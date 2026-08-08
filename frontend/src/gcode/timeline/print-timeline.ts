import * as THREE from '../../three-exports'
import type { Layer } from '../parsing/parser'
import type { PrintExclusions } from '../exclusions'
import type { SlicerTimeMarks } from '../parsing/slicer-time-marks'

/** A non-empty layer in print order, carrying its offset into the global segment numbering */
interface DrawnLayer {
  layerNumber: number
  globalBase: number
  numSegments: number
  vertices: Float32Array
  filePositions: Uint32Array
  durations: Float32Array
  excluded: Uint8Array | null
}

/** How the estimated durations are reshaped to run at the times a slicer states */
interface SlicerMarkCalibration {
  /** Factor applied to the durations running up to each mark */
  stretchFactors: Float64Array
  /** Seconds spent standing still at each mark */
  pauseSeconds: Float64Array
}

/** A point along the timeline: a segment (or the travel gap before it) and the fraction into it */
export interface TimelineSpot {
  segmentIndex: number
  fraction: number
  onSegment: boolean
}

/**
 * How far behind the live print the shown nozzle trails to absorb bursty updates.
 * Higher looks smoother but lags real time more, lower tracks tighter but can stutter
 */
const NOZZLE_LAG_SECONDS = 1.5
/** Read position leap beyond which the nozzle snaps instead of sweeping the whole way (a seek, a mid-print reload) */
const NOZZLE_SNAP_SECONDS = 120

/** Estimated timeline of the print, mapping file progress to positions along the path */
export class PrintTimeline {
  /** Drawn layers in print order */
  drawnLayers: DrawnLayer[] = []
  /** Total drawn segments across all layers */
  private totalSegments = 0

  /** Cumulative print time at each segment's start, travel gaps included */
  private segmentStartTimes = new Float64Array(0)

  /** Print times the slicer states along the file, null when it states none */
  private slicerTimeMarks: SlicerTimeMarks | null = null
  /** Factor applied to the durations running up to each slicer time mark */
  private stretchFactors: Float64Array = Float64Array.of(1)

  /** Timeline coordinate the nozzle has been eased to */
  private nozzleTime = 0
  /** Timeline coordinate of the printer's read position */
  private targetTime = 0
  /** Nozzle position in scene coordinates */
  private readonly nozzlePosition = new THREE.Vector3()

  /** Print exclusions of the loaded gcode */
  private readonly exclusions: PrintExclusions

  /**
   * @param exclusions - Print exclusions of the loaded gcode
   */
  constructor (exclusions: PrintExclusions) {
    this.exclusions = exclusions
  }

  /* ---- Indexing ---- */

  /**
   * (Re)builds the timeline from parsed layers
   * @param layers - Parsed gcode layers
   * @param slicerTimeMarks - Print times the slicer states along the file, null when it states none
   */
  build (layers: Layer[], slicerTimeMarks: SlicerTimeMarks | null): void {
    // Flatten the drawn layers into print order, tracking each one's running segment offset
    this.drawnLayers = []
    let base = 0
    layers.forEach((layer, i) => {
      if (layer.vertices.length <= 2) return // empty layers have no drawn object
      const numSegments = layer.vertices.length / 6
      this.drawnLayers.push({ layerNumber: i + 1, globalBase: base, numSegments, vertices: layer.vertices, filePositions: layer.filePositions, durations: layer.durations, excluded: this.exclusions.classifyLayer(layer) })
      base += numSegments
    })
    this.totalSegments = base

    // Reshaping that brings the estimated durations onto the times the slicer states
    const { stretchFactors, pauseSeconds } = slicerTimeMarks
      ? this.slicerMarkCalibration(slicerTimeMarks)
      : { stretchFactors: Float64Array.of(1), pauseSeconds: Float64Array.of(0) }
    const markFilePositions = slicerTimeMarks?.filePositions ?? new Uint32Array(0)
    this.slicerTimeMarks = slicerTimeMarks
    this.stretchFactors = stretchFactors

    // Timeline coordinate of every segment, counting the travel gaps between them, so the
    // nozzle can be eased along the whole path at each move's own pace
    const starts = new Float64Array(this.totalSegments)
    let time = 0
    let globalIndex = 0
    let markIndex = 0
    this.drawnLayers.forEach((layer) => {
      const durations = layer.durations
      const filePositions = layer.filePositions
      const excluded = layer.excluded
      for (let offset = 0, segment = 0; offset < durations.length; offset += 2, segment++) {
        while (markIndex < markFilePositions.length && markFilePositions[markIndex] <= filePositions[segment]) {
          time += pauseSeconds[markIndex]
          markIndex++
        }
        const stretchFactor = stretchFactors[markIndex]

        // Excluded segments take no time
        if (excluded && excluded[segment]) {
          starts[globalIndex] = time
        } else {
          time += durations[offset] * stretchFactor
          starts[globalIndex] = time
          time += durations[offset + 1] * stretchFactor
        }
        globalIndex++
      }
    })
    this.segmentStartTimes = starts

    // Start the nozzle from scratch on the new timeline
    this.nozzleTime = 0
    this.targetTime = 0
  }

  /**
   * Measures the estimated time the print takes to reach each slicer time mark
   * @param markFilePositions - Byte offsets the marks sit at
   * @returns The estimated seconds at each mark
   */
  private estimatedSecondsAtSlicerMarks (markFilePositions: Uint32Array): Float64Array {
    const estimatedSecondsAtMarks = new Float64Array(markFilePositions.length)
    let estimatedSeconds = 0
    let markIndex = 0

    // Time reached at every mark passed
    this.drawnLayers.forEach((layer) => {
      const durations = layer.durations
      const filePositions = layer.filePositions
      for (let offset = 0, segment = 0; offset < durations.length; offset += 2, segment++) {
        while (markIndex < markFilePositions.length && markFilePositions[markIndex] <= filePositions[segment]) {
          estimatedSecondsAtMarks[markIndex++] = estimatedSeconds
        }
        estimatedSeconds += durations[offset] + durations[offset + 1]
      }
    })

    // Marks past the last drawn segment
    while (markIndex < markFilePositions.length) estimatedSecondsAtMarks[markIndex++] = estimatedSeconds

    return estimatedSecondsAtMarks
  }

  /**
   * Measures how the estimated durations have to be reshaped to match the slicer
   * @param marks - Print times the slicer states along the file
   * @returns The reshaping of the durations running up to each mark, and of the ones past the last
   */
  private slicerMarkCalibration (marks: SlicerTimeMarks): SlicerMarkCalibration {
    const markFilePositions = marks.filePositions
    const markElapsedSeconds = marks.elapsedSeconds
    const estimatedSecondsAtMarks = this.estimatedSecondsAtSlicerMarks(markFilePositions)

    // Pace of every stretch between two marks
    const stretchFactors = new Float64Array(markFilePositions.length + 1)
    const pauseSeconds = new Float64Array(markFilePositions.length + 1)
    let stretchFactor = 1
    for (let markIndex = 1; markIndex < markFilePositions.length; markIndex++) {
      const estimatedSeconds = estimatedSecondsAtMarks[markIndex] - estimatedSecondsAtMarks[markIndex - 1]
      const statedSeconds = markElapsedSeconds[markIndex] - markElapsedSeconds[markIndex - 1]

      // Stretches drawing nothing, such as the heat up opening the print, stand still instead
      if (estimatedSeconds > 0) stretchFactor = statedSeconds / estimatedSeconds
      else pauseSeconds[markIndex] = statedSeconds

      stretchFactors[markIndex] = stretchFactor
    }

    // Stretches outside the marks keep the nearest pace
    stretchFactors[0] = stretchFactors[1]
    stretchFactors[markFilePositions.length] = stretchFactor

    return { stretchFactors, pauseSeconds }
  }

  /* ---- Drawn layer lookup ---- */

  /**
   * Finds the first drawn layer reaching a point of the print
   * @param reaches - Callback telling whether a layer reaches that point
   * @returns Index of that layer among the drawn ones, past the last one when none reaches it
   */
  private firstLayerReaching (reaches: (layer: DrawnLayer) => boolean): number {
    const layers = this.drawnLayers
    let lo = 0; let hi = layers.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (reaches(layers[mid])) hi = mid
      else lo = mid + 1
    }
    return lo
  }

  /* ---- Reveal positions ---- */

  /**
   * Locates a reveal position by layer and within-layer segment
   * @param index - Global index of the reveal position
   * @returns The 1-based layer and its revealed segments
   */
  revealPosition (index: number): { layerNumber: number, segmentNumber: number } {
    const layerNumber = this.layerNumberAt(index)
    return { layerNumber, segmentNumber: Math.max(0, index - this.revealIndex(layerNumber, 0)) }
  }

  /**
   * Finds the layer holding the last revealed segment
   * @param segmentIndex - Global index of the reveal position
   * @returns The 1-based layer number, or 0 before the first segment
   */
  private layerNumberAt (segmentIndex: number): number {
    const index = this.firstLayerReaching((layer) => layer.globalBase >= segmentIndex)
    return index > 0 ? this.drawnLayers[index - 1].layerNumber : 0
  }

  /**
   * Counts the drawn segments of a layer
   * @param layerNumber - 1-based layer number
   * @returns The drawn segment count, or 0 for an empty layer
   */
  layerSegmentCount (layerNumber: number): number {
    const layer = this.drawnLayers[this.drawnLayerIndex(layerNumber)]
    return layer?.layerNumber === layerNumber ? layer.numSegments : 0
  }

  /**
   * Finds where a layer sits among the drawn ones
   * @param layerNumber - 1-based layer number
   * @returns Index of the first drawn layer reaching that number
   */
  private drawnLayerIndex (layerNumber: number): number {
    return this.firstLayerReaching((layer) => layer.layerNumber >= layerNumber)
  }

  /**
   * Maps a within-layer position to a global reveal index
   * @param layerNumber - 1-based layer number
   * @param revealedSegments - Revealed segments of that layer
   * @returns The global segment index to reveal up to
   */
  revealIndex (layerNumber: number, revealedSegments: number): number {
    const layer = this.drawnLayers[this.drawnLayerIndex(layerNumber)]

    // Past the last drawn layer
    if (!layer) return this.totalSegments

    // Layers with nothing drawn reveal up to where the next drawn one starts
    if (layer.layerNumber !== layerNumber) return layer.globalBase

    return layer.globalBase + Math.min(revealedSegments, layer.numSegments)
  }

  /* ---- Print tracking ---- */

  /**
   * Moves the nozzle along the timeline toward the printer's read position
   * @param filePosition - Bytes of the file sent to the printer so far
   * @param deltaSeconds - Seconds elapsed since the previous call
   * @returns Where the nozzle now sits, or null when no gcode is indexed
   */
  advance (filePosition: number, deltaSeconds: number): TimelineSpot | null {
    if (!this.drawnLayers.length) return null

    // How much of the print has been sent to the printer so far
    this.targetTime = this.timeAfterSegments(this.segmentsReadAt(filePosition))

    // Follow that point smoothly: the nozzle stops when nothing new arrives and speeds up
    // after a burst of commands; it jumps only when the point is behind it or very far ahead
    const backlog = this.targetTime - this.nozzleTime
    if (backlog < 0 || backlog > NOZZLE_SNAP_SECONDS) this.nozzleTime = this.targetTime
    else this.nozzleTime += backlog * (1 - Math.exp(-deltaSeconds / NOZZLE_LAG_SECONDS))

    // Where along the timeline the nozzle sits: reveal, tip and nozzle model all derive from here
    const spot = this.locateTime(this.nozzleTime)
    this.updateNozzlePosition(spot)
    return spot
  }

  /**
   * Gets the estimated time the print has got through at a file position
   * @param filePosition - Bytes of the file sent to the printer
   * @returns The estimated seconds
   */
  estimatedSecondsAt (filePosition: number): number {
    return this.timeAfterSegments(this.segmentsReadAt(filePosition))
  }

  /**
   * Gets the estimated time the print has got through when a layer starts
   * @param layerNumber - 1-based layer number
   * @returns The estimated seconds
   */
  estimatedSecondsAtLayer (layerNumber: number): number {
    return this.timeAfterSegments(this.revealIndex(layerNumber, 0))
  }

  /**
   * Gets the timeline coordinate reached once a number of segments has been drawn
   * @param segments - Drawn segments passed
   * @returns The coordinate in seconds
   */
  private timeAfterSegments (segments: number): number {
    if (!this.totalSegments) return 0
    return segments < this.totalSegments ? this.segmentStartTimes[segments] : this.endTimeAt(this.totalSegments - 1)
  }

  /**
   * Counts the drawn segments a file position has passed
   * @param filePosition - Bytes of the file sent to the printer
   * @returns The number of drawn segments passed
   */
  private segmentsReadAt (filePosition: number): number {
    // First layer the read position has not passed whole
    const layerIndex = this.firstLayerReaching((layer) => layer.filePositions[layer.filePositions.length - 1] >= filePosition)

    // Past the last drawn layer
    const layer = this.drawnLayers[layerIndex]
    if (!layer) return this.totalSegments

    // The read position has not reached this layer
    const filePositions = layer.filePositions
    if (filePositions[0] > filePosition) return layer.globalBase

    // Segments in this layer already read (binary search over the sorted file positions)
    let lo = 0; let hi = filePositions.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (filePositions[mid] < filePosition) lo = mid + 1
      else hi = mid
    }
    return layer.globalBase + lo
  }

  /**
   * Finds the segment, or the travel gap before it, holding a timeline coordinate
   * @param time - Timeline coordinate in seconds
   * @returns The spot at that coordinate
   */
  private locateTime (time: number): TimelineSpot {
    const starts = this.segmentStartTimes

    // First segment starting past the coordinate (binary search)
    let lo = 0; let hi = starts.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (starts[mid] <= time) lo = mid + 1
      else hi = mid
    }

    // Before the first segment: sweep the travel gap that opens the print
    if (lo === 0) return { segmentIndex: 0, fraction: starts[0] > 0 ? time / starts[0] : 0, onSegment: false }

    // The last segment started is the only one the coordinate can still fall in
    const current = lo - 1
    const start = starts[current]
    const end = this.endTimeAt(current)
    if (time < end) return { segmentIndex: current, fraction: (time - start) / (end - start), onSegment: true }

    // Past the last segment
    if (lo >= starts.length) return { segmentIndex: starts.length, fraction: 1, onSegment: false }

    // In the travel gap before the next segment
    const gap = starts[lo] - end
    return { segmentIndex: lo, fraction: gap > 0 ? (time - end) / gap : 0, onSegment: false }
  }

  /**
   * Gets the timeline coordinate a segment ends at
   * @param globalIndex - Global segment index
   * @returns The coordinate in seconds
   */
  private endTimeAt (globalIndex: number): number {
    const { layer, localIndex } = this.segmentAt(globalIndex)!

    // Excluded segments take no time
    const extrusion = layer.excluded?.[localIndex]
      ? 0
      : layer.durations[localIndex * 2 + 1] * this.stretchFactorAt(layer.filePositions[localIndex])

    return this.segmentStartTimes[globalIndex] + extrusion
  }

  /**
   * Gets the factor the durations at a file position are stretched by
   * @param filePosition - Byte offset in the file
   * @returns The factor
   */
  private stretchFactorAt (filePosition: number): number {
    const markFilePositions = this.slicerTimeMarks?.filePositions
    if (!markFilePositions) return 1

    // Marks the file position has passed (binary search)
    let lo = 0; let hi = markFilePositions.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (markFilePositions[mid] <= filePosition) lo = mid + 1
      else hi = mid
    }

    return this.stretchFactors[lo]
  }

  /* ---- Nozzle position ---- */

  /**
   * Moves the nozzle position to a timeline spot
   * @param spot - Timeline position
   */
  private updateNozzlePosition (spot: TimelineSpot): void {
    const position = this.nozzlePosition

    // Past the end: park on the last segment's endpoint
    if (spot.segmentIndex >= this.totalSegments) {
      const last = this.segmentAt(this.totalSegments - 1)!
      position.fromArray(last.layer.vertices, last.localIndex * 6 + 3)
      return
    }

    const segment = this.segmentAt(spot.segmentIndex)!
    const vertices = segment.layer.vertices
    const offset = segment.localIndex * 6

    if (spot.onSegment) {
      // Along the segment being drawn
      position.set(
        vertices[offset] + (vertices[offset + 3] - vertices[offset]) * spot.fraction,
        vertices[offset + 1] + (vertices[offset + 4] - vertices[offset + 1]) * spot.fraction,
        vertices[offset + 2] + (vertices[offset + 5] - vertices[offset + 2]) * spot.fraction
      )
    } else if (spot.segmentIndex > 0) {
      // In a travel gap: glide from the previous segment's end to this one's start
      const previous = this.segmentAt(spot.segmentIndex - 1)!
      const from = previous.layer.vertices
      const fromOffset = previous.localIndex * 6
      position.set(
        from[fromOffset + 3] + (vertices[offset] - from[fromOffset + 3]) * spot.fraction,
        from[fromOffset + 4] + (vertices[offset + 1] - from[fromOffset + 4]) * spot.fraction,
        from[fromOffset + 5] + (vertices[offset + 2] - from[fromOffset + 5]) * spot.fraction
      )
    } else {
      // Wait at the start of the segment
      position.fromArray(vertices, offset)
    }
  }

  /**
   * Gets the current nozzle position
   * @returns The position, or null until the print reaches the first segment
   */
  getNozzlePosition (): THREE.Vector3 | null {
    return this.targetTime > 0 ? this.nozzlePosition : null
  }

  /* ---- Segment lookup ---- */

  /**
   * Resolves a global segment index to its layer and index within it
   * @param globalIndex - Global segment index
   * @returns The layer and local index, or null when out of range
   */
  segmentAt (globalIndex: number): { layer: DrawnLayer, localIndex: number } | null {
    const index = this.firstLayerReaching((layer) => layer.globalBase + layer.numSegments > globalIndex)

    const layer = this.drawnLayers[index]
    return layer ? { layer, localIndex: globalIndex - layer.globalBase } : null
  }
}
