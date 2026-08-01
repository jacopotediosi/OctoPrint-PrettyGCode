/** One color rule: keywords to look for in comments, and the color to paint their segments */
export interface ColorRule {
  keywords: string[]
  color: string
}

/** The parser's color rules and the default color used for segments matching no color rule */
export interface ParserColors {
  colorRules: ColorRule[]
  defaultColor: string
}

/** A named set of colors, one per gcode feature, selectable in the model colors modal */
export interface ColorPreset {
  /** Preset name */
  name: string
  /** Color of segments matching no color rule */
  defaultColor: string
  /** Color rules of the preset, in priority order */
  colorRules: ColorRule[]
}

/**
 * Copies color rules into an editable array
 * @param colorRules - Color rules to copy
 * @returns The copied rules
 */
export function cloneColorRules (colorRules: ColorRule[]): ColorRule[] {
  return colorRules.map((rule) => ({ keywords: [...rule.keywords], color: rule.color }))
}
