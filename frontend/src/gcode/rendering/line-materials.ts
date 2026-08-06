import * as THREE from '../../three-exports'

/** A rendered gcode line object */
export type GcodeLine = THREE.LineSegments2 | THREE.LineSegments

/** A material a gcode line is drawn with */
export type GcodeLineMaterial = THREE.LineMaterial | THREE.LineBasicMaterial

/**
 * Tells whether a rendered line is drawn with thickness
 * @param line - Line to test
 * @returns True for a thick line
 */
export const isThickLine = (line: GcodeLine): line is THREE.LineSegments2 => line instanceof THREE.LineSegments2

/**
 * Tells whether a material draws lines with thickness
 * @param material - Material to test
 * @returns True for the thick line material
 */
export const isThickMaterial = (material: GcodeLineMaterial): material is THREE.LineMaterial => material instanceof THREE.LineMaterial

/**
 * Makes the material for thin gcode lines
 * @param clippingPlanes - Clipping planes to apply, if any
 * @returns The new material
 */
export const makeThinMaterial = (clippingPlanes: THREE.Plane[] | null = null): THREE.LineBasicMaterial => new THREE.LineBasicMaterial({ vertexColors: true, clippingPlanes })

/**
 * Fixes the thick-line shaders: in orthographic view and
 * very close up the lines under the top layers show through them
 * @param parameters - WebGL program parameters holding the shader sources
 */
const patchThickMaterialShaders = (parameters: THREE.WebGLProgramParametersWithUniforms): void => {
  const fixes: Array<{ shader: 'vertexShader' | 'fragmentShader', from: string, to: string }> = [
    // Likely a three.js bug: it builds the flat quads that render each line facing the camera
    // position, assuming a perspective camera. An orthographic camera looks along a fixed axis
    // regardless of its position, so the quads come out misrotated and tilted views break the
    // lines into stripes exposing the layers beneath: orient the quads along the orthographic
    // view axis instead
    {
      shader: 'vertexShader',
      from: 'vec3 tmpFwd = normalize( mix( start.xyz, end.xyz, 0.5 ) );',
      to: 'vec3 tmpFwd = perspective ? normalize( mix( start.xyz, end.xyz, 0.5 ) ) : vec3( 0.0, 0.0, - 1.0 );'
    },
    // three.js pins each quad's depth to its line center to blend the joints between segments.
    // The quads are inflated half a linewidth towards the camera, and keeping their real depth
    // seals the small gaps between adjacent lines: perspective view already works that way, since
    // the logarithmic depth buffer recomputes the pinned depths, but in orthographic view the
    // pinning would survive and let the layers beneath show through the gaps at tilted angles
    {
      shader: 'vertexShader',
      from: 'clip.z = clipPose.z * clip.w;',
      to: 'if ( perspective ) clip.z = clipPose.z * clip.w;'
    },
    // The camera type checks below need the projection matrix, which three.js only hands to the
    // vertex shader: declare it in the fragment shader too
    {
      shader: 'fragmentShader',
      from: '#include <logdepthbuf_pars_fragment>',
      to: '#include <logdepthbuf_pars_fragment>\nuniform mat4 projectionMatrix;'
    },
    // Likely a three.js bug too: to make the flat quads look like round lines, it discards the
    // pixels farther than half a linewidth from the view ray, building every ray out of the
    // camera position as a perspective camera would. Orthographic view rays are parallel instead,
    // and the fanned-out rays keep the wrong pixels, leaving stray pieces of the lines beneath
    // floating over the surface
    {
      shader: 'fragmentShader',
      from: 'vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;',
      to: 'bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 );\n' +
        'vec3 rayOrigin = perspective ? vec3( 0.0 ) : vec3( worldPos.xy, 1e5 );\n' +
        'vec3 rayEnd = perspective ? normalize( worldPos.xyz ) * 1e5 : vec3( worldPos.xy, - 1e5 );'
    },
    // Hand the ray start above to the distance test, which assumed all rays start at the camera
    {
      shader: 'fragmentShader',
      from: 'closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd )',
      to: 'closestLineToLine( worldStart, worldEnd, rayOrigin, rayEnd )'
    },
    // Locate the nearest ray point from the ray start too, now that it is not the camera position
    {
      shader: 'fragmentShader',
      from: 'vec3 p2 = rayEnd * params.y;',
      to: 'vec3 p2 = mix( rayOrigin, rayEnd, params.y );'
    }
  ]
  for (const { shader, from, to } of fixes) {
    if (!parameters[shader].includes(from)) throw new Error(`Thick-line shader code to fix not found: "${from}"`)
    parameters[shader] = parameters[shader].replace(from, to)
  }
}

/**
 * Makes the material for thick gcode lines
 * @param clippingPlanes - Clipping planes to apply, if any
 * @returns The new material
 */
export const makeThickMaterial = (clippingPlanes: THREE.Plane[] | null = null): THREE.LineMaterial => {
  const material = new THREE.LineMaterial({ worldUnits: true, vertexColors: true, clippingPlanes })
  material.onBeforeCompile = patchThickMaterialShaders
  return material
}
