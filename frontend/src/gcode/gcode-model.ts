import * as THREE from '../three-exports'
import { isThickLine, isThickMaterial, makeThickMaterial, makeThinMaterial } from './line-materials'
import { TipLine } from './tip-line'
import type { GcodeLine, GcodeLineMaterial } from './line-materials'
import type { Settings } from '../settings'
import type { Layer } from './parser'
import type { PrintExclusions } from './exclusions'
import type { PrintTimeline, TimelineSpot } from './print-timeline'

/** Part of the print the travel moves are drawn for */
export type TravelScope = 'none' | 'displayedLayer' | 'wholeModel'

/** Metadata a rendered gcode line carries */
interface GcodeLineMetadata {
  /** 1-based layer number */
  layerNumber: number
  /** Global segment index the layer starts at */
  globalBase: number
  /** Moves the line draws */
  numMoves: number
  /** Segment of the layer each drawn move waits for, or null for the whole layer */
  segmentIndices: Uint32Array | null
  /** Whether the line draws the layer's mirror */
  mirror?: boolean
}

/** Name prefix of the layer line objects */
const LAYER_PREFIX = 'layer#'
/** Name prefix of the travel line objects */
const TRAVEL_PREFIX = 'travel#'

/**
 * Tells whether a scene object is one of the rendered gcode layers
 * @param child - Scene object to test
 * @returns True for layer line objects
 */
const isLayerObject = (child: THREE.Object3D): child is GcodeLine => child.name.startsWith(LAYER_PREFIX)

/**
 * Reads the metadata a gcode line carries
 * @param line - Gcode line
 * @returns Its metadata
 */
const gcodeLineMetadata = (line: GcodeLine): GcodeLineMetadata => line.userData as GcodeLineMetadata

/** Oversize factor of the drawn lines, to avoid gaps */
const LINE_THICKNESS_FACTOR = 1.1

/** Brightness the mirror multiplies the model colors by */
const MIRROR_BRIGHTNESS = 0.5

/** A subset of a layer's segments */
class LayerPart {
  readonly vertices: Float32Array
  readonly colors: Uint8ClampedArray
  readonly segmentIndices: Uint32Array
  private segmentCount = 0

  constructor (segments: number) {
    this.vertices = new Float32Array(segments * 6)
    this.colors = new Uint8ClampedArray(segments * 6)
    this.segmentIndices = new Uint32Array(segments)
  }

  /**
   * Adds a layer's segment to the part
   * @param layer - Layer holding the segment
   * @param segment - Segment index within the layer
   */
  add (layer: Layer, segment: number): void {
    const from = segment * 6
    const to = this.segmentCount * 6
    for (let i = 0; i < 6; i++) {
      this.vertices[to + i] = layer.vertices[from + i]
      this.colors[to + i] = layer.colors[from + i]
    }
    this.segmentIndices[this.segmentCount] = segment
    this.segmentCount++
  }
}

/** The rendered gcode model, made of per-layer line objects */
export class GcodeModel {
  /** Group holding the gcode model lines */
  readonly linesGroup = new THREE.Group()

  /** Group holding the mirror lines, reflected through the bed */
  private readonly mirrorGroup = new THREE.Group()

  /** Group holding the travel lines */
  private readonly travelGroup = new THREE.Group()

  /** Layers the model was last built from */
  private layers: Layer[] = []

  /** Global segment index of the reveal position the model is showing */
  private revealedIndex = -1

  /** Layer the highlight is on, or 0 when no layer is highlighted */
  private highlightedLayer = -1

  /** The growing tip drawn along the segment the nozzle is currently laying down */
  private readonly tipLine: TipLine

  /** Material for thin lines */
  private readonly thinMaterial = makeThinMaterial()
  /** Material for thick lines */
  private readonly thickMaterial = makeThickMaterial()
  /** Thin line material for the highlighted layer */
  private readonly highlightThinMaterial = makeThinMaterial()
  /** Thick line material for the highlighted layer */
  private readonly highlightThickMaterial = makeThickMaterial()

  /** Thick line material for the mirror, clipped to the bed */
  private readonly mirrorThickMaterial: THREE.LineMaterial
  /** Thin line material for the mirror, clipped to the bed */
  private readonly mirrorThinMaterial: THREE.LineBasicMaterial

  /** Material for the travel lines */
  private readonly travelMaterial = new THREE.LineBasicMaterial()

  /** Plugin frontend settings */
  private readonly settings: Settings

  /** Getter of the current nozzle diameter in mm */
  private readonly getNozzleDiameter: () => number

  /** Print timeline of the loaded gcode */
  private readonly timeline: PrintTimeline

  /** Print exclusions of the loaded gcode */
  private readonly exclusions: PrintExclusions

  /**
   * @param settings - Plugin frontend settings
   * @param getNozzleDiameter - Getter of the current nozzle diameter in mm
   * @param timeline - Print timeline of the loaded gcode
   * @param exclusions - Print exclusions of the loaded gcode
   * @param mirrorBoundsPlanes - Planes clipping the mirror to the bed
   */
  constructor (settings: Settings, getNozzleDiameter: () => number, timeline: PrintTimeline, exclusions: PrintExclusions, mirrorBoundsPlanes: THREE.Plane[]) {
    this.settings = settings
    this.getNozzleDiameter = getNozzleDiameter
    this.timeline = timeline
    this.exclusions = exclusions

    this.mirrorThickMaterial = makeThickMaterial(mirrorBoundsPlanes)
    this.mirrorThinMaterial = makeThinMaterial(mirrorBoundsPlanes)

    // Dim the mirror colors
    this.mirrorThickMaterial.color.setRGB(MIRROR_BRIGHTNESS, MIRROR_BRIGHTNESS, MIRROR_BRIGHTNESS)
    this.mirrorThinMaterial.color.setRGB(MIRROR_BRIGHTNESS, MIRROR_BRIGHTNESS, MIRROR_BRIGHTNESS)

    // Keeps the flipped thick lines from breaking into specks
    this.mirrorThickMaterial.side = THREE.BackSide

    // Flip the mirror lines through the bed
    this.mirrorGroup.scale.z = -1
    this.mirrorGroup.matrixAutoUpdate = false
    this.mirrorGroup.updateMatrix()
    this.linesGroup.add(this.mirrorGroup)
    this.linesGroup.add(this.travelGroup)

    this.tipLine = new TipLine(timeline, this.linesGroup)
  }

  /* ---- Materials ---- */

  /** Material the layers are drawn with */
  private get defaultMaterial (): GcodeLineMaterial {
    return this.settings.thickLines ? this.thickMaterial : this.thinMaterial
  }

  /** Material the highlighted layer is drawn with */
  private get highlightMaterial (): GcodeLineMaterial {
    return this.settings.thickLines ? this.highlightThickMaterial : this.highlightThinMaterial
  }

  /** Refreshes the drawn line thickness from the nozzle size */
  updateLineWidth (): void {
    const lineWidth = this.getNozzleDiameter() * LINE_THICKNESS_FACTOR

    this.thickMaterial.linewidth = lineWidth
    this.mirrorThickMaterial.linewidth = lineWidth
    this.highlightThickMaterial.linewidth = lineWidth
  }

  /* ---- Object building ---- */

  /**
   * Builds the model's line objects from parsed layers
   * @param layers - Parsed gcode layers
   */
  build (layers: Layer[]): void {
    this.layers = layers
    for (const child of this.linesGroup.children) {
      if (isLayerObject(child)) child.geometry.dispose()
    }
    this.mirrorGroup.clear()
    this.linesGroup.clear()
    this.linesGroup.add(this.mirrorGroup)
    this.linesGroup.add(this.travelGroup)
    this.revealedIndex = -1
    this.highlightedLayer = -1

    this.updateLineWidth()

    for (const { layerNumber, globalBase } of this.timeline.drawnLayers) {
      this.addLayerLines(layers[layerNumber - 1], layerNumber, globalBase)
    }

    this.updateTravelLines()

    this.tipLine.build(this.highlightMaterial)
  }

  /** Rebuilds the model from the last given layers, e.g. after a settings change */
  rebuild (): void {
    this.build(this.layers)
  }

  /**
   * Creates a line object
   * @param vertices - Segment endpoints as flat XYZ triplets
   * @param colors - Vertex colors as flat RGB triplets
   * @param material - Material to render with
   * @returns The new line object
   */
  private makeLine (vertices: Float32Array, colors: Uint8ClampedArray, material: GcodeLineMaterial): GcodeLine {
    let line: GcodeLine
    if (isThickMaterial(material)) {
      // Thick lines
      const geometry = new THREE.LineSegmentsGeometry()
      geometry.setPositions(vertices)
      const colorBuffer = new THREE.InstancedInterleavedBuffer(colors, 6, 1)
      geometry.setAttribute('instanceColorStart', new THREE.InterleavedBufferAttribute(colorBuffer, 3, 0, true))
      geometry.setAttribute('instanceColorEnd', new THREE.InterleavedBufferAttribute(colorBuffer, 3, 3, true))
      line = new THREE.LineSegments2(geometry, material)
    } else {
      // Thin lines
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true))
      line = new THREE.LineSegments(geometry, material)
    }

    // Speeds up rendering, the lines never move
    line.matrixAutoUpdate = false

    return line
  }

  /**
   * Adds a layer's lines to the model
   * @param layer - Parsed layer
   * @param layerNumber - 1-based layer number
   * @param globalBase - Global segment index the layer starts at
   */
  private addLayerLines (layer: Layer, layerNumber: number, globalBase: number): void {
    // Skip empty layers
    if (layer.vertices.length <= 2) return

    // Layers untouched by exclusions go in whole
    const excludedFlags = this.exclusions.classifyLayer(layer)
    if (!excludedFlags) {
      this.addLayerPart(layerNumber, globalBase, layer.vertices, layer.colors, null)
      return
    }

    // Split the layer between printed and excluded segments
    let excludedSegments = 0
    for (let i = 0; i < excludedFlags.length; i++) excludedSegments += excludedFlags[i]
    const printedPart = new LayerPart(excludedFlags.length - excludedSegments)
    const excludedPart = new LayerPart(excludedSegments)
    for (let segment = 0; segment < excludedFlags.length; segment++) {
      const part = excludedFlags[segment] ? excludedPart : printedPart
      part.add(layer, segment)
    }

    // Add the printed part
    this.addLayerPart(layerNumber, globalBase, printedPart.vertices, printedPart.colors, printedPart.segmentIndices)

    // Add the excluded part, greyed out
    if (this.settings.showExcluded) {
      this.greyOutColors(excludedPart.colors)
      this.addLayerPart(layerNumber, globalBase, excludedPart.vertices, excludedPart.colors, excludedPart.segmentIndices)
    }
  }

  /**
   * Adds one part of a layer's segments to the model
   * @param layerNumber - 1-based layer number
   * @param globalBase - Global segment index the layer starts at
   * @param vertices - Segment endpoints as flat XYZ triplets
   * @param colors - Vertex colors as flat RGB triplets
   * @param segmentIndices - Indices of the part's segments in the layer, or null for the whole layer
   */
  private addLayerPart (layerNumber: number, globalBase: number, vertices: Float32Array, colors: Uint8ClampedArray, segmentIndices: Uint32Array | null): void {
    // Skip empty parts
    if (vertices.length <= 2) return

    const metadata: GcodeLineMetadata = {
      layerNumber,
      globalBase,
      numMoves: vertices.length / 6,
      segmentIndices
    }

    // Build the part's line object and add it to the gcode group
    const line = this.makeLine(vertices, colors, this.defaultMaterial)
    line.name = LAYER_PREFIX + layerNumber
    line.userData = metadata
    this.linesGroup.add(line)

    // Draw the part's geometry in the mirror too
    if (this.settings.showBed && this.settings.showMirror) {
      const mirror: GcodeLine = isThickLine(line)
        ? new THREE.LineSegments2(line.geometry, this.mirrorThickMaterial)
        : new THREE.LineSegments(line.geometry, this.mirrorThinMaterial)
      mirror.matrixAutoUpdate = false
      mirror.name = LAYER_PREFIX + layerNumber
      mirror.userData = { ...metadata, mirror: true } satisfies GcodeLineMetadata
      this.mirrorGroup.add(mirror)
    }
  }

  /**
   * Turns colors into their greyed-out version
   * @param colors - Vertex colors as flat RGB triplets, modified in place
   */
  private greyOutColors (colors: Uint8ClampedArray): void {
    const color = new THREE.Color()
    const hsl = { h: 0, s: 0, l: 0 }
    for (let i = 0; i < colors.length; i += 3) {
      color.setRGB(colors[i] / 255, colors[i + 1] / 255, colors[i + 2] / 255)
      color.getHSL(hsl)
      color.setHSL(hsl.h, 0, hsl.l * 0.6)
      colors[i] = color.r * 255
      colors[i + 1] = color.g * 255
      colors[i + 2] = color.b * 255
    }
  }

  /** (Re)builds the travel lines from the current travel settings */
  updateTravelLines (): void {
    for (const child of this.travelGroup.children) (child as THREE.LineSegments).geometry.dispose()
    this.travelGroup.clear()

    // Let the next reveal show the new lines
    this.revealedIndex = -1

    if (this.settings.travelScope === 'none') return

    this.travelMaterial.color.set(this.settings.travelColor)

    for (const { layerNumber, globalBase } of this.timeline.drawnLayers) {
      this.addTravelLines(this.layers[layerNumber - 1], layerNumber, globalBase)
    }
  }

  /**
   * Adds a layer's travel lines to the model
   * @param layer - Parsed layer
   * @param layerNumber - 1-based layer number
   * @param globalBase - Global segment index the layer starts at
   */
  private addTravelLines (layer: Layer, layerNumber: number, globalBase: number): void {
    let { travelVertices, travelSegmentIndices } = layer

    // Leave out the travels leading to segments the exclusions keep undrawn
    const excludedFlags = this.settings.showExcluded ? null : this.exclusions.classifyLayer(layer)
    if (excludedFlags) {
      const drawnIndices = travelSegmentIndices.filter((segment) => !excludedFlags[segment])
      const drawnVertices = new Float32Array(drawnIndices.length * 6)
      let drawn = 0
      for (let travel = 0; travel < travelSegmentIndices.length; travel++) {
        if (excludedFlags[travelSegmentIndices[travel]]) continue
        drawnVertices.set(travelVertices.subarray(travel * 6, travel * 6 + 6), drawn * 6)
        drawn++
      }
      travelVertices = drawnVertices
      travelSegmentIndices = drawnIndices
    }

    // Skip layers with no travel
    if (!travelVertices.length) return

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(travelVertices, 3))

    const line = new THREE.LineSegments(geometry, this.travelMaterial)

    // Speeds up rendering, the lines never move
    line.matrixAutoUpdate = false

    line.name = TRAVEL_PREFIX + layerNumber
    line.userData = {
      layerNumber,
      globalBase,
      numMoves: travelSegmentIndices.length,
      segmentIndices: travelSegmentIndices
    } satisfies GcodeLineMetadata
    this.travelGroup.add(line)
  }

  /* ---- Reveal and highlight ---- */

  /**
   * Highlights a layer, unhighlighting the others
   * @param layerNumber - 1-based layer number to highlight
   */
  highlightLayer (layerNumber: number): void {
    // Shade the highlight materials by the set intensity
    const brightness = 1 - this.settings.highlightIntensity / 100
    this.highlightThinMaterial.color.setRGB(brightness, brightness, brightness)
    this.highlightThickMaterial.color.setRGB(brightness, brightness, brightness)

    // A zeroed intensity leaves no layer highlighted
    const highlighted = this.settings.highlightIntensity > 0 ? layerNumber : 0
    if (highlighted === this.highlightedLayer) return
    this.highlightedLayer = highlighted

    this.linesGroup.traverse((child) => {
      if (!isLayerObject(child)) return
      const metadata = gcodeLineMetadata(child)

      // The mirror keeps its own bed-clipped material
      if (metadata.mirror) return

      // Highlight the target layer, default on the others
      child.material = metadata.layerNumber === highlighted ? this.highlightMaterial : this.defaultMaterial
    })
  }

  /**
   * Shows a layer up to a within-layer position, hiding the layers above
   * @param layerNumber - 1-based topmost layer to show
   * @param segmentsShown - Segments of that layer to reveal
   * @returns True if anything changed
   */
  syncToLayerSegment (layerNumber: number, segmentsShown: number): boolean {
    let needUpdate = false

    // Hide the growing tip while sliding layer/segments manually
    if (this.tipLine.hide()) needUpdate = true

    if (this.revealUpTo(this.timeline.revealIndex(layerNumber, segmentsShown))) needUpdate = true

    return needUpdate
  }

  /**
   * Reveals the model up to a print timeline position
   * @param spot - Timeline position to reveal up to
   */
  revealTo (spot: TimelineSpot): void {
    this.revealUpTo(spot.segmentIndex)

    // Grow the segment the nozzle is mid-way through
    this.tipLine.update(spot)
  }

  /**
   * Reveals the model up to a global segment index, hiding the parts it hasn't reached
   * @param index - Global index of the reveal position
   * @returns True if anything changed
   */
  private revealUpTo (index: number): boolean {
    if (index === this.revealedIndex) return false
    this.revealedIndex = index

    let needUpdate = false

    this.linesGroup.traverse((child) => {
      if (!isLayerObject(child)) return
      const count = this.revealedMoveCount(child, index)
      const visible = count > 0
      if (child.visible !== visible) {
        child.visible = visible
        needUpdate = true
      }
      if (visible && this.setRevealedMoveCount(child, count)) needUpdate = true
    })

    if (this.revealTravelsUpTo(index)) needUpdate = true

    return needUpdate
  }

  /**
   * Reveals the travel lines up to a global segment index, hiding the ones it hasn't reached
   * @param index - Global index of the reveal position
   * @returns True if anything changed
   */
  private revealTravelsUpTo (index: number): boolean {
    const wholeModel = this.settings.travelScope === 'wholeModel'
    const displayedLayer = this.timeline.revealPosition(index).layerNumber

    let needUpdate = false

    for (const child of this.travelGroup.children as THREE.LineSegments[]) {
      const count = this.revealedMoveCount(child, index + 1)
      const visible = count > 0 && (wholeModel || gcodeLineMetadata(child).layerNumber === displayedLayer)
      if (child.visible !== visible) {
        child.visible = visible
        needUpdate = true
      }
      if (visible && this.setRevealedMoveCount(child, count)) needUpdate = true
    }

    return needUpdate
  }

  /**
   * Counts how many of a line's moves a reveal position has passed
   * @param line - Gcode line
   * @param revealed - Global index of the reveal position
   * @returns The number of moves passed
   */
  private revealedMoveCount (line: GcodeLine, revealed: number): number {
    const { globalBase, numMoves, segmentIndices } = gcodeLineMetadata(line)

    // How many of the layer's segments the reveal has passed
    const revealedInLayer = revealed - globalBase

    // A whole layer is drawn up to the reveal, capped to its own size
    if (!segmentIndices) return Math.max(0, Math.min(numMoves, revealedInLayer))

    // Otherwise count the moves whose segment the reveal has passed (binary search)
    let lo = 0; let hi = numMoves
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (segmentIndices[mid] < revealedInLayer) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /**
   * Limits how many of a line's moves are drawn
   * @param line - Gcode line
   * @param count - Moves to draw
   * @returns True if the count changed
   */
  private setRevealedMoveCount (line: GcodeLine, count: number): boolean {
    // Thick lines are instanced; thin ones aren't, so limit their drawn vertex range (2 per move)
    if (isThickLine(line)) {
      if (line.geometry.instanceCount === count) return false
      line.geometry.instanceCount = count
    } else {
      if (line.geometry.drawRange.count === count * 2) return false
      line.geometry.setDrawRange(0, count * 2)
    }
    return true
  }
}
