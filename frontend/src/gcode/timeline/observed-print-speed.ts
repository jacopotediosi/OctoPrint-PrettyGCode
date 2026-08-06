/** Shortest span of real time a measurement covers before it is used; longer waits for a steadier figure, shorter starts correcting sooner */
const SHORTEST_MEASUREMENT_SECONDS = 180
/** Span of real time after which the measurement starts over; longer keeps it steady, shorter follows a change of speed sooner */
const LONGEST_MEASUREMENT_SECONDS = 900

/** How far a print had got when it was measured */
interface PrintMeasurement {
  /** Real seconds the printer had been on the job */
  realSeconds: number
  /** Estimated seconds the job had got through */
  estimatedSeconds: number
}

/** Measures how much estimated print time a printer gets through in real time */
export class ObservedPrintSpeed {
  /** How far the print had got when the current measurement started */
  private measurementStart: PrintMeasurement | null = null
  /** Estimated seconds the printer gets through in a second of real time */
  private estimatedSecondsPerRealSecond = 1
  /** Whether the measurement has stabilized */
  private hasStabilized = false

  /**
   * Takes note of how far the print has got
   * @param realSeconds - Real seconds the printer has been on the job
   * @param estimatedSeconds - Estimated seconds the job has got through
   */
  track (realSeconds: number, estimatedSeconds: number): void {
    const measurementStart = this.measurementStart
    if (!measurementStart) {
      this.measurementStart = { realSeconds, estimatedSeconds }
      return
    }

    const realSecondsPassed = realSeconds - measurementStart.realSeconds
    const estimatedSecondsPassed = estimatedSeconds - measurementStart.estimatedSeconds

    // A job starting over is measured from scratch
    if (realSecondsPassed < 0 || estimatedSecondsPassed < 0) {
      this.restart()
      return
    }

    // Stretches where the print stands still, such as the heat up, leave the speed alone
    if (estimatedSecondsPassed && realSecondsPassed >= SHORTEST_MEASUREMENT_SECONDS) {
      this.estimatedSecondsPerRealSecond = estimatedSecondsPassed / realSecondsPassed
    }

    if (realSecondsPassed >= LONGEST_MEASUREMENT_SECONDS) {
      this.measurementStart = { realSeconds, estimatedSeconds }
      if (estimatedSecondsPassed) this.hasStabilized = true
    }
  }

  /** Starts measuring from scratch */
  restart (): void {
    this.measurementStart = null
    this.estimatedSecondsPerRealSecond = 1
    this.hasStabilized = false
  }

  /**
   * Converts a stretch of estimated time into the time the printer takes over it
   * @param estimatedSeconds - Estimated time to cover
   * @returns The real seconds the printer takes and whether the measurement behind them has stabilized
   */
  toRealSeconds (estimatedSeconds: number): { seconds: number, stabilized: boolean } {
    return { seconds: estimatedSeconds / this.estimatedSecondsPerRealSecond, stabilized: this.hasStabilized }
  }
}
