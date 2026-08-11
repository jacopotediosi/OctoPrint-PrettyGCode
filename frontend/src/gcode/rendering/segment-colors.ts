import * as THREE from '../../three-exports'
import type { RgbColor } from '../../utils/colors'
import type { Layer, SegmentProperty } from '../parsing/parsed-gcode'

/** Brightness the darkest segments are drawn at, as a share of their own color */
const MIN_BRIGHTNESS = 0.5
/** Brightness range the segments span as their angle turns, so the passes inside a layer can be told apart */
const ANGLE_BRIGHTNESS_RANGE = 0.4
/** Brightness the odd layers gain, so stacked layers can be told apart */
const ODD_LAYER_BRIGHTNESS_GAIN = 0.1
/** Brightness the excluded segments are greyed to, as a share of their own */
const EXCLUDED_BRIGHTNESS = 0.6

/**
 * Fills the colors a layer's segments are drawn with
 * @param layer - Parsed layer
 * @param layerNumber - 1-based layer number
 * @param property - Property the segments take their color from
 * @param colorAt - Color a value of that property is drawn with
 * @param colors - Segment colors as flat RGB triplets, two per segment, filled in place
 */
export function fillSegmentColors (layer: Layer, layerNumber: number, property: SegmentProperty, colorAt: (value: number) => RgbColor, colors: Uint8ClampedArray): void {
  const { vertices } = layer
  const { segmentIndices, values } = property
  const segments = vertices.length / 6
  const layerBrightnessGain = layerNumber % 2 === 0 ? 0 : ODD_LAYER_BRIGHTNESS_GAIN

  for (let stretch = 0; stretch < values.length; stretch++) {
    const color = colorAt(values[stretch])
    const nextStretchSegment = stretch + 1 < values.length ? segmentIndices[stretch + 1] : segments

    for (let segment = segmentIndices[stretch]; segment < nextStretchSegment; segment++) {
      const vertex = segment * 6
      const deltaX = vertices[vertex + 3] - vertices[vertex]
      const deltaY = vertices[vertex + 4] - vertices[vertex + 1]
      const deltaZ = vertices[vertex + 5] - vertices[vertex + 2]

      // Make the segment brighter or darker depending on the way it points
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

/**
 * Turns colors into their greyed-out version
 * @param colors - Colors as flat RGB triplets, modified in place
 */
export function greyOutColors (colors: Uint8ClampedArray): void {
  const color = new THREE.Color()
  const hsl = { h: 0, s: 0, l: 0 }
  for (let i = 0; i < colors.length; i += 3) {
    color.setRGB(colors[i] / 255, colors[i + 1] / 255, colors[i + 2] / 255)
    color.getHSL(hsl)
    color.setHSL(hsl.h, 0, hsl.l * EXCLUDED_BRIGHTNESS)
    colors[i] = color.r * 255
    colors[i + 1] = color.g * 255
    colors[i + 2] = color.b * 255
  }
}
