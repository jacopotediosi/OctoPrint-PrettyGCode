import * as THREE from '../../three-exports'
import { gcodeLineColorBuffer, gcodeLineMetadata, isLayerObject, isThickLine, makeLine, LAYER_PREFIX, TRAVEL_PREFIX } from './gcode-line'
import { makeThickMaterial, makeThinMaterial } from './line-materials'
import { resolveSegmentColoring } from '../colors/color-modes'
import { fillSegmentColors, greyOutColors } from './segment-colors'
import { TipLine } from './tip-line'
import type { GcodeLine, GcodeLineMetadata } from './gcode-line'
import type { GcodeLineMaterial } from './line-materials'
import type { SegmentColoring } from '../colors/color-modes'
import type { Settings } from '../../settings'
import { emptyGcode, type Layer, type ParsedGcode } from '../parsing/parsed-gcode'
import type { PrintTimeline, TimelineSpot } from '../timeline/print-timeline'

/** Part of the print the travel moves are drawn for */
export type TravelScope = 'none' | 'displayedLayer' | 'wholeModel'

/** Oversize factor of the drawn lines, to avoid gaps */
const LINE_THICKNESS_FACTOR = 1.1

/** Brightness the mirror multiplies the line colors by */
const MIRROR_BRIGHTNESS = 0.5

/** A subset of a layer's segments */
class LayerPart {
  /** Segment endpoints as flat XYZ triplets */
  readonly vertices: Float32Array
  /** Segment colors as flat RGB triplets */
  readonly colors: Uint8ClampedArray
  /** Index in the layer of each segment the part holds */
  readonly localSegmentIndices: Uint32Array
  /** Segments added so far */
  private segmentCount = 0

  /**
   * @param segments - Segments the part holds
   */
  constructor (segments: number) {
    this.vertices = new Float32Array(segments * 6)
    this.colors = new Uint8ClampedArray(segments * 6)
    this.localSegmentIndices = new Uint32Array(segments)
  }

  /**
   * Adds a layer's segment to the part
   * @param layer - Layer holding the segment
   * @param colors - Segment colors of the layer as flat RGB triplets
   * @param localSegmentIndex - Segment index within the layer
   */
  add (layer: Layer, colors: Uint8ClampedArray, localSegmentIndex: number): void {
    const from = localSegmentIndex * 6
    const to = this.segmentCount * 6
    for (let i = 0; i < 6; i++) {
      this.vertices[to + i] = layer.vertices[from + i]
      this.colors[to + i] = colors[from + i]
    }
    this.localSegmentIndices[this.segmentCount] = localSegmentIndex
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

  /** Gcode the model was last built from */
  private gcode: ParsedGcode = emptyGcode()

  /** How the segments take their color, null until it is resolved */
  private _segmentColoring: SegmentColoring | null = null

  /** Segment colors of each layer the model was last built from */
  private layerColors: Uint8ClampedArray[] = []

  /** Global segment index the model is revealed up to */
  private revealedGlobalSegmentIndex = -1

  /** Layer the highlight is on, 0 when no layer is highlighted and -1 before the first highlight */
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

  /**
   * @param settings - Plugin frontend settings
   * @param getNozzleDiameter - Getter of the current nozzle diameter in mm
   * @param timeline - Print timeline of the loaded gcode
   * @param mirrorBoundsPlanes - Planes clipping the mirror to the bed
   */
  constructor (settings: Settings, getNozzleDiameter: () => number, timeline: PrintTimeline, mirrorBoundsPlanes: THREE.Plane[]) {
    this.settings = settings
    this.getNozzleDiameter = getNozzleDiameter
    this.timeline = timeline

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

  /* ---- Model building ---- */

  /**
   * (Re)builds the model's line objects from parsed layers
   * @param gcode - Parsed gcode to draw
   */
  build (gcode: ParsedGcode): void {
    this.gcode = gcode
    for (const child of this.linesGroup.children) {
      if (isLayerObject(child)) child.geometry.dispose()
    }
    this.mirrorGroup.clear()
    this.linesGroup.clear()
    this.linesGroup.add(this.mirrorGroup)
    this.linesGroup.add(this.travelGroup)
    this._segmentColoring = null
    this.layerColors = []
    this.revealedGlobalSegmentIndex = -1
    this.highlightedLayer = -1

    this.updateLineWidth()

    for (const { layerNumber, firstGlobalSegmentIndex, excludedFlags } of this.timeline.drawnLayers) {
      this.addLayerLines(gcode.layers[layerNumber - 1], layerNumber, firstGlobalSegmentIndex, excludedFlags)
    }

    this.rebuildTravelLines()

    this.tipLine.build(this.highlightMaterial)
  }

  /** Rebuilds the model from the gcode it was last built from */
  rebuild (): void {
    this.build(this.gcode)
  }

  /* ---- Colors ---- */

  /** How the segments take their color */
  get segmentColoring (): SegmentColoring {
    this._segmentColoring ??= this.resolveSegmentColoring()
    return this._segmentColoring
  }

  /**
   * Resolves how the segments take their color from the gcode and the current settings
   * @returns The resolved coloring
   */
  private resolveSegmentColoring (): SegmentColoring {
    return resolveSegmentColoring(this.gcode, this.settings, (layerNumber) => this.timeline.layerSeconds(layerNumber))
  }

  /** Applies the current colors to the model's lines */
  recolor (): void {
    this._segmentColoring = null
    for (const { layerNumber } of this.timeline.drawnLayers) {
      const layer = this.gcode.layers[layerNumber - 1]
      fillSegmentColors(layer, layerNumber, this.segmentColoring.propertyOf(layer, layerNumber), this.segmentColoring.colorAt, this.layerColors[layerNumber - 1])
    }

    this.linesGroup.traverse((child) => {
      if (!isLayerObject(child)) return
      const { layerNumber, moveCount, localSegmentIndices, excluded, mirror } = gcodeLineMetadata(child)

      // The mirror draws the geometry of the layer's own line, filled already
      if (mirror) return

      const buffer = gcodeLineColorBuffer(child)

      // Parts keep their own copy of the segments they draw
      if (localSegmentIndices) {
        const colors = buffer.array as Uint8ClampedArray
        const layerColors = this.layerColors[layerNumber - 1]
        for (let move = 0; move < moveCount; move++) {
          const from = localSegmentIndices[move] * 6
          const to = move * 6
          for (let i = 0; i < 6; i++) colors[to + i] = layerColors[from + i]
        }
        if (excluded) greyOutColors(colors)
      }

      buffer.needsUpdate = true
    })
  }

  /* ---- Layer lines ---- */

  /**
   * Adds a layer's lines to the model
   * @param layer - Parsed layer
   * @param layerNumber - 1-based layer number
   * @param firstGlobalSegmentIndex - Global segment index the layer starts at
   * @param excludedFlags - One flag per segment, 1 where excluded from printing and 0 otherwise, null when none is
   */
  private addLayerLines (layer: Layer, layerNumber: number, firstGlobalSegmentIndex: number, excludedFlags: Uint8Array | null): void {
    // Skip empty layers
    if (layer.vertices.length <= 2) return

    const colors = new Uint8ClampedArray(layer.vertices.length)
    fillSegmentColors(layer, layerNumber, this.segmentColoring.propertyOf(layer, layerNumber), this.segmentColoring.colorAt, colors)
    this.layerColors[layerNumber - 1] = colors

    // Layers untouched by exclusions go in whole
    if (!excludedFlags) {
      this.addLayerPart(layerNumber, firstGlobalSegmentIndex, layer.vertices, colors, null)
      return
    }

    // Split the layer between printed and excluded segments
    let excludedSegments = 0
    for (let i = 0; i < excludedFlags.length; i++) excludedSegments += excludedFlags[i]
    const printedPart = new LayerPart(excludedFlags.length - excludedSegments)
    const excludedPart = new LayerPart(excludedSegments)
    for (let localSegmentIndex = 0; localSegmentIndex < excludedFlags.length; localSegmentIndex++) {
      const part = excludedFlags[localSegmentIndex] ? excludedPart : printedPart
      part.add(layer, colors, localSegmentIndex)
    }

    // Add the printed part
    this.addLayerPart(layerNumber, firstGlobalSegmentIndex, printedPart.vertices, printedPart.colors, printedPart.localSegmentIndices)

    // Add the excluded part, greyed out
    if (this.settings.showExcluded) {
      greyOutColors(excludedPart.colors)
      this.addLayerPart(layerNumber, firstGlobalSegmentIndex, excludedPart.vertices, excludedPart.colors, excludedPart.localSegmentIndices, true)
    }
  }

  /**
   * Adds one part of a layer's segments to the model
   * @param layerNumber - 1-based layer number
   * @param firstGlobalSegmentIndex - Global segment index the layer starts at
   * @param vertices - Segment endpoints as flat XYZ triplets
   * @param colors - Segment colors as flat RGB triplets
   * @param localSegmentIndices - Indices of the part's segments in the layer, or null for the whole layer
   * @param excluded - True when the part holds the layer's excluded segments
   */
  private addLayerPart (layerNumber: number, firstGlobalSegmentIndex: number, vertices: Float32Array, colors: Uint8ClampedArray, localSegmentIndices: Uint32Array | null, excluded = false): void {
    // Skip empty parts
    if (vertices.length <= 2) return

    const metadata: GcodeLineMetadata = {
      layerNumber,
      firstGlobalSegmentIndex,
      moveCount: vertices.length / 6,
      localSegmentIndices,
      excluded
    }

    // Build the part's line object and add it to the gcode group
    const line = makeLine(vertices, colors, this.defaultMaterial)
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

  /* ---- Travel lines ---- */

  /** (Re)builds the travel lines from the current travel settings */
  rebuildTravelLines (): void {
    for (const child of this.travelGroup.children) (child as THREE.LineSegments).geometry.dispose()
    this.travelGroup.clear()

    // Let the next reveal show the new lines
    this.revealedGlobalSegmentIndex = -1

    if (this.settings.travelScope === 'none') return

    this.travelMaterial.color.set(this.settings.travelColor)

    for (const { layerNumber, firstGlobalSegmentIndex, excludedFlags } of this.timeline.drawnLayers) {
      this.addTravelLines(this.gcode.layers[layerNumber - 1], layerNumber, firstGlobalSegmentIndex, excludedFlags)
    }
  }

  /**
   * Adds a layer's travel lines to the model
   * @param layer - Parsed layer
   * @param layerNumber - 1-based layer number
   * @param firstGlobalSegmentIndex - Global segment index the layer starts at
   * @param excludedFlags - One flag per segment, 1 where excluded from printing and 0 otherwise, null when none is
   */
  private addTravelLines (layer: Layer, layerNumber: number, firstGlobalSegmentIndex: number, excludedFlags: Uint8Array | null): void {
    let { travelVertices, travelLocalSegmentIndices } = layer

    // Leave out the travels leading to segments the exclusions keep undrawn
    if (excludedFlags && !this.settings.showExcluded) {
      const drawnIndices = travelLocalSegmentIndices.filter((localSegmentIndex) => !excludedFlags[localSegmentIndex])
      const drawnVertices = new Float32Array(drawnIndices.length * 6)
      let drawn = 0
      for (let travel = 0; travel < travelLocalSegmentIndices.length; travel++) {
        if (excludedFlags[travelLocalSegmentIndices[travel]]) continue
        drawnVertices.set(travelVertices.subarray(travel * 6, travel * 6 + 6), drawn * 6)
        drawn++
      }
      travelVertices = drawnVertices
      travelLocalSegmentIndices = drawnIndices
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
      firstGlobalSegmentIndex,
      moveCount: travelLocalSegmentIndices.length,
      localSegmentIndices: travelLocalSegmentIndices
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
   * Reveals a layer up to a within-layer position, hiding the layers above
   * @param layerNumber - 1-based topmost layer to show
   * @param revealedSegments - Segments of that layer to reveal
   * @returns True if anything changed
   */
  syncToLayerSegment (layerNumber: number, revealedSegments: number): boolean {
    let needUpdate = false

    // Hide the growing tip while sliding layer/segments manually
    if (this.tipLine.hide()) needUpdate = true

    if (this.revealUpTo(this.timeline.revealIndex(layerNumber, revealedSegments))) needUpdate = true

    return needUpdate
  }

  /**
   * Reveals the model up to a print timeline position
   * @param spot - Timeline position to reveal up to
   */
  revealTo (spot: TimelineSpot): void {
    this.revealUpTo(spot.globalSegmentIndex)

    // Grow the segment the nozzle is mid-way through
    this.tipLine.update(spot, this.layerColors)
  }

  /**
   * Reveals the model up to a global segment index, hiding the parts it hasn't reached
   * @param globalSegmentIndex - Global index of the reveal position
   * @returns True if anything changed
   */
  private revealUpTo (globalSegmentIndex: number): boolean {
    if (globalSegmentIndex === this.revealedGlobalSegmentIndex) return false
    this.revealedGlobalSegmentIndex = globalSegmentIndex

    let needUpdate = false

    this.linesGroup.traverse((child) => {
      if (!isLayerObject(child)) return
      const count = this.revealedMoveCount(child, globalSegmentIndex)
      const visible = count > 0
      if (child.visible !== visible) {
        child.visible = visible
        needUpdate = true
      }
      if (visible && this.setRevealedMoveCount(child, count)) needUpdate = true
    })

    if (this.revealTravelsUpTo(globalSegmentIndex)) needUpdate = true

    return needUpdate
  }

  /**
   * Reveals the travel lines up to a global segment index, hiding the ones it hasn't reached
   * @param globalSegmentIndex - Global index of the reveal position
   * @returns True if anything changed
   */
  private revealTravelsUpTo (globalSegmentIndex: number): boolean {
    const wholeModel = this.settings.travelScope === 'wholeModel'
    const displayedLayer = this.timeline.revealPosition(globalSegmentIndex).layerNumber

    let needUpdate = false

    for (const child of this.travelGroup.children as THREE.LineSegments[]) {
      const count = this.revealedMoveCount(child, globalSegmentIndex + 1)
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
   * @param globalSegmentIndex - Global index of the reveal position
   * @returns The number of moves passed
   */
  private revealedMoveCount (line: GcodeLine, globalSegmentIndex: number): number {
    const { firstGlobalSegmentIndex, moveCount, localSegmentIndices } = gcodeLineMetadata(line)

    // How many of the layer's segments the reveal has passed
    const revealedInLayer = globalSegmentIndex - firstGlobalSegmentIndex

    // A whole layer is drawn up to the reveal, capped to its own size
    if (!localSegmentIndices) return Math.max(0, Math.min(moveCount, revealedInLayer))

    // Otherwise count the moves whose segment the reveal has passed (binary search)
    let lo = 0; let hi = moveCount
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (localSegmentIndices[mid] < revealedInLayer) lo = mid + 1
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
    // Thick lines draw a number of instances, thin ones a range of vertices, two per move
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
