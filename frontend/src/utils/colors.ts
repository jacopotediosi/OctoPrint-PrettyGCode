import { clamp } from './numbers'

/** An RGB color, with components from 0 to 1 */
export interface RgbColor {
  r: number
  g: number
  b: number
}

/**
 * Converts an sRGB component to linear space
 * @param component - The sRGB component (from 0 to 1)
 * @returns The linear component
 */
export const srgbToLinear = (component: number): number => component < 0.04045 ? component * 0.0773993808 : Math.pow(component * 0.9478672986 + 0.0521327014, 2.4)

/**
 * Converts a color to linear space
 * @param hexString - Color as "#rrggbb"
 * @returns The linear color
 */
export function hexStringToLinearColor (hexString: string): RgbColor {
  const hex = parseInt(hexString.slice(1), 16)
  return {
    r: srgbToLinear(((hex >> 16) & 255) / 255),
    g: srgbToLinear(((hex >> 8) & 255) / 255),
    b: srgbToLinear((hex & 255) / 255)
  }
}

/**
 * Converts a linear color to the form a style sheet takes
 * @param color - Color to convert
 * @returns The color as "#rrggbb"
 */
export function rgbColorToHexString (color: RgbColor): string {
  const component = (value: number): string => {
    const srgb = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
    return Math.round(clamp(srgb, 0, 1) * 255).toString(16).padStart(2, '0')
  }
  return '#' + component(color.r) + component(color.g) + component(color.b)
}
