import type { Layer, ParsedGcode, SegmentProperty } from '../parsing/parsed-gcode'
import { joinSegmentProperties, wholeLayerProperty } from '../parsing/segment-properties'

/** Filament diameter in mm assumed when the slicer states none */
const DEFAULT_FILAMENT_DIAMETER_MM = 1.75

/** Measures of a whole gcode the color modes read alongside a layer */
export interface GcodeMeasures {
  /** Cross-section area of the filament in square mm */
  filamentArea: number
  /** Estimated seconds a layer takes to print */
  layerSeconds: (layerNumber: number) => number
}

/**
 * Measures a gcode the way the color modes read it
 * @param gcode - Parsed gcode to measure
 * @param layerSeconds - Estimated seconds a layer takes to print
 * @returns The measures of that gcode
 */
export function gcodeMeasures (gcode: ParsedGcode, layerSeconds: (layerNumber: number) => number): GcodeMeasures {
  const diameter = gcode.slicerFilamentDiameter ?? DEFAULT_FILAMENT_DIAMETER_MM
  return { filamentArea: Math.PI * (diameter / 2) ** 2, layerSeconds }
}

/** Widest an estimated extrusion may read */
const WIDEST_ESTIMATED_WIDTH_MM = 2
/** Widest an estimated extrusion may read for each mm of its height */
const WIDEST_ESTIMATED_WIDTH_PER_HEIGHT = 4

/**
 * Works out how wide each segment of a layer is extruded
 * @param layer - Parsed layer
 * @param layerNumber - 1-based layer number
 * @param measures - Measures of the gcode the layer belongs to
 * @returns The property, holding the width the slicer states and, where it states none, the width the extruded filament gives
 */
export function extrudedWidthProperty (layer: Layer, layerNumber: number, measures: GcodeMeasures): SegmentProperty {
  return joinSegmentProperties(
    layer.widths,
    joinSegmentProperties(layer.filamentPerMm, layer.heights, (filamentPerMm, height) => {
      if (height <= 0) return 0
      const extruded = filamentPerMm * measures.filamentArea / height + height * (1 - Math.PI / 4)
      return Math.min(extruded, Math.max(WIDEST_ESTIMATED_WIDTH_MM, WIDEST_ESTIMATED_WIDTH_PER_HEIGHT * height))
    }),
    (stated, extruded) => stated > 0 ? stated : extruded
  )
}

/**
 * Works out how much filament each segment of a layer extrudes over a second
 * @param layer - Parsed layer
 * @param layerNumber - 1-based layer number
 * @param measures - Measures of the gcode the layer belongs to
 * @returns The property, in cubic mm per second
 */
export function volumetricFlowProperty (layer: Layer, layerNumber: number, measures: GcodeMeasures): SegmentProperty {
  return joinSegmentProperties(layer.filamentPerMm, layer.feedrates, (filamentPerMm, feedrate) => filamentPerMm * measures.filamentArea * feedrate)
}

/**
 * Works out how long the layer a segment belongs to takes to print
 * @param layer - Parsed layer
 * @param layerNumber - 1-based layer number
 * @param measures - Measures of the gcode the layer belongs to
 * @returns The property, holding the estimated seconds of the layer over all of its segments
 */
export function layerTimeProperty (layer: Layer, layerNumber: number, measures: GcodeMeasures): SegmentProperty {
  return wholeLayerProperty(measures.layerSeconds(layerNumber))
}
