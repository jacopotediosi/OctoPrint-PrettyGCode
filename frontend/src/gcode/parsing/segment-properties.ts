import type { SegmentProperty } from './parsed-gcode'

/**
 * Joins two properties of a layer into one, taking a value from each
 * @param first - First property to read
 * @param second - Second property to read
 * @param combine - Value the joined property takes where the two hold the given values
 * @returns The joined property, changing wherever either of the two does
 */
export function joinSegmentProperties (first: SegmentProperty, second: SegmentProperty, combine: (firstValue: number, secondValue: number) => number): SegmentProperty {
  const segmentIndices: number[] = []
  const values: number[] = []
  let firstStretch = 0
  let secondStretch = 0

  while (firstStretch < first.values.length || secondStretch < second.values.length) {
    const firstSegment = firstStretch < first.values.length ? first.segmentIndices[firstStretch] : Infinity
    const secondSegment = secondStretch < second.values.length ? second.segmentIndices[secondStretch] : Infinity

    segmentIndices.push(Math.min(firstSegment, secondSegment))

    if (firstSegment <= secondSegment) firstStretch++
    if (secondSegment <= firstSegment) secondStretch++

    values.push(combine(first.values[firstStretch - 1] ?? 0, second.values[secondStretch - 1] ?? 0))
  }

  return { segmentIndices: Uint32Array.from(segmentIndices), values: Float32Array.from(values) }
}

/**
 * Builds a property the whole layer holds one value of
 * @param value - Value the layer holds
 * @returns The property
 */
export function wholeLayerProperty (value: number): SegmentProperty {
  return { segmentIndices: Uint32Array.of(0), values: Float32Array.of(value) }
}
