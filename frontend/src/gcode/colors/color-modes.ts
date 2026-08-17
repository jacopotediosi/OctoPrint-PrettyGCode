import { extrudedWidthProperty, gcodeMeasures, layerTimeProperty, volumetricFlowProperty } from './computed-properties'
import type { GcodeMeasures } from './computed-properties'
import { colorPrintProperty, resolveColorPrintColors } from './fixed-colors/color-print'
import { resolveFeatureTypeColors } from './fixed-colors/feature-type'
import { resolveToolColors } from './fixed-colors/tool'
import type { PropertyFixedColors } from './property-fixed-colors'
import { propertyValueUsage } from './property-value-usage'
import type { PropertyValueUsage } from './property-value-usage'
import { resolveRangeColors } from './range-colors'
import type { RgbColor } from '../../utils/colors'
import { secondsToDurationText } from '../../utils/time'
import type { Layer, ParsedGcode, SegmentProperty } from '../parsing/parsed-gcode'
import type { Settings } from '../../settings'

/* ---- Color modes ---- */

/** A way of coloring the gcode segments */
export interface ColorMode {
  /** Name shown to the user */
  name: string
  /**
   * Readies the mode to color a gcode
   * @param gcode - Parsed gcode to color
   * @param settings - Settings holding the colors the mode paints with
   * @param layerSeconds - Estimated seconds a layer takes to print
   * @returns The ready coloring
   */
  resolve: (gcode: ParsedGcode, settings: Settings, layerSeconds: (layerNumber: number) => number) => SegmentColoring
}

/** A color mode ready to color the segments of a gcode */
export interface SegmentColoring {
  /** Property a layer's segments take their color from */
  propertyOf: (layer: Layer, layerNumber: number) => SegmentProperty
  /** Color a value of that property is drawn with */
  colorAt: (value: number) => RgbColor
  /** Describes what the colors stand for */
  legend: () => ColorLegend
}

/* ---- Legend ---- */

/** What a color mode paints, described entry by entry */
export interface ColorLegend {
  /** Name of each column, the label one first */
  columnNames: string[]
  /** Entries, in the order they are shown */
  entries: ColorLegendEntry[]
}

/** One entry of what a color mode paints */
export interface ColorLegendEntry {
  /** Color the entry stands for */
  color: RgbColor
  /** Text naming what the entry stands for */
  label: string
  /** Measures shown on the right of the label */
  values: string[]
}

/* ---- Fixed colors ---- */

/** Definition of a color mode painting each value of its property with a color of its own */
interface FixedColorModeDefinition {
  /** Name shown to the user */
  name: string
  /** Property a layer's segments take their color from */
  propertyOf: (layer: Layer, layerNumber: number, measures: GcodeMeasures) => SegmentProperty
  /** Colors the values of that property are fixed to */
  colorsOf: (gcode: ParsedGcode, settings: Settings) => PropertyFixedColors
}

/**
 * Builds a color mode painting each value of its property with a color of its own
 * @param def - Definition of the mode
 * @returns The color mode
 */
function fixedColorMode (def: FixedColorModeDefinition): ColorMode {
  return {
    name: def.name,
    resolve: (gcode, settings, layerSeconds) => {
      const measures = gcodeMeasures(gcode, layerSeconds)
      const propertyOf = (layer: Layer, layerNumber: number): SegmentProperty => def.propertyOf(layer, layerNumber, measures)
      const fixedColors = def.colorsOf(gcode, settings)
      const colorAt = (value: number): RgbColor => fixedColors.colors[value] ?? fixedColors.defaultColor

      return {
        propertyOf,
        colorAt,
        legend: () => {
          // Weighing the filament takes a diameter and a density only some slicers state
          const density = gcode.slicerFilamentDiameter != null ? gcode.slicerFilamentDensity : null

          // Tells whether a value has a color of its own, the others sharing the default one
          const colored = (used: PropertyValueUsage): boolean => fixedColors.colors[used.value] !== undefined

          const usage = propertyValueUsage(gcode.layers, propertyOf)
          if (fixedColors.inPrintOrder) {
            usage.reverse()
          } else {
            usage.sort((first, second) => Number(colored(second)) - Number(colored(first)) || second.timeShare - first.timeShare)
          }

          const entries = usage.map((used) => {
            const values = [(used.timeShare * 100).toFixed(1) + ' %', (used.filamentMm / 1000).toFixed(2) + ' m']
            if (density != null) values.push((used.filamentMm * measures.filamentArea * density / 1000).toFixed(1) + ' g')

            return { color: colorAt(used.value), label: fixedColors.nameOf(used.value), values }
          })

          return { columnNames: [def.name, 'Percentage', 'Used filament'], entries }
        }
      }
    }
  }
}

/* ---- Range colors ---- */

/** Definition of a color mode spreading the values of its property over the range they cover */
interface RangeColorModeDefinition {
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
  propertyOf: (layer: Layer, layerNumber: number, measures: GcodeMeasures) => SegmentProperty
}

/**
 * Builds a color mode spreading the values of its property over the range they cover
 * @param def - Definition of the mode
 * @returns The color mode
 */
function rangeColorMode (def: RangeColorModeDefinition): ColorMode {
  return {
    name: def.name,
    resolve: (gcode, settings, layerSeconds) => {
      const measures = gcodeMeasures(gcode, layerSeconds)
      const propertyOf = (layer: Layer, layerNumber: number): SegmentProperty => def.propertyOf(layer, layerNumber, measures)
      const rangeColors = resolveRangeColors(gcode.layers, propertyOf, def.decimals, def.logarithmic)

      return {
        propertyOf,
        colorAt: rangeColors.colorAt,
        legend: () => ({
          columnNames: [],
          entries: rangeColors.steps.map((value) => ({
            color: rangeColors.colorAt(value),
            label: def.duration ? secondsToDurationText(value, 's') : value.toFixed(def.decimals) + ' ' + def.unit,
            values: []
          })).reverse()
        })
      }
    }
  }
}

/* ---- Catalog ---- */

/** The ways of coloring the gcode segments, by id */
export const COLOR_MODES = {
  featureType: fixedColorMode({
    name: 'Feature type',
    propertyOf: (layer) => layer.featureTypeIds,
    colorsOf: (gcode, settings) => resolveFeatureTypeColors(gcode.featureTypes, settings.featureTypeColorRules, settings.featureTypeDefaultColor)
  }),
  height: rangeColorMode({ name: 'Height', unit: 'mm', decimals: 3, propertyOf: (layer) => layer.heights }),
  width: rangeColorMode({ name: 'Width', unit: 'mm', decimals: 3, propertyOf: extrudedWidthProperty }),
  speed: rangeColorMode({ name: 'Speed', unit: 'mm/s', decimals: 1, propertyOf: (layer) => layer.feedrates }),
  fanSpeed: rangeColorMode({ name: 'Fan speed', unit: '%', decimals: 0, propertyOf: (layer) => layer.fanSpeeds }),
  temperature: rangeColorMode({ name: 'Temperature', unit: '\u00b0C', decimals: 0, propertyOf: (layer) => layer.temperatures }),
  volumetricFlow: rangeColorMode({ name: 'Volumetric flow rate', unit: 'mm\u00b3/s', decimals: 3, propertyOf: volumetricFlowProperty }),
  layerTime: rangeColorMode({ name: 'Layer time (linear)', unit: 's', decimals: 0, duration: true, propertyOf: layerTimeProperty }),
  layerTimeLogarithmic: rangeColorMode({ name: 'Layer time (logarithmic)', unit: 's', decimals: 0, logarithmic: true, duration: true, propertyOf: layerTimeProperty }),
  tool: fixedColorMode({
    name: 'Tool',
    propertyOf: (layer) => layer.toolIds,
    colorsOf: (gcode) => resolveToolColors(gcode.slicerToolColors)
  }),
  colorPrint: fixedColorMode({ name: 'Color Print', propertyOf: colorPrintProperty, colorsOf: resolveColorPrintColors })
} satisfies Record<string, ColorMode>

/** Id of a way of coloring the gcode segments */
export type ColorModeId = keyof typeof COLOR_MODES

/**
 * Works out how the segments of a gcode take their color
 * @param gcode - Parsed gcode to color
 * @param settings - Settings holding the color mode and the colors it paints with
 * @param layerSeconds - Estimated seconds a layer takes to print
 * @returns The resolved coloring
 */
export function resolveSegmentColoring (gcode: ParsedGcode, settings: Settings, layerSeconds: (layerNumber: number) => number): SegmentColoring {
  return COLOR_MODES[settings.colorMode].resolve(gcode, settings, layerSeconds)
}
