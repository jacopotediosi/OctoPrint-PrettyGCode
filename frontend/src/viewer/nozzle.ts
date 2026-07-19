import * as THREE from '../three-exports'
import type { Vector3 } from 'three'
import type { Settings } from '../settings'

/** URL of the nozzle 3D model */
const NOZZLE_MODEL_URL = PLUGIN_BASEURL + 'prettygcode/static/js/models/ExtruderNozzle.obj'
/** Nozzle color */
const NOZZLE_COLOR = 0xba971b
/** Brighter nozzle color compensating for the disabled reflection */
const NOZZLE_UNREFLECTIVE_COLOR = 0xffd826
/** Emissive lift applied to the unreflective nozzle color */
const NOZZLE_UNREFLECTIVE_EMISSIVE = 0.36

/** The nozzle model of the 3D view */
export class Nozzle {
  /** Plugin frontend settings */
  private readonly settings: Settings

  /** The 3D scene */
  private readonly scene: THREE.Scene
  /** Callback forcing a render on the next animation frame */
  private readonly requestRender: () => void

  /** Camera rendering the metallic reflections on the nozzle */
  private readonly reflectionCamera = new THREE.CubeCamera(1, 100000, new THREE.WebGLCubeRenderTarget(128))

  /** Nozzle model, once loaded */
  private model: THREE.Group | null = null
  /** Material shared by the nozzle model meshes, once loaded */
  private material: THREE.MeshStandardMaterial | null = null
  /** Offset from the nozzle position to the nozzle model center */
  private readonly centerOffset = new THREE.Vector3()

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
  }

  /** Loads the nozzle model and shows it in the scene once ready */
  load () {
    new THREE.OBJLoader().load(NOZZLE_MODEL_URL, (obj) => {
      obj.rotation.x = Math.PI / 2
      obj.scale.setScalar(0.1)
      obj.position.set(0, 0, 10)
      const material = new THREE.MeshStandardMaterial({
        metalness: 1,
        roughness: 0.5,
        envMap: this.reflectionCamera.renderTarget.texture,
        color: NOZZLE_COLOR
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
      this.material = material
      new THREE.Box3().setFromObject(obj).getCenter(this.centerOffset).sub(obj.position)
      this.scene.add(obj)
      this.requestRender()
    })
  }

  /**
   * Updates the nozzle for a new frame
   * @param position - Nozzle position to show, or null to move the nozzle back to the origin
   * @param renderer - The WebGL renderer
   * @param sceneChanged - True if the scene already changed this frame
   * @returns True if the nozzle changed the scene
   */
  update (position: Vector3 | null, renderer: THREE.WebGLRenderer, sceneChanged: boolean) {
    const settings = this.settings
    let needRender = false

    // Update nozzle model position
    if (this.model) {
      if (position) {
        this.model.position.copy(position)
      } else if (this.model.position.lengthSq()) {
        this.model.position.set(0, 0, 0)
        needRender = true
      }
    }

    // Fade the nozzle to match the transparency setting
    const opacity = 1 - settings.nozzleTransparency / 100
    if (this.model && this.material && this.material.opacity !== opacity) {
      this.material.opacity = opacity
      this.material.transparent = opacity < 1
      this.material.needsUpdate = true
      this.model.visible = opacity > 0
      needRender = true
    }

    // Toggle the nozzle reflection to match the setting
    const envMap = settings.nozzleReflection ? this.reflectionCamera.renderTarget.texture : null
    if (this.material && this.material.envMap !== envMap) {
      this.material.envMap = envMap
      this.material.metalness = envMap ? 1 : 0
      this.material.roughness = envMap ? 0.5 : 1
      this.material.color.setHex(envMap ? NOZZLE_COLOR : NOZZLE_UNREFLECTIVE_COLOR)
      this.material.emissive.setHex(envMap ? 0x000000 : NOZZLE_UNREFLECTIVE_COLOR)
      this.material.emissiveIntensity = NOZZLE_UNREFLECTIVE_EMISSIVE
      this.material.needsUpdate = true
      needRender = true
    }

    // Rebuild the reflection when the scene changed, capturing it from the nozzle center with the nozzle hidden
    if ((sceneChanged || needRender) && settings.nozzleReflection && this.model) {
      const visible = this.model.visible
      this.model.visible = false
      this.reflectionCamera.position.copy(this.model.position).add(this.centerOffset)
      this.reflectionCamera.update(renderer, this.scene)
      this.model.visible = visible
    }

    return needRender
  }
}
