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

/** Keywords per color rule, in priority order (first match from the top wins); shared by every preset */
const COLOR_RULE_DEFS = [
  { id: 'overhang', keywords: ['overhang'] }, // Prusa/SuperSlicer "Overhang perimeter", Bambu/Orca "Overhang wall"
  { id: 'externalWall', keywords: ['external', 'outer'] }, // Prusa/SuperSlicer "External perimeter", Bambu/Orca "Outer wall", Cura "WALL-OUTER", Simplify3D "outer perimeter"/"external single extrusion"
  { id: 'innerWall', keywords: ['perimeter', 'inner', 'internal single'] }, // Prusa/SuperSlicer "Perimeter", Bambu/Orca "Inner wall", Cura "WALL-INNER", Simplify3D "inner perimeter"/"internal single extrusion"
  { id: 'topSurface', keywords: ['top', 'skin'] }, // Prusa/SuperSlicer "Top solid infill", Bambu/Orca "Top surface", Cura "SKIN"
  { id: 'bottomSurface', keywords: ['bottom'] }, // Bambu/Orca "Bottom surface"
  { id: 'solidInfill', keywords: ['solid'] }, // Prusa/SuperSlicer "Solid infill", Bambu/Orca "Internal solid infill", Simplify3D "solid layer"
  { id: 'internalBridge', keywords: ['internal bridge infill'] }, // SuperSlicer "Internal bridge infill"
  { id: 'bridge', keywords: ['bridge'] }, // Prusa/SuperSlicer "Bridge infill", Bambu/Orca "Bridge", Simplify3D "bridge"
  { id: 'supportIroning', keywords: ['support ironing'] }, // Bambu "Support ironing"
  { id: 'ironing', keywords: ['ironing'] }, // Prusa/SuperSlicer/Bambu/Orca "Ironing"
  { id: 'gap', keywords: ['gap'] }, // Prusa/SuperSlicer "Gap fill", Bambu/Orca "Gap infill", Simplify3D "gap fill"
  { id: 'skirt', keywords: ['skirt'] }, // Prusa/SuperSlicer/Bambu/Orca "Skirt", Cura "SKIRT", Simplify3D "skirt"
  { id: 'brim', keywords: ['brim', 'raft'] }, // Bambu/Orca "Brim", Simplify3D "raft"
  { id: 'supportInterface', keywords: ['interface'] }, // Prusa/SuperSlicer "Support material interface", Bambu/Orca "Support interface", Cura "SUPPORT-INTERFACE"
  { id: 'supportTransition', keywords: ['support transition'] }, // Bambu/Orca "Support transition"
  { id: 'support', keywords: ['support'] }, // Prusa/SuperSlicer "Support material", Bambu/Orca "Support", Cura "SUPPORT", Simplify3D "support"
  { id: 'primeTower', keywords: ['tower', 'pillar', 'ooze'] }, // Prusa/SuperSlicer/Bambu "Wipe tower", Orca "Prime tower", Simplify3D "prime pillar"/"ooze shield"
  { id: 'thinWall', keywords: ['thin wall'] }, // SuperSlicer "Thin wall"
  { id: 'floatingShell', keywords: ['floating vertical shell'] }, // Bambu "Floating vertical shell"
  { id: 'sparseInfill', keywords: ['fill'] } // Prusa/SuperSlicer "Internal infill", Bambu/Orca "Sparse infill", Cura "FILL", Simplify3D "infill"
] as const satisfies readonly { id: string, keywords: readonly string[] }[]

/** Identifier of a color rule */
type ColorRuleId = typeof COLOR_RULE_DEFS[number]['id']

/** A named set of colors, one per color rule, selectable in the model colors modal */
export interface ColorPreset {
  /** Preset name */
  name: string
  /** Color of segments matching no color rule */
  defaultColor: string
  /** Color of each color rule, by id */
  colors: Record<ColorRuleId, string>
}

/** Built-in model color presets */
export const COLOR_PRESETS: ColorPreset[] = [
  {
    name: 'PrusaSlicer / SuperSlicer / Bambu Studio / OrcaSlicer',
    defaultColor: '#e6b3b3',
    colors: {
      overhang: '#1f1fff',
      externalWall: '#ff7d38',
      innerWall: '#ffe64d',
      topSurface: '#f04040',
      bottomSurface: '#665cc7',
      solidInfill: '#9654cc',
      internalBridge: '#c94a42',
      bridge: '#4d80ba',
      supportIroning: '#99ff99',
      ironing: '#ff8c69',
      gap: '#ffffff',
      skirt: '#00876e',
      brim: '#003b6e',
      supportInterface: '#008000',
      supportTransition: '#004000',
      support: '#00ff00',
      primeTower: '#b3e3ab',
      thinWall: '#00ff66',
      floatingShell: '#e6b2b2',
      sparseInfill: '#b03029'
    }
  },
  {
    name: 'Cura',
    defaultColor: '#ffffff',
    colors: {
      overhang: '#1f1fff',
      externalWall: '#e60000',
      innerWall: '#00e600',
      topSurface: '#e6e600',
      bottomSurface: '#665cc7',
      solidInfill: '#9654cc',
      internalBridge: '#c94a42',
      bridge: '#4d80ba',
      supportIroning: '#99ff99',
      ironing: '#ff8c69',
      gap: '#ffffff',
      skirt: '#00e6e6',
      brim: '#003b6e',
      supportInterface: '#3f7fff',
      supportTransition: '#004000',
      support: '#00e6e6',
      primeTower: '#00ffff',
      thinWall: '#00ff66',
      floatingShell: '#e6b2b2',
      sparseInfill: '#e67300'
    }
  }
]

/**
 * Builds the color rules of a preset
 * @param preset - Preset whose colors to use
 * @returns The color rules, in priority order
 */
export function presetColorRules (preset: ColorPreset): ColorRule[] {
  return COLOR_RULE_DEFS.map(({ id, keywords }) => ({ keywords: [...keywords], color: preset.colors[id] }))
}

/** Default color rules, in priority order */
export const DEFAULT_COLOR_RULES: ColorRule[] = presetColorRules(COLOR_PRESETS[0])

/** Default color of segments matching no color rule */
export const DEFAULT_COLOR = COLOR_PRESETS[0].defaultColor

/**
 * Copies color rules into an editable array
 * @param colorRules - Color rules to copy
 * @returns The copied rules
 */
export function cloneColorRules (colorRules: ColorRule[]): ColorRule[] {
  return colorRules.map((rule) => ({ keywords: [...rule.keywords], color: rule.color }))
}
