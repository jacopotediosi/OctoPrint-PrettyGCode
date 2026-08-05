import * as THREE from '../three-exports'
import { BeltPrinterTransform } from './printer-transform/belt-printer-transform'
import type { Layer } from './parsing/parser'
import type { Settings } from '../settings'

/** Excluded region defined in the Exclude Region plugin */
export interface ExcludedRegion {
  type: 'RectangularRegion' | 'CircularRegion'
  id: string
  x1?: number
  y1?: number
  x2?: number
  y2?: number
  cx?: number
  cy?: number
  r?: number
}

/** Printable object listed by the Cancel Object plugin */
export interface CancelObjectEntry {
  object: string
  cancelled: boolean
}

/** Material shared by the region markers */
const regionMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xe76666, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })

/**
 * Tells whether a region contains a point
 * @param region - Region to test against
 * @param x - Point X
 * @param y - Point Y
 * @returns True if the point is inside the region
 */
const regionContains = (region: ExcludedRegion, x: number, y: number): boolean =>
  region.type === 'CircularRegion'
    ? Math.hypot(x - region.cx!, y - region.cy!) <= region.r!
    : x >= region.x1! && x <= region.x2! && y >= region.y1! && y <= region.y2!

/**
 * Tells whether two regions have the same geometry
 * @param a - First region
 * @param b - Second region
 * @returns True if the regions match
 */
const sameRegion = (a: ExcludedRegion, b: ExcludedRegion): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ExcludedRegion>
  return [...keys].every((key) => a[key] === b[key])
}

/** Print exclusions gathered from the Exclude Region and Cancel Object plugins */
export class PrintExclusions {
  /** Plugin frontend settings */
  private readonly settings: Settings

  /** Group holding the markers of the excluded regions */
  readonly regionMarkersGroup = new THREE.Group()

  /** Currently defined excluded regions */
  private excludedRegions: ExcludedRegion[] = []
  /** Names of the cancelled objects */
  private cancelledObjects = new Set<string>()

  /** Object names of the loaded gcode, by object id */
  private objectNames: string[] = []
  /** Ids the cancelled objects have in the loaded gcode */
  private cancelledIds = new Set<number>()

  /** Transform the vertices were drawn with, null for non-belt printers */
  private printerTransform: BeltPrinterTransform | null = null

  /**
   * @param settings - Plugin frontend settings
   */
  constructor (settings: Settings) {
    this.settings = settings
  }

  /* ---- Plugin updates ---- */

  /**
   * Applies the exclusions update from an Exclude Region or Cancel Object message, ignoring those from any other plugin
   * @param plugin - Identifier of the sending plugin
   * @param data - Message payload
   * @returns True if the exclusions changed
   */
  applyPluginMessage (plugin: string, data: any): boolean {
    if (plugin === 'excluderegion' && data.excluded_regions) return this.setRegions(data.excluded_regions)
    if (plugin === 'cancelobject' && data.objects) return this.setCancelledObjects(data.objects)
    return false
  }

  /**
   * Fetches the exclusions currently defined by the Exclude Region or Cancel Object plugins
   * @returns True if the exclusions changed
   */
  async fetch (): Promise<boolean> {
    let changed = false

    try {
      const response = await OctoPrint.simpleApiGet('excluderegion')
      if (this.setRegions(response.excluded_regions ?? [])) changed = true
    } catch {}

    try {
      const response = await OctoPrint.simpleApiCommand('cancelobject', 'objlist')
      if (this.setCancelledObjects(response.list ?? [])) changed = true
    } catch {}

    return changed
  }

  /**
   * Sets the excluded regions to the ones a plugin update reports
   * @param regions - Excluded regions reported by the Exclude Region plugin
   * @returns True if the regions changed
   */
  private setRegions (regions: ExcludedRegion[]): boolean {
    const previous = this.excludedRegions
    this.excludedRegions = regions

    const changed = previous.length !== regions.length || regions.some((region, i) => !sameRegion(region, previous[i]))
    if (changed) this.rebuildRegionMarkers()
    return changed
  }

  /**
   * Sets the cancelled objects to the ones a plugin update reports
   * @param entries - Objects reported by the Cancel Object plugin
   * @returns True if the cancelled objects changed
   */
  private setCancelledObjects (entries: CancelObjectEntry[]): boolean {
    const cancelled = new Set(entries.filter((entry) => entry.cancelled).map((entry) => entry.object))

    const changed = cancelled.size !== this.cancelledObjects.size || [...cancelled].some((name) => !this.cancelledObjects.has(name))
    if (changed) {
      this.cancelledObjects = cancelled
      this.rebuildCancelledIds()
    }
    return changed
  }

  /* ---- Gcode objects ---- */

  /**
   * Sets the names of the objects the loaded gcode contains
   * @param objectNames - Object names, by object id
   */
  setGcodeObjectNames (objectNames: string[]): void {
    this.objectNames = objectNames
    this.rebuildCancelledIds()
  }

  /** (Re)builds the ids the cancelled objects have in the loaded gcode */
  private rebuildCancelledIds (): void {
    this.cancelledIds = new Set()
    this.objectNames.forEach((name, id) => {
      if (this.cancelledObjects.has(name)) this.cancelledIds.add(id)
    })
  }

  /* ---- Printer transform ---- */

  /** Syncs the printer transform with the printer settings */
  private updatePrinterTransform (): void {
    if (this.settings.beltPrinter) {
      const gantryAngle = this.settings.beltPrinterGantryAngle
      if (gantryAngle !== this.printerTransform?.gantryAngle) this.printerTransform = new BeltPrinterTransform(gantryAngle)
    } else {
      this.printerTransform = null
    }
  }

  /* ---- Segment classification ---- */

  /**
   * Flags which of a layer's segments are excluded from printing
   * @param layer - Parsed layer
   * @returns One flag per segment, 1 where excluded and 0 otherwise, or null when none is excluded
   */
  classifyLayer (layer: Layer): Uint8Array | null {
    if (!this.excludedRegions.length && !this.cancelledIds.size) return null

    this.updatePrinterTransform()

    const { vertices, objectIds } = layer
    const segments = vertices.length / 6
    let flags: Uint8Array | null = null
    for (let segment = 0; segment < segments; segment++) {
      const excluded = (objectIds !== null && this.cancelledIds.has(objectIds[segment])) || this.inExcludedRegion(vertices, segment * 6)
      if (excluded) {
        flags ??= new Uint8Array(segments)
        flags[segment] = 1
      }
    }
    return flags
  }

  /**
   * Tells whether a segment touches an excluded region
   * @param vertices - Layer vertices holding the segment endpoints
   * @param offset - Offset of the segment's first endpoint in the vertices
   * @returns True if the segment is in the excluded region
   */
  private inExcludedRegion (vertices: Float32Array, offset: number): boolean {
    // Regions bound the machine X and Y axes, and a belt printer runs its Y axis along the gantry
    const startY = this.printerTransform ? this.printerTransform.gantryTravelOf(vertices[offset + 2]) : vertices[offset + 1]
    const endY = this.printerTransform ? this.printerTransform.gantryTravelOf(vertices[offset + 5]) : vertices[offset + 4]

    for (const excludedRegion of this.excludedRegions) {
      if (
        regionContains(excludedRegion, vertices[offset], startY) ||
        regionContains(excludedRegion, vertices[offset + 3], endY)
      ) { return true }
    }
    return false
  }

  /* ---- Region markers ---- */

  /**
   * Shows or hides the region markers
   * @param visible - True to show the region markers
   */
  applyRegionMarkersVisibility (visible: boolean): void {
    this.regionMarkersGroup.visible = visible
  }

  /** (Re)places the region markers to match the printer geometry */
  placeRegionMarkers (): void {
    const group = this.regionMarkersGroup

    this.updatePrinterTransform()

    if (this.printerTransform) {
      // A belt printer runs its Y axis along the gantry, so a region marks a band of heights across the belt
      group.rotation.x = Math.PI / 2
      group.scale.set(1, this.printerTransform.heightPerGantryTravel, 1)
    } else {
      // A region marks a footprint of the bed, at every height
      group.rotation.x = 0
      group.scale.set(1, 1, 1)
    }
  }

  /** (Re)builds the region markers from the current regions */
  private rebuildRegionMarkers (): void {
    for (const child of this.regionMarkersGroup.children) (child as THREE.Mesh).geometry.dispose()
    this.regionMarkersGroup.clear()

    for (const excludedRegion of this.excludedRegions) {
      const { type, r, cx, cy, x1, y1, x2, y2 } = excludedRegion
      const circular = type === 'CircularRegion'
      const geometry = circular
        ? new THREE.CircleGeometry(r, 64)
        : new THREE.PlaneGeometry(x2! - x1!, y2! - y1!)
      const marker = new THREE.Mesh(geometry, regionMarkerMaterial)
      const x = circular ? cx! : (x1! + x2!) / 2
      const y = circular ? cy! : (y1! + y2!) / 2
      marker.position.set(x, y, 0.01)
      this.regionMarkersGroup.add(marker)
    }
  }
}
