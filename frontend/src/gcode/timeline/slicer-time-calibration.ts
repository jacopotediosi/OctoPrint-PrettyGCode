import type { SlicerTimeMarks } from '../parsing/slicer-time-marks'

/** A layer carrying the estimated durations of its segments */
interface TimedLayer {
  /** Byte offset in the file of each segment's line */
  filePositions: Uint32Array
  /** Estimated seconds of each segment, the travel leading to it followed by its extrusion */
  durations: Float32Array
}

/**
 * Measures the estimated time the print takes to reach each slicer time mark
 * @param markFilePositions - Byte offsets the marks sit at
 * @param layers - Layers the estimated durations are read from
 * @returns The estimated seconds at each mark
 */
function estimatedSecondsAtMarks (markFilePositions: Uint32Array, layers: TimedLayer[]): Float64Array {
  const markEstimatedSeconds = new Float64Array(markFilePositions.length)
  let estimatedSeconds = 0
  let markIndex = 0

  // Time reached at every mark passed
  layers.forEach((layer) => {
    const durations = layer.durations
    const filePositions = layer.filePositions
    for (let offset = 0, segment = 0; offset < durations.length; offset += 2, segment++) {
      while (markIndex < markFilePositions.length && markFilePositions[markIndex] <= filePositions[segment]) {
        markEstimatedSeconds[markIndex++] = estimatedSeconds
      }
      estimatedSeconds += durations[offset] + durations[offset + 1]
    }
  })

  // Marks past the last drawn segment
  while (markIndex < markFilePositions.length) markEstimatedSeconds[markIndex++] = estimatedSeconds

  return markEstimatedSeconds
}

/** How the estimated durations are reshaped to run at the times a slicer states */
export class SlicerTimeCalibration {
  /** Byte offsets the marks sit at, in increasing order */
  readonly markFilePositions: Uint32Array
  /** Factor applied to the durations running up to each mark */
  readonly stretchFactors: Float64Array
  /** Seconds spent standing still at each mark */
  readonly pauseSeconds: Float64Array

  /**
   * @param marks - Print times the slicer states along the file, null when it states none
   * @param layers - Layers the estimated durations are read from
   */
  constructor (marks: SlicerTimeMarks | null, layers: TimedLayer[]) {
    this.markFilePositions = marks?.filePositions ?? new Uint32Array(0)
    this.stretchFactors = Float64Array.of(1)
    this.pauseSeconds = Float64Array.of(0)
    if (!marks) return

    const markFilePositions = marks.filePositions
    const markElapsedSeconds = marks.elapsedSeconds
    const markEstimatedSeconds = estimatedSecondsAtMarks(markFilePositions, layers)

    // Pace of every stretch between two marks
    const stretchFactors = new Float64Array(markFilePositions.length + 1)
    const pauseSeconds = new Float64Array(markFilePositions.length + 1)
    let stretchFactor = 1
    for (let markIndex = 1; markIndex < markFilePositions.length; markIndex++) {
      const estimatedSeconds = markEstimatedSeconds[markIndex] - markEstimatedSeconds[markIndex - 1]
      const statedSeconds = markElapsedSeconds[markIndex] - markElapsedSeconds[markIndex - 1]

      // Stretches drawing nothing, such as the heat up opening the print, stand still instead
      if (estimatedSeconds > 0) stretchFactor = statedSeconds / estimatedSeconds
      else pauseSeconds[markIndex] = statedSeconds

      stretchFactors[markIndex] = stretchFactor
    }

    // Stretches outside the marks keep the nearest pace
    stretchFactors[0] = stretchFactors[1]
    stretchFactors[markFilePositions.length] = stretchFactor

    this.stretchFactors = stretchFactors
    this.pauseSeconds = pauseSeconds
  }

  /**
   * Gets the factor the durations at a file position are stretched by
   * @param filePosition - Byte offset in the file
   * @returns The factor
   */
  stretchFactorAt (filePosition: number): number {
    const markFilePositions = this.markFilePositions

    // Marks the file position has passed (binary search)
    let lo = 0; let hi = markFilePositions.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (markFilePositions[mid] <= filePosition) lo = mid + 1
      else hi = mid
    }

    return this.stretchFactors[lo]
  }
}
