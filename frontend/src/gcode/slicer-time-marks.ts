/** Print time a slicer states at points along its gcode */
export interface SlicerTimeMarks {
  /** Byte offsets the marks sit at, in increasing order */
  filePositions: Uint32Array
  /** Print time elapsed at each mark */
  elapsedSeconds: Float32Array
}

/**
 * Collects the print times a slicer states along its gcode: some slicers count the time up from the
 * start and others count it down to the end, and both are kept as the time elapsed so far
 */
export class SlicerTimeMarksCollector {
  /** Byte offsets the collected marks sit at */
  private readonly filePositions: number[] = []
  /** Print time elapsed at each collected mark */
  private readonly elapsedSeconds: number[] = []
  /** Time left at the first mark of a countdown, which the following ones are measured against */
  private firstRemainingSeconds: number | null = null

  /**
   * Adds a mark stating how much print time has elapsed
   * @param filePosition - Byte offset of the mark
   * @param elapsedSeconds - Print time elapsed at that offset
   */
  addElapsed (filePosition: number, elapsedSeconds: number): void {
    if (Number.isFinite(elapsedSeconds)) this.add(filePosition, elapsedSeconds)
  }

  /**
   * Adds a mark stating how much print time is left
   * @param filePosition - Byte offset of the mark
   * @param remainingSeconds - Print time left at that offset
   */
  addRemaining (filePosition: number, remainingSeconds: number): void {
    if (!Number.isFinite(remainingSeconds)) return

    // A countdown never states the total, so the first mark it reaches becomes the origin
    this.firstRemainingSeconds ??= remainingSeconds
    this.add(filePosition, this.firstRemainingSeconds - remainingSeconds)
  }

  /**
   * Appends a mark
   * @param filePosition - Byte offset of the mark
   * @param elapsedSeconds - Print time elapsed at that offset
   */
  private add (filePosition: number, elapsedSeconds: number): void {
    const marks = this.filePositions.length
    if (marks && (filePosition <= this.filePositions[marks - 1] || elapsedSeconds <= this.elapsedSeconds[marks - 1])) return

    this.filePositions.push(filePosition)
    this.elapsedSeconds.push(elapsedSeconds)
  }

  /**
   * Gets the collected marks
   * @returns The marks, or null when the gcode states fewer than two
   */
  getMarks (): SlicerTimeMarks | null {
    if (this.filePositions.length < 2) return null

    return {
      filePositions: new Uint32Array(this.filePositions),
      elapsedSeconds: new Float32Array(this.elapsedSeconds)
    }
  }
}
