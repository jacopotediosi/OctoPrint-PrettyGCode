import { hexStringToLinearColor } from '../../../utils/colors'
import type { PropertyFixedColors } from '../property-fixed-colors'

/**
 * Colors standing in for the filament colors a gcode does not state.
 * Values copied from PrusaSlicer's GCodeProcessor Default_Colors (AGPL-3.0-or-later, Copyright (c) Prusa Research 2020-2023):
 * https://github.com/prusa3d/PrusaSlicer/blob/b028299c770b8380ee81c921a2867d522f288123/src/libslic3r/GCode/GCodeProcessor.cpp#L1991
 */
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
