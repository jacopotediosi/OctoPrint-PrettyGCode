import { arcOffsetFromRadius, interpolateArc } from './arc-interpolation'
import { BeltPrinterTransform } from '../printer-transform/belt-printer-transform'
import { SlicerTimeMarksCollector, type SlicerTimeMarks } from './slicer-time-marks'

/* ---- Parse result ---- */

/** A parsed gcode */
export interface ParsedGcode {
  /** Parsed layers (segment endpoints, feature types...) */
  layers: Layer[]
  /** Bounding box of the extruded gcode */
  bounds: GcodeBounds
  /** Nozzle diameter the slicer states, if any */
  slicerNozzleDiameter: number | null
  /** Print times the slicer states along the file, if any */
  slicerTimeMarks: SlicerTimeMarks | null
  /** Lowercased feature type comments the gcode states, by feature type id */
  featureTypeComments: string[]
  /** Names of the objects marked in the gcode, by object id */
  objectNames: string[]
}

/** One parsed layer and its properties */
export interface Layer {
  vertices: Float32Array
  z: number
  filePositions: Uint32Array
  durations: Float32Array
  objectIds: Int32Array | null
  featureTypeIds: SegmentProperty
  feedrates: SegmentProperty
  fanSpeeds: SegmentProperty
  temperatures: SegmentProperty
  travelVertices: Float32Array
  travelSegmentIndices: Uint32Array
}

/** A property of the segments, recorded only where it changes */
export interface SegmentProperty {
  /** Segment of the layer each property value starts at */
  segmentIndices: Uint32Array
  /** Value the property takes from that segment on */
  values: Float32Array
}

/** The value each property takes on one segment */
export interface SegmentPropertyValues {
  /** Id of the feature type the segment belongs to, -1 for none */
  featureTypeId: number
  /** Speed of the segment in mm/s */
  feedrate: number
  /** Speed of the print cooling fan in percent */
  fanSpeed: number
  /** Nozzle temperature in degrees Celsius */
  temperature: number
}

/** Box the parsed gcode fits in */
export interface GcodeBounds {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

/**
 * Builds empty bounds
 * @returns The empty bounds
 */
export const emptyBounds = (): GcodeBounds => ({ minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity })

/** A point of the parsed gcode, in scene coordinates */
export interface ScenePoint {
  x: number
  y: number
  z: number
}

/* ---- Machine state ---- */

/** Machine state the parser tracks */
export interface MachineState {
  x: number
  y: number
  z: number
  e: number
  f: number
}

/** Initial machine state */
const INITIAL_MACHINE_STATE: MachineState = Object.freeze({ x: 0, y: 0, z: 0, e: 0, f: 0 })

/**
 * Converts a feedrate to mm/s, with a sane pace for moves before any F word is seen
 * @param feedrate - Feedrate in mm/min
 * @returns Speed in mm/s
 */
const feedrateMmPerSecond = (feedrate: number): number => (feedrate > 0 ? feedrate : 1500) / 60

/* ---- Gcode text ---- */

/** Matches non-ASCII characters, whose lines need real encoding to be measured */
const NON_ASCII = /[\u0080-\uffff]/

/** Encoder measuring lines in bytes */
const textEncoder = new TextEncoder()

/**
 * Measures a gcode line on the decoded text, the way OctoPrint measures the print position
 * @param line - Line to measure
 * @returns Its length in bytes
 */
const lineByteLength = (line: string): number => NON_ASCII.test(line) ? textEncoder.encode(line).length : line.length

/** Matches the nozzle diameter stated by the slicer, e.g. "; nozzle_diameter = 0.4" */
const NOZZLE_DIAMETER_COMMENT = /nozzle[_ ]?diameter\s*[:=]\s*([\d.]+)/i

/**
 * Matches the marker opening a slicer's feature-type comment
 * - ;TYPE:<label>      PrusaSlicer/SuperSlicer/Cura, OrcaSlicer (non-Bambu-Lab printers)
 * - ; FEATURE: <label> Bambu Studio, OrcaSlicer (Bambu Lab printers)
 * - ; feature <label>  Simplify3D
 */
const FEATURE_TYPE_COMMENT = /;\s*(type:|feature[ :])/i

/** Prefix, lowercased, of the comment stating the print time elapsed so far */
const TIME_ELAPSED_COMMENT = ';time_elapsed:'

/* ---- Layers ---- */

/** A property of the segments being filled, kept only where it changes */
class OpenSegmentProperty {
  private readonly segmentIndices: number[] = []
  private readonly values: number[] = []

  /**
   * Records the value the property takes on a segment
   * @param segment - Segment index within the layer
   * @param value - Value the property takes there
   */
  add (segment: number, value: number): void {
    if (this.values[this.values.length - 1] === value) return

    this.segmentIndices.push(segment)
    this.values.push(value)
  }

  /**
   * Builds the property from the values recorded so far
   * @returns The built property
   */
  finish (): SegmentProperty {
    return { segmentIndices: Uint32Array.from(this.segmentIndices), values: Float32Array.from(this.values) }
  }
}

/** Z step below which a move stays in the same layer: vase mode rises continuously and would split a layer per segment */
const LAYER_EPSILON_MM = 0.04

/** A layer being filled with segments and with the travels leading to them */
class OpenLayer {
  /** Initial size of segment buffers */
  private static readonly INITIAL_BUFFERS_CAPACITY = 1024
  /** Initial size of travel buffers */
  private static readonly INITIAL_TRAVEL_BUFFERS_CAPACITY = 128

  private vertices = new Float32Array(OpenLayer.INITIAL_BUFFERS_CAPACITY * 6)
  private filePositions = new Uint32Array(OpenLayer.INITIAL_BUFFERS_CAPACITY)
  private durations = new Float32Array(OpenLayer.INITIAL_BUFFERS_CAPACITY * 2)
  private objectIds: Int32Array | null = null
  private readonly featureTypeIds = new OpenSegmentProperty()
  private readonly feedrates = new OpenSegmentProperty()
  private readonly fanSpeeds = new OpenSegmentProperty()
  private readonly temperatures = new OpenSegmentProperty()
  private capacity = OpenLayer.INITIAL_BUFFERS_CAPACITY
  private segments = 0

  private travelVertices = new Float32Array(OpenLayer.INITIAL_TRAVEL_BUFFERS_CAPACITY * 6)
  private travelSegmentIndices = new Uint32Array(OpenLayer.INITIAL_TRAVEL_BUFFERS_CAPACITY)
  private travelCapacity = OpenLayer.INITIAL_TRAVEL_BUFFERS_CAPACITY
  private travels = 0

  constructor (readonly z: number) {}

  /**
   * Appends a segment
   * @param start - Segment start point
   * @param end - Segment end point
   * @param filePosition - Byte offset of the segment's line in the file
   * @param travelSeconds - Estimated travel time leading to the segment
   * @param extrusionSeconds - Estimated time extruding the segment
   * @param objectId - Id of the object the segment belongs to, -1 for none
   * @param propertyValues - Value each property takes on the segment
   */
  addSegment (start: ScenePoint, end: ScenePoint, filePosition: number, travelSeconds: number, extrusionSeconds: number, objectId: number, propertyValues: SegmentPropertyValues): void {
    if (this.segments === this.capacity) this.growSegments()

    const vertex = this.segments * 6
    this.vertices[vertex] = start.x
    this.vertices[vertex + 1] = start.y
    this.vertices[vertex + 2] = start.z
    this.vertices[vertex + 3] = end.x
    this.vertices[vertex + 4] = end.y
    this.vertices[vertex + 5] = end.z

    this.filePositions[this.segments] = filePosition
    this.durations[this.segments * 2] = travelSeconds
    this.durations[this.segments * 2 + 1] = extrusionSeconds

    // Start storing object ids at the first segment that belongs to one
    if (objectId >= 0 && !this.objectIds) this.objectIds = new Int32Array(this.capacity).fill(-1)
    if (this.objectIds) this.objectIds[this.segments] = objectId

    this.featureTypeIds.add(this.segments, propertyValues.featureTypeId)
    this.feedrates.add(this.segments, propertyValues.feedrate)
    this.fanSpeeds.add(this.segments, propertyValues.fanSpeed)
    this.temperatures.add(this.segments, propertyValues.temperature)

    this.segments++
  }

  /**
   * Appends the travels leading to the segment the layer takes next
   * @param vertices - Travel endpoints as flat XYZ triplets
   * @param travels - Travels the vertices hold
   */
  addTravels (vertices: Float32Array, travels: number): void {
    while (this.travels + travels > this.travelCapacity) this.growTravels()

    this.travelVertices.set(vertices.subarray(0, travels * 6), this.travels * 6)
    this.travelSegmentIndices.fill(this.segments, this.travels, this.travels + travels)
    this.travels += travels
  }

  /** Doubles the capacity of the segment buffers */
  private growSegments (): void {
    this.capacity *= 2

    const vertices = new Float32Array(this.capacity * 6)
    vertices.set(this.vertices)
    this.vertices = vertices

    const filePositions = new Uint32Array(this.capacity)
    filePositions.set(this.filePositions)
    this.filePositions = filePositions

    const durations = new Float32Array(this.capacity * 2)
    durations.set(this.durations)
    this.durations = durations

    if (this.objectIds) {
      const objectIds = new Int32Array(this.capacity).fill(-1)
      objectIds.set(this.objectIds)
      this.objectIds = objectIds
    }
  }

  /** Doubles the capacity of the travel buffers */
  private growTravels (): void {
    this.travelCapacity *= 2

    const travelVertices = new Float32Array(this.travelCapacity * 6)
    travelVertices.set(this.travelVertices)
    this.travelVertices = travelVertices

    const travelSegmentIndices = new Uint32Array(this.travelCapacity)
    travelSegmentIndices.set(this.travelSegmentIndices)
    this.travelSegmentIndices = travelSegmentIndices
  }

  /**
   * Finishes the layer
   * @returns The finished layer
   */
  finish (): Layer {
    return {
      z: this.z,
      vertices: this.vertices.slice(0, this.segments * 6),
      filePositions: this.filePositions.slice(0, this.segments),
      durations: this.durations.slice(0, this.segments * 2),
      objectIds: this.objectIds ? this.objectIds.slice(0, this.segments) : null,
      featureTypeIds: this.featureTypeIds.finish(),
      feedrates: this.feedrates.finish(),
      fanSpeeds: this.fanSpeeds.finish(),
      temperatures: this.temperatures.finish(),
      travelVertices: this.travelVertices.slice(0, this.travels * 6),
      travelSegmentIndices: this.travelSegmentIndices.slice(0, this.travels)
    }
  }
}

/* ---- Parser ---- */

/** Scratch point reused for the scene start of each move */
const scratchStart: ScenePoint = { x: 0, y: 0, z: 0 }
/** Scratch point reused for the scene end of each move */
const scratchEnd: ScenePoint = { x: 0, y: 0, z: 0 }

/** Travel length below which the move is not drawn */
const MIN_TRAVEL_LENGTH_MM = 0.5

/** Streaming gcode parser: feed it byte chunks to get layers of segments with feature types, file positions and time estimates */
export class GcodeParser {
  /* ---- Parse result ---- */

  /** Parsed layers: segment endpoints, feature types, file positions and estimated durations */
  readonly layers: Layer[] = []
  /** Bounding box of the extruded gcode */
  bounds = emptyBounds()
  /** Nozzle diameter the slicer states, if any */
  slicerNozzleDiameter: number | null = null
  /** Print times the slicer states along the file, if any */
  slicerTimeMarks: SlicerTimeMarks | null = null
  /** Lowercased feature type comments the gcode states, by feature type id */
  readonly featureTypeComments: string[] = []
  /** Names of the objects marked in the gcode, by object id */
  readonly objectNames: string[] = []

  /* ---- Gcode text ---- */

  /** Decoder turning the gcode bytes into text, keeping the byte order mark so it counts toward the file position */
  private readonly decoder = new TextDecoder('utf-8', { ignoreBOM: true })
  /** Partial line left over from the previous chunk */
  private pendingLine = ''
  /** Bytes parsed so far */
  private filePosition = 0

  /* ---- Machine state ---- */

  /** Current machine state */
  private machineState: MachineState = INITIAL_MACHINE_STATE
  /** Whether axis moves are relative */
  private axesRelative = false
  /** Whether extrusion is relative */
  private extrusionRelative = false
  /** Whether G90/G91 also switch the extrusion mode, not only the axes */
  private readonly g90InfluencesExtruder: boolean
  /** Transform of the belt printer the gcode is meant for, null for non-belt printers */
  private readonly printerTransform: BeltPrinterTransform | null

  /* ---- Layers ---- */

  /** Layer being filled, if any */
  private currentLayer: OpenLayer | null = null
  /** Layers opened so far */
  private layersOpened = 0

  /* ---- Travels ---- */

  /** Initial size of the buffer holding the travels waiting for the segment they lead to */
  private static readonly INITIAL_PENDING_TRAVELS_CAPACITY = 16

  /** Travel time accumulated since the last segment */
  private pendingTravelSeconds = 0
  /** Endpoints of the travels made since the last segment */
  private pendingTravelVertices = new Float32Array(GcodeParser.INITIAL_PENDING_TRAVELS_CAPACITY * 6)
  /** Travels made since the last segment */
  private pendingTravels = 0

  /* ---- Segment properties ---- */

  /** Value each property takes on the segments being parsed */
  private readonly currentPropertyValues: SegmentPropertyValues = { featureTypeId: -1, feedrate: 0, fanSpeed: 0, temperature: 0 }
  /** Whether a feature type comment of the printed model has been seen yet */
  private featureTypeCommentSeen = false

  /* ---- Object markers ---- */

  /** Tag of the object markers, lowercased */
  private readonly objectTag: string
  /** Id of the object the parsed segments belong to, -1 for none */
  private currentObjectId = -1

  /* ---- Slicer time marks ---- */

  /** Collector of the print times the slicer states along the file */
  private readonly slicerTimeMarksCollector = new SlicerTimeMarksCollector()

  /**
   * @param objectTag - Tag of the "@<tag> <name>" object markers
   * @param g90InfluencesExtruder - Whether G90/G91 also switch the extrusion mode
   * @param beltPrinterGantryAngle - Angle between the belt and the printer gantry in degrees, null for non-belt printers
   */
  constructor (objectTag = 'Object', g90InfluencesExtruder = false, beltPrinterGantryAngle: number | null = null) {
    this.objectTag = objectTag.toLowerCase()
    this.g90InfluencesExtruder = g90InfluencesExtruder
    this.printerTransform = beltPrinterGantryAngle == null ? null : new BeltPrinterTransform(beltPrinterGantryAngle)
  }

  /**
   * Parses the next chunk of gcode bytes; chunks may split lines anywhere
   * @param chunk - Raw gcode bytes
   */
  parse (chunk: Uint8Array): void {
    // Chunks may split a line in two: prepend last call's leftover, hold the new trailing partial for next time
    const lines = this.decoder.decode(chunk, { stream: true }).split('\n')
    lines[0] = this.pendingLine + lines[0]
    this.pendingLine = lines[lines.length - 1]

    for (let i = 0; i < lines.length - 1; i++) {
      this.filePosition += lineByteLength(lines[i]) + 1
      this.parseLine(lines[i])
    }
  }

  /**
   * Parses one line of gcode
   * @param rawLine - Gcode line, comment included
   */
  private parseLine (rawLine: string): void {
    // Drop the byte order mark
    if (rawLine.startsWith('\ufeff')) rawLine = rawLine.slice(1)

    // Parse object markers
    if (rawLine.startsWith('@')) {
      this.parseObjectMarker(rawLine)
      return
    }

    // Parse comments
    const commentStart = rawLine.indexOf(';')
    if (commentStart >= 0) {
      const commentLower = rawLine.toLowerCase()

      // Take the feature type from feature-type comments only
      if (FEATURE_TYPE_COMMENT.test(commentLower)) {
        const id = this.featureTypeComments.indexOf(commentLower)
        this.currentPropertyValues.featureTypeId = id >= 0 ? id : this.featureTypeComments.push(commentLower) - 1

        // First feature type seen, not counting the slicers' own start gcode
        if (!this.featureTypeCommentSeen && !commentLower.includes('custom')) {
          this.featureTypeCommentSeen = true
          // Drop the pre-print moves (e.g., calibration/wiping/purge lines) gathered so far from the model bounds
          this.bounds = emptyBounds()
        }
      }

      // First nozzle diameter the slicer states wins
      if (this.slicerNozzleDiameter == null) {
        const nozzleMatch = commentLower.match(NOZZLE_DIAMETER_COMMENT)
        if (nozzleMatch) this.slicerNozzleDiameter = parseFloat(nozzleMatch[1])
      }

      // Take the elapsed print time the slicer states
      if (commentLower.startsWith(TIME_ELAPSED_COMMENT, commentStart)) {
        this.slicerTimeMarksCollector.addElapsed(this.filePosition, parseFloat(rawLine.slice(commentStart + TIME_ELAPSED_COMMENT.length)))
      }
    }

    // Parse gcode cmd and args
    // Temporary workaround for https://github.com/OctoPrint/OctoPrint/issues/5438: the babel-polyfill
    // library OctoPrint ships replaces the browser's own trim with a far slower one, so the line
    // bounds are found here without using it
    const lineEnd = commentStart < 0 ? rawLine.length : commentStart
    let lineStart = 0
    while (lineStart < lineEnd && rawLine[lineStart] <= ' ') lineStart++
    let lineStop = lineEnd
    while (lineStop > lineStart && rawLine[lineStop - 1] <= ' ') lineStop--

    const tokens = rawLine.slice(lineStart, lineStop).split(' ')
    const cmd = tokens[0].toUpperCase()
    const args: Record<string, number> = {}
    for (let token = 1; token < tokens.length; token++) {
      const word = tokens[token]
      if (!word) continue

      // Temporary workaround for https://github.com/OctoPrint/OctoPrint/issues/5438: the babel-polyfill
      // library OctoPrint ships replaces the browser's own parseFloat with a far slower one, so the
      // unary plus reads the number instead, and only what it cannot read goes through parseFloat
      const text = word.substring(1)
      const number = text === '' ? NaN : +text
      args[word[0].toLowerCase()] = Number.isNaN(number) ? parseFloat(text) : number
    }

    // Axis value from args (absolute/relative aware), or the current one if omitted
    const coord = (key: keyof MachineState): number => {
      if (args[key] === undefined) return this.machineState[key]
      if (key === 'f') return args.f
      const relative = key === 'e' ? this.extrusionRelative : this.axesRelative
      return relative ? this.machineState[key] + args[key] : args[key]
    }

    switch (cmd) {
      case 'G0': // Rapid move
      case 'G1': { // Linear move
        const move: MachineState = { x: coord('x'), y: coord('y'), z: coord('z'), e: coord('e'), f: coord('f') }
        const extruding = this.extrusionDelta(args, move) > 0

        // New layer when extrusion moves to a different Z
        if (extruding && (this.currentLayer == null || Math.abs(move.z - this.currentLayer.z) > LAYER_EPSILON_MM)) {
          this.changeLayer(move)
        }

        // Extrude a segment when the move lays down material, otherwise track the travel time
        if (extruding) this.addSegment(this.machineState, move)
        else this.addTravel(this.machineState, move)
        this.machineState = move
        break
      }
      case 'G2': // Clockwise arc move
      case 'G3': { // Counter-clockwise arc move
        const move: MachineState = {
          x: coord('x'),
          y: coord('y'),
          z: coord('z'),
          e: coord('e'), // extruder position
          f: coord('f') // feedrate
        }
        const extruding = this.extrusionDelta(args, move) > 0

        // New layer when extrusion moves to a different Z
        if (extruding && (this.currentLayer == null || Math.abs(move.z - this.currentLayer.z) > LAYER_EPSILON_MM)) {
          this.changeLayer(move)
        }

        // Center offset from the I/J words, or computed from the radius of an R-form arc
        const offset = args.r !== undefined
          ? arcOffsetFromRadius(this.machineState, move, args.r, cmd === 'G2')
          : { i: args.i ?? 0, j: args.j ?? 0 }

        // Arcs with K, or an R that gives no usable center, fall back to a straight segment
        // so the next moves still start from the right point
        if (args.k !== undefined || (args.r !== undefined && !offset.i && !offset.j)) {
          console.warn('PrettyGCode: Unsupported arc', rawLine)
          if (extruding) this.addSegment(this.machineState, move)
          else this.addTravel(this.machineState, move)
          this.machineState = move
          break
        }

        // Split the arc into straight segments
        const arc = {
          ...move,
          i: offset.i, // X offset from start to arc center
          j: offset.j, // Y offset from start to arc center
          is_clockwise: cmd === 'G2'
        }
        const segments = interpolateArc(this.machineState, arc)
        for (let segmentIndex = 1; segmentIndex < segments.length; segmentIndex++) {
          if (extruding) this.addSegment(segments[segmentIndex - 1], segments[segmentIndex])
          else this.addTravel(segments[segmentIndex - 1], segments[segmentIndex])
        }
        this.machineState = segments[segments.length - 1]
        break
      }
      case 'G4': { // Dwell: the pause adds to the time of the travel toward the next segment
        this.pendingTravelSeconds += (args.s || 0) + (args.p || 0) / 1000
        break
      }
      case 'G28': { // Home: the named axes (all of them if none is given) end up at the origin
        const all = args.x === undefined && args.y === undefined && args.z === undefined
        this.machineState = {
          ...this.machineState,
          x: all || args.x !== undefined ? 0 : this.machineState.x,
          y: all || args.y !== undefined ? 0 : this.machineState.y,
          z: all || args.z !== undefined ? 0 : this.machineState.z
        }
        break
      }
      case 'G90': { // Absolute positioning
        this.axesRelative = false
        if (this.g90InfluencesExtruder) this.extrusionRelative = false
        break
      }
      case 'G91': { // Relative positioning
        this.axesRelative = true
        if (this.g90InfluencesExtruder) this.extrusionRelative = true
        break
      }
      case 'M73': { // Remaining print time the slicer states
        if (args.r !== undefined) this.slicerTimeMarksCollector.addRemaining(this.filePosition, args.r * 60)
        break
      }
      case 'M82': { // Absolute extrusion
        this.extrusionRelative = false
        break
      }
      case 'M83': { // Relative extrusion
        this.extrusionRelative = true
        break
      }
      case 'M104': // Set the nozzle temperature
      case 'M109': { // Set the nozzle temperature and wait for it to be reached
        this.currentPropertyValues.temperature = args.s ?? args.r ?? this.currentPropertyValues.temperature
        break
      }
      case 'M106': { // Set the print cooling fan speed, which the printers scale from 0 to 255
        // Bambu Lab printers number the print cooling fan as P1 and their other fans from P2 up
        if (args.p === undefined || args.p === 1) this.currentPropertyValues.fanSpeed = (args.s ?? 255) * 100 / 255
        break
      }
      case 'M107': { // Stop the print cooling fan
        this.currentPropertyValues.fanSpeed = 0
        break
      }
      case 'G92': { // Set position without moving
        this.machineState = {
          ...this.machineState,
          x: args.x ?? this.machineState.x,
          y: args.y ?? this.machineState.y,
          z: args.z ?? this.machineState.z,
          e: args.e ?? this.machineState.e
        }
        break
      }
    }
  }

  /**
   * Computes the E increment brought by a single command, whatever the E mode
   * @param args - Parsed command arguments
   * @param move - Machine state after the command
   * @returns The extruded length in mm
   */
  private extrusionDelta (args: Record<string, number>, move: MachineState): number {
    if (args.e === undefined) return 0
    return this.extrusionRelative ? args.e : move.e - this.machineState.e
  }

  /**
   * Parse the object marker, updating the current object id
   * @param rawLine - Object marker line, starting with "@"
   */
  private parseObjectMarker (rawLine: string): void {
    const space = rawLine.indexOf(' ')
    const command = (space < 0 ? rawLine : rawLine.slice(0, space)).slice(1).toLowerCase()

    if (command === this.objectTag + 'stop') {
      this.currentObjectId = -1
    } else if (command === this.objectTag && space > 0) {
      const name = rawLine.slice(space + 1).trim()
      if (!name) return

      const id = this.objectNames.indexOf(name)
      this.currentObjectId = id >= 0 ? id : this.objectNames.push(name) - 1
    }
  }

  /**
   * Opens a new layer and makes it current
   * @param move - Machine state starting the layer
   * @returns The new layer
   */
  private changeLayer (move: MachineState): OpenLayer {
    this.sealLayer()
    this.layersOpened++
    this.currentLayer = new OpenLayer(move.z)
    return this.currentLayer
  }

  /** Seals the open layer, if any */
  private sealLayer (): void {
    if (!this.currentLayer) return
    this.layers.push(this.currentLayer.finish())
    this.currentLayer = null
  }

  /** Finishes parsing */
  finish (): void {
    // Parse the last line of a file that does not end with a newline
    if (this.pendingLine) {
      this.filePosition += lineByteLength(this.pendingLine)
      this.parseLine(this.pendingLine)
      this.pendingLine = ''
    }

    this.sealLayer()
    this.slicerTimeMarks = this.slicerTimeMarksCollector.getMarks()
    if (this.printerTransform) this.slidePrintToBeltOrigin()
  }

  /** Slides the print along the belt so it starts at the belt origin, where the printed shape trails behind it */
  private slidePrintToBeltOrigin (): void {
    const offset = -this.bounds.minY
    if (!Number.isFinite(offset)) return

    for (const { vertices, travelVertices } of this.layers) {
      for (let y = 1; y < vertices.length; y += 3) vertices[y] += offset
      for (let y = 1; y < travelVertices.length; y += 3) travelVertices[y] += offset
    }
    this.bounds.minY += offset
    this.bounds.maxY += offset
  }

  /**
   * Adds a non-extruding move, whose time is charged to the gap before the next segment
   * @param start - Machine state at the move start
   * @param end - Machine state at the move end
   */
  private addTravel (start: MachineState, end: MachineState): void {
    const distance = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)
    this.pendingTravelSeconds += (distance || Math.abs(end.e - start.e) || 0) / feedrateMmPerSecond(end.f)

    // Keep the travels long enough to draw, from the first layer on
    if (distance >= MIN_TRAVEL_LENGTH_MM && this.layersOpened > 0) {
      // Grow the pending buffer when a gap holds more travels than it fits
      const vertex = this.pendingTravels * 6
      if (vertex === this.pendingTravelVertices.length) {
        const pendingTravelVertices = new Float32Array(vertex * 2)
        pendingTravelVertices.set(this.pendingTravelVertices)
        this.pendingTravelVertices = pendingTravelVertices
      }

      // Turn the machine points into the points the travel runs between
      const printerTransform = this.printerTransform
      const sceneStart = printerTransform ? printerTransform.toScenePoint(start, scratchStart) : start
      const sceneEnd = printerTransform ? printerTransform.toScenePoint(end, scratchEnd) : end
      this.pendingTravelVertices[vertex] = sceneStart.x
      this.pendingTravelVertices[vertex + 1] = sceneStart.y
      this.pendingTravelVertices[vertex + 2] = sceneStart.z
      this.pendingTravelVertices[vertex + 3] = sceneEnd.x
      this.pendingTravelVertices[vertex + 4] = sceneEnd.y
      this.pendingTravelVertices[vertex + 5] = sceneEnd.z
      this.pendingTravels++
    }
  }

  /**
   * Grows the model bounds to contain a point
   * @param point - Point to contain
   */
  private expandBounds (point: ScenePoint): void {
    const bounds = this.bounds
    bounds.minX = Math.min(bounds.minX, point.x)
    bounds.minY = Math.min(bounds.minY, point.y)
    bounds.minZ = Math.min(bounds.minZ, point.z)
    bounds.maxX = Math.max(bounds.maxX, point.x)
    bounds.maxY = Math.max(bounds.maxY, point.y)
    bounds.maxZ = Math.max(bounds.maxZ, point.z)
  }

  /**
   * Appends an extruded segment to the current layer
   * @param start - Machine state at the segment start
   * @param end - Machine state at the segment end
   */
  private addSegment (start: MachineState, end: MachineState): void {
    // Check coordinates
    if (Number.isNaN(start.x) || Number.isNaN(start.y) || Number.isNaN(start.z) || Number.isNaN(end.x) || Number.isNaN(end.y) || Number.isNaN(end.z)) {
      console.warn('PrettyGCode: bad line segment', start, end)
      return
    }

    // Open a layer if none is active yet
    const layer = this.currentLayer ?? this.changeLayer(start)

    // Estimated seconds of the travel leading here and of the segment itself
    const distance = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)
    const length = distance || Math.abs(end.e - start.e) || 0
    const travelSeconds = this.pendingTravelSeconds
    const feedrate = feedrateMmPerSecond(end.f)
    const extrusionSeconds = length / feedrate
    this.pendingTravelSeconds = 0

    // Attach the travels leading here to the layer
    if (this.pendingTravels) {
      layer.addTravels(this.pendingTravelVertices, this.pendingTravels)
      this.pendingTravels = 0
    }

    // Turn the machine points into the points the segment prints at
    const printerTransform = this.printerTransform
    const sceneStart = printerTransform ? printerTransform.toScenePoint(start, scratchStart) : start
    const sceneEnd = printerTransform ? printerTransform.toScenePoint(end, scratchEnd) : end

    // Grow the model bounds only on moves that change position
    if (start.x !== end.x || start.y !== end.y || start.z !== end.z) {
      this.expandBounds(sceneStart)
      this.expandBounds(sceneEnd)
    }

    // Add the segment to the layer
    this.currentPropertyValues.feedrate = feedrate
    layer.addSegment(sceneStart, sceneEnd, this.filePosition, travelSeconds, extrusionSeconds, this.currentObjectId, this.currentPropertyValues)
  }
}
