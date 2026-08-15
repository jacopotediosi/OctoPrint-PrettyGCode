import { hexStringToLinearColor } from '../../../utils/colors'
import type { PropertyFixedColors } from '../property-fixed-colors'

/** Colors standing in for the filament colors a gcode does not state */
const FALLBACK_FILAMENT_COLORS = ['#0b2c7a', '#1c8891', '#aaf200', '#f5ce0a', '#d16830', '#942616']

/**
 * Picks the color every tool of a gcode is painted with
 * @param statedColors - Color the slicer states for each tool, empty where it states none
 * @returns The picked colors
 */
export function resolveToolColors (statedColors: string[]): PropertyFixedColors {
  const tools = Math.max(statedColors.length, FALLBACK_FILAMENT_COLORS.length)

  return {
    colors: Array.from({ length: tools }, (_unused, tool) =>
      hexStringToLinearColor(statedColors[tool] || FALLBACK_FILAMENT_COLORS[tool % FALLBACK_FILAMENT_COLORS.length])),
    defaultColor: hexStringToLinearColor(FALLBACK_FILAMENT_COLORS[0]),
    nameOf: (tool: number) => `Extruder ${tool + 1}`
  }
}
