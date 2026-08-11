import * as THREE from '../../three-exports'
import { isThickLine } from './gcode-line'
import { isThickMaterial } from './line-materials'
import type { GcodeLine } from './gcode-line'
import type { GcodeLineMaterial } from './line-materials'
import type { PrintTimeline, TimelineSpot } from '../timeline/print-timeline'

/** The growing tip drawn along the segment the nozzle is currently laying down */
export class TipLine {
  /** The rendered line, null until it is built */
  private line: GcodeLine | null = null

  /** Print timeline of the loaded gcode */
  private readonly timeline: PrintTimeline

  /** Group holding the rendered line */
  private readonly group: THREE.Group

  /**
   * @param timeline - Print timeline of the loaded gcode
   * @param group - Group holding the rendered line
   */
  constructor (timeline: PrintTimeline, group: THREE.Group) {
    this.timeline = timeline
    this.group = group
  }

  /**
   * (Re)creates the rendered line
   * @param material - Material the line is drawn with
   */
  build (material: GcodeLineMaterial): void {
    if (this.line) {
      this.group.remove(this.line)
      this.line.geometry.dispose()
    }

    const positions = new Float32Array(6)
    const colors = new Float32Array(6)

    if (isThickMaterial(material)) {
      // Thick line
      const geometry = new THREE.LineSegmentsGeometry()
      geometry.setPositions(positions)
      geometry.setColors(colors)
      this.line = new THREE.LineSegments2(geometry, material)
    } else {
      // Thin line
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      this.line = new THREE.LineSegments(geometry, material)
    }

    this.line.visible = false
    this.line.frustumCulled = false

    this.group.add(this.line)
  }

  /**
   * Hides the tip
   * @returns True if it was showing
   */
  hide (): boolean {
    if (!this.line?.visible) return false

    this.line.visible = false
    return true
  }

  /**
   * Grows the tip up to a timeline position
   * @param spot - Timeline position
   * @param layerColors - Segment colors of every layer, in the layers' order
   */
  update (spot: TimelineSpot, layerColors: Uint8ClampedArray[]): void {
    if (!this.line) return

    // Nothing grows while traveling between segments or past the end
    if (!spot.onSegment || spot.fraction <= 0) {
      this.line.visible = false
      return
    }

    const segment = this.timeline.segmentAt(spot.segmentIndex)!
    const vertices = segment.layer.vertices
    const offset = segment.localIndex * 6
    const startX = vertices[offset]; const startY = vertices[offset + 1]; const startZ = vertices[offset + 2]

    // Grow up to how far along the segment the nozzle has reached
    const progress = spot.fraction
    const colors = layerColors[segment.layer.layerNumber - 1]
    this.setGeometry(this.line, startX, startY, startZ,
      startX + (vertices[offset + 3] - startX) * progress, startY + (vertices[offset + 4] - startY) * progress, startZ + (vertices[offset + 5] - startZ) * progress,
      colors[offset] / 255, colors[offset + 1] / 255, colors[offset + 2] / 255)
    this.line.visible = true
  }

  /**
   * Writes new endpoints and color into a line
   * @param line - Line to write into
   * @param startX - Start point X
   * @param startY - Start point Y
   * @param startZ - Start point Z
   * @param endX - End point X
   * @param endY - End point Y
   * @param endZ - End point Z
   * @param r - Red component (0-1)
   * @param g - Green component (0-1)
   * @param b - Blue component (0-1)
   */
  private setGeometry (line: GcodeLine, startX: number, startY: number, startZ: number, endX: number, endY: number, endZ: number, r: number, g: number, b: number): void {
    if (isThickLine(line)) {
      const attributes = line.geometry.attributes as Record<string, THREE.InterleavedBufferAttribute>
      const positions = attributes.instanceStart.data
      positions.array.set([startX, startY, startZ, endX, endY, endZ])
      positions.needsUpdate = true
      const colors = attributes.instanceColorStart.data
      colors.array.set([r, g, b, r, g, b])
      colors.needsUpdate = true
    } else {
      const attributes = line.geometry.attributes
      attributes.position.array.set([startX, startY, startZ, endX, endY, endZ])
      attributes.position.needsUpdate = true
      attributes.color.array.set([r, g, b, r, g, b])
      attributes.color.needsUpdate = true
    }
  }
}
