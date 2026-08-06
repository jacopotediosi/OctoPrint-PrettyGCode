/** Mouse buttons usable in a navigation binding */
export type MouseButton = 'left' | 'middle' | 'right'
/** Mouse button with an optional modifier key to hold */
export type MouseBinding = MouseButton | `${'shift' | 'ctrl'}+${MouseButton}`

/** Mouse bindings of a navigation mode */
export interface NavigationMode {
  /** Display name */
  name: string
  /** Bindings that rotate the camera around its target */
  orbit: MouseBinding | MouseBinding[]
  /** Bindings that pan the camera */
  pan: MouseBinding | MouseBinding[]
  /** Bindings that zoom by drag */
  zoom?: MouseBinding | MouseBinding[]
}

/** Navigation modes mirroring popular slicers and CADs */
export const NAVIGATION_MODES = {
  prusaslicer: {
    name: 'PrusaSlicer / Bambu Studio / OrcaSlicer / OpenSCAD',
    orbit: 'left',
    pan: ['right', 'middle']
  },
  cura: {
    name: 'Cura / Tinkercad / Onshape',
    orbit: ['right', 'ctrl+left'],
    pan: ['middle', 'shift+right', 'ctrl+right']
  },
  fusion360: {
    name: 'Fusion 360 / Inventor / AutoCAD',
    orbit: 'shift+middle',
    pan: 'middle'
  },
  blender: {
    name: 'Blender / SketchUp / NX / Creo',
    orbit: 'middle',
    pan: 'shift+middle',
    zoom: 'ctrl+middle'
  },
  solidworks: {
    name: 'SOLIDWORKS',
    orbit: 'middle',
    pan: 'ctrl+middle',
    zoom: 'shift+middle'
  },
  rhino: {
    name: 'Rhinoceros',
    orbit: 'right',
    pan: 'shift+right',
    zoom: 'ctrl+right'
  }
} satisfies Record<string, NavigationMode>

/** Key identifying a navigation mode in NAVIGATION_MODES */
export type NavigationModeKey = keyof typeof NAVIGATION_MODES

/** Projection mode of the 3D view */
export type ProjectionMode = 'perspective' | 'orthographic'
