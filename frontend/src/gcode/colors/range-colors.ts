import { srgbToLinear } from '../../utils/colors'
import type { RgbColor } from '../../utils/colors'
import { clamp } from '../../utils/numbers'
import type { Layer, SegmentProperty } from '../parsing/parsed-gcode'

/** The colors the values of a property are spread over, and the values standing for them */
export interface PropertyRangeColors {
  /** Color a value of the property is drawn with */
  colorAt: (value: number) => RgbColor
  /** Values the spread is described by, from the lowest to the highest */
  steps: number[]
}

/** The range a property covers over a gcode */
interface PropertyRange {
  /** Value the spread runs from */
  lowest: number
  /** Value the spread runs to */
  highest: number
  /** The values the property takes, empty when it takes more than two of them */
  values: number[]
}

/**
 * Colors the values of a property range are drawn with, from its lowest to its highest.
 * Values copied from PrusaSlicer libvgcode's DEFAULT_RANGES_COLORS (AGPL-3.0-or-later, Copyright (c) Prusa Research 2023):
 * https://github.com/prusa3d/PrusaSlicer/blob/b028299c770b8380ee81c921a2867d522f288123/src/libvgcode/include/ColorRange.hpp#L14
 */
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
 * @param logarithmic - True to spread the values by their ratio instead of their difference
 * @returns The range it covers
 */
function propertyRange (layers: Layer[], propertyOf: (layer: Layer, layerNumber: number) => SegmentProperty, decimals: number, logarithmic: boolean): PropertyRange {
  const step = 10 ** decimals
  let lowest = Infinity
  let lowestPositive = Infinity
  let highest = -Infinity
  const values = new Set<number>()

  for (let layerNumber = 1; layerNumber <= layers.length; layerNumber++) {
    for (const rawValue of propertyOf(layers[layerNumber - 1], layerNumber).values) {
      const value = Math.round(rawValue * step) / step
      if (value < lowest) lowest = value
      if (value > 0 && value < lowestPositive) lowestPositive = value
      if (value > highest) highest = value
      if (values.size <= 2) values.add(value)
    }
  }

  return {
    // A logarithmic spread has to start above zero
    lowest: logarithmic && lowestPositive < Infinity ? lowestPositive : lowest,
    highest,
    values: values.size <= 2 ? [...values].sort((a, b) => a - b) : []
  }
}

/**
 * Picks the color a value of a property range is drawn with
 * @param value - Value to color
 * @param range - Property range the value belongs to
 * @param logarithmic - True to spread the values by their ratio instead of their difference
 * @returns The color, in linear space
 */
function propertyRangeColorAt (value: number, range: PropertyRange, logarithmic = false): RgbColor {
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

/**
 * Picks the values a property range is described by, one per color of the palette
 * @param range - Property range to describe
 * @param logarithmic - True to spread the values by their ratio instead of their difference
 * @returns The values, from the lowest to the highest
 */
function propertyRangeSteps (range: PropertyRange, logarithmic = false): number[] {
  if (range.values.length) return range.values

  return Array.from({ length: PROPERTY_RANGE_COLORS.length }, (_unused, step) => {
    const share = step / (PROPERTY_RANGE_COLORS.length - 1)
    return logarithmic && range.lowest > 0
      ? range.lowest * Math.exp(share * Math.log(range.highest / range.lowest))
      : range.lowest + share * (range.highest - range.lowest)
  })
}

/**
 * Picks the colors the values of a property are painted with, spread over the range they cover
 * @param layers - Parsed gcode layers
 * @param propertyOf - Property to read of each layer
 * @param decimals - Decimals the values are read at
 * @param logarithmic - True to spread the values by their ratio instead of their difference
 * @returns The picked colors
 */
export function resolveRangeColors (layers: Layer[], propertyOf: (layer: Layer, layerNumber: number) => SegmentProperty, decimals: number, logarithmic = false): PropertyRangeColors {
  const range = propertyRange(layers, propertyOf, decimals, logarithmic)

  return {
    colorAt: (value: number) => propertyRangeColorAt(value, range, logarithmic),
    steps: propertyRangeSteps(range, logarithmic)
  }
}
