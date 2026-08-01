import * as THREE from '../three-exports'
import type { Settings } from '../settings'

/** Light theme bed grid center-line color */
const LIGHT_GRID_CENTER = 0x000000
/** Dark theme bed grid center-line color */
const DARK_GRID_CENTER = 0xffffff

/** Planes clipping the gcode reflection when the camera is below the bed */
const BELOW_BED_CLIP_PLANES = [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)]
/** Empty plane set, to disable clipping */
const NO_CLIP_PLANES: THREE.Plane[] = []

/** Print bed geometry */
export interface BedVolume {
  depth: number
  height: number
  origin: string
  width: number
}

/**
 * Computes the bed center in scene coordinates
 * @param bedVolume - Print bed geometry
 * @returns Center X and Y
 */
export const bedCenter = (bedVolume: BedVolume): { x: number, y: number } => {
  const lowerleft = bedVolume.origin === 'lowerleft'
  return { x: lowerleft ? bedVolume.width / 2 : 0, y: lowerleft ? bedVolume.depth / 2 : 0 }
}

/** The print bed of the 3D view */
export class Bed {
  /** Plugin frontend settings */
  private readonly settings: Settings

  /** The 3D scene */
  private readonly scene: THREE.Scene
  /** Planes clipping the gcode reflection to where the line of sight crosses the bed */
  private readonly mirrorBoundsPlanes: THREE.Plane[]
  /** Callback forcing a render on the next animation frame */
  private readonly requestRender: () => void

  /** Bed surface */
  private plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null
  /** Bed grid lines */
  private grid: THREE.GridHelper | null = null

  /**
   * @param settings - Plugin frontend settings
   * @param scene - The 3D scene
   * @param mirrorBoundsPlanes - Planes clipping the gcode reflection to the bed
   * @param requestRender - Callback forcing a render on the next animation frame
   */
  constructor (settings: Settings, scene: THREE.Scene, mirrorBoundsPlanes: THREE.Plane[], requestRender: () => void) {
    this.settings = settings
    this.scene = scene
    this.mirrorBoundsPlanes = mirrorBoundsPlanes
    this.requestRender = requestRender
  }

  /**
   * (Re)builds the bed
   * @param bedVolume - Print bed geometry
   */
  rebuild (bedVolume: BedVolume): void {
    const center = bedCenter(bedVolume)

    // Drop the previous bed
    if (this.plane) {
      this.scene.remove(this.plane)
      this.plane.geometry.dispose()
      this.plane.material.dispose()
    }
    if (this.grid) {
      this.scene.remove(this.grid)
      this.grid.dispose()
    }

    // Translucent bed surface
    const planeMaterial = new THREE.MeshBasicMaterial({ color: 0xc6c6c6, side: THREE.DoubleSide, transparent: true, opacity: 0.2 })
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(bedVolume.width, bedVolume.depth), planeMaterial)
    plane.position.set(center.x, center.y, -0.1) // The bed is just below the grid to avoid z-fighting
    this.scene.add(plane)
    this.plane = plane

    // Grid lines
    const grid = new THREE.GridHelper(bedVolume.width, bedVolume.width / 10, this.settings.darkMode ? DARK_GRID_CENTER : LIGHT_GRID_CENTER, 0xc1c1c1)
    grid.position.set(center.x, center.y, 0)
    grid.material.transparent = true
    grid.material.opacity = 0.6
    grid.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)) // Three.js creates the grid standing upright: rotate it to lie flat on the bed
    this.scene.add(grid)
    this.grid = grid

    // Apply the show bed setting
    this.applyVisibility(this.settings.showBed)
  }

  /**
   * Shows or hides the print bed
   * @param visible - True to show the bed
   */
  applyVisibility (visible: boolean): void {
    for (const object of [this.plane, this.grid]) {
      if (object) object.visible = visible
    }
    this.requestRender()
  }

  /**
   * Updates the bed for a new frame
   * @param camera - The active camera
   * @param renderer - The WebGL renderer
   * @param bedVolume - Print bed geometry
   */
  update (camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, renderer: THREE.WebGLRenderer, bedVolume: BedVolume): void {
    const mirrorShown = this.settings.showBed && this.settings.showMirror

    // Cull the bed mirror when viewing from below the bed
    renderer.clippingPlanes = (mirrorShown && camera.position.z < 0) ? BELOW_BED_CLIP_PLANES : NO_CLIP_PLANES

    // Refresh the planes clipping the bed reflection, when it is shown
    if (!mirrorShown) return

    const lowerleft = bedVolume.origin === 'lowerleft'
    const xMin = lowerleft ? 0 : -bedVolume.width / 2
    const xMax = lowerleft ? bedVolume.width : bedVolume.width / 2
    const yMin = lowerleft ? 0 : -bedVolume.depth / 2
    const yMax = lowerleft ? bedVolume.depth : bedVolume.depth / 2

    const corners = [
      new THREE.Vector3(xMin, yMin, 0),
      new THREE.Vector3(xMax, yMin, 0),
      new THREE.Vector3(xMax, yMax, 0),
      new THREE.Vector3(xMin, yMax, 0)
    ]
    const center = new THREE.Vector3((xMin + xMax) / 2, (yMin + yMax) / 2, 0)
    const cameraPosition = camera.position
    const viewDirection = camera.getWorldDirection(new THREE.Vector3())

    // Each plane contains one bed edge and the line of sight grazing it, so a reflected
    // point shows only where the view crosses the bed
    for (let i = 0; i < 4; i++) {
      const plane = this.mirrorBoundsPlanes[i]
      if (camera instanceof THREE.PerspectiveCamera) {
        // All sight lines meet at the camera: pass the plane through it and the edge
        plane.setFromCoplanarPoints(cameraPosition, corners[i], corners[(i + 1) % 4])
      } else {
        // Sight lines are parallel: pass the plane through the edge and a point one step behind it along the view direction
        plane.setFromCoplanarPoints(new THREE.Vector3().subVectors(corners[i], viewDirection), corners[i], corners[(i + 1) % 4])
      }
      // Orient the plane so the bed interior (and the reflection over it) is on the kept side
      if (plane.distanceToPoint(center) < 0) plane.negate()
    }
  }
}
