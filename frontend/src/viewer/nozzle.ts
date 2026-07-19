import * as THREE from '../three-exports'
import type { Vector3 } from 'three'
import type { Settings } from '../settings'

/** Markers available for the nozzle position */
export type NozzleStyle = 'none' | 'model' | 'dot'

/** URL of the nozzle 3D model */
const MODEL_URL = PLUGIN_BASEURL + 'prettygcode/static/js/models/ExtruderNozzle.obj'
/** Color of the nozzle model */
const MODEL_COLOR = 0xba971b
/** Brighter model color compensating for the disabled reflection */
const MODEL_UNREFLECTIVE_COLOR = 0xffd826
/** Emissive lift applied to the unreflective model color */
const MODEL_UNREFLECTIVE_EMISSIVE = 0.36

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

  /**
   * @param settings - Plugin frontend settings
   * @param scene - The 3D scene
   * @param requestRender - Callback forcing a render on the next animation frame
   */
  constructor (settings: Settings, scene: THREE.Scene, requestRender: () => void) {
    this.settings = settings
    this.scene = scene
    this.requestRender = requestRender
    scene.add(this.reflectionCamera)
    this.dot.visible = false
    scene.add(this.dot)
  }

  /** Loads the nozzle marker assets and shows them in the scene once ready */
  load () {
    new THREE.OBJLoader().load(MODEL_URL, (obj) => {
      obj.rotation.x = Math.PI / 2
      obj.scale.setScalar(0.1)
      obj.position.set(0, 0, 10)
      const material = new THREE.MeshStandardMaterial({
        metalness: 1,
        roughness: 0.5,
        envMap: this.reflectionCamera.renderTarget.texture,
        color: MODEL_COLOR
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

  /**
   * Updates the nozzle for a new frame
   * @param position - Nozzle position to show, or null to move the nozzle back to the origin
   * @param nozzleDiameter - Nozzle diameter in mm
   * @param renderer - The WebGL renderer
   * @param sceneChanged - True if the scene already changed this frame
   * @returns True if the nozzle changed the scene
   */
  update (position: Vector3 | null, nozzleDiameter: number, renderer: THREE.WebGLRenderer, sceneChanged: boolean) {
    const settings = this.settings
    const style = settings.nozzleStyle
    let needRender = false

    // Update nozzle position
    for (const marker of [this.model, this.dot]) {
      if (!marker) continue
      if (position) {
        marker.position.copy(position)
      } else if (marker.position.lengthSq()) {
        marker.position.set(0, 0, 0)
        needRender = true
      }
    }

    // Size the dot to match the size setting
    const dotDiameter = nozzleDiameter * settings.nozzleDotSize
    if (this.dot.scale.x !== dotDiameter) {
      this.dot.scale.setScalar(dotDiameter)
      needRender = true
    }

    // Recolor the dot to match the setting
    if ('#' + this.dotMaterial.color.getHexString() !== settings.nozzleDotColor) {
      this.dotMaterial.color.set(settings.nozzleDotColor)
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
      this.modelMaterial.color.setHex(envMap ? MODEL_COLOR : MODEL_UNREFLECTIVE_COLOR)
      this.modelMaterial.emissive.setHex(envMap ? 0x000000 : MODEL_UNREFLECTIVE_COLOR)
      this.modelMaterial.emissiveIntensity = MODEL_UNREFLECTIVE_EMISSIVE
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
