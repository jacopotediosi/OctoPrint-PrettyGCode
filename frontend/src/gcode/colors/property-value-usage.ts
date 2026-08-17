import { vectorLength } from '../../utils/numbers'
import type { Layer, SegmentProperty } from '../parsing/parsed-gcode'

/** How much of a print the segments holding one value of a property take */
export interface PropertyValueUsage {
  /** Value the segments hold */
  value: number
  /** Share of the extrusion time, from 0 to 1 */
  timeShare: number
  /** Filament the segments extrude, in mm */
  filamentMm: number
}

/**
 * Measures how much of a gcode the segments holding each value of a property take
 * @param layers - Parsed gcode layers
 * @param propertyOf - Property to read of each layer
 * @returns The usage of every value the property takes, in value order
 */
export function propertyValueUsage (layers: Layer[], propertyOf: (layer: Layer, layerNumber: number) => SegmentProperty): PropertyValueUsage[] {
  let highestValue = -1
  for (let layerNumber = 1; layerNumber <= layers.length; layerNumber++) {
    for (const value of propertyOf(layers[layerNumber - 1], layerNumber).values) highestValue = Math.max(highestValue, value)
  }

  const seconds = new Float64Array(highestValue + 2)
  const filament = new Float64Array(highestValue + 2)

  for (let layerNumber = 1; layerNumber <= layers.length; layerNumber++) {
    const layer = layers[layerNumber - 1]
    const { vertices, durations, filamentPerMm } = layer
    const property = propertyOf(layer, layerNumber)
    const segments = vertices.length / 6
    let propertyStretch = 0
    let filamentStretch = 0

    for (let localSegmentIndex = 0; localSegmentIndex < segments; localSegmentIndex++) {
      while (propertyStretch + 1 < property.values.length && property.localSegmentIndices[propertyStretch + 1] <= localSegmentIndex) propertyStretch++
      while (filamentStretch + 1 < filamentPerMm.values.length && filamentPerMm.localSegmentIndices[filamentStretch + 1] <= localSegmentIndex) filamentStretch++

      const vertex = localSegmentIndex * 6
      const length = vectorLength(vertices[vertex + 3] - vertices[vertex], vertices[vertex + 4] - vertices[vertex + 1], vertices[vertex + 5] - vertices[vertex + 2])

      // Count every value one slot further, so the -1 of the segments holding none has a slot too
      const slot = property.values[propertyStretch] + 1
      seconds[slot] += durations[localSegmentIndex * 2 + 1]
      filament[slot] += filamentPerMm.values[filamentStretch] * length
    }
  }

  const totalSeconds = seconds.reduce((total, value) => total + value, 0)
  const usage: PropertyValueUsage[] = []
  for (let slot = 0; slot < seconds.length; slot++) {
    if (seconds[slot] > 0) usage.push({ value: slot - 1, timeShare: totalSeconds > 0 ? seconds[slot] / totalSeconds : 0, filamentMm: filament[slot] })
  }
  return usage
}
