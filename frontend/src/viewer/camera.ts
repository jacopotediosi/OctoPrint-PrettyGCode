import * as THREE from '../three-exports'
import CameraControls from 'camera-controls'
import { Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster } from 'three'
import { bedCenter } from './bed'
import { NAVIGATION_MODES, VIEW_ANGLES } from './navigation'
import type { BedVolume } from './bed'
import type { MouseBinding, MouseButton, NavigationMode, NavigationModeKey, ProjectionMode, ViewAngle } from './navigation'
import type { Settings } from '../settings'

/**
 * Subset of three.js required by camera-controls.
 * Copied from camera-controls/readme.md's `subsetOfTHREE` to keep three.js tree-shakeable
 */
const CAMERA_CONTROLS_THREE = { Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster }

/** Seconds the camera must sit idle before it starts auto-orbiting */
const ORBIT_IDLE_DELAY_SECONDS = 5

/** Zoom-out limit, in multiples of the largest bed or gcode dimension */
const MAX_ZOOM_OUT_FACTOR = 5

/** Slowest zoom speed */
const MIN_ZOOM_SPEED = 0.5

/** Polar angle of the default view, in radians from vertical */
const DEFAULT_VIEW_POLAR_ANGLE = Math.PI / 4

/** Height framed by the orthographic camera at zoom 1 */
const ORTHOGRAPHIC_VIEW_HEIGHT_MM = 100

/** The camera of the 3D view */
export class Camera {
  /** Plugin frontend settings */
  private readonly settings: Settings
  /** Callback forcing a render on the next animation frame */
  private readonly requestRender: () => void

  /** Perspective camera */
  private readonly perspectiveCamera: THREE.PerspectiveCamera
  /** Orthographic camera */
  private readonly orthographicCamera: THREE.OrthographicCamera
  /** The active camera */
  private activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  /** Camera controls */
  private readonly controls: CameraControls
  /** Seconds the camera has sat idle */
  private idleTime = 0
  /** Bounds of the displayed gcode */
  private readonly gcodeBounds = new THREE.Box3()

  /** The active navigation mode */
  private navigationMode: NavigationMode = NAVIGATION_MODES.prusaslicer
  /** Modifier key currently held down */
  private navigationModifier: 'shift' | 'ctrl' | null = null

  /* ---- Setup ---- */

  /**
   * @param settings - Plugin frontend settings
   * @param canvas - Canvas the camera controls listen on
   * @param bedVolume - Print bed geometry
   * @param requestRender - Callback forcing a render on the next animation frame
   */
  constructor (settings: Settings, canvas: HTMLCanvasElement, bedVolume: BedVolume, requestRender: () => void) {
    this.settings = settings
    this.requestRender = requestRender

    // Cameras
    this.perspectiveCamera = new THREE.PerspectiveCamera(70, 2, 1, 5000)
    this.orthographicCamera = new THREE.OrthographicCamera(-ORTHOGRAPHIC_VIEW_HEIGHT_MM, ORTHOGRAPHIC_VIEW_HEIGHT_MM, ORTHOGRAPHIC_VIEW_HEIGHT_MM / 2, -ORTHOGRAPHIC_VIEW_HEIGHT_MM / 2, 1, 5000)
    this.activeCamera = settings.projectionMode === 'orthographic' ? this.orthographicCamera : this.perspectiveCamera
    for (const camera of [this.perspectiveCamera, this.orthographicCamera]) {
      camera.up.set(0, 0, 1)
      camera.position.set(bedVolume.width, 0, 50)
    }

    // Controls
    CameraControls.install({ THREE: CAMERA_CONTROLS_THREE })
    this.controls = new CameraControls(this.activeCamera, canvas)
    this.controls.dollyToCursor = true
    this.controls.infinityDolly = true
    this.controls.minDistance = 10
    this.applyNavigationMode(settings.navigationMode)
    this.applyDefaultView(bedVolume)

    // Watch navigation modifiers
    window.addEventListener('keydown', (event) => this.updateNavigationModifier(event))
    window.addEventListener('keyup', (event) => this.updateNavigationModifier(event))
    window.addEventListener('blur', () => this.updateNavigationModifier(null))
  }

  /** The active camera */
  get active () {
    return this.activeCamera
  }

  /**
   * Switches the camera to the given canvas
   * @param canvas - Canvas to listen on
   */
  setCanvas (canvas: HTMLCanvasElement) {
    this.controls.disconnect()
    this.controls.connect(canvas)
  }

  /* ---- Render loop ---- */

  /**
   * Updates the camera for a new frame
   * @param deltaSeconds - Seconds elapsed since the previous frame
   * @returns True if the camera moved
   */
  update (deltaSeconds: number) {
    // Cap any pending dolly at the zoom-out limit
    if (this.activeCamera === this.perspectiveCamera && this.controls.getSpherical(new Spherical()).radius > this.controls.maxDistance) {
      this.controls.dollyTo(this.controls.maxDistance, true)
    }

    // Slow the zoom near the gcode
    if (this.activeCamera === this.perspectiveCamera && !this.gcodeBounds.isEmpty()) {
      const position = this.controls.getPosition(new Vector3())
      const size = this.gcodeBounds.getSize(new Vector3())
      const gcodeSpan = Math.max(1, size.x, size.y, size.z)
      const gcodeDistance = this.gcodeBounds.distanceToPoint(position)
      this.controls.dollySpeed = MIN_ZOOM_SPEED + (1 - MIN_ZOOM_SPEED) * Math.min(1, gcodeDistance / gcodeSpan)
    }

    // Auto-orbit once the camera has sat idle a while
    let moved = this.controls.update(deltaSeconds)
    if (moved) {
      this.idleTime = 0
    } else {
      this.idleTime += deltaSeconds
      if (this.settings.orbitWhenIdle && this.idleTime > ORBIT_IDLE_DELAY_SECONDS) {
        this.controls.rotate(deltaSeconds / 5.0, 0, false)
        this.controls.update(deltaSeconds)
        moved = true
      }
    }

    return moved
  }

  /**
   * (Re)fits the cameras to the canvas size
   * @param width - Canvas width in px
   * @param height - Canvas height in px
   */
  setSize (width: number, height: number) {
    const aspect = width / height
    this.perspectiveCamera.aspect = aspect
    this.perspectiveCamera.updateProjectionMatrix()
    this.orthographicCamera.left = -ORTHOGRAPHIC_VIEW_HEIGHT_MM * aspect / 2
    this.orthographicCamera.right = ORTHOGRAPHIC_VIEW_HEIGHT_MM * aspect / 2
    this.orthographicCamera.updateProjectionMatrix()
    this.controls.setViewport(0, 0, width, height)
  }

  /* ---- Views ---- */

  /**
   * Adapts the camera to the given bed geometry
   * @param bedVolume - Print bed geometry
   */
  applyBedVolume (bedVolume: BedVolume) {
    const gcodeSize = this.gcodeBounds.getSize(new Vector3())
    const maxSceneDimension = Math.max(100, bedVolume.width, bedVolume.depth, bedVolume.height, gcodeSize.x, gcodeSize.y, gcodeSize.z)
    const center = bedCenter(bedVolume)

    // Cap the zoom-out
    this.controls.maxDistance = MAX_ZOOM_OUT_FACTOR * maxSceneDimension
    this.controls.minZoom = this.toOrthographicZoom(this.controls.maxDistance)
    this.controls.setBoundary(new Box3(
      new Vector3(center.x - 2 * maxSceneDimension, center.y - 2 * maxSceneDimension, -2 * maxSceneDimension),
      new Vector3(center.x + 2 * maxSceneDimension, center.y + 2 * maxSceneDimension, 2 * maxSceneDimension)
    ))

    // Cameras only render between their near and far planes: put the far planes
    // past the zoom-out limit so the scene never gets clipped while zooming out
    const far = this.controls.maxDistance * 1.2
    this.perspectiveCamera.far = far
    this.perspectiveCamera.updateProjectionMatrix()

    // The orthographic camera zooms by scaling the view without moving, so the scene
    // can extend behind it: a negative near plane keeps that part visible too
    this.orthographicCamera.near = -far
    this.orthographicCamera.far = far
    this.orthographicCamera.updateProjectionMatrix()
  }

  /**
   * Points the camera back at the bed center
   * @param bedVolume - Print bed geometry
   * @param enableTransition - True to animate the move
   */
  resetTarget (bedVolume: BedVolume, enableTransition = false) {
    const center = bedCenter(bedVolume)
    this.controls.setTarget(center.x, center.y, 0, enableTransition)
  }

  /**
   * Moves the camera to the default view
   * @param bedVolume - Print bed geometry
   * @param enableTransition - True to animate the move
   */
  applyDefaultView (bedVolume: BedVolume, enableTransition = false) {
    // Re-center on the bed first
    this.resetTarget(bedVolume, enableTransition)

    // Return to the elevated front view
    this.controls.normalizeRotations()
    this.controls.rotateTo(0, DEFAULT_VIEW_POLAR_ANGLE, enableTransition)

    // Pull back to fit the whole bed, with a floor for tiny beds
    const distance = Math.max(40, bedVolume.width, bedVolume.depth)
    if (this.activeCamera === this.perspectiveCamera) this.controls.dollyTo(distance, enableTransition)
    else this.controls.zoomTo(this.toOrthographicZoom(distance), enableTransition)
  }

  /**
   * Rotates the camera to a named view angle
   * @param view - View angle to rotate to
   * @param enableTransition - True to animate the move
   */
  applyViewAngle (view: ViewAngle, enableTransition = false) {
    const [azimuthAngle, polarAngle] = VIEW_ANGLES[view]
    this.controls.normalizeRotations()
    this.controls.rotateTo(azimuthAngle, polarAngle, enableTransition)
  }

  /**
   * Converts a perspective camera distance to the orthographic zoom framing the same height
   * @param distance - Distance from the camera target
   */
  private toOrthographicZoom (distance: number) {
    const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.perspectiveCamera.fov) / 2)
    return ORTHOGRAPHIC_VIEW_HEIGHT_MM / viewHeight
  }

  /**
   * Converts an orthographic zoom to the perspective camera distance framing the same height
   * @param zoom - Orthographic camera zoom
   */
  private toPerspectiveDistance (zoom: number) {
    const viewHeight = ORTHOGRAPHIC_VIEW_HEIGHT_MM / zoom
    return viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.perspectiveCamera.fov) / 2))
  }

  /**
   * Updates the camera limits to the loaded gcode bounds
   * @param bounds - Gcode bounding box, in scene coordinates
   * @param bedVolume - Print bed geometry
   */
  applyGcodeBounds (bounds: THREE.Box3, bedVolume: BedVolume) {
    this.gcodeBounds.copy(bounds)
    this.applyBedVolume(bedVolume)
  }

  /* ---- Navigation ---- */

  /**
   * Switches the mouse mappings to the given navigation mode
   * @param mode - NAVIGATION_MODES key
   */
  applyNavigationMode (mode: NavigationModeKey) {
    this.navigationMode = NAVIGATION_MODES[mode] ?? NAVIGATION_MODES.prusaslicer
    this.applyMouseBindings()
  }

  /**
   * (Re)applies the mouse bindings for the held modifier key
   * @param event - Event carrying the modifier key state, or null when the window loses focus
   */
  private updateNavigationModifier (event: KeyboardEvent | null) {
    const modifier = event?.shiftKey ? 'shift' : event?.ctrlKey ? 'ctrl' : null
    if (modifier !== this.navigationModifier) {
      this.navigationModifier = modifier
      this.applyMouseBindings()
    }
  }

  /** Binds each mouse button to its action in the active navigation mode */
  private applyMouseBindings () {
    const isPerspective = this.activeCamera === this.perspectiveCamera
    const zoomAction = isPerspective ? CameraControls.ACTION.DOLLY : CameraControls.ACTION.ZOOM
    const actions: Array<[MouseBinding | MouseBinding[] | undefined, number]> = [
      [this.navigationMode.orbit, CameraControls.ACTION.ROTATE],
      [this.navigationMode.pan, CameraControls.ACTION.TRUCK],
      [this.navigationMode.zoom, zoomAction]
    ]

    const buttons: Record<MouseButton, number> = { left: CameraControls.ACTION.NONE, middle: CameraControls.ACTION.NONE, right: CameraControls.ACTION.NONE }
    const modifierButtons: Partial<typeof buttons> = {}
    for (const [bindings, action] of actions) {
      for (const binding of [bindings ?? []].flat()) {
        const [button, modifier] = binding.split('+').reverse() as [MouseButton, string?]
        if (modifier === undefined) buttons[button] = action
        else if (modifier === this.navigationModifier) modifierButtons[button] = action
      }
    }
    Object.assign(this.controls.mouseButtons, buttons, modifierButtons, { wheel: zoomAction })
    this.controls.touches.two = isPerspective ? CameraControls.ACTION.TOUCH_DOLLY_TRUCK : CameraControls.ACTION.TOUCH_ZOOM_TRUCK
  }

  /**
   * Switches the 3D view to the given camera projection
   * @param mode - Camera projection to use
   */
  applyProjectionMode (mode: ProjectionMode) {
    const camera = mode === 'orthographic' ? this.orthographicCamera : this.perspectiveCamera
    if (camera === this.activeCamera) return

    // Swap the camera into the controls, converting the framing between distance and zoom
    const distance = this.controls.distance
    this.activeCamera = camera
    this.controls.camera = camera
    if (camera === this.orthographicCamera) {
      this.controls.zoomTo(this.toOrthographicZoom(distance), false)
      this.controls.dollySpeed = 1
    } else {
      this.controls.dollyTo(this.toPerspectiveDistance(this.orthographicCamera.zoom), false)
      this.controls.zoomTo(1, false)
    }
    this.applyMouseBindings()
    this.requestRender()
  }
}
