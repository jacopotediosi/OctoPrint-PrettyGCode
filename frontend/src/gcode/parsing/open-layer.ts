import type { Layer, ScenePoint, SegmentProperty, SegmentPropertyValues } from './parsed-gcode'

/** Share the extrusion of a segment may differ by before it counts as a change, keeping the rounding of E out of the record */
const FILAMENT_PER_MM_TOLERANCE = 0.02

/** A property of the segments being filled, kept only where it changes */
class OpenSegmentProperty {
  /** Segment of the layer each recorded value starts at */
  private readonly segmentIndices: number[] = []
  /** Value the property takes from that segment on */
  private readonly values: number[] = []
  /** Share of the last recorded value a new one may differ by and still count as the same */
  private readonly tolerance: number

  /**
   * @param tolerance - Share of the last recorded value a new one may differ by and still count as the same
   */
  constructor (tolerance: number = 0) {
    this.tolerance = tolerance
  }

  /**
   * Records the value the property takes on a segment
   * @param segment - Segment index within the layer
   * @param value - Value the property takes there
   */
  add (segment: number, value: number): void {
    const recorded = this.values[this.values.length - 1]

    // A value equal to the last recorded one, or within its tolerance, leaves the property unchanged
    if (recorded === value || Math.abs(value - recorded) <= this.tolerance * Math.abs(recorded)) return

    this.segmentIndices.push(segment)
    this.values.push(value)
  }

  /**
   * Builds the property from the values recorded so far
   * @returns The built property
   */
  finish (): SegmentProperty {
    return { segmentIndices: Uint32Array.from(this.segmentIndices), values: Float32Array.from(this.values) }
  }
}

/** A layer being filled with segments and with the travels leading to them */
export class OpenLayer {
  /** Initial size of segment buffers */
  private static readonly INITIAL_BUFFERS_CAPACITY = 1024
  /** Initial size of travel buffers */
  private static readonly INITIAL_TRAVEL_BUFFERS_CAPACITY = 128

  /** Segment endpoints as flat XYZ triplets */
  private vertices = new Float32Array(OpenLayer.INITIAL_BUFFERS_CAPACITY * 6)
  /** Byte offset in the file of each segment's line */
  private filePositions = new Uint32Array(OpenLayer.INITIAL_BUFFERS_CAPACITY)
  /** Estimated seconds of each segment, the travel leading to it followed by its extrusion */
  private durations = new Float32Array(OpenLayer.INITIAL_BUFFERS_CAPACITY * 2)
  /** Id of the object each segment belongs to, -1 for none, null while no segment belongs to one */
  private objectIds: Int32Array | null = null
  /** Id of the feature type each segment belongs to, -1 for none */
  private readonly featureTypeIds = new OpenSegmentProperty()
  /** Id of the tool each segment is extruded with */
  private readonly toolIds = new OpenSegmentProperty()
  /** Index of the color change each segment is extruded after, -1 before the first one of its tool */
  private readonly colorChangeIds = new OpenSegmentProperty()
  /** Speed of each segment in mm/s */
  private readonly feedrates = new OpenSegmentProperty()
  /** Speed of the print cooling fan over the segments, in percent */
  private readonly fanSpeeds = new OpenSegmentProperty()
  /** Nozzle temperature over the segments, in degrees Celsius */
  private readonly temperatures = new OpenSegmentProperty()
  /** Width of each extruded line in mm, 0 where the slicer states none */
  private readonly widths = new OpenSegmentProperty()
  /** Height of each extruded line in mm */
  private readonly heights = new OpenSegmentProperty()
  /** Filament in mm each segment extrudes over each mm of its length */
  private readonly filamentPerMm = new OpenSegmentProperty(FILAMENT_PER_MM_TOLERANCE)
  /** Segments the buffers have room for */
  private capacity = OpenLayer.INITIAL_BUFFERS_CAPACITY
  /** Segments appended so far */
  private segments = 0

  /** Travel endpoints as flat XYZ triplets */
  private travelVertices = new Float32Array(OpenLayer.INITIAL_TRAVEL_BUFFERS_CAPACITY * 6)
  /** Segment of the layer each travel leads to */
  private travelSegmentIndices = new Uint32Array(OpenLayer.INITIAL_TRAVEL_BUFFERS_CAPACITY)
  /** Travels the buffers have room for */
  private travelCapacity = OpenLayer.INITIAL_TRAVEL_BUFFERS_CAPACITY
  /** Travels appended so far */
  private travels = 0

  /** Machine Z the layer is printed at */
  z: number

  /**
   * @param z - Machine Z the layer is printed at
   */
  constructor (z: number) {
    this.z = z
  }

  /**
   * Appends a segment
   * @param start - Segment start point
   * @param end - Segment end point
   * @param filePosition - Byte offset of the segment's line in the file
   * @param travelSeconds - Estimated travel time leading to the segment
   * @param extrusionSeconds - Estimated time extruding the segment
   * @param objectId - Id of the object the segment belongs to, -1 for none
   * @param propertyValues - Value each property takes on the segment
   */
  addSegment (start: ScenePoint, end: ScenePoint, filePosition: number, travelSeconds: number, extrusionSeconds: number, objectId: number, propertyValues: SegmentPropertyValues): void {
    if (this.segments === this.capacity) this.growSegments()

    const vertex = this.segments * 6
    this.vertices[vertex] = start.x
    this.vertices[vertex + 1] = start.y
    this.vertices[vertex + 2] = start.z
    this.vertices[vertex + 3] = end.x
    this.vertices[vertex + 4] = end.y
    this.vertices[vertex + 5] = end.z

    this.filePositions[this.segments] = filePosition
    this.durations[this.segments * 2] = travelSeconds
    this.durations[this.segments * 2 + 1] = extrusionSeconds

    // Start storing object ids at the first segment that belongs to one
    if (objectId >= 0 && !this.objectIds) this.objectIds = new Int32Array(this.capacity).fill(-1)
    if (this.objectIds) this.objectIds[this.segments] = objectId

    this.featureTypeIds.add(this.segments, propertyValues.featureTypeId)
    this.toolIds.add(this.segments, propertyValues.toolId)
    this.colorChangeIds.add(this.segments, propertyValues.colorChangeId)
    this.feedrates.add(this.segments, propertyValues.feedrate)
    this.fanSpeeds.add(this.segments, propertyValues.fanSpeed)
    this.temperatures.add(this.segments, propertyValues.temperature)
    this.widths.add(this.segments, propertyValues.width)
    this.heights.add(this.segments, propertyValues.height)
    this.filamentPerMm.add(this.segments, propertyValues.filamentPerMm)

    this.segments++
  }

  /**
   * Appends the travels leading to the segment the layer takes next
   * @param vertices - Travel endpoints as flat XYZ triplets
   * @param travels - Travels the vertices hold
   */
  addTravels (vertices: Float32Array, travels: number): void {
    while (this.travels + travels > this.travelCapacity) this.growTravels()

    this.travelVertices.set(vertices.subarray(0, travels * 6), this.travels * 6)
    this.travelSegmentIndices.fill(this.segments, this.travels, this.travels + travels)
    this.travels += travels
  }

  /** Doubles the capacity of the segment buffers */
  private growSegments (): void {
    this.capacity *= 2

    const vertices = new Float32Array(this.capacity * 6)
    vertices.set(this.vertices)
    this.vertices = vertices

    const filePositions = new Uint32Array(this.capacity)
    filePositions.set(this.filePositions)
    this.filePositions = filePositions

    const durations = new Float32Array(this.capacity * 2)
    durations.set(this.durations)
    this.durations = durations

    if (this.objectIds) {
      const objectIds = new Int32Array(this.capacity).fill(-1)
      objectIds.set(this.objectIds)
      this.objectIds = objectIds
    }
  }

  /** Doubles the capacity of the travel buffers */
  private growTravels (): void {
    this.travelCapacity *= 2

    const travelVertices = new Float32Array(this.travelCapacity * 6)
    travelVertices.set(this.travelVertices)
    this.travelVertices = travelVertices

    const travelSegmentIndices = new Uint32Array(this.travelCapacity)
    travelSegmentIndices.set(this.travelSegmentIndices)
    this.travelSegmentIndices = travelSegmentIndices
  }

  /**
   * Finishes the layer
   * @returns The finished layer
   */
  finish (): Layer {
    return {
      vertices: this.vertices.slice(0, this.segments * 6),
      z: this.z,
      filePositions: this.filePositions.slice(0, this.segments),
      durations: this.durations.slice(0, this.segments * 2),
      objectIds: this.objectIds ? this.objectIds.slice(0, this.segments) : null,
      featureTypeIds: this.featureTypeIds.finish(),
      toolIds: this.toolIds.finish(),
      colorChangeIds: this.colorChangeIds.finish(),
      feedrates: this.feedrates.finish(),
      fanSpeeds: this.fanSpeeds.finish(),
      temperatures: this.temperatures.finish(),
      widths: this.widths.finish(),
      heights: this.heights.finish(),
      filamentPerMm: this.filamentPerMm.finish(),
      travelVertices: this.travelVertices.slice(0, this.travels * 6),
      travelSegmentIndices: this.travelSegmentIndices.slice(0, this.travels)
    }
  }
}
