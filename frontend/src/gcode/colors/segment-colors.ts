import { resolveFeatureTypeColors } from './feature-type-colors'
import { resolveToolColors } from './tool-colors'
import { srgbToLinear } from '../../utils/colors'
import type { RgbColor } from '../../utils/colors'
import { clamp } from '../../utils/numbers'
import type { Layer, ParsedGcode, SegmentProperty } from '../parsing/parser'
import type { Settings } from '../../settings'

/* ---- Color modes ---- */

/** Filament diameter in mm assumed when the slicer states none */
const DEFAULT_FILAMENT_DIAMETER_MM = 1.75

/** Widest an estimated extrusion may read */
const WIDEST_ESTIMATED_WIDTH_MM = 2
/** Widest an estimated extrusion may read for each mm of its height */
const WIDEST_ESTIMATED_WIDTH_PER_HEIGHT = 4

/** What the color modes need from a gcode to read a layer of it */
export interface ColorModeContext {
  /** Cross-section area of the filament in square mm */
  filamentArea: number
  /** Estimated seconds a layer takes to print */
  layerSeconds: (layerNumber: number) => number
}

/** A way of coloring the gcode segments */
export interface ColorMode {
  /** Name shown to the user */
  name: string
  /** Unit the colored values are measured in, empty when they have none */
  unit: string
  /** Decimals the values are read at */
  decimals: number
  /** Whether the values spread over their range by their ratio instead of their difference */
  logarithmic?: boolean
  /** Whether the values are durations, read as hours and minutes rather than as a plain number */
  duration?: boolean
  /** Property a layer's segments take their color from */
  propertyOf: (layer: Layer, layerNumber: number, context: ColorModeContext) => SegmentProperty
  /** Colors the values of that property are fixed to, absent for the modes spreading them over a range */
  fixedColors?: (gcode: ParsedGcode, settings: Settings) => PropertyFixedColors
  /** Whether the filament usage of each value of that property is measured */
  measuresFilamentUsage?: boolean
}

/**
 * Joins two properties of a layer into one, taking a value from each
 * @param first - First property to read
 * @param second - Second property to read
 * @param combine - Value the joined property takes where the two hold the given values
 * @returns The joined property, changing wherever either of the two does
 */
function joinSegmentProperties (first: SegmentProperty, second: SegmentProperty, combine: (firstValue: number, secondValue: number) => number): SegmentProperty {
  const segmentIndices: number[] = []
  const values: number[] = []
  let firstStretch = 0
  let secondStretch = 0

  while (firstStretch < first.values.length || secondStretch < second.values.length) {
    const firstSegment = firstStretch < first.values.length ? first.segmentIndices[firstStretch] : Infinity
    const secondSegment = secondStretch < second.values.length ? second.segmentIndices[secondStretch] : Infinity

    segmentIndices.push(Math.min(firstSegment, secondSegment))

    if (firstSegment <= secondSegment) firstStretch++
    if (secondSegment <= firstSegment) secondStretch++

    values.push(combine(first.values[firstStretch - 1] ?? 0, second.values[secondStretch - 1] ?? 0))
  }

  return { segmentIndices: Uint32Array.from(segmentIndices), values: Float32Array.from(values) }
}

/**
 * Builds a property the whole layer holds one value of
 * @param value - Value the layer holds
 * @returns The property
 */
function wholeLayerProperty (value: number): SegmentProperty {
  return { segmentIndices: Uint32Array.of(0), values: Float32Array.of(value) }
}

/** The ways of coloring the gcode segments, by id */
export const COLOR_MODES = {
  featureType: {
    name: 'Feature type',
    unit: '',
    decimals: 0,
    propertyOf: (layer: Layer) => layer.featureTypeIds,
    fixedColors: (gcode: ParsedGcode, settings: Settings) =>
      resolveFeatureTypeColors(gcode.featureTypes, settings.featureTypeColorRules, settings.featureTypeDefaultColor),
    measuresFilamentUsage: true
  },
  height: { name: 'Height', unit: 'mm', decimals: 3, propertyOf: (layer: Layer) => layer.heights },
  width: {
    name: 'Width',
    unit: 'mm',
    decimals: 3,
    propertyOf: (layer: Layer, layerNumber: number, context: ColorModeContext) => joinSegmentProperties(
      layer.widths,
      joinSegmentProperties(layer.filamentPerMm, layer.heights, (filamentPerMm, height) => {
        if (height <= 0) return 0
        const extruded = filamentPerMm * context.filamentArea / height + height * (1 - Math.PI / 4)
        return Math.min(extruded, Math.max(WIDEST_ESTIMATED_WIDTH_MM, WIDEST_ESTIMATED_WIDTH_PER_HEIGHT * height))
      }),
      (stated, extruded) => stated > 0 ? stated : extruded
    )
  },
  speed: { name: 'Speed', unit: 'mm/s', decimals: 1, propertyOf: (layer: Layer) => layer.feedrates },
  fanSpeed: { name: 'Fan speed', unit: '%', decimals: 0, propertyOf: (layer: Layer) => layer.fanSpeeds },
  temperature: { name: 'Temperature', unit: '\u00b0C', decimals: 0, propertyOf: (layer: Layer) => layer.temperatures },
  volumetricFlow: {
    name: 'Volumetric flow rate',
    unit: 'mm\u00b3/s',
    decimals: 3,
    propertyOf: (layer: Layer, layerNumber: number, context: ColorModeContext) =>
      joinSegmentProperties(layer.filamentPerMm, layer.feedrates, (filamentPerMm, feedrate) => filamentPerMm * context.filamentArea * feedrate)
  },
  layerTime: {
    name: 'Layer time (linear)',
    unit: 's',
    decimals: 0,
    duration: true,
    propertyOf: (layer: Layer, layerNumber: number, context: ColorModeContext) => wholeLayerProperty(context.layerSeconds(layerNumber))
  },
  layerTimeLogarithmic: {
    name: 'Layer time (logarithmic)',
    unit: 's',
    decimals: 0,
    logarithmic: true,
    duration: true,
    propertyOf: (layer: Layer, layerNumber: number, context: ColorModeContext) => wholeLayerProperty(context.layerSeconds(layerNumber))
  },
  tool: {
    name: 'Tool',
    unit: '',
    decimals: 0,
    propertyOf: (layer: Layer) => layer.toolIds,
    fixedColors: (gcode: ParsedGcode) => resolveToolColors(gcode.slicerToolColors),
    measuresFilamentUsage: true
  }
} satisfies Record<string, ColorMode>

/**
 * Works out what the color modes need from a gcode
 * @param gcode - Parsed gcode to read
 * @param layerSeconds - Estimated seconds a layer takes to print
 * @returns What its layers are read with
 */
export function colorModeContext (gcode: ParsedGcode, layerSeconds: (layerNumber: number) => number): ColorModeContext {
  const diameter = gcode.slicerFilamentDiameter ?? DEFAULT_FILAMENT_DIAMETER_MM
  return { filamentArea: Math.PI * (diameter / 2) ** 2, layerSeconds }
}

/** Id of a way of coloring the gcode segments */
export type ColorModeId = keyof typeof COLOR_MODES

/** A color mode ready to color the segments of a gcode */
export interface SegmentColoring {
  /** Color mode the segments are colored by */
  mode: ColorMode
  /** Property a layer's segments take their color from */
  propertyOf: (layer: Layer, layerNumber: number) => SegmentProperty
  /** Color a value of that property is drawn with */
  colorAt: (value: number) => RgbColor
}

/* ---- Property values ---- */

/** The colors the values of a property are fixed to, one each, and the names they go by */
export interface PropertyFixedColors {
  /** Color fixed for each value the property takes, undefined where none is */
  colors: Array<RgbColor | undefined>
  /** Color of the values no color is fixed for */
  defaultColor: RgbColor
  /** Name a value goes by */
  nameOf: (value: number) => string
}

/** The lowest and the highest value a property takes over a gcode */
export interface PropertyRange {
  /** Lowest value the property takes */
  lowest: number
  /** Highest value the property takes */
  highest: number
  /** The values the property takes, empty when it takes more than two of them */
  values: number[]
}

/** Colors the values of a property range are drawn with, from its lowest to its highest */
const PROPERTY_RANGE_COLORS = [
  { r: 11, g: 44, b: 122 },
  { r: 19, g: 89, b: 133 },
  { r: 28, g: 136, b: 145 },
  { r: 4, g: 214, b: 15 },
  { r: 170, g: 242, b: 0 },
  { r: 252, g: 249, b: 3 },
  { r: 245, g: 206, b: 10 },
  { r: 227, g: 136, b: 32 },
  { r: 209, g: 104, b: 48 },
  { r: 194, g: 82, b: 60 },
  { r: 148, g: 38, b: 22 }
].map((color) => ({ r: color.r / 255, g: color.g / 255, b: color.b / 255 }))

/**
 * Measures the range a property covers over a whole gcode
 * @param layers - Parsed gcode layers
 * @param propertyOf - Property to read of each layer
 * @param decimals - Decimals the values are read at
 * @returns The range it covers
 */
export function propertyRange (layers: Layer[], propertyOf: (layer: Layer, layerNumber: number) => SegmentProperty, decimals: number): PropertyRange {
  const step = 10 ** decimals
  let lowest = Infinity
  let highest = -Infinity
  const values = new Set<number>()

  for (let layerNumber = 1; layerNumber <= layers.length; layerNumber++) {
    for (const rawValue of propertyOf(layers[layerNumber - 1], layerNumber).values) {
      const value = Math.round(rawValue * step) / step
      if (value < lowest) lowest = value
      if (value > highest) highest = value
      if (values.size <= 2) values.add(value)
    }
  }

  return { lowest, highest, values: values.size <= 2 ? [...values].sort((a, b) => a - b) : [] }
}

/**
 * Picks the color a value of a property range is drawn with
 * @param value - Value to color
 * @param range - Property range the value belongs to
 * @param logarithmic - True to spread the values by their ratio instead of their difference
 * @returns The color, in linear space
 */
export function propertyRangeColorAt (value: number, range: PropertyRange, logarithmic = false): RgbColor {
  const held = clamp(value, range.lowest, range.highest)
  const step = logarithmic && range.lowest > 0
    ? Math.log(range.highest / range.lowest) / (PROPERTY_RANGE_COLORS.length - 1)
    : (range.highest - range.lowest) / (PROPERTY_RANGE_COLORS.length - 1)
  const spread = logarithmic && range.lowest > 0 ? Math.log(held / range.lowest) : held - range.lowest
  const place = step > 0 ? spread / step : 0

  const lower = clamp(Math.floor(place), 0, PROPERTY_RANGE_COLORS.length - 1)
  const upper = Math.min(lower + 1, PROPERTY_RANGE_COLORS.length - 1)
  const share = place - lower

  const mix = (component: 'r' | 'g' | 'b'): number =>
    srgbToLinear(PROPERTY_RANGE_COLORS[lower][component] * (1 - share) + PROPERTY_RANGE_COLORS[upper][component] * share)
  return { r: mix('r'), g: mix('g'), b: mix('b') }
}

/** How much of a print the segments holding one value of a property take */
export interface PropertyValueUsage {
  /** Value the segments hold */
  value: number
  /** Share of the extrusion time, from 0 to 1 */
  timeShare: number
  /** Filament the segments extrude, in mm */
  filamentMm: number
}

/**
 * Measures how much of a gcode the segments holding each value of a property take
 * @param layers - Parsed gcode layers
 * @param propertyOf - Property to read of each layer
 * @returns The usage of every value the property takes, in value order
 */
export function propertyValueUsage (layers: Layer[], propertyOf: (layer: Layer, layerNumber: number) => SegmentProperty): PropertyValueUsage[] {
  let highestValue = -1
  for (let layerNumber = 1; layerNumber <= layers.length; layerNumber++) {
    for (const value of propertyOf(layers[layerNumber - 1], layerNumber).values) highestValue = Math.max(highestValue, value)
  }

  const seconds = new Float64Array(highestValue + 2)
  const filament = new Float64Array(highestValue + 2)

  for (let layerNumber = 1; layerNumber <= layers.length; layerNumber++) {
    const layer = layers[layerNumber - 1]
    const { vertices, durations, filamentPerMm } = layer
    const property = propertyOf(layer, layerNumber)
    const segments = vertices.length / 6
    let propertyStretch = 0
    let filamentStretch = 0

    for (let segment = 0; segment < segments; segment++) {
      while (propertyStretch + 1 < property.values.length && property.segmentIndices[propertyStretch + 1] <= segment) propertyStretch++
      while (filamentStretch + 1 < filamentPerMm.values.length && filamentPerMm.segmentIndices[filamentStretch + 1] <= segment) filamentStretch++

      const vertex = segment * 6
      const length = Math.hypot(vertices[vertex + 3] - vertices[vertex], vertices[vertex + 4] - vertices[vertex + 1], vertices[vertex + 5] - vertices[vertex + 2])
      const slot = property.values[propertyStretch] + 1
      seconds[slot] += durations[segment * 2 + 1]
      filament[slot] += filamentPerMm.values[filamentStretch] * length
    }
  }

  const totalSeconds = seconds.reduce((total, value) => total + value, 0)
  const usage: PropertyValueUsage[] = []
  for (let slot = 0; slot < seconds.length; slot++) {
    if (seconds[slot] > 0) usage.push({ value: slot - 1, timeShare: totalSeconds > 0 ? seconds[slot] / totalSeconds : 0, filamentMm: filament[slot] })
  }
  return usage
}

/**
 * Picks the values a property range is described by, one per color of the palette
 * @param range - Property range to describe
 * @param logarithmic - True to spread the values by their ratio instead of their difference
 * @returns The values, from the lowest to the highest
 */
export function propertyRangeSteps (range: PropertyRange, logarithmic = false): number[] {
  if (range.values.length) return range.values

  return Array.from({ length: PROPERTY_RANGE_COLORS.length }, (_unused, step) => {
    const share = step / (PROPERTY_RANGE_COLORS.length - 1)
    return logarithmic && range.lowest > 0
      ? range.lowest * Math.exp(share * Math.log(range.highest / range.lowest))
      : range.lowest + share * (range.highest - range.lowest)
  })
}

/* ---- Segment colors ---- */

/** Brightness the darkest segments are drawn at, as a share of their own color */
const MIN_BRIGHTNESS = 0.5
/** Brightness range the segments span as their angle turns, so the passes inside a layer can be told apart */
const ANGLE_BRIGHTNESS_RANGE = 0.4
/** Brightness the odd layers gain, so stacked layers can be told apart */
const ODD_LAYER_BRIGHTNESS_GAIN = 0.1

/**
 * Fills the vertex colors a layer's segments are drawn with
 * @param layer - Parsed layer
 * @param layerNumber - 1-based layer number
 * @param property - Property the segments take their color from
 * @param colorAt - Color a value of that property is drawn with
 * @param colors - Vertex colors as flat RGB triplets, filled in place
 */
export function fillLayerVertexColors (layer: Layer, layerNumber: number, property: SegmentProperty, colorAt: (value: number) => RgbColor, colors: Uint8ClampedArray): void {
  const { vertices } = layer
  const { segmentIndices, values } = property
  const segments = vertices.length / 6
  const layerBrightnessGain = layerNumber % 2 === 0 ? 0 : ODD_LAYER_BRIGHTNESS_GAIN

  for (let stretch = 0; stretch < values.length; stretch++) {
    const color = colorAt(values[stretch])
    const nextStretchSegment = stretch + 1 < values.length ? segmentIndices[stretch + 1] : segments

    for (let segment = segmentIndices[stretch]; segment < nextStretchSegment; segment++) {
      const vertex = segment * 6
      const deltaX = vertices[vertex + 3] - vertices[vertex]
      const deltaY = vertices[vertex + 4] - vertices[vertex + 1]
      const deltaZ = vertices[vertex + 5] - vertices[vertex + 2]

      // Fake shading: tint by the segment's angle, alternating per layer for readability
      const distance = Math.hypot(deltaX, deltaY, deltaZ)
      const directionX = distance ? deltaX / distance : 0
      const brightness = MIN_BRIGHTNESS + ANGLE_BRIGHTNESS_RANGE * (directionX + 1) / 2 + layerBrightnessGain

      const red = color.r * brightness * 255
      const green = color.g * brightness * 255
      const blue = color.b * brightness * 255
      colors[vertex] = red
      colors[vertex + 1] = green
      colors[vertex + 2] = blue
      colors[vertex + 3] = red
      colors[vertex + 4] = green
      colors[vertex + 5] = blue
    }
  }
}
