import { srgbToLinear, type RgbColor } from './segment-colors'

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
 * Converts a color to linear space
 * @param hexString - Color as "#rrggbb"
 * @returns The linear color
 */
function hexStringToLinearColor (hexString: string): RgbColor {
  const hex = parseInt(hexString.slice(1), 16)
  return {
    r: srgbToLinear(((hex >> 16) & 255) / 255),
    g: srgbToLinear(((hex >> 8) & 255) / 255),
    b: srgbToLinear((hex & 255) / 255)
  }
}

/**
 * Picks the color every feature type of a gcode is painted with
 * @param featureTypeComments - Lowercased feature type comments the gcode states, by feature type id
 * @param colorRules - Feature type color rules to try, in priority order
 * @param defaultColor - Color of segments matching no color rule
 * @returns The picked colors
 */
export function resolveFeatureTypeColors (featureTypeComments: string[], colorRules: FeatureTypeColorRule[], defaultColor: string): ResolvedFeatureTypeColors {
  // Lowercase the keywords, dropping the empty ones
  const rules = colorRules.map((rule) => ({
    keywords: rule.keywords.map((keyword) => keyword.toLowerCase()).filter(Boolean),
    color: rule.color
  }))

  return {
    colors: featureTypeComments.map((comment) => {
      const match = rules.find(({ keywords }) => keywords.some((keyword) => comment.includes(keyword)))
      return hexStringToLinearColor(match ? match.color : defaultColor)
    }),
    defaultColor: hexStringToLinearColor(defaultColor)
  }
}
