import * as THREE from '../three-exports'
import type { Settings } from '../settings'

/** Light theme bed grid center-line color */
const LIGHT_GRID_CENTER = 0x000000
/** Dark theme bed grid center-line color */
const DARK_GRID_CENTER = 0xffffff

/** Spacing of the bed grid lines */
const GRID_SPACING_MM = 10

/** Planes clipping the gcode reflection when the camera is below the bed */
const BELOW_BED_CLIP_PLANES = [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)]
/** Empty plane set, to disable clipping */
const NO_CLIP_PLANES: THREE.Plane[] = []

/** Straight segments the edge of a circular bed is drawn with */
const CIRCULAR_BED_SEGMENTS = 128

/** Stencil buffer marking the bed surface */
export const BED_STENCIL_REF = 1
/** Material marking in the bed stencil buffer */
const stencilMaterial = new THREE.MeshBasicMaterial({
  colorWrite: false,
  depthWrite: false,
  stencilWrite: true,
  stencilRef: BED_STENCIL_REF,
  stencilZPass: THREE.ReplaceStencilOp
})

/** Print bed geometry */
export interface BedVolume {
  /** Bed depth in mm */
  depth: number
  /** Bed shape, "rectangular" or "circular" */
  formFactor: string
  /** Printable height in mm */
  height: number
  /** Point the bed coordinates start from, "lowerleft" or "center" */
  origin: string
  /** Bed width in mm */
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
  /** Callback forcing a render on the next animation frame */
  private readonly requestRender: () => void

  /** Bed surface */
  private plane: THREE.Mesh<THREE.PlaneGeometry | THREE.CircleGeometry, THREE.MeshBasicMaterial> | null = null
  /** Bed grid lines */
  private grid: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null

  /**
   * @param settings - Plugin frontend settings
   * @param scene - The 3D scene
   * @param requestRender - Callback forcing a render on the next animation frame
   */
  constructor (settings: Settings, scene: THREE.Scene, requestRender: () => void) {
    this.settings = settings
    this.scene = scene
    this.requestRender = requestRender
  }

  /**
   * (Re)builds the bed
   * @param bedVolume - Print bed geometry
   */
  rebuild (bedVolume: BedVolume): void {
    const center = bedCenter(bedVolume)
    const circular = bedVolume.formFactor === 'circular'
    const halfWidth = bedVolume.width / 2
    const halfDepth = bedVolume.depth / 2

    // Drop the previous bed
    for (const object of [this.plane, this.grid]) {
      if (!object) continue
      this.scene.remove(object)
      object.geometry.dispose()
      object.material.dispose()
    }

    // Translucent bed surface
    const planeGeometry = circular ? new THREE.CircleGeometry(halfWidth, CIRCULAR_BED_SEGMENTS) : new THREE.PlaneGeometry(bedVolume.width, bedVolume.depth)
    const planeMaterial = new THREE.MeshBasicMaterial({ color: 0xc6c6c6, side: THREE.DoubleSide, transparent: true, opacity: 0.2 })
    const plane = new THREE.Mesh(planeGeometry, planeMaterial)
    plane.position.set(center.x, center.y, -0.1) // The bed is just below the grid to avoid z-fighting
    this.scene.add(plane)
    this.plane = plane

    // Mark the bed surface with a stencil, for the gcode reflection
    const stencilMask = new THREE.Mesh(planeGeometry, stencilMaterial)
    stencilMask.renderOrder = -1 // The mark has to be there before the gcode reflection is drawn
    plane.add(stencilMask)

    /**
     * Lists the offsets from the bed center where grid lines run along an axis
     * @param half - Half the bed size along that axis
     * @returns The offsets, one per line, the two straight edges included
     */
    const gridLineOffsets = (half: number): number[] => {
      const offsets = [0]
      for (let offset = GRID_SPACING_MM; offset < half; offset += GRID_SPACING_MM) offsets.push(offset, -offset)
      if (!circular) offsets.push(half, -half)
      return offsets
    }

    /**
     * Computes how far a grid line reaches from the bed center line it crosses
     * @param offset - Offset of the grid line from the bed center
     * @param half - Half the bed size along the grid line
     * @returns Half the grid line length
     */
    const gridLineReach = (offset: number, half: number): number => circular ? Math.sqrt(half ** 2 - offset ** 2) : half

    // Grid lines
    const centerColor = new THREE.Color(this.settings.darkMode ? DARK_GRID_CENTER : LIGHT_GRID_CENTER)
    const lineColor = new THREE.Color(0xc1c1c1)
    const gridPositions: number[] = []
    const gridColors: number[] = []
    for (const offset of gridLineOffsets(halfWidth)) {
      const color = offset === 0 ? centerColor : lineColor
      const reach = gridLineReach(offset, halfDepth)
      gridPositions.push(offset, -reach, 0, offset, reach, 0)
      gridColors.push(color.r, color.g, color.b, color.r, color.g, color.b)
    }
    for (const offset of gridLineOffsets(halfDepth)) {
      const color = offset === 0 ? centerColor : lineColor
      const reach = gridLineReach(offset, halfWidth)
      gridPositions.push(-reach, offset, 0, reach, offset, 0)
      gridColors.push(color.r, color.g, color.b, color.r, color.g, color.b)
    }

    // Round edge of a circular bed
    if (circular) {
      for (let i = 0; i < CIRCULAR_BED_SEGMENTS; i++) {
        const from = i / CIRCULAR_BED_SEGMENTS * 2 * Math.PI
        const to = (i + 1) / CIRCULAR_BED_SEGMENTS * 2 * Math.PI
        gridPositions.push(halfWidth * Math.cos(from), halfWidth * Math.sin(from), 0, halfWidth * Math.cos(to), halfWidth * Math.sin(to), 0)
        gridColors.push(lineColor.r, lineColor.g, lineColor.b, lineColor.r, lineColor.g, lineColor.b)
      }
    }

    const gridGeometry = new THREE.BufferGeometry()
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3))
    gridGeometry.setAttribute('color', new THREE.Float32BufferAttribute(gridColors, 3))
    const grid = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6 }))
    grid.position.set(center.x, center.y, 0)
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
   */
  update (camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, renderer: THREE.WebGLRenderer): void {
    const mirrorShown = this.settings.showBed && this.settings.showMirror

    // Cull the bed mirror when viewing from below the bed
    renderer.clippingPlanes = (mirrorShown && camera.position.z < 0) ? BELOW_BED_CLIP_PLANES : NO_CLIP_PLANES
  }
}
