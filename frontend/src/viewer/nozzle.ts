import * as THREE from '../three-exports'
import type { ScenePoint } from '../gcode/parsing/parsed-gcode'
import type { Settings } from '../settings'

/** Markers available for the nozzle position */
export type NozzleStyle = 'none' | 'model' | 'dot'

/** URL of the nozzle 3D model */
const MODEL_URL = PLUGIN_BASEURL + 'prettygcode/static/js/models/ExtruderNozzle.obj'
/** Nozzle model scale at size 100% */
const MODEL_BASE_SCALE = 0.1
/** Dot diameter at size 100%, as a multiple of the nozzle diameter */
const DOT_BASE_DIAMETERS = 4

/** The nozzle marker of the 3D view */
export class Nozzle {
  /** Plugin frontend settings */
  private readonly settings: Settings

  /** The 3D scene */
  private readonly scene: THREE.Scene
  /** Callback forcing a render on the next animation frame */
  private readonly requestRender: () => void

  /** Camera rendering the metallic reflections on the nozzle model */
  private readonly reflectionCamera = new THREE.CubeCamera(1, 100000, new THREE.WebGLCubeRenderTarget(128))

  /** Nozzle model, once loaded */
  private model: THREE.Group | null = null
  /** Material shared by the nozzle model meshes, once loaded */
  private modelMaterial: THREE.MeshStandardMaterial | null = null
  /** Offset from the nozzle position to the nozzle model center */
  private readonly modelCenterOffset = new THREE.Vector3()

  /** Material of the nozzle dot */
  private readonly dotMaterial = new THREE.MeshBasicMaterial()
  /** Dot marking the nozzle position */
  private readonly dot = new THREE.Mesh(new THREE.SphereGeometry(0.5), this.dotMaterial)

  /* ---- Setup ---- */

  /**
   * @param settings - Plugin frontend settings
   * @param scene - The 3D scene
   * @param requestRender - Callback forcing a render on the next animation frame
   */
  constructor (settings: Settings, scene: THREE.Scene, requestRender: () => void) {
    this.settings = settings
    this.scene = scene
    this.requestRender = requestRender
    this.dot.visible = false
    scene.add(this.dot)
  }

  /** Loads the nozzle marker assets and shows them in the scene once ready */
  load (): void {
    new THREE.OBJLoader().load(MODEL_URL, (obj) => {
      obj.rotation.x = Math.PI / 2
      obj.scale.setScalar(MODEL_BASE_SCALE * this.settings.nozzleSize / 100)
      obj.position.set(0, 0, 10)
      const material = new THREE.MeshStandardMaterial({
        metalness: 1,
        roughness: 0.5,
        envMap: this.reflectionCamera.renderTarget.texture,
        color: this.settings.nozzleColor,
        emissiveIntensity: 0.7
      })
      // Depth-only twins drawn first keep the transparency uniform on the outer surface
      const depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true })
      obj.children.slice().forEach((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = material
          child.renderOrder = 2
          const twin = new THREE.Mesh(child.geometry, depthMaterial)
          twin.renderOrder = 1
          obj.add(twin)
        }
      })
      this.model = obj
      this.modelMaterial = material
      new THREE.Box3().setFromObject(obj).getCenter(this.modelCenterOffset).sub(obj.position)
      this.scene.add(obj)
      this.requestRender()
    })
  }

  /* ---- Render loop ---- */

  /**
   * Updates the nozzle for a new frame
   * @param position - Nozzle position to show, or null to move the nozzle back to the origin
   * @param nozzleDiameter - Nozzle diameter in mm
   * @param renderer - The WebGL renderer
   * @param sceneChanged - True if the scene already changed this frame
   * @returns True if the nozzle changed the scene
   */
  update (position: ScenePoint | null, nozzleDiameter: number, renderer: THREE.WebGLRenderer, sceneChanged: boolean): boolean {
    const settings = this.settings
    const style = settings.nozzleStyle
    let needRender = false

    // Update nozzle position
    for (const marker of [this.model, this.dot]) {
      if (!marker) continue
      if (position) {
        marker.position.set(position.x, position.y, position.z)
      } else if (marker.position.lengthSq()) {
        marker.position.set(0, 0, 0)
        needRender = true
      }
    }

    // Size the dot to match the size setting
    const dotDiameter = nozzleDiameter * DOT_BASE_DIAMETERS * settings.nozzleSize / 100
    if (this.dot.scale.x !== dotDiameter) {
      this.dot.scale.setScalar(dotDiameter)
      needRender = true
    }

    // Size the model and stand it perpendicular to the layers, which a belt printer tilts with its gantry
    const modelScale = MODEL_BASE_SCALE * settings.nozzleSize / 100
    const modelTilt = Math.PI / 2 + (settings.beltPrinter ? THREE.MathUtils.degToRad(settings.beltPrinterGantryAngle) : 0)
    if (this.model && (this.model.scale.x !== modelScale || this.model.rotation.x !== modelTilt)) {
      this.model.scale.setScalar(modelScale)
      this.model.rotation.x = modelTilt
      new THREE.Box3().setFromObject(this.model).getCenter(this.modelCenterOffset).sub(this.model.position)
      needRender = true
    }

    // Recolor the nozzle markers to match the setting
    const color = settings.nozzleColor
    for (const material of [this.modelMaterial, this.dotMaterial]) {
      if (material && '#' + material.color.getHexString() !== color) {
        material.color.set(color)
        needRender = true
      }
    }

    // Light the unreflective model with its own color to compensate the missing reflection
    const emissive = settings.nozzleReflection ? '#000000' : color
    if (this.modelMaterial && '#' + this.modelMaterial.emissive.getHexString() !== emissive) {
      this.modelMaterial.emissive.set(emissive)
      needRender = true
    }

    // Fade the nozzle to match the transparency setting
    const opacity = 1 - settings.nozzleTransparency / 100
    for (const material of [this.modelMaterial, this.dotMaterial]) {
      if (material && material.opacity !== opacity) {
        material.opacity = opacity
        material.transparent = opacity < 1
        material.needsUpdate = true
        needRender = true
      }
    }

    // Show the marker selected by the style setting
    const modelVisible = style === 'model' && opacity > 0
    if (this.model && this.model.visible !== modelVisible) {
      this.model.visible = modelVisible
      needRender = true
    }
    const dotVisible = style === 'dot' && opacity > 0
    if (this.dot.visible !== dotVisible) {
      this.dot.visible = dotVisible
      needRender = true
    }

    // Toggle the model reflection to match the setting
    const envMap = settings.nozzleReflection ? this.reflectionCamera.renderTarget.texture : null
    if (this.modelMaterial && this.modelMaterial.envMap !== envMap) {
      this.modelMaterial.envMap = envMap
      this.modelMaterial.metalness = envMap ? 1 : 0
      this.modelMaterial.roughness = envMap ? 0.5 : 1
      this.modelMaterial.needsUpdate = true
      needRender = true
    }

    // Rebuild the reflection when the scene changed, capturing it from the model center with the model hidden
    if ((sceneChanged || needRender) && settings.nozzleReflection && style === 'model' && this.model) {
      const visible = this.model.visible
      this.model.visible = false
      this.reflectionCamera.position.copy(this.model.position).add(this.modelCenterOffset)
      this.reflectionCamera.update(renderer, this.scene)
      this.model.visible = visible
    }

    return needRender
  }
}
