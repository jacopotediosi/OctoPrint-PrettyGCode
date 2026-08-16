import type { SegmentProperty } from './parsed-gcode'

/**
 * Joins two properties of a layer into one, taking a value from each
 * @param first - First property to read
 * @param second - Second property to read
 * @param combine - Value the joined property takes where the two hold the given values
 * @returns The joined property, changing wherever either of the two does
 */
export function joinSegmentProperties (first: SegmentProperty, second: SegmentProperty, combine: (firstValue: number, secondValue: number) => number): SegmentProperty {
  const localSegmentIndices: number[] = []
  const values: number[] = []
  let firstStretch = 0
  let secondStretch = 0

  while (firstStretch < first.values.length || secondStretch < second.values.length) {
    const firstLocalSegmentIndex = firstStretch < first.values.length ? first.localSegmentIndices[firstStretch] : Infinity
    const secondLocalSegmentIndex = secondStretch < second.values.length ? second.localSegmentIndices[secondStretch] : Infinity

    localSegmentIndices.push(Math.min(firstLocalSegmentIndex, secondLocalSegmentIndex))

    if (firstLocalSegmentIndex <= secondLocalSegmentIndex) firstStretch++
    if (secondLocalSegmentIndex <= firstLocalSegmentIndex) secondStretch++

    values.push(combine(first.values[firstStretch - 1] ?? 0, second.values[secondStretch - 1] ?? 0))
  }

  return { localSegmentIndices: Uint32Array.from(localSegmentIndices), values: Float32Array.from(values) }
}

/**
 * Builds a property the whole layer holds one value of
 * @param value - Value the layer holds
 * @returns The property
 */
export function wholeLayerProperty (value: number): SegmentProperty {
  return { localSegmentIndices: Uint32Array.of(0), values: Float32Array.of(value) }
}
