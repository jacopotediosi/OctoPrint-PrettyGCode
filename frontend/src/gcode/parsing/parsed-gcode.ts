/* ---- Parse result ---- */

/** A parsed gcode */
export interface ParsedGcode {
  /** Parsed layers, in the order the gcode prints them */
  layers: Layer[]
  /** Bounding box of the extruded gcode */
  bounds: GcodeBounds
  /** Nozzle diameter in mm the slicer states, null when it states none */
  slicerNozzleDiameter: number | null
  /** Filament diameter in mm the slicer states, null when it states none */
  slicerFilamentDiameter: number | null
  /** Filament density in g/cm3 the slicer states, null when it states none */
  slicerFilamentDensity: number | null
  /** Color the slicer states for each tool, empty where it states none */
  slicerToolColors: string[]
  /** Color changes the gcode states, in the order it states them */
  colorChanges: ColorChange[]
  /** Print times the slicer states along the file, null when it states fewer than two */
  slicerTimeMarks: SlicerTimeMarks | null
  /** Feature types the gcode states, by feature type id */
  featureTypes: FeatureType[]
  /** Names of the objects marked in the gcode, by object id */
  objectNames: string[]
}

/** A color change the gcode states */
export interface ColorChange {
  /** Id of the tool it changes the color of */
  toolId: number
  /** Color the tool prints with from there on, empty when the gcode states none */
  color: string
  /** Height in mm it takes effect at */
  z: number
}

/** Print time a slicer states at points along its gcode */
export interface SlicerTimeMarks {
  /** Byte offsets the marks sit at, in increasing order */
  filePositions: Uint32Array
  /** Print time elapsed at each mark */
  elapsedSeconds: Float64Array
}

/** A feature type the gcode states */
export interface FeatureType {
  /** Whole comment line stating it, lowercased */
  comment: string
  /** Name it carries in that comment, in the slicer's own writing */
  label: string
}

/** One parsed layer and its properties */
export interface Layer {
  /** Segment endpoints as flat XYZ triplets */
  vertices: Float32Array
  /** Machine Z the layer is printed at */
  z: number
  /** Byte offset in the file of each segment's line */
  filePositions: Uint32Array
  /** Estimated seconds of each segment, the travel leading to it followed by its extrusion */
  durations: Float32Array
  /** Id of the object each segment belongs to, -1 for none, null when the layer holds no marked object */
  objectIds: Int32Array | null
  /** Id of the feature type each segment belongs to, -1 for none */
  featureTypeIds: SegmentProperty
  /** Id of the tool each segment is extruded with */
  toolIds: SegmentProperty
  /** Index of the color change each segment is extruded after, -1 before the first one of its tool */
  colorChangeIds: SegmentProperty
  /** Speed of each segment in mm/s */
  feedrates: SegmentProperty
  /** Speed of the print cooling fan over the segments, in percent */
  fanSpeeds: SegmentProperty
  /** Nozzle temperature over the segments, in degrees Celsius */
  temperatures: SegmentProperty
  /** Width of each extruded line in mm, 0 where the slicer states none */
  widths: SegmentProperty
  /** Height of each extruded line in mm */
  heights: SegmentProperty
  /** Filament in mm each segment extrudes over each mm of its length */
  filamentPerMm: SegmentProperty
  /** Travel endpoints as flat XYZ triplets */
  travelVertices: Float32Array
  /** Segment of the layer each travel leads to */
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
  /** Id of the tool the segment is extruded with */
  toolId: number
  /** Index of the color change the segment is extruded after, -1 before the first one of its tool */
  colorChangeId: number
  /** Speed of the segment in mm/s */
  feedrate: number
  /** Speed of the print cooling fan in percent */
  fanSpeed: number
  /** Nozzle temperature in degrees Celsius */
  temperature: number
  /** Width of the extruded line in mm, 0 when the slicer states none */
  width: number
  /** Height of the extruded line in mm */
  height: number
  /** Filament in mm the segment extrudes over each mm of its length */
  filamentPerMm: number
}

/** Box the parsed gcode fits in, in scene coordinates */
export interface GcodeBounds {
  /** Lowest X the gcode reaches in mm */
  minX: number
  /** Lowest Y the gcode reaches in mm */
  minY: number
  /** Lowest Z the gcode reaches in mm */
  minZ: number
  /** Highest X the gcode reaches in mm */
  maxX: number
  /** Highest Y the gcode reaches in mm */
  maxY: number
  /** Highest Z the gcode reaches in mm */
  maxZ: number
}

/**
 * Builds empty bounds
 * @returns The empty bounds
 */
export const emptyBounds = (): GcodeBounds => ({ minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity })

/**
 * Builds an empty parse result
 * @returns The empty gcode
 */
export const emptyGcode = (): ParsedGcode => ({
  layers: [], bounds: emptyBounds(), slicerNozzleDiameter: null, slicerFilamentDiameter: null, slicerFilamentDensity: null, slicerToolColors: [], colorChanges: [], slicerTimeMarks: null, featureTypes: [], objectNames: []
})

/** A point of the parsed gcode, in scene coordinates */
export interface ScenePoint {
  /** Position along the X axis in mm */
  x: number
  /** Position along the Y axis in mm */
  y: number
  /** Position along the Z axis in mm */
  z: number
}

/* ---- Machine state ---- */

/** Machine state the parser tracks */
export interface MachineState {
  /** Position along the X axis in mm */
  x: number
  /** Position along the Y axis in mm */
  y: number
  /** Position along the Z axis in mm */
  z: number
  /** Extruder position in mm */
  e: number
  /** Feedrate in mm/min */
  f: number
}
