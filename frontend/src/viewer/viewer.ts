import * as THREE from '../three-exports'
import { Bed } from './bed'
import { Camera } from './camera'
import { Nozzle } from './nozzle'
import type { GcodeBounds, ScenePoint } from '../gcode/parsing/parsed-gcode'
import type { BedVolume } from './bed'
import type { ProjectionMode } from './camera'
import type { NavigationModeKey } from './navigation'
import type { Settings } from '../settings'

/** Light theme background color */
const LIGHT_BACKGROUND = 0xe9e9e9
/** Dark theme background color */
const DARK_BACKGROUND = 0x000000

/** Per-frame print progress outcome */
export interface PrintProgressUpdate {
  /** Whether the scene changed and has to be drawn again */
  needRender: boolean
  /** Nozzle position to show, null to move the nozzle back to the origin */
  nozzlePosition: ScenePoint | null
}

/** The plugin's 3D view: renders the bed, the gcode model and the nozzle */
export class Viewer {
  /** Plugin frontend settings */
  private readonly settings: Settings

  /** WebGL renderer */
  private renderer!: THREE.WebGLRenderer
  /** Whether the renderer draws with antialiasing */
  private antialias!: boolean
  /** Whether to render the next frame regardless of changes */
  private forceRender = true
  /** Whether the next frame is already scheduled */
  private frameScheduled = false
  /** Timer measuring frame deltas */
  private timer!: THREE.Timer

  /** Width the canvas is displayed at, in px */
  private canvasWidth = 0
  /** Height the canvas is displayed at, in px */
  private canvasHeight = 0
  /** Watcher of the canvas display size */
  private readonly canvasSizeObserver = new ResizeObserver(([{ target }]) => {
    // Track the displayed canvas size
    this.canvasWidth = target.clientWidth
    this.canvasHeight = target.clientHeight

    // Redraw at the new size
    this.requestRender()
    this.timer.reset()
    this.scheduleFrame()
  })

  /** The 3D scene */
  private readonly scene = new THREE.Scene()

  /** Callback advancing the print progress each frame */
  private readonly onFrame: (deltaSeconds: number) => PrintProgressUpdate

  /** The camera */
  private camera!: Camera

  /** The print bed */
  private readonly bed: Bed
  /** The nozzle marker */
  private readonly nozzle: Nozzle

  /** Light under the bed */
  private underBedLight!: THREE.PointLight
  /** Light following the camera */
  private cameraLight!: THREE.PointLight

  /** Getter of the current print bed geometry */
  private readonly getBedVolume: () => BedVolume
  /** Getter of the current nozzle diameter in mm */
  private readonly getNozzleDiameter: () => number

  /** Planes clipping the gcode reflection to where the line of sight crosses the bed */
  readonly mirrorBoundsPlanes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane(), new THREE.Plane()]

  /* ---- Setup ---- */

  /**
   * @param settings - Plugin frontend settings
   * @param getBedVolume - Getter of the current print bed geometry
   * @param getNozzleDiameter - Getter of the current nozzle diameter in mm
   * @param onFrame - Callback advancing the print progress each frame, run before rendering
   */
  constructor (settings: Settings, getBedVolume: () => BedVolume, getNozzleDiameter: () => number, onFrame: (deltaSeconds: number) => PrintProgressUpdate) {
    this.settings = settings
    this.getBedVolume = getBedVolume
    this.getNozzleDiameter = getNozzleDiameter
    this.onFrame = onFrame
    this.bed = new Bed(settings, this.scene, this.mirrorBoundsPlanes, () => this.requestRender())
    this.nozzle = new Nozzle(settings, this.scene, () => this.requestRender())
  }

  /** Sets up the 3D view and starts its render loop */
  init (): void {
    const settings = this.settings
    const bedVolume = this.getBedVolume()
    const canvas = document.getElementById('pg-canvas') as HTMLCanvasElement

    // Renderer
    this.scene.matrixWorldAutoUpdate = false
    this.createRenderer(canvas, settings.antialias)

    // Camera
    this.camera = new Camera(settings, this.renderer, bedVolume, () => this.requestRender())

    // Bed (grid)
    this.rebuildBed()

    // Nozzle marker
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
    this.timer.connect(document)

    this.scheduleFrame()
  }

  /**
   * Creates the WebGL renderer bound to a canvas
   * @param canvas - Canvas to render into
   * @param antialias - True to enable antialiasing
   */
  private createRenderer (canvas: HTMLCanvasElement, antialias: boolean): void {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias, logarithmicDepthBuffer: true })
    this.antialias = antialias
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.localClippingEnabled = true // Needed for the gcode reflection on the bed surface

    this.canvasSizeObserver.disconnect()
    this.canvasSizeObserver.observe(canvas)
  }

  /* ---- Render loop ---- */

  /** Schedules the next frame */
  private scheduleFrame (): void {
    if (this.frameScheduled) return

    this.frameScheduled = true
    requestAnimationFrame(() => this.animate())
  }

  /** Renders a frame when needed and schedules the next one */
  private animate (): void {
    this.frameScheduled = false

    // Skip animation if canvas size is 0 (e.g. plugin tab is not shown)
    if (this.canvasWidth === 0 || this.canvasHeight === 0) return

    this.timer.update()
    const deltaSeconds = this.timer.getDelta()

    let needRender = this.forceRender
    this.forceRender = false

    // Update and get the print progress
    const printProgress = this.onFrame(deltaSeconds)
    if (printProgress.needRender) needRender = true

    // Update the nozzle
    if (this.nozzle.update(printProgress.nozzlePosition, this.getNozzleDiameter(), this.renderer, needRender)) needRender = true

    // Update the camera
    if (this.camera.update(deltaSeconds)) needRender = true

    // Light follows the camera
    this.cameraLight.position.copy(this.camera.active.position)

    // Match the canvas to its display size, re-rendering if it changed
    if (this.resizeCanvasToDisplaySize()) needRender = true

    // Update the bed
    if (needRender) this.bed.update(this.camera.active, this.renderer, this.getBedVolume())

    // Render only when something changed this frame
    if (needRender) {
      this.scene.updateMatrixWorld()
      this.renderer.render(this.scene, this.camera.active)
      this.camera.renderViewCube()
    }

    // Schedule the next frame
    this.scheduleFrame()
  }

  /** Forces a render on the next animation frame */
  requestRender (): void {
    this.forceRender = true
  }

  /**
   * Matches the rendering size to the canvas display size
   * @returns True if the size changed
   */
  private resizeCanvasToDisplaySize (): boolean {
    // Get new canvas size
    const width = this.canvasWidth
    const height = this.canvasHeight

    // Skip if already at the display size
    const current = this.renderer.getSize(new THREE.Vector2())
    if (current.width === width && current.height === height) return false

    // Resize canvas
    this.renderer.setSize(width, height, false)

    // Refit the cameras to the new size
    this.camera.setSize(width, height)

    return true
  }

  /* ---- Scene and camera ---- */

  /**
   * Adds an object to the 3D scene
   * @param object - Object to add
   */
  add (object: THREE.Object3D): void {
    this.scene.add(object)
  }

  /** (Re)builds the bed and adapts the camera to the current bed geometry */
  rebuildBed (): void {
    if (!this.camera) return

    const bedVolume = this.getBedVolume()
    this.bed.rebuild(bedVolume)
    this.camera.applyBedVolume(bedVolume)
  }

  /**
   * Points the camera back at what it frames
   * @param enableTransition - True to animate the move
   */
  resetCameraTarget (enableTransition = false): void {
    if (!this.camera) return
    this.camera.resetTarget(this.getBedVolume(), enableTransition)
  }

  /**
   * Moves the camera to the default view
   * @param enableTransition - True to animate the move
   */
  applyDefaultCameraView (enableTransition = false): void {
    this.camera.applyDefaultView(this.getBedVolume(), enableTransition)
  }

  /**
   * Updates the camera limits to the loaded gcode bounds
   * @param bounds - Gcode bounding box, in scene coordinates
   */
  applyGcodeBounds (bounds: GcodeBounds): void {
    this.camera.applyGcodeBounds(bounds, this.getBedVolume())
  }

  /* ---- Apply settings ---- */

  /**
   * Shows or hides the print bed
   * @param visible - True to show the bed
   */
  applyBedVisibility (visible: boolean): void {
    this.bed.applyVisibility(visible)
  }

  /**
   * Repaints the 3D view in the light or dark theme
   * @param darkMode - True for the dark theme
   */
  applyTheme (darkMode: boolean): void {
    this.scene.background = new THREE.Color(darkMode ? DARK_BACKGROUND : LIGHT_BACKGROUND)
    this.camera.applyViewCubeTheme(darkMode)
    this.rebuildBed()
    this.requestRender()
  }

  /**
   * Shows or hides the view cube
   * @param visible - True to show the view cube
   */
  applyViewCubeVisibility (visible: boolean): void {
    this.camera.applyViewCubeVisibility(visible)
    this.requestRender()
  }

  /**
   * Switches the mouse mappings to the given navigation mode
   * @param mode - NAVIGATION_MODES key
   */
  applyNavigationMode (mode: NavigationModeKey): void {
    this.camera.applyNavigationMode(mode)
  }

  /**
   * Switches the 3D view to the given camera projection
   * @param mode - Camera projection to use
   */
  applyProjectionMode (mode: ProjectionMode): void {
    this.camera.applyProjectionMode(mode)
  }

  /**
   * Turns renderer antialiasing on or off
   * @param antialias - True to enable antialiasing
   */
  applyAntialias (antialias: boolean): void {
    if (antialias === this.antialias) return

    // Antialias is a fixed WebGL context attribute, so toggling it means recreating the
    // context. A context stays bound to its canvas, so swap in a fresh canvas too.
    const oldCanvas = this.renderer.domElement
    const canvas = oldCanvas.cloneNode(false) as HTMLCanvasElement

    oldCanvas.replaceWith(canvas)

    // Drop the old renderer and free the GPU memory dispose leaves allocated
    this.renderer.dispose()
    this.renderer.forceContextLoss()

    this.createRenderer(canvas, antialias)
    this.camera.setRenderer(this.renderer)

    this.requestRender()
  }
}
