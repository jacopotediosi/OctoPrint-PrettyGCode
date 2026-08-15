import { resolveToolColors } from './tool'
import { hexStringToLinearColor, type RgbColor } from '../../../utils/colors'
import type { PropertyFixedColors } from '../property-fixed-colors'
import type { Layer, ParsedGcode, SegmentProperty } from '../../parsing/parsed-gcode'
import { joinSegmentProperties } from '../../parsing/segment-properties'

/** Colors standing in for the color change colors a gcode does not state */
const FALLBACK_COLOR_CHANGE_COLORS = ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#1abc9c', '#2980b9', '#9b59b6']

/** Value the first color change takes, the lower ones standing for the tools printing before any change */
const FIRST_COLOR_CHANGE_VALUE = 256

/** Height in mm a color change may miss the layer it takes effect at by */
const COLOR_CHANGE_EPSILON_MM = 0.0011

/**
 * Works out what each segment of a layer takes its color from
 * @param layer - Parsed layer
 * @returns The property, holding the tool of a segment printed before that tool changed color and the color change of one printed after it
 */
export function colorPrintProperty (layer: Layer): SegmentProperty {
  return joinSegmentProperties(layer.toolIds, layer.colorChangeIds,
    (toolId, colorChangeId) => colorChangeId < 0 ? toolId : FIRST_COLOR_CHANGE_VALUE + colorChangeId)
}

/**
 * Picks the color and the name every stretch of a color printed gcode goes by
 * @param gcode - Parsed gcode to read
 * @returns The picked colors
 */
export function resolveColorPrintColors (gcode: ParsedGcode): PropertyFixedColors {
  const toolColors = resolveToolColors(gcode.slicerToolColors)
  const colors: Array<RgbColor | undefined> = [...toolColors.colors]

  gcode.colorChanges.forEach((change, index) => {
    colors[FIRST_COLOR_CHANGE_VALUE + index] = hexStringToLinearColor(change.color || FALLBACK_COLOR_CHANGE_COLORS[index % FALLBACK_COLOR_CHANGE_COLORS.length])
  })

  // Heights every change prints from, and the last ones printed before it
  const layerHeights = gcode.layers.map((layer) => layer.z).sort((first, second) => first - second)
  const changeHeights = gcode.colorChanges.map((change) => {
    const layer = layerHeights.findIndex((height) => height >= change.z - COLOR_CHANGE_EPSILON_MM)
    return { from: layer < 0 ? change.z : layerHeights[layer], upTo: layer > 0 ? layerHeights[layer - 1] : 0 }
  })

  /**
   * Finds the color change a tool takes after another one
   * @param toolId - Id of the tool to follow
   * @param change - Index of the color change to start from, -1 to start from the top of the print
   * @returns The index of the next change of that tool, -1 when it changes no more
   */
  const nextChange = (toolId: number, change: number): number =>
    gcode.colorChanges.findIndex((next, index) => index > change && next.toolId === toolId)

  return {
    colors,
    defaultColor: toolColors.defaultColor,
    inPrintOrder: true,
    nameOf: (value: number) => {
      const change = value < FIRST_COLOR_CHANGE_VALUE ? -1 : value - FIRST_COLOR_CHANGE_VALUE
      const toolId = change < 0 ? value : gcode.colorChanges[change].toolId
      const next = nextChange(toolId, change)

      // Only a gcode printing with several tools names them apart
      const tool = gcode.slicerToolColors.length > 1 ? toolColors.nameOf(toolId) + ' ' : ''

      if (change < 0) return tool + (next < 0 ? 'default color' : `up to ${changeHeights[next].upTo.toFixed(2)} mm`)
      if (next < 0) return tool + `above ${changeHeights[change].from.toFixed(2)} mm`
      return tool + `from ${changeHeights[change].from.toFixed(2)} to ${changeHeights[next].upTo.toFixed(2)} mm`
    }
  }
}
