import * as THREE from '../../three-exports'
import { isThickMaterial } from './line-materials'
import type { GcodeLineMaterial } from './line-materials'

/** A rendered gcode line object */
export type GcodeLine = THREE.LineSegments2 | THREE.LineSegments

/**
 * Tells whether a rendered line is drawn with thickness
 * @param line - Line to test
 * @returns True for a thick line
 */
export const isThickLine = (line: GcodeLine): line is THREE.LineSegments2 => line instanceof THREE.LineSegments2

/** Metadata a rendered gcode line carries */
export interface GcodeLineMetadata {
  /** 1-based layer number */
  layerNumber: number
  /** Global segment index the layer starts at */
  firstGlobalIndex: number
  /** Moves the line draws */
  moveCount: number
  /** Segment of the layer each drawn move waits for, or null for the whole layer */
  segmentIndices: Uint32Array | null
  /** Whether the line draws the excluded part of the layer */
  excluded?: boolean
  /** Whether the line draws the layer's mirror */
  mirror?: boolean
}

/** Name prefix of the layer line objects */
export const LAYER_PREFIX = 'layer#'
/** Name prefix of the travel line objects */
export const TRAVEL_PREFIX = 'travel#'

/**
 * Tells whether a scene object is one of the rendered gcode layers
 * @param child - Scene object to test
 * @returns True for layer line objects
 */
export const isLayerObject = (child: THREE.Object3D): child is GcodeLine => child.name.startsWith(LAYER_PREFIX)

/**
 * Reads the metadata a gcode line carries
 * @param line - Gcode line
 * @returns Its metadata
 */
export const gcodeLineMetadata = (line: GcodeLine): GcodeLineMetadata => line.userData as GcodeLineMetadata

/**
 * Reads the buffer a gcode line holds its colors in
 * @param line - Gcode line
 * @returns The buffer holding the colors as flat RGB triplets
 */
export function gcodeLineColorBuffer (line: GcodeLine): THREE.InterleavedBuffer | THREE.BufferAttribute {
  if (isThickLine(line)) {
    const attributes = line.geometry.attributes as Record<string, THREE.InterleavedBufferAttribute>
    return attributes.instanceColorStart.data
  }
  return line.geometry.attributes.color as THREE.BufferAttribute
}

/**
 * Creates a line object
 * @param vertices - Segment endpoints as flat XYZ triplets
 * @param colors - Segment colors as flat RGB triplets
 * @param material - Material to render with
 * @returns The new line object
 */
export function makeLine (vertices: Float32Array, colors: Uint8ClampedArray, material: GcodeLineMaterial): GcodeLine {
  let line: GcodeLine
  if (isThickMaterial(material)) {
    // Thick lines
    const geometry = new THREE.LineSegmentsGeometry()
    geometry.setPositions(vertices)
    const colorBuffer = new THREE.InstancedInterleavedBuffer(colors, 6, 1)
    geometry.setAttribute('instanceColorStart', new THREE.InterleavedBufferAttribute(colorBuffer, 3, 0, true))
    geometry.setAttribute('instanceColorEnd', new THREE.InterleavedBufferAttribute(colorBuffer, 3, 3, true))
    line = new THREE.LineSegments2(geometry, material)
  } else {
    // Thin lines
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true))
    line = new THREE.LineSegments(geometry, material)
  }

  // Speeds up rendering, the lines never move
  line.matrixAutoUpdate = false

  return line
}
