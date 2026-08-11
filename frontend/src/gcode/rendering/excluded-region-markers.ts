import * as THREE from '../../three-exports'
import type { BeltPrinterTransform } from '../printer-transform/belt-printer-transform'
import type { ExcludedRegion } from '../../octoprint/push-payloads'

/** Material shared by the markers */
const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xe76666, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })

/** The markers drawn over the regions excluded from printing */
export class ExcludedRegionMarkers {
  /** Group holding the markers */
  readonly group = new THREE.Group()

  /**
   * Shows or hides the markers
   * @param visible - True to show the markers
   */
  applyVisibility (visible: boolean): void {
    this.group.visible = visible
  }

  /**
   * (Re)places the markers to match the printer geometry
   * @param printerTransform - Transform the vertices were drawn with, null for non-belt printers
   */
  place (printerTransform: BeltPrinterTransform | null): void {
    if (printerTransform) {
      // A belt printer runs its Y axis along the gantry, so a region marks a band of heights across the belt
      this.group.rotation.x = Math.PI / 2
      this.group.scale.set(1, printerTransform.heightPerGantryTravel, 1)
    } else {
      // A region marks a footprint of the bed, at every height
      this.group.rotation.x = 0
      this.group.scale.set(1, 1, 1)
    }
  }

  /**
   * (Re)builds the markers from the given regions
   * @param regions - Excluded regions to mark
   */
  rebuild (regions: ExcludedRegion[]): void {
    for (const child of this.group.children) (child as THREE.Mesh).geometry.dispose()
    this.group.clear()

    for (const excludedRegion of regions) {
      const { type, r, cx, cy, x1, y1, x2, y2 } = excludedRegion
      const circular = type === 'CircularRegion'
      const geometry = circular
        ? new THREE.CircleGeometry(r, 64)
        : new THREE.PlaneGeometry(x2! - x1!, y2! - y1!)
      const marker = new THREE.Mesh(geometry, markerMaterial)
      const x = circular ? cx! : (x1! + x2!) / 2
      const y = circular ? cy! : (y1! + y2!) / 2
      marker.position.set(x, y, 0.01)
      this.group.add(marker)
    }
  }
}
