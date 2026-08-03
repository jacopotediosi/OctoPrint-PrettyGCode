/** Span of real time the speed is averaged over; longer keeps it steady, shorter follows a change of speed sooner */
const SPEED_SMOOTHING_SECONDS = 300

/** How far a print had got when it was measured */
interface PrintMeasurement {
  /** Real seconds the printer had been on the job */
  realSeconds: number
  /** Estimated seconds the job had got through */
  estimatedSeconds: number
}

/** Measures how much estimated print time a printer gets through in real time */
export class ObservedPrintSpeed {
  /** How far the print had got at the previous measurement */
  private previousPrintMeasurement: PrintMeasurement | null = null
  /** Estimated seconds the printer gets through in a second of real time */
  private estimatedSecondsPerRealSecond = 1

  /**
   * Takes note of how far the print has got
   * @param realSeconds - Real seconds the printer has been on the job
   * @param estimatedSeconds - Estimated seconds the job has got through
   */
  track (realSeconds: number, estimatedSeconds: number): void {
    const previousPrintMeasurement = this.previousPrintMeasurement
    this.previousPrintMeasurement = { realSeconds, estimatedSeconds }
    if (!previousPrintMeasurement) return

    const realSecondsPassed = realSeconds - previousPrintMeasurement.realSeconds
    const estimatedSecondsPassed = estimatedSeconds - previousPrintMeasurement.estimatedSeconds

    // A job starting over is measured from scratch
    if (realSecondsPassed <= 0 || estimatedSecondsPassed < 0) {
      this.previousPrintMeasurement = null
      this.estimatedSecondsPerRealSecond = 1
      return
    }

    // Stretches where the print stands still, such as a pause or the heat up, leave the speed alone
    if (!estimatedSecondsPassed) return

    // Weigh each measurement by how long it spans
    const measuredSpeed = estimatedSecondsPassed / realSecondsPassed
    const weight = 1 - Math.exp(-realSecondsPassed / SPEED_SMOOTHING_SECONDS)
    this.estimatedSecondsPerRealSecond += (measuredSpeed - this.estimatedSecondsPerRealSecond) * weight
  }

  /**
   * Converts a stretch of estimated time into the time the printer takes over it
   * @param estimatedSeconds - Estimated time to cover
   * @returns The real seconds the printer takes
   */
  toRealSeconds (estimatedSeconds: number): number {
    return estimatedSeconds / this.estimatedSecondsPerRealSecond
  }
}
