import * as THREE from '../three-exports'
import { ViewportGizmo } from 'three-viewport-gizmo'
import type { GizmoOptions } from 'three-viewport-gizmo'

/** Width and height of the cube, in px */
const CUBE_SIZE_PX = 80

/** Colors the cube is painted with */
interface CubeTheme {
  /** Color of the labelled faces */
  face: number
  /** Color of the face labels */
  label: number
  /** Color of the edges and corners framing the faces */
  frame: number
  /** Color a face, edge or corner takes under the pointer */
  hover: number
  /** Color of the face labels under the pointer */
  hoverLabel: number
}

/** Cube colors of the light and dark themes */
const CUBE_THEMES: Record<'light' | 'dark', CubeTheme> = {
  light: { face: 0xfafafa, label: 0x555555, frame: 0xcccccc, hover: 0x0088cc, hoverLabel: 0xffffff },
  dark: { face: 0x484848, label: 0xe3e3e3, frame: 0x2b2b2b, hover: 0x4db3ff, hoverLabel: 0x2b2b2b }
}

/** The cube showing the camera orientation, whose faces, edges and corners turn the camera to their view */
export class ViewCube {
  /** Element the cube is drawn in */
  private readonly container: HTMLElement
  /** The cube widget */
  private readonly gizmo: ViewportGizmo
  /** Whether the running interaction picked a view instead of dragging the cube around */
  private viewPicked = false

  /* ---- Setup ---- */

  /**
   * @param camera - The active camera
   * @param renderer - Renderer drawing the 3D view
   * @param darkMode - True for the dark theme
   * @param onCameraTurned - Callback handed the direction the cube turned the camera to
   * @param requestRender - Callback forcing a render on the next animation frame
   */
  constructor (camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, renderer: THREE.WebGLRenderer, darkMode: boolean, onCameraTurned: (direction: THREE.Vector3) => void, requestRender: () => void) {
    const container = document.getElementById('pg-view-cube')!
    container.style.width = `${CUBE_SIZE_PX}px`
    container.style.height = `${CUBE_SIZE_PX}px`
    this.container = container

    this.gizmo = new ViewportGizmo(camera, renderer, this.themedOptions(darkMode))

    // A pick reports itself while the cube is already turning, a drag before it starts
    this.gizmo.addEventListener('start', () => { this.viewPicked = this.gizmo.animating })

    this.gizmo.addEventListener('change', () => {
      onCameraTurned(this.turnedDirection())
      requestRender()
    })

    // Redraw the highlight the cube paints under the pointer
    container.addEventListener('pointermove', requestRender)
    container.addEventListener('pointerleave', requestRender)

    // Put the cube back in place when its container is shown again
    new ResizeObserver(() => this.gizmo.update()).observe(container)
  }

  /**
   * Builds the cube options in the given theme
   * @param darkMode - True for the dark theme
   * @returns Every option the cube widget is built from, in that theme
   */
  private themedOptions (darkMode: boolean): GizmoOptions {
    const theme = CUBE_THEMES[darkMode ? 'dark' : 'light']
    const face = { color: theme.face, labelColor: theme.label, hover: { color: theme.hover, labelColor: theme.hoverLabel } }
    const frame = { color: theme.frame, hover: { color: theme.hover } }

    return {
      container: this.container,
      type: 'rounded-cube',
      size: CUBE_SIZE_PX,
      placement: 'top-left',
      offset: { top: 0, right: 0, bottom: 0, left: 0 },
      corners: frame,
      edges: frame,
      x: face,
      y: face,
      z: face,
      nx: face,
      ny: face,
      nz: face
    }
  }

  /**
   * Repaints the cube in the light or dark theme
   * @param darkMode - True for the dark theme
   */
  applyTheme (darkMode: boolean): void {
    this.gizmo.set(this.themedOptions(darkMode))
  }

  /**
   * Shows or hides the cube
   * @param visible - True to show the cube
   */
  applyVisibility (visible: boolean): void {
    this.gizmo.visible = visible
    if (visible) this.gizmo.update()
  }

  /**
   * (Re)attaches the cube to the given camera and renderer, at its current place in the view
   * @param camera - The active camera
   * @param renderer - Renderer drawing the 3D view
   */
  attachTo (camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, renderer: THREE.WebGLRenderer): void {
    this.gizmo.camera = camera
    this.gizmo.renderer = renderer
    this.gizmo.update()
  }

  /**
   * Gets where the cube turned the camera
   * @returns The unit vector from the camera target to the camera, laid on the exact direction of a picked face, edge or corner
   */
  private turnedDirection (): THREE.Vector3 {
    const direction = new THREE.Vector3().subVectors(this.gizmo.camera.position, this.gizmo.target).normalize()

    // Faces, edges and corners all lie on the directions whose components are -1, 0 or 1
    return this.viewPicked ? direction.round().normalize() : direction
  }

  /* ---- Render loop ---- */

  /** Whether the cube is turning the camera to a picked view */
  get animating (): boolean {
    return this.gizmo.animating
  }

  /**
   * Draws the cube, turned to match the current camera
   * @param target - Point the camera turns around
   */
  render (target: THREE.Vector3): void {
    this.gizmo.target.copy(target)
    this.gizmo.cameraUpdate()
    this.gizmo.render()
  }
}
