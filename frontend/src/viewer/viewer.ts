import * as THREE from '../three-exports'
import { Vector2 } from 'three'
import { Bed } from './bed'
import { Camera } from './camera'
import { Nozzle } from './nozzle'
import type { BedVolume } from './bed'
import type { NavigationModeKey, ProjectionMode, ViewAngle } from './navigation'
import type { Settings } from '../settings'

/** Light theme background color */
const LIGHT_BACKGROUND = 0xd0d0d0
/** Dark theme background color */
const DARK_BACKGROUND = 0x000000

/** Per-frame print view outcome: whether the scene changed and the nozzle position to show */
export interface PrintViewUpdate {
  needRender: boolean
  nozzlePosition: THREE.Vector3 | null
}

/** The plugin's 3D view: renders the bed, the gcode model and the nozzle */
export class Viewer {
  /** Plugin frontend settings */
  private readonly settings: Settings

  /** WebGL renderer */
  private renderer!: THREE.WebGLRenderer
  /** Whether to render the next frame regardless of changes */
  private forceRender = true
  /** Timer measuring frame deltas */
  private timer!: THREE.Timer

  /** The 3D scene */
  readonly scene = new THREE.Scene()

  /** Callback advancing the print view each frame */
  private readonly onFrame: (deltaSeconds: number) => PrintViewUpdate

  /** The camera */
  private camera!: Camera

  /** The print bed */
  private readonly bed: Bed
  /** The nozzle model */
  private readonly nozzle: Nozzle

  /** Light under the bed */
  private underBedLight!: THREE.PointLight
  /** Light following the camera */
  private cameraLight!: THREE.PointLight

  /** Getter of the current print bed geometry */
  private readonly getBedVolume: () => BedVolume

  /** Planes clipping the gcode reflection to where the line of sight crosses the bed */
  readonly mirrorBoundsPlanes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane(), new THREE.Plane()]

  /* ---- Setup ---- */

  /**
   * @param settings - Plugin frontend settings
   * @param getBedVolume - Getter of the current print bed geometry
   * @param onFrame - Callback advancing the print view each frame, run before rendering
   */
  constructor (settings: Settings, getBedVolume: () => BedVolume, onFrame: (deltaSeconds: number) => PrintViewUpdate) {
    this.settings = settings
    this.getBedVolume = getBedVolume
    this.onFrame = onFrame
    this.bed = new Bed(settings, this.scene, this.mirrorBoundsPlanes, () => this.requestRender())
    this.nozzle = new Nozzle(settings, this.scene, () => this.requestRender())
  }

  /** Sets up the 3D view and starts its render loop */
  init () {
    const settings = this.settings
    const bedVolume = this.getBedVolume()
    const canvas = document.getElementById('pg-canvas') as HTMLCanvasElement

    // Renderer
    THREE.ColorManagement.enabled = false
    this.createRenderer(canvas, settings.antialias)

    // Camera
    this.camera = new Camera(settings, canvas, bedVolume, () => this.requestRender())

    // Background
    this.applyBackground(settings.darkMode)

    // Bed (grid)
    this.updateBedMesh()

    // Nozzle model
    this.nozzle.load()

    // Under bed light
    this.underBedLight = new THREE.PointLight(0xffffff)
    this.underBedLight.decay = 0
    this.underBedLight.position.set(0, 0, -bedVolume.height)
    this.scene.add(this.underBedLight)

    // Camera light
    this.cameraLight = new THREE.PointLight(0xffffff)
    this.cameraLight.decay = 0
    this.cameraLight.position.copy(this.camera.active.position)
    this.scene.add(this.cameraLight)

    this.timer = new THREE.Timer()
    this.animate()
  }

  /**
   * Creates the WebGL renderer bound to a canvas
   * @param canvas - Canvas to render into
   * @param antialias - True to enable antialiasing
   */
  private createRenderer (canvas: HTMLCanvasElement, antialias: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias, logarithmicDepthBuffer: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.localClippingEnabled = true // Needed for the gcode reflection on the bed surface
  }

  /* ---- Render loop ---- */

  /** Renders a frame when needed and schedules the next one */
  private animate () {
    this.timer.update()
    const deltaSeconds = this.timer.getDelta()

    let needRender = this.forceRender
    this.forceRender = false

    // Skip animation if canvas size is 0 (e.g. plugin tab is not shown)
    const canvas = this.renderer.domElement
    if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
      // Schedule the next frame and return
      requestAnimationFrame(() => this.animate())
      return
    }

    // Update and get the print view
    const printView = this.onFrame(deltaSeconds)
    if (printView.needRender) needRender = true

    // Update the nozzle
    if (this.nozzle.update(printView.nozzlePosition, this.renderer, needRender)) needRender = true

    // Update the camera
    if (this.camera.update(deltaSeconds)) needRender = true

    // Light follows the camera
    this.cameraLight.position.copy(this.camera.active.position)

    // Match the canvas to its display size, re-rendering if it changed
    if (this.resizeCanvasToDisplaySize()) needRender = true

    // Update the bed
    if (needRender) this.bed.update(this.camera.active, this.renderer, this.getBedVolume())

    // Render only when something changed this frame
    if (needRender) this.renderer.render(this.scene, this.camera.active)

    // Schedule the next frame
    requestAnimationFrame(() => this.animate())
  }

  /** Forces a render on the next animation frame */
  requestRender () {
    this.forceRender = true
  }

  /**
   * Matches the rendering size to the canvas display size
   * @returns True if the size changed
   */
  private resizeCanvasToDisplaySize () {
    // Get new canvas size
    const canvas = this.renderer.domElement
    const width = canvas.clientWidth
    const height = canvas.clientHeight

    // Skip if already at the display size
    const current = this.renderer.getSize(new Vector2())
    if (current.width === width && current.height === height) return false

    // Resize canvas
    this.renderer.setSize(width, height, false)

    // Refit the cameras to the new size
    this.camera.setSize(width, height)

    return true
  }

  /* ---- Scene and camera ---- */

  /** (Re)builds the bed and adapts the camera to the current bed geometry */
  updateBedMesh () {
    if (!this.camera) return

    const bedVolume = this.getBedVolume()
    this.bed.rebuild(bedVolume)
    this.camera.applyBedVolume(bedVolume)
  }

  /**
   * Shows or hides the print bed
   * @param visible - True to show the bed
   */
  applyBedVisibility (visible: boolean) {
    this.bed.applyVisibility(visible)
  }

  /**
   * Points the camera back at the bed center
   * @param enableTransition - True to animate the move
   */
  resetCameraTarget (enableTransition = false) {
    if (!this.camera) return
    this.camera.resetTarget(this.getBedVolume(), enableTransition)
  }

  /**
   * Moves the camera to the default view
   * @param enableTransition - True to animate the move
   * @param footprint - Print footprint to frame, the whole bed when omitted
   */
  applyDefaultView (enableTransition = false, footprint?: number) {
    this.camera.applyDefaultView(this.getBedVolume(), enableTransition, footprint)
  }

  /**
   * Rotates the camera to a named view angle
   * @param view - View angle to rotate to
   * @param enableTransition - True to animate the move
   */
  applyViewAngle (view: ViewAngle, enableTransition = false) {
    this.camera.applyViewAngle(view, enableTransition)
  }

  /**
   * Adjusts the camera to show the given bounds
   * @param bounds - Box to frame, in scene coordinates
   */
  frameBounds (bounds: THREE.Box3) {
    this.camera.frameBounds(bounds, this.getBedVolume())
  }

  /* ---- Apply settings ---- */

  /**
   * Applies the light or dark background to the scene
   * @param darkMode - True for the dark background
   */
  applyBackground (darkMode: boolean) {
    this.scene.background = new THREE.Color(darkMode ? DARK_BACKGROUND : LIGHT_BACKGROUND)
    this.requestRender()
  }

  /**
   * Switches the mouse mappings to the given navigation mode
   * @param mode - NAVIGATION_MODES key
   */
  applyNavigationMode (mode: NavigationModeKey) {
    this.camera.applyNavigationMode(mode)
  }

  /**
   * Switches the 3D view to the given camera projection
   * @param mode - Camera projection to use
   */
  applyProjectionMode (mode: ProjectionMode) {
    this.camera.applyProjectionMode(mode)
  }

  /**
   * Turns renderer antialiasing on or off
   * @param antialias - True to enable antialiasing
   */
  applyAntialias (antialias: boolean) {
    // Antialias is a fixed WebGL context attribute, so toggling it means recreating the
    // context. A context stays bound to its canvas, so swap in a fresh canvas too.
    const oldCanvas = this.renderer.domElement
    const canvas = oldCanvas.cloneNode(false) as HTMLCanvasElement

    oldCanvas.replaceWith(canvas)

    this.renderer.dispose()
    this.createRenderer(canvas, antialias)
    this.camera.setCanvas(canvas)

    this.requestRender()
  }
}
