import { hexStringToLinearColor, type RgbColor } from '../../utils/colors'
import type { FeatureType, ParsedGcode } from '../parsing/parser'

/** One feature type color rule: keywords to look for in comments, and the color to paint their segments */
export interface FeatureTypeColorRule {
  keywords: string[]
  color: string
}

/** A named set of colors, one per gcode feature type, selectable in the feature type colors modal */
export interface FeatureTypeColorPreset {
  /** Preset name */
  name: string
  /** Color of segments matching no color rule */
  defaultColor: string
  /** Color rules of the preset, in priority order */
  colorRules: FeatureTypeColorRule[]
}

/** The colors the feature type color rules call for on a gcode */
export interface ResolvedFeatureTypeColors {
  /** Color of each feature type, by feature type id */
  colors: RgbColor[]
  /** Color of segments belonging to no feature type */
  defaultColor: RgbColor
  /** Color rule each feature type matched, -1 when it matched none, by feature type id */
  ruleIndices: number[]
}

/**
 * Copies feature type color rules into an editable array
 * @param colorRules - Feature type color rules to copy
 * @returns The copied rules
 */
export function cloneFeatureTypeColorRules (colorRules: FeatureTypeColorRule[]): FeatureTypeColorRule[] {
  return colorRules.map((rule) => ({ keywords: [...rule.keywords], color: rule.color }))
}

/** How much of a print one feature type takes */
export interface FeatureTypeUsage {
  /** Id of the feature type, -1 for the segments belonging to none */
  featureTypeId: number
  /** Share of the extrusion time, from 0 to 1 */
  timeShare: number
  /** Filament the segments extrude, in mm */
  filamentMm: number
}

/**
 * Measures how much of a gcode each of its feature types takes
 * @param gcode - Parsed gcode to measure
 * @returns The usage of the feature types its segments belong to, in feature type id order
 */
export function featureTypeUsage (gcode: ParsedGcode): FeatureTypeUsage[] {
  const seconds = new Float64Array(gcode.featureTypes.length + 1)
  const filament = new Float64Array(gcode.featureTypes.length + 1)

  for (const layer of gcode.layers) {
    const { vertices, durations, featureTypeIds, filamentPerMm } = layer
    const segments = vertices.length / 6
    let featureTypeStretch = 0
    let filamentStretch = 0

    for (let segment = 0; segment < segments; segment++) {
      while (featureTypeStretch + 1 < featureTypeIds.values.length && featureTypeIds.segmentIndices[featureTypeStretch + 1] <= segment) featureTypeStretch++
      while (filamentStretch + 1 < filamentPerMm.values.length && filamentPerMm.segmentIndices[filamentStretch + 1] <= segment) filamentStretch++

      const vertex = segment * 6
      const length = Math.hypot(vertices[vertex + 3] - vertices[vertex], vertices[vertex + 4] - vertices[vertex + 1], vertices[vertex + 5] - vertices[vertex + 2])
      const slot = featureTypeIds.values[featureTypeStretch] + 1
      seconds[slot] += durations[segment * 2 + 1]
      filament[slot] += filamentPerMm.values[filamentStretch] * length
    }
  }

  const totalSeconds = seconds.reduce((total, value) => total + value, 0)
  const usage: FeatureTypeUsage[] = []
  for (let slot = 0; slot < seconds.length; slot++) {
    if (seconds[slot] > 0) usage.push({ featureTypeId: slot - 1, timeShare: totalSeconds > 0 ? seconds[slot] / totalSeconds : 0, filamentMm: filament[slot] })
  }
  return usage
}

/**
 * Picks the color every feature type of a gcode is painted with
 * @param featureTypes - Feature types the gcode states, by feature type id
 * @param colorRules - Feature type color rules to try, in priority order
 * @param defaultColor - Color of segments matching no color rule
 * @returns The picked colors
 */
export function resolveFeatureTypeColors (featureTypes: FeatureType[], colorRules: FeatureTypeColorRule[], defaultColor: string): ResolvedFeatureTypeColors {
  // Lowercase the keywords, dropping the empty ones
  const rules = colorRules.map((rule) => ({
    keywords: rule.keywords.map((keyword) => keyword.toLowerCase()).filter(Boolean),
    color: rule.color
  }))

  const ruleIndices = featureTypes.map((featureType) =>
    rules.findIndex(({ keywords }) => keywords.some((keyword) => featureType.comment.includes(keyword))))

  return {
    colors: ruleIndices.map((rule) => hexStringToLinearColor(rule < 0 ? defaultColor : rules[rule].color)),
    defaultColor: hexStringToLinearColor(defaultColor),
    ruleIndices
  }
}
