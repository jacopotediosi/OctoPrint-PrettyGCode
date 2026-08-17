import { arcOffsetFromRadius, interpolateArc } from './arc-interpolation'
import { BeltPrinterTransform } from '../printer-transform/belt-printer-transform'
import { ColorChangesCollector } from './collectors/color-changes'
import { ExtrusionSizeCollector } from './collectors/extrusion-size'
import { FeatureTypesCollector } from './collectors/feature-types'
import { GcodeBoundsCollector } from './collectors/gcode-bounds'
import { MarkedObjectsCollector } from './collectors/marked-objects'
import { NozzleTemperaturesCollector } from './collectors/nozzle-temperatures'
import { vectorLength } from '../../utils/numbers'
import { OpenLayer } from './open-layer'
import type { Layer, MachineState, ParsedGcode, ScenePoint, SegmentPropertyValues } from './parsed-gcode'
import { LAYER_CHANGE_COMMENT_PATTERN } from './slicer-comments'
import { SlicerConfigCollector } from './collectors/slicer-config'
import { SlicerTimeMarksCollector } from './collectors/slicer-time-marks'

/* ---- Machine state ---- */

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
const NON_ASCII_PATTERN = /[\u0080-\uffff]/

/** Encoder measuring lines in bytes */
const textEncoder = new TextEncoder()

/**
 * Measures a gcode line on the decoded text, the way OctoPrint measures the print position
 * @param line - Line to measure
 * @returns Its length in bytes
 */
const lineByteLength = (line: string): number => NON_ASCII_PATTERN.test(line) ? textEncoder.encode(line).length : line.length

/* ---- Scene points ---- */

/** Scratch point reused for the scene start of each move */
const scratchStart: ScenePoint = { x: 0, y: 0, z: 0 }
/** Scratch point reused for the scene end of each move */
const scratchEnd: ScenePoint = { x: 0, y: 0, z: 0 }

/* ---- Commands ---- */

/** Highest tool number a T command selects */
const HIGHEST_TOOL_NUMBER = 254

/** Words giving a length, by the commands carrying them */
const LENGTH_WORDS_BY_COMMANDS = [
  {
    commands: new Set(['G0', 'G1', 'G2', 'G3', 'G28', 'G92']),
    words: [
      'x', // position along the X axis
      'y', // position along the Y axis
      'z', // position along the Z axis
      'e', // extruder position
      'f' // feedrate
    ]
  },
  {
    commands: new Set(['G2', 'G3']),
    words: [
      'i', // X offset from start to arc center
      'j', // Y offset from start to arc center
      'k', // Z offset from start to arc center
      'r' // radius of the arc
    ]
  }
]

/* ---- Layers ---- */

/** Z step below which a move stays in the same layer: vase mode rises continuously and would split a layer per segment */
const LAYER_EPSILON_MM = 0.04

/* ---- Travels ---- */

/** Travel length below which the move is not drawn */
const MIN_TRAVEL_LENGTH_MM = 0.5

/** Streaming gcode parser, turning the bytes of a gcode file into layers of segments with their properties, file positions and time estimates */
export class GcodeParser {
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
  /** Millimeters a gcode length unit stands for (a gcode can switch between inches and millimeters) */
  private mmPerUnit = 1
  /** Factor the gcode scales its extrusion by */
  private flowFactor = 1
  /** Whether G90/G91 also switch the extrusion mode, not only the axes */
  private readonly g90InfluencesExtruder: boolean
  /** Transform of the belt printer the gcode is meant for, null for non-belt printers */
  private readonly printerTransform: BeltPrinterTransform | null

  /* ---- Layers ---- */

  /** Parsed layers, in the order the gcode prints them */
  private readonly layers: Layer[] = []
  /** Layer being filled, if any */
  private currentLayer: OpenLayer | null = null
  /** Layers opened so far */
  private layersOpened = 0
  /** Whether the gcode states its layer changes */
  private statesLayerChanges = false
  /** Whether a stated layer change is waiting for the extrusion opening its layer */
  private pendingLayerChange = false
  /** Whether the layer being filled holds the slicer's own custom gcode only */
  private customLayer = false

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
  private readonly currentPropertyValues: SegmentPropertyValues = { featureTypeId: -1, toolId: 0, colorChangeId: -1, feedrate: 0, fanSpeed: 0, temperature: 0, width: 0, height: 0, filamentPerMm: 0 }

  /* ---- Collectors ---- */

  /** Collector of the box the extruded gcode fits in */
  private readonly gcodeBoundsCollector = new GcodeBoundsCollector()
  /** Collector of the print settings the slicer states */
  private readonly slicerConfigCollector = new SlicerConfigCollector()
  /** Collector of the color changes the gcode states */
  private readonly colorChangesCollector = new ColorChangesCollector()
  /** Collector of the print times the slicer states */
  private readonly slicerTimeMarksCollector = new SlicerTimeMarksCollector()
  /** Collector of the feature types the gcode states */
  private readonly featureTypesCollector = new FeatureTypesCollector()
  /** Collector of the objects the gcode marks */
  private readonly markedObjectsCollector: MarkedObjectsCollector
  /** Collector of the nozzle temperatures the gcode sets */
  private readonly nozzleTemperaturesCollector = new NozzleTemperaturesCollector()
  /** Collector of the size of the lines the gcode extrudes */
  private readonly extrusionSizeCollector = new ExtrusionSizeCollector()

  /**
   * @param objectTag - Tag of the "@<tag> <name>" object markers
   * @param g90InfluencesExtruder - Whether G90/G91 also switch the extrusion mode
   * @param beltPrinterGantryAngle - Angle between the belt and the printer gantry in degrees, null for non-belt printers
   */
  constructor (objectTag = 'Object', g90InfluencesExtruder = false, beltPrinterGantryAngle: number | null = null) {
    this.markedObjectsCollector = new MarkedObjectsCollector(objectTag)
    this.g90InfluencesExtruder = g90InfluencesExtruder
    this.printerTransform = beltPrinterGantryAngle == null ? null : new BeltPrinterTransform(beltPrinterGantryAngle)
  }

  /* ---- Gcode text ---- */

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

    // Collect the objects the gcode marks
    if (rawLine.startsWith('@')) {
      this.markedObjectsCollector.addMarker(rawLine)
      return
    }

    // Parse comments
    const commentStart = rawLine.indexOf(';')
    if (commentStart >= 0) this.parseComment(rawLine, commentStart)

    // Parse gcode cmd and args
    const args: Record<string, number> = {}
    const cmd = this.parseCommand(rawLine, commentStart, args)
    this.applyCommand(cmd, args, rawLine)
  }

  /* ---- Comments ---- */

  /**
   * Parses the comment of a line, taking the values the slicer states in it
   * @param rawLine - Gcode line holding the comment
   * @param commentStart - Offset the comment starts at
   */
  private parseComment (rawLine: string, commentStart: number): void {
    const commentLower = rawLine.toLowerCase()

    // Collect the feature types the gcode states
    if (this.featureTypesCollector.addComment(rawLine, commentLower)) {
      // Drop the pre-print moves (e.g., calibration/wiping/purge lines) gathered so far from the model bounds
      this.gcodeBoundsCollector.reset()
    }

    // Record the layer changes the slicer states, which take over from the Z rule
    if (LAYER_CHANGE_COMMENT_PATTERN.test(commentLower)) {
      this.statesLayerChanges = true
      this.pendingLayerChange = true
    }

    // Collect the extrusion size the slicer states
    this.extrusionSizeCollector.addComment(commentLower)

    // Collect the print settings the slicer states
    this.slicerConfigCollector.addComment(commentLower)

    // Collect the color changes the gcode states
    this.colorChangesCollector.addComment(commentLower, this.machineState.z)

    // Collect the print times the slicer states
    this.slicerTimeMarksCollector.addComment(rawLine, commentLower, commentStart, this.filePosition)
  }

  /* ---- Commands ---- */

  /**
   * Parses the command a line carries and the arguments that follow it
   * @param rawLine - Gcode line, comment included
   * @param commentStart - Offset the comment starts at, -1 for a line carrying none
   * @param args - Object each argument is written into, by lowercased word
   * @returns The command, uppercased, empty when the line carries none
   */
  private parseCommand (rawLine: string, commentStart: number, args: Record<string, number>): string {
    // Temporary workaround for https://github.com/OctoPrint/OctoPrint/issues/5438: the babel-polyfill
    // library OctoPrint ships replaces the browser's own trim with a far slower one, so the line
    // bounds are found here without using it
    const lineEnd = commentStart < 0 ? rawLine.length : commentStart
    let lineStart = 0
    while (lineStart < lineEnd && rawLine[lineStart] <= ' ') lineStart++
    let lineStop = lineEnd
    while (lineStop > lineStart && rawLine[lineStop - 1] <= ' ') lineStop--

    // The command runs up to the first space
    let wordStop = rawLine.indexOf(' ', lineStart)
    if (wordStop < 0 || wordStop > lineStop) wordStop = lineStop
    const cmd = rawLine.slice(lineStart, wordStop).toUpperCase()

    // Read the words that follow, one per space
    while (wordStop < lineStop) {
      const wordStart = wordStop + 1
      wordStop = rawLine.indexOf(' ', wordStart)
      if (wordStop < 0 || wordStop > lineStop) wordStop = lineStop
      if (wordStop === wordStart) continue

      // Temporary workaround for https://github.com/OctoPrint/OctoPrint/issues/5438: the babel-polyfill
      // library OctoPrint ships replaces the browser's own parseFloat with a far slower one, so the
      // unary plus reads the number instead, and only what it cannot read goes through parseFloat
      const text = rawLine.slice(wordStart + 1, wordStop)
      const number = text === '' ? NaN : +text
      args[rawLine[wordStart].toLowerCase()] = Number.isNaN(number) ? parseFloat(text) : number
    }

    // Bring the lengths to millimeters
    if (this.mmPerUnit !== 1) {
      for (const { commands, words } of LENGTH_WORDS_BY_COMMANDS) {
        if (!commands.has(cmd)) continue
        for (const word of words) {
          if (args[word] !== undefined) args[word] *= this.mmPerUnit
        }
      }
    }

    return cmd
  }

  /**
   * Applies a command to the tracked machine state, adding the segments it prints
   * @param cmd - Command to apply, uppercased
   * @param args - Arguments the command carries, by lowercased word
   * @param rawLine - Gcode line the command comes from
   */
  private applyCommand (cmd: string, args: Record<string, number>, rawLine: string): void {
    // Axis value the args give, or the current one when they give none
    const coord = (key: keyof MachineState): number => {
      if (args[key] === undefined) return this.machineState[key]
      if (key === 'f') return args.f
      const relative = key === 'e' ? this.extrusionRelative : this.axesRelative
      return relative ? this.machineState[key] + args[key] : args[key]
    }

    switch (cmd) {
      case 'G0': // Rapid move
      case 'G1': { // Linear move
        const move: MachineState = {
          x: coord('x'),
          y: coord('y'),
          z: coord('z'),
          e: coord('e'), // extruder position
          f: coord('f') // feedrate
        }

        // Filament pushed without moving in XY unretracts or purges, it lays no line down
        const extruding = this.extrusionDelta(args, move) > 0 && (move.x !== this.machineState.x || move.y !== this.machineState.y)

        if (extruding && this.startsLayer(move)) this.changeLayer(move)

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

        if (extruding && this.startsLayer(move)) this.changeLayer(move)

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
        const arcPoints = interpolateArc(this.machineState, arc)
        for (let point = 1; point < arcPoints.length; point++) {
          if (extruding) this.addSegment(arcPoints[point - 1], arcPoints[point])
          else this.addTravel(arcPoints[point - 1], arcPoints[point])
        }
        this.machineState = arcPoints[arcPoints.length - 1]
        break
      }
      case 'G4': { // Dwell: the pause adds to the time of the travel toward the next segment
        this.pendingTravelSeconds += (args.s || 0) + (args.p || 0) / 1000
        break
      }
      case 'G20': { // Lengths given in inches
        this.mmPerUnit = 25.4
        break
      }
      case 'G21': { // Lengths given in millimeters
        this.mmPerUnit = 1
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
        const temperature = args.s ?? args.r
        if (temperature !== undefined) this.nozzleTemperaturesCollector.addTemperature(temperature, args.t)
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
      case 'M221': { // Scale the extrusion by a percentage, the per-extruder form left to the printer
        if (args.s !== undefined && args.t === undefined) this.flowFactor = args.s / 100
        break
      }
      case 'M600': { // Change the filament color
        this.colorChangesCollector.addFilamentChange(this.machineState.z)
        break
      }
      default: { // Select the tool
        if (cmd[0] === 'T') {
          const tool = +cmd.slice(1)
          // Numbers above the tools stand for machine commands (T255, T1000, Tx...)
          if (Number.isInteger(tool) && tool >= 0 && tool <= HIGHEST_TOOL_NUMBER) {
            this.currentPropertyValues.toolId = tool
            this.colorChangesCollector.selectTool(tool)
            this.nozzleTemperaturesCollector.selectTool(tool)
          }
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

  /* ---- Layers ---- */

  /**
   * Tells whether an extruding move belongs to a layer of its own
   * @param move - Machine state of the move
   * @returns True when the move opens a layer
   */
  private startsLayer (move: MachineState): boolean {
    if (this.currentLayer == null || this.pendingLayerChange) return true
    if (this.statesLayerChanges || this.featureTypesCollector.customGcode) return false
    return Math.abs(move.z - this.currentLayer.z) > LAYER_EPSILON_MM
  }

  /**
   * Opens a new layer and makes it current
   * @param move - Machine state starting the layer
   * @returns The new layer
   */
  private changeLayer (move: MachineState): OpenLayer {
    this.pendingLayerChange = false

    this.extrusionSizeCollector.addLayer(move.z)

    // The slicer's custom gcode joins the layer coming after it instead of filling one of its own
    if (this.customLayer && this.currentLayer) {
      this.customLayer = false
      this.currentLayer.z = move.z
      return this.currentLayer
    }

    this.sealLayer()
    this.layersOpened++

    this.customLayer = this.featureTypesCollector.customGcode
    this.currentLayer = new OpenLayer(move.z)
    return this.currentLayer
  }

  /** Seals the open layer, if any */
  private sealLayer (): void {
    if (!this.currentLayer) return
    this.layers.push(this.currentLayer.finish())
    this.currentLayer = null
  }

  /* ---- Travels ---- */

  /**
   * Adds a non-extruding move, whose time is charged to the gap before the next segment
   * @param start - Machine state at the move start
   * @param end - Machine state at the move end
   */
  private addTravel (start: MachineState, end: MachineState): void {
    const distance = vectorLength(end.x - start.x, end.y - start.y, end.z - start.z)
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

  /* ---- Segments ---- */

  /**
   * Appends an extruded segment to the current layer
   * @param start - Machine state at the segment start
   * @param end - Machine state at the segment end
   */
  private addSegment (start: MachineState, end: MachineState): void {
    // Drop the segment when a coordinate is not a number
    if (Number.isNaN(start.x) || Number.isNaN(start.y) || Number.isNaN(start.z) || Number.isNaN(end.x) || Number.isNaN(end.y) || Number.isNaN(end.z)) {
      console.warn('PrettyGCode: bad line segment', start, end)
      return
    }

    // Open a layer if none is active yet
    const layer = this.currentLayer ?? this.changeLayer(start)
    if (!this.featureTypesCollector.customGcode) this.customLayer = false

    // Estimated seconds of the travel leading here and of the segment itself
    const distance = vectorLength(end.x - start.x, end.y - start.y, end.z - start.z)
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
      this.gcodeBoundsCollector.addPoint(sceneStart)
      this.gcodeBoundsCollector.addPoint(sceneEnd)
    }

    // Add the segment to the layer
    this.currentPropertyValues.featureTypeId = this.featureTypesCollector.currentFeatureTypeId
    this.currentPropertyValues.colorChangeId = this.colorChangesCollector.currentColorChangeId
    this.currentPropertyValues.feedrate = feedrate
    this.currentPropertyValues.temperature = this.nozzleTemperaturesCollector.currentTemperature
    this.currentPropertyValues.width = this.extrusionSizeCollector.width
    this.currentPropertyValues.height = this.extrusionSizeCollector.height
    this.currentPropertyValues.filamentPerMm = distance > 0 ? (end.e - start.e) * this.flowFactor / distance : 0
    layer.addSegment(sceneStart, sceneEnd, this.filePosition, travelSeconds, extrusionSeconds, this.markedObjectsCollector.currentObjectId, this.currentPropertyValues)
  }

  /* ---- Parse result ---- */

  /**
   * Finishes parsing
   * @returns The parsed gcode
   */
  finish (): ParsedGcode {
    // Parse the last line of a file that does not end with a newline
    if (this.pendingLine) {
      this.filePosition += lineByteLength(this.pendingLine)
      this.parseLine(this.pendingLine)
      this.pendingLine = ''
    }

    this.sealLayer()
    if (this.printerTransform) this.slidePrintToBeltOrigin()

    const slicerConfig = this.slicerConfigCollector.config

    return {
      layers: this.layers,
      bounds: this.gcodeBoundsCollector.bounds,
      slicerNozzleDiameter: slicerConfig.nozzleDiameter,
      slicerFilamentDiameter: slicerConfig.filamentDiameter,
      slicerFilamentDensity: slicerConfig.filamentDensity,
      slicerToolColors: slicerConfig.toolColors,
      colorChanges: this.colorChangesCollector.colorChanges,
      slicerTimeMarks: this.slicerTimeMarksCollector.marks,
      featureTypes: this.featureTypesCollector.featureTypes,
      objectNames: this.markedObjectsCollector.objectNames
    }
  }

  /** Slides the print along the belt so it starts at the belt origin, where the printed shape trails behind it */
  private slidePrintToBeltOrigin (): void {
    const offset = -this.gcodeBoundsCollector.bounds.minY
    if (!Number.isFinite(offset)) return

    for (const { vertices, travelVertices } of this.layers) {
      for (let y = 1; y < vertices.length; y += 3) vertices[y] += offset
      for (let y = 1; y < travelVertices.length; y += 3) travelVertices[y] += offset
    }
    this.gcodeBoundsCollector.slideY(offset)
  }
}
