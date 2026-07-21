import * as THREE from '../three-exports'
import { arcOffsetFromRadius, interpolateArc } from './arc-interpolation'

/** Machine state the parser tracks */
export interface MachineState {
  x: number
  y: number
  z: number
  e: number
  f: number
}

/** One parsed layer and its properties */
export interface Layer {
  vertices: number[]
  z: number
  colors: number[]
  filePositions: number[]
  durations: number[]
  objectIds: number[]
}

/** Initial machine state */
const INITIAL_MACHINE_STATE: MachineState = Object.freeze({ x: 0, y: 0, z: 0, e: 0, f: 0 })

/**
 * Converts a feedrate to mm/s, with a sane pace for moves before any F word is seen
 * @param feedrate - Feedrate in mm/min
 * @returns Speed in mm/s
 */
const feedrateMmPerSecond = (feedrate: number) => (feedrate > 0 ? feedrate : 1500) / 60

/** Matches non-ASCII characters, whose lines need real encoding since OctoPrint's filepos counts bytes */
const NON_ASCII = /[\u0080-\uffff]/

/** Encoder measuring lines in bytes */
const textEncoder = new TextEncoder()

/** Z step below which a move stays in the same layer: vase mode rises continuously and would split a layer per segment */
const LAYER_EPSILON_MM = 0.04

/** One color rule: keywords to look for in comments, and the color to paint their segments */
export interface ColorRule {
  keywords: string[]
  color: string
}

/** The parser's color rules and the default color used for segments matching no color rule */
export interface ParserColors {
  colorRules: ColorRule[]
  defaultColor: string
}

/** Default color of segments matching no color rule */
export const DEFAULT_COLOR = '#ffffff'
/** Default color rules, in priority order */
export const DEFAULT_COLOR_RULES: ColorRule[] = [
  { keywords: ['overhang'], color: '#1f1fff' }, // Orca "Overhang wall", PrusaSlicer "Overhang perimeter"
  { keywords: ['external', 'outer'], color: '#ff7d38' }, // Cura "WALL-OUTER", Orca "Outer wall", PrusaSlicer "External perimeter", Simplify3D "outer perimeter"
  { keywords: ['top solid', 'skin', 'surface'], color: '#f04040' }, // Cura "SKIN", Orca "Top surface"/"Bottom surface", PrusaSlicer "Top solid infill"
  { keywords: ['bridge'], color: '#4d80ba' }, // ideaMaker "BRIDGE", Orca "Bridge", PrusaSlicer "Bridge infill"/"Internal bridge infill", Simplify3D "bridge"
  { keywords: ['solid'], color: '#9654cc' }, // Orca "Internal solid infill", PrusaSlicer "Solid infill", Simplify3D "solid layer"
  { keywords: ['gap'], color: '#ffffff' }, // Orca "Gap infill", PrusaSlicer "Gap fill"
  { keywords: ['ironing'], color: '#ff8c69' }, // Orca "Ironing", PrusaSlicer "Ironing"
  { keywords: ['interface'], color: '#008000' }, // Cura "SUPPORT-INTERFACE", Orca "Support interface", PrusaSlicer "Support material interface"
  { keywords: ['support'], color: '#00ff00' }, // Cura "SUPPORT", Orca "Support"/"Support transition", PrusaSlicer "Support material", Simplify3D "support"/"dense support"
  { keywords: ['skirt', 'brim', 'raft'], color: '#00876e' }, // Cura "SKIRT"/"RAFT", ideaMaker "RAFT", Orca "Skirt"/"Brim", PrusaSlicer "Skirt/Brim", Simplify3D "skirt"/"raft"
  { keywords: ['tower', 'pillar'], color: '#b3e3ab' }, // Cura "PRIME-TOWER", Orca "Prime tower", PrusaSlicer "Wipe tower", Simplify3D "prime pillar"
  { keywords: ['inner', 'perimeter'], color: '#ffe64d' }, // Cura "WALL-INNER", Orca "Inner wall", PrusaSlicer "Perimeter", Simplify3D "inner perimeter"
  { keywords: ['fill'], color: '#b03029' } // Cura "FILL", Orca "Sparse infill", PrusaSlicer "Internal infill", Simplify3D "infill"
]

/**
 * Copies color rules into an editable array
 * @param colorRules - Color rules to copy
 * @returns The copied rules
 */
export function cloneColorRules (colorRules: ColorRule[]): ColorRule[] {
  return colorRules.map((rule) => ({ keywords: [...rule.keywords], color: rule.color }))
}

/** Matches the nozzle diameter stated by the slicer, e.g. "; nozzle_diameter = 0.4" */
const NOZZLE_DIAMETER_COMMENT = /nozzle[_ ]?diameter\s*[:=]\s*([\d.]+)/i

/**
 * Matches the marker opening a slicer's feature-type comment
 * - ;TYPE:<label>      PrusaSlicer/SuperSlicer/Cura, OrcaSlicer (non-Bambu-Lab printers)
 * - ; FEATURE: <label> Bambu Studio, OrcaSlicer (Bambu Lab printers)
 * - ; feature <label>  Simplify3D
 */
const FEATURE_TYPE_COMMENT = /;\s*(type:|feature[ :])/i

/** Scratch vector reused across segments to avoid allocations */
const scratchPoint = new THREE.Vector3()
/** Scratch vector reused across segments to avoid allocations */
const scratchDirection = new THREE.Vector3()
/** Scratch color reused across segments to avoid allocations */
const scratchColor = new THREE.Color()
/** Scratch HSL values reused across segments to avoid allocations */
const scratchHsl = { h: 0, s: 0, l: 0 }

/** Streaming gcode parser: feed it text chunks to get colored layers of segments with file positions and time estimates */
export class GCodeParser {
  /** Parsed layers: segment endpoints, colors, file positions and estimated durations */
  readonly layers: Layer[] = []

  /** Bounding box of the extruded gcode */
  readonly bounds = new THREE.Box3()

  /** Nozzle diameter the slicer states, if any */
  slicerNozzleDiameter: number | null = null

  /** Names of the objects marked in the gcode, by object id */
  readonly objectNames: string[] = []

  /** Tag of the object markers, lowercased */
  private readonly objectTag: string

  /** Current machine state */
  private machineState: MachineState = INITIAL_MACHINE_STATE
  /** Layer being filled, if any */
  private currentLayer: Layer | null = null
  /** Color rules, in priority order */
  private readonly colorRules: { keywords: string[], color: THREE.Color }[]
  /** Color of segments matching no color rule */
  private readonly defaultColor: THREE.Color
  /** Color of the current feature type */
  private currentColor: THREE.Color
  /** Whether a slicer feature type has been seen yet */
  private featureTypeSeen = false
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
   */
  constructor (objectTag = 'Object', colors: ParserColors = { colorRules: DEFAULT_COLOR_RULES, defaultColor: DEFAULT_COLOR }) {
    this.objectTag = objectTag.toLowerCase()

    // Precompute the colors and lowercase the keywords, dropping the empty ones
    this.defaultColor = new THREE.Color(colors.defaultColor)
    this.currentColor = this.defaultColor
    this.colorRules = colors.colorRules.map((rule) => ({
      keywords: rule.keywords.map((keyword) => keyword.toLowerCase()).filter(Boolean),
      color: new THREE.Color(rule.color)
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
      if (rawLine.includes(';')) {
        const commentLower = rawLine.toLowerCase()

        // Pick the color from feature-type comments only
        if (FEATURE_TYPE_COMMENT.test(commentLower)) {
          const match = this.colorRules.find(({ keywords }) => keywords.some((keyword) => commentLower.includes(keyword)))
          if (match) {
            this.currentColor = match.color
            this.featureTypeSeen = true
          }
        }

        // First nozzle diameter the slicer states wins
        if (this.slicerNozzleDiameter == null) {
          const nozzleMatch = commentLower.match(NOZZLE_DIAMETER_COMMENT)
          if (nozzleMatch) this.slicerNozzleDiameter = parseFloat(nozzleMatch[1])
        }
      }

      // Parse gcode cmd and args
      const tokens = rawLine.replace(/;.*/, '').trim().split(/\s+/)
      const cmd = tokens[0].toUpperCase()
      const args: Record<string, number> = {}
      tokens.slice(1).forEach((token) => {
        if (token) args[token[0].toLowerCase()] = parseFloat(token.substring(1))
      })

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
          const move = { x: coord('x'), y: coord('y'), z: coord('z'), e: coord('e'), f: coord('f') }

          // New layer only when extrusion climbs to a higher Z
          if (this.extrusionDelta(args, move) > 0 && (this.currentLayer == null || move.z > this.currentLayer.z + LAYER_EPSILON_MM)) {
            this.newLayer(move)
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
          const move = {
            x: coord('x'),
            y: coord('y'),
            z: coord('z'),
            e: coord('e'), // extruder position
            f: coord('f') // feedrate
          }

          // New layer only when extrusion climbs to a higher Z
          if (this.extrusionDelta(args, move) > 0 && (this.currentLayer == null || move.z > this.currentLayer.z + LAYER_EPSILON_MM)) {
            this.newLayer(move)
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
          this.extrusionRelative = false
          break
          // Relative positioning
        case 'G91':
          this.axesRelative = true
          this.extrusionRelative = true
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
  private newLayer (move: MachineState) {
    this.currentLayer = { vertices: [], z: move.z, colors: [], filePositions: [], durations: [], objectIds: [] }
    this.layers.push(this.currentLayer)
    return this.currentLayer
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
    const layer = this.currentLayer ?? this.newLayer(start)

    // Store the segment endpoints, its position in the file and the object it belongs to
    layer.vertices.push(start.x, start.y, start.z, end.x, end.y, end.z)
    layer.filePositions.push(this.filePosition)
    layer.objectIds.push(this.currentObjectId)

    // Estimated seconds of the travel leading here and of the segment itself
    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) || Math.abs(end.e - start.e) || 0
    layer.durations.push(this.pendingTravelSeconds, length / feedrateMmPerSecond(end.f))
    this.pendingTravelSeconds = 0

    // Grow the model bounds only after a slicer color is set, so pre-print moves don't skew the framing
    if (this.featureTypeSeen) {
      this.bounds.expandByPoint(scratchPoint.set(start.x, start.y, start.z))
      this.bounds.expandByPoint(scratchPoint.set(end.x, end.y, end.z))
    }

    // Fake shading: tint by the segment's angle, alternating per layer for readability
    const direction = scratchDirection.set(end.x - start.x, end.y - start.y, end.z - start.z).normalize()
    const angleShade = ((direction.x / 2) + 0.5) / 5.0
    const drawColor = scratchColor.copy(this.currentColor)
    drawColor.getHSL(scratchHsl)
    scratchHsl.l = angleShade + (this.layers.length % 2 === 0 ? 0.25 : 0.30)
    drawColor.setHSL(scratchHsl.h, scratchHsl.s, scratchHsl.l)

    // Same color on both endpoints of the segment
    layer.colors.push(drawColor.r, drawColor.g, drawColor.b, drawColor.r, drawColor.g, drawColor.b)
  }
}

/**
 * Downloads and parses a job's gcode; an empty path yields an empty result
 * @param jobPath - Server path of the job file
 * @param objectTag - Tag of the "@<tag> <name>" object markers
 * @param colors - Colors the parser paints segments with
 * @returns The parser holding the parsed gcode
 */
export async function parseGcodeFile (jobPath: string, objectTag?: string, colors?: ParserColors) {
  const parser = new GCodeParser(objectTag, colors)
  if (!jobPath) return parser

  const fileUrl = OctoPrint.files.downloadPath('local', jobPath)
  const response = await fetch(fileUrl)
  if (!response.body) return parser

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parser.parse(decoder.decode(value, { stream: true }))
  }

  return parser
}
