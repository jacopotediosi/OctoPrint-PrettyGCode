import { arcOffsetFromRadius, interpolateArc } from './arc-interpolation'
import { type ParserColors, DEFAULT_COLOR_RULES, DEFAULT_COLOR } from './model-colors'

/* ---- Parse result ---- */

/** A parsed gcode */
export interface ParsedGcode {
  /** Parsed layers (segment endpoints, colors...) */
  layers: Layer[]
  /** Bounding box of the extruded gcode */
  bounds: GcodeBounds
  /** Nozzle diameter the slicer states, if any */
  slicerNozzleDiameter: number | null
  /** Names of the objects marked in the gcode, by object id */
  objectNames: string[]
}

/** One parsed layer and its properties */
export interface Layer {
  vertices: Float32Array
  z: number
  colors: Uint8ClampedArray
  filePositions: Uint32Array
  durations: Float32Array
  objectIds: Int32Array | null
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
const feedrateMmPerSecond = (feedrate: number) => (feedrate > 0 ? feedrate : 1500) / 60

/* ---- Gcode text ---- */

/** Matches non-ASCII characters, whose lines need real encoding since OctoPrint's filepos counts bytes */
const NON_ASCII = /[\u0080-\uffff]/

/** Encoder measuring lines in bytes */
const textEncoder = new TextEncoder()

/** Matches the nozzle diameter stated by the slicer, e.g. "; nozzle_diameter = 0.4" */
const NOZZLE_DIAMETER_COMMENT = /nozzle[_ ]?diameter\s*[:=]\s*([\d.]+)/i

/**
 * Matches the marker opening a slicer's feature-type comment
 * - ;TYPE:<label>      PrusaSlicer/SuperSlicer/Cura, OrcaSlicer (non-Bambu-Lab printers)
 * - ; FEATURE: <label> Bambu Studio, OrcaSlicer (Bambu Lab printers)
 * - ; feature <label>  Simplify3D
 */
const FEATURE_TYPE_COMMENT = /;\s*(type:|feature[ :])/i

/* ---- Segment colors ---- */

/** An RGB color, with components from 0 to 1 */
interface RgbColor {
  r: number
  g: number
  b: number
}

/** Scratch color reused across segments to avoid allocations */
const scratchColor: RgbColor = { r: 0, g: 0, b: 0 }

/** Brightness the darkest segments are drawn at, as a share of their own color */
const MIN_BRIGHTNESS = 0.5
/** Brightness range the segments span as their angle turns, so the passes inside a layer can be told apart */
const ANGLE_BRIGHTNESS_RANGE = 0.4
/** Brightness the odd layers gain, so stacked layers can be told apart */
const ODD_LAYER_BRIGHTNESS_GAIN = 0.1

/**
 * Converts an sRGB component to linear space
 * @param component - The sRGB component (from 0 to 1)
 * @returns The linear component
 */
const srgbToLinear = (component: number) => component < 0.04045 ? component * 0.0773993808 : Math.pow(component * 0.9478672986 + 0.0521327014, 2.4)

/**
 * Converts a color to its most vivid form
 * @param hexString - Color as "#rrggbb"
 * @returns The vivid color, in linear space
 */
function hexStringToVividColor (hexString: string): RgbColor {
  const hex = parseInt(hexString.slice(1), 16)
  const red = srgbToLinear(((hex >> 16) & 255) / 255)
  const green = srgbToLinear(((hex >> 8) & 255) / 255)
  const blue = srgbToLinear((hex & 255) / 255)

  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  if (max === min) return { r: 0.5, g: 0.5, b: 0.5 }

  const lightness = (max + min) / 2
  const saturation = lightness <= 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min)

  // Spread the components around half lightness
  const scale = saturation / (max - min)
  const offset = (1 - saturation) / 2 - min * scale
  return { r: red * scale + offset, g: green * scale + offset, b: blue * scale + offset }
}

/* ---- Layers ---- */

/** Z step below which a move stays in the same layer: vase mode rises continuously and would split a layer per segment */
const LAYER_EPSILON_MM = 0.04

/** A layer being filled with segments */
class OpenLayer {
  /** Initial size of segment buffers */
  private static readonly INITIAL_BUFFERS_CAPACITY = 1024

  private vertices = new Float32Array(OpenLayer.INITIAL_BUFFERS_CAPACITY * 6)
  private colors = new Uint8ClampedArray(OpenLayer.INITIAL_BUFFERS_CAPACITY * 6)
  private filePositions = new Uint32Array(OpenLayer.INITIAL_BUFFERS_CAPACITY)
  private durations = new Float32Array(OpenLayer.INITIAL_BUFFERS_CAPACITY * 2)
  private objectIds: Int32Array | null = null
  private capacity = OpenLayer.INITIAL_BUFFERS_CAPACITY
  private segments = 0

  constructor (readonly z: number) {}

  /**
   * Appends a segment
   * @param start - Segment start point
   * @param end - Segment end point
   * @param color - Segment color
   * @param filePosition - Byte offset of the segment's line in the file
   * @param travelSeconds - Estimated travel time leading to the segment
   * @param extrusionSeconds - Estimated time extruding the segment
   * @param objectId - Id of the object the segment belongs to, -1 for none
   */
  add (start: MachineState, end: MachineState, color: RgbColor, filePosition: number, travelSeconds: number, extrusionSeconds: number, objectId: number) {
    if (this.segments === this.capacity) this.grow()

    const vertex = this.segments * 6
    this.vertices[vertex] = start.x
    this.vertices[vertex + 1] = start.y
    this.vertices[vertex + 2] = start.z
    this.vertices[vertex + 3] = end.x
    this.vertices[vertex + 4] = end.y
    this.vertices[vertex + 5] = end.z

    const red = color.r * 255
    const green = color.g * 255
    const blue = color.b * 255
    this.colors[vertex] = red
    this.colors[vertex + 1] = green
    this.colors[vertex + 2] = blue
    this.colors[vertex + 3] = red
    this.colors[vertex + 4] = green
    this.colors[vertex + 5] = blue

    this.filePositions[this.segments] = filePosition
    this.durations[this.segments * 2] = travelSeconds
    this.durations[this.segments * 2 + 1] = extrusionSeconds

    // Start storing object ids at the first segment that belongs to one
    if (objectId >= 0 && !this.objectIds) this.objectIds = new Int32Array(this.capacity).fill(-1)
    if (this.objectIds) this.objectIds[this.segments] = objectId

    this.segments++
  }

  /** Doubles the capacity of the segment buffers */
  private grow () {
    this.capacity *= 2

    const vertices = new Float32Array(this.capacity * 6)
    vertices.set(this.vertices)
    this.vertices = vertices

    const colors = new Uint8ClampedArray(this.capacity * 6)
    colors.set(this.colors)
    this.colors = colors

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

  /**
   * Finishes the layer
   * @returns The finished layer
   */
  finish (): Layer {
    return {
      z: this.z,
      vertices: this.vertices.slice(0, this.segments * 6),
      colors: this.colors.slice(0, this.segments * 6),
      filePositions: this.filePositions.slice(0, this.segments),
      durations: this.durations.slice(0, this.segments * 2),
      objectIds: this.objectIds ? this.objectIds.slice(0, this.segments) : null
    }
  }
}

/* ---- Parser ---- */

/** Streaming gcode parser: feed it text chunks to get colored layers of segments with file positions and time estimates */
export class GCodeParser {
  /** Parsed layers: segment endpoints, colors, file positions and estimated durations */
  readonly layers: Layer[] = []

  /** Bounding box of the extruded gcode */
  bounds = emptyBounds()

  /** Nozzle diameter the slicer states, if any */
  slicerNozzleDiameter: number | null = null

  /** Names of the objects marked in the gcode, by object id */
  readonly objectNames: string[] = []

  /** Tag of the object markers, lowercased */
  private readonly objectTag: string

  /** Whether G90/G91 also switch the extrusion mode, not only the axes */
  private readonly g90InfluencesExtruder: boolean

  /** Current machine state */
  private machineState: MachineState = INITIAL_MACHINE_STATE
  /** Layer being filled, if any */
  private currentLayer: OpenLayer | null = null
  /** Layers opened so far */
  private layersOpened = 0
  /** Color rules, in priority order */
  private readonly colorRules: { keywords: string[], color: RgbColor }[]
  /** Color of segments matching no color rule */
  private readonly defaultColor: RgbColor
  /** Color of the current feature type */
  private currentColor: RgbColor
  /** Whether a slicer feature type comment has been seen yet */
  private featureTypeCommentSeen = false
  /** Id of the object the parsed segments belong to, -1 for none */
  private currentObjectId = -1
  /** Partial line left over from the previous chunk */
  private pendingLine = ''
  /** Bytes parsed so far */
  private filePosition = 0
  /** Travel time accumulated since the last segment */
  private pendingTravelSeconds = 0
  /** Whether axis moves are relative */
  private axesRelative = false
  /** Whether extrusion is relative */
  private extrusionRelative = false

  /**
   * @param objectTag - Tag of the "@<tag> <name>" object markers
   * @param colors - Colors the parser paints segments with
   * @param g90InfluencesExtruder - Whether G90/G91 also switch the extrusion mode
   */
  constructor (objectTag = 'Object', colors: ParserColors = { colorRules: DEFAULT_COLOR_RULES, defaultColor: DEFAULT_COLOR }, g90InfluencesExtruder = false) {
    this.objectTag = objectTag.toLowerCase()
    this.g90InfluencesExtruder = g90InfluencesExtruder

    // Precompute the colors and lowercase the keywords, dropping the empty ones
    this.defaultColor = hexStringToVividColor(colors.defaultColor)
    this.currentColor = this.defaultColor
    this.colorRules = colors.colorRules.map((rule) => ({
      keywords: rule.keywords.map((keyword) => keyword.toLowerCase()).filter(Boolean),
      color: hexStringToVividColor(rule.color)
    }))
  }

  /**
   * Parses the next chunk of gcode text; chunks may split lines anywhere
   * @param chunk - Raw gcode text
   */
  parse (chunk: string) {
    // Chunks may split a line in two: prepend last call's leftover, hold the new trailing partial for next time
    const lines = chunk.split('\n')
    lines[0] = this.pendingLine + lines[0]
    this.pendingLine = lines[lines.length - 1]

    for (let i = 0; i < lines.length - 1; i++) {
      // Get the line
      const rawLine = lines[i]
      this.filePosition += (NON_ASCII.test(rawLine) ? textEncoder.encode(rawLine).length : rawLine.length) + 1

      // Parse object markers
      if (rawLine.startsWith('@')) {
        this.parseObjectMarker(rawLine)
        continue
      }

      // Parse comments
      const commentStart = rawLine.indexOf(';')
      if (commentStart >= 0) {
        const commentLower = rawLine.toLowerCase()

        // Pick the color from feature-type comments only
        if (FEATURE_TYPE_COMMENT.test(commentLower)) {
          const match = this.colorRules.find(({ keywords }) => keywords.some((keyword) => commentLower.includes(keyword)))
          if (match) {
            this.currentColor = match.color
            // First feature type seen
            if (!this.featureTypeCommentSeen) {
              this.featureTypeCommentSeen = true
              // Drop the pre-print moves (e.g., calibration/wiping/purge lines) gathered so far from the model bounds
              this.bounds = emptyBounds()
            }
          }
        }

        // First nozzle diameter the slicer states wins
        if (this.slicerNozzleDiameter == null) {
          const nozzleMatch = commentLower.match(NOZZLE_DIAMETER_COMMENT)
          if (nozzleMatch) this.slicerNozzleDiameter = parseFloat(nozzleMatch[1])
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
      const coord = (key: keyof MachineState) => {
        if (args[key] === undefined) return this.machineState[key]
        if (key === 'f') return args.f
        const relative = key === 'e' ? this.extrusionRelative : this.axesRelative
        return relative ? this.machineState[key] + args[key] : args[key]
      }

      switch (cmd) {
        // Linear move
        case 'G0':
        case 'G1': {
          const move: MachineState = { x: coord('x'), y: coord('y'), z: coord('z'), e: coord('e'), f: coord('f') }

          // New layer when extrusion moves to a different Z
          if (this.extrusionDelta(args, move) > 0 && (this.currentLayer == null || Math.abs(move.z - this.currentLayer.z) > LAYER_EPSILON_MM)) {
            this.changeLayer(move)
          }

          // Extrude a segment when E is present, otherwise track the travel time
          if (args.e !== undefined) this.addSegment(this.machineState, move)
          else this.addTravel(this.machineState, move)
          this.machineState = move
          break
        }
        // Arc move (G2 clockwise, G3 counter-clockwise)
        case 'G2':
        case 'G3': {
          const move: MachineState = {
            x: coord('x'),
            y: coord('y'),
            z: coord('z'),
            e: coord('e'), // extruder position
            f: coord('f') // feedrate
          }

          // New layer when extrusion moves to a different Z
          if (this.extrusionDelta(args, move) > 0 && (this.currentLayer == null || Math.abs(move.z - this.currentLayer.z) > LAYER_EPSILON_MM)) {
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
            if (args.e !== undefined) this.addSegment(this.machineState, move)
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
            if (args.e !== undefined) this.addSegment(segments[segmentIndex - 1], segments[segmentIndex])
            else this.addTravel(segments[segmentIndex - 1], segments[segmentIndex])
          }
          this.machineState = segments[segments.length - 1]
          break
        }
        // Dwell: the pause adds to the time of the travel toward the next segment
        case 'G4':
          this.pendingTravelSeconds += (args.s || 0) + (args.p || 0) / 1000
          break
        // Home: the named axes (all of them if none is given) end up at the origin
        case 'G28': {
          const all = args.x === undefined && args.y === undefined && args.z === undefined
          this.machineState = {
            ...this.machineState,
            x: all || args.x !== undefined ? 0 : this.machineState.x,
            y: all || args.y !== undefined ? 0 : this.machineState.y,
            z: all || args.z !== undefined ? 0 : this.machineState.z
          }
          break
        }
        // Absolute positioning
        case 'G90':
          this.axesRelative = false
          if (this.g90InfluencesExtruder) this.extrusionRelative = false
          break
          // Relative positioning
        case 'G91':
          this.axesRelative = true
          if (this.g90InfluencesExtruder) this.extrusionRelative = true
          break
          // Absolute extrusion
        case 'M82':
          this.extrusionRelative = false
          break
          // Relative extrusion
        case 'M83':
          this.extrusionRelative = true
          break
          // Set position without moving
        case 'G92':
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
  private extrusionDelta (args: Record<string, number>, move: MachineState) {
    if (args.e === undefined) return 0
    return this.extrusionRelative ? args.e : move.e - this.machineState.e
  }

  /**
   * Parse the object marker, updating the current object id
   * @param rawLine - Object marker line, starting with "@"
   */
  private parseObjectMarker (rawLine: string) {
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
  private changeLayer (move: MachineState) {
    this.finish()
    this.layersOpened++
    this.currentLayer = new OpenLayer(move.z)
    return this.currentLayer
  }

  /** Finishes parsing */
  finish () {
    if (!this.currentLayer) return
    this.layers.push(this.currentLayer.finish())
    this.currentLayer = null
  }

  /**
   * Accounts the time of a non-extruding move, charged to the gap before the next segment
   * @param start - Machine state at the move start
   * @param end - Machine state at the move end
   */
  private addTravel (start: MachineState, end: MachineState) {
    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)
    this.pendingTravelSeconds += (length || 0) / feedrateMmPerSecond(end.f)
  }

  /**
   * Grows the model bounds to contain a point
   * @param point - Point to contain
   */
  private expandBounds (point: MachineState) {
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
  private addSegment (start: MachineState, end: MachineState) {
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
    const extrusionSeconds = length / feedrateMmPerSecond(end.f)
    this.pendingTravelSeconds = 0

    // Grow the model bounds only on moves that change position
    if (start.x !== end.x || start.y !== end.y || start.z !== end.z) {
      this.expandBounds(start)
      this.expandBounds(end)
    }

    // Fake shading: tint by the segment's angle, alternating per layer for readability
    const directionX = distance ? (end.x - start.x) / distance : 0
    const brightness = MIN_BRIGHTNESS + ANGLE_BRIGHTNESS_RANGE * (directionX + 1) / 2 +
      (this.layersOpened % 2 === 0 ? 0 : ODD_LAYER_BRIGHTNESS_GAIN)
    scratchColor.r = this.currentColor.r * brightness
    scratchColor.g = this.currentColor.g * brightness
    scratchColor.b = this.currentColor.b * brightness

    // Add the segment to the layer
    layer.add(start, end, scratchColor, this.filePosition, travelSeconds, extrusionSeconds, this.currentObjectId)
  }
}
