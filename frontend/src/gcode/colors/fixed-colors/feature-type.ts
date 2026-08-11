import { hexStringToLinearColor } from '../../../utils/colors'
import type { PropertyFixedColors } from '../property-fixed-colors'
import type { FeatureType } from '../../parsing/parsed-gcode'

/** Rule coloring the gcode wherever a feature type comment holds one of its keywords */
export interface FeatureTypeColorRule {
  /** Keywords to look for in the feature type comments */
  keywords: string[]
  /** Color to paint the matching segments, as "#rrggbb" */
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

/**
 * Copies feature type color rules into an editable array
 * @param colorRules - Feature type color rules to copy
 * @returns The copied rules
 */
export function cloneFeatureTypeColorRules (colorRules: FeatureTypeColorRule[]): FeatureTypeColorRule[] {
  return colorRules.map((rule) => ({ keywords: [...rule.keywords], color: rule.color }))
}

/**
 * Picks the color every feature type of a gcode is painted with
 * @param featureTypes - Feature types the gcode states, by feature type id
 * @param colorRules - Feature type color rules to try, in priority order
 * @param defaultColor - Color of segments matching no color rule
 * @returns The picked colors
 */
export function resolveFeatureTypeColors (featureTypes: FeatureType[], colorRules: FeatureTypeColorRule[], defaultColor: string): PropertyFixedColors {
  // Lowercase the keywords, dropping the empty ones
  const rules = colorRules.map((rule) => ({
    keywords: rule.keywords.map((keyword) => keyword.toLowerCase()).filter(Boolean),
    color: rule.color
  }))

  const ruleIndices = featureTypes.map((featureType) =>
    rules.findIndex(({ keywords }) => keywords.some((keyword) => featureType.comment.includes(keyword))))

  return {
    colors: ruleIndices.map((rule) => rule < 0 ? undefined : hexStringToLinearColor(rules[rule].color)),
    defaultColor: hexStringToLinearColor(defaultColor),
    nameOf: (featureTypeId: number) => featureTypes[featureTypeId]?.label ?? 'Other'
  }
}
