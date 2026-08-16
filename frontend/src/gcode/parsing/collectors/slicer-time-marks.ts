import type { SlicerTimeMarks } from '../parsed-gcode'

/**
 * Prefixes, lowercased, of the comments stating the print time elapsed so far
 * - ;TIME_ELAPSED:   Cura
 * - ;PRINTING_TIME:  ideaMaker
 */
const TIME_ELAPSED_COMMENT_PREFIXES = [';time_elapsed:', ';printing_time:']

/** Marks collected from one of the ways a slicer states its print times */
class CollectedMarks {
  /** Byte offsets the collected marks sit at */
  private readonly filePositions: number[] = []
  /** Print time elapsed at each collected mark */
  private readonly elapsedSeconds: number[] = []

  /**
   * Records a mark
   * @param filePosition - Byte offset of the mark
   * @param elapsedSeconds - Print time elapsed at that offset
   */
  addMark (filePosition: number, elapsedSeconds: number): void {
    const marks = this.filePositions.length
    if (marks && (filePosition <= this.filePositions[marks - 1] || elapsedSeconds <= this.elapsedSeconds[marks - 1])) return

    this.filePositions.push(filePosition)
    this.elapsedSeconds.push(elapsedSeconds)
  }

  /** Collected marks, null when the gcode states fewer than two */
  get marks (): SlicerTimeMarks | null {
    if (this.filePositions.length < 2) return null

    return {
      filePositions: new Uint32Array(this.filePositions),
      elapsedSeconds: new Float64Array(this.elapsedSeconds)
    }
  }
}

/**
 * Collects the print times a slicer states along its gcode: some slicers count the time up from the
 * start and others count it down to the end, and both are kept as the time elapsed so far
 */
export class SlicerTimeMarksCollector {
  /** Marks collected where the gcode states the print time elapsed */
  private readonly elapsedTimeMarks = new CollectedMarks()
  /** Marks collected where the gcode states the print time left */
  private readonly remainingTimeMarks = new CollectedMarks()
  /** Time left at the first mark of a countdown, which the following ones are measured against */
  private firstRemainingSeconds: number | null = null

  /**
   * Records the print time a comment states has elapsed
   * @param rawLine - Gcode line holding the comment
   * @param commentLower - Gcode line holding the comment, lowercased
   * @param commentStart - Offset the comment starts at
   * @param filePosition - Byte offset of the comment
   */
  addComment (rawLine: string, commentLower: string, commentStart: number, filePosition: number): void {
    for (const prefix of TIME_ELAPSED_COMMENT_PREFIXES) {
      if (commentLower.startsWith(prefix, commentStart)) {
        this.addElapsed(filePosition, parseFloat(rawLine.slice(commentStart + prefix.length)))
        break
      }
    }
  }

  /**
   * Records a mark stating how much print time is left
   * @param filePosition - Byte offset of the mark
   * @param remainingSeconds - Print time left at that offset
   */
  addRemaining (filePosition: number, remainingSeconds: number): void {
    if (!Number.isFinite(remainingSeconds)) return

    // A countdown never states the total, so the first mark it reaches becomes the origin
    this.firstRemainingSeconds ??= remainingSeconds
    this.remainingTimeMarks.addMark(filePosition, this.firstRemainingSeconds - remainingSeconds)
  }

  /** Collected marks, null when the gcode states fewer than two */
  get marks (): SlicerTimeMarks | null {
    return this.elapsedTimeMarks.marks ?? this.remainingTimeMarks.marks
  }

  /**
   * Records a mark stating how much print time has elapsed
   * @param filePosition - Byte offset of the mark
   * @param elapsedSeconds - Print time elapsed at that offset
   */
  private addElapsed (filePosition: number, elapsedSeconds: number): void {
    if (Number.isFinite(elapsedSeconds)) this.elapsedTimeMarks.addMark(filePosition, elapsedSeconds)
  }
}
