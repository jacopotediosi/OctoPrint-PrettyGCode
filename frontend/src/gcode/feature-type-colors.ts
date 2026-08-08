import type { Layer } from './parsing/parser'

/* ---- Color rules ---- */

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

/**
 * Copies feature type color rules into an editable array
 * @param colorRules - Feature type color rules to copy
 * @returns The copied rules
 */
export function cloneFeatureTypeColorRules (colorRules: FeatureTypeColorRule[]): FeatureTypeColorRule[] {
  return colorRules.map((rule) => ({ keywords: [...rule.keywords], color: rule.color }))
}

/* ---- Segment colors ---- */

/** An RGB color, with components from 0 to 1 */
export interface RgbColor {
  r: number
  g: number
  b: number
}

/** The colors the feature type color rules call for on a gcode */
export interface ResolvedFeatureTypeColors {
  /** Color of each feature type, by feature type id */
  colors: RgbColor[]
  /** Color of segments belonging to no feature type */
  defaultColor: RgbColor
}

/** Brightness the darkest segments are drawn at, as a share of their own color */
const MIN_BRIGHTNESS = 0.5
/** Brightness range the segments span as their angle turns, so the passes inside a layer can be told apart */
const ANGLE_BRIGHTNESS_RANGE = 0.4
/** Brightness the odd layers gain, so stacked layers can be told apart */
const ODD_LAYER_BRIGHTNESS_GAIN = 0.1

/**
 * Converts an sRGB component to linear space
 * @param component - The sRGB component (from 0 to 1)
 * @returns The linear component
 */
const srgbToLinear = (component: number): number => component < 0.04045 ? component * 0.0773993808 : Math.pow(component * 0.9478672986 + 0.0521327014, 2.4)

/**
 * Converts a color to its most vivid form
 * @param hexString - Color as "#rrggbb"
 * @returns The vivid color, in linear space
 */
function hexStringToVividColor (hexString: string): RgbColor {
  const hex = parseInt(hexString.slice(1), 16)
  const red = srgbToLinear(((hex >> 16) & 255) / 255)
  const green = srgbToLinear(((hex >> 8) & 255) / 255)
  const blue = srgbToLinear((hex & 255) / 255)

  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  if (max === min) return { r: 0.5, g: 0.5, b: 0.5 }

  const lightness = (max + min) / 2
  const saturation = lightness <= 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min)

  // Spread the components around half lightness
  const scale = saturation / (max - min)
  const offset = (1 - saturation) / 2 - min * scale
  return { r: red * scale + offset, g: green * scale + offset, b: blue * scale + offset }
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
      return hexStringToVividColor(match ? match.color : defaultColor)
    }),
    defaultColor: hexStringToVividColor(defaultColor)
  }
}

/**
 * Fills the vertex colors a layer's segments are drawn with
 * @param layer - Parsed layer
 * @param layerNumber - 1-based layer number
 * @param featureTypeColors - Colors to paint the segments with
 * @param colors - Vertex colors as flat RGB triplets, filled in place
 */
export function fillLayerVertexColors (layer: Layer, layerNumber: number, featureTypeColors: ResolvedFeatureTypeColors, colors: Uint8ClampedArray): void {
  const { vertices, featureTypeIds, featureTypeSegmentIndices } = layer
  const segments = vertices.length / 6
  const layerBrightnessGain = layerNumber % 2 === 0 ? 0 : ODD_LAYER_BRIGHTNESS_GAIN

  for (let featureType = 0; featureType < featureTypeIds.length; featureType++) {
    const featureTypeId = featureTypeIds[featureType]
    const color = featureTypeId < 0 ? featureTypeColors.defaultColor : featureTypeColors.colors[featureTypeId]
    const nextFeatureTypeSegment = featureType + 1 < featureTypeIds.length ? featureTypeSegmentIndices[featureType + 1] : segments

    for (let segment = featureTypeSegmentIndices[featureType]; segment < nextFeatureTypeSegment; segment++) {
      const vertex = segment * 6
      const deltaX = vertices[vertex + 3] - vertices[vertex]
      const deltaY = vertices[vertex + 4] - vertices[vertex + 1]
      const deltaZ = vertices[vertex + 5] - vertices[vertex + 2]

      // Fake shading: tint by the segment's angle, alternating per layer for readability
      const distance = Math.hypot(deltaX, deltaY, deltaZ)
      const directionX = distance ? deltaX / distance : 0
      const brightness = MIN_BRIGHTNESS + ANGLE_BRIGHTNESS_RANGE * (directionX + 1) / 2 + layerBrightnessGain

      const red = color.r * brightness * 255
      const green = color.g * brightness * 255
      const blue = color.b * brightness * 255
      colors[vertex] = red
      colors[vertex + 1] = green
      colors[vertex + 2] = blue
      colors[vertex + 3] = red
      colors[vertex + 4] = green
      colors[vertex + 5] = blue
    }
  }
}
