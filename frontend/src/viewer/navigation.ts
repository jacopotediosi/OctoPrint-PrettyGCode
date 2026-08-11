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

/** Modifier key held down while navigating, null for none */
export type NavigationModifier = 'shift' | 'ctrl' | null

/** Action ids the mouse buttons are bound to */
export interface NavigationActions {
  /** Action rotating the camera around its target */
  orbit: number
  /** Action panning the camera */
  pan: number
  /** Action zooming by drag */
  zoom: number
  /** Action leaving the button unbound */
  none: number
}

/**
 * Reads the modifier key an event holds down
 * @param event - Keyboard event, null when the browser window loses focus
 * @returns The held modifier key, null for none
 */
export function heldModifier (event: KeyboardEvent | null): NavigationModifier {
  return event?.shiftKey ? 'shift' : event?.ctrlKey ? 'ctrl' : null
}

/**
 * Works out the action each mouse button takes in a navigation mode
 * @param mode - Navigation mode the bindings come from
 * @param modifier - Modifier key held down, null for none
 * @param actions - Action ids to bind the buttons to
 * @returns The action of each mouse button
 */
export function mouseButtonActions (mode: NavigationMode, modifier: NavigationModifier, actions: NavigationActions): Record<MouseButton, number> {
  const boundActions: Array<[MouseBinding | MouseBinding[] | undefined, number]> = [
    [mode.orbit, actions.orbit],
    [mode.pan, actions.pan],
    [mode.zoom, actions.zoom]
  ]

  // Bindings needing the held modifier win over the plain ones
  const buttons: Record<MouseButton, number> = { left: actions.none, middle: actions.none, right: actions.none }
  const modifierButtons: Partial<typeof buttons> = {}
  for (const [bindings, action] of boundActions) {
    for (const binding of [bindings ?? []].flat()) {
      const [button, bindingModifier] = binding.split('+').reverse() as [MouseButton, string?]
      if (bindingModifier === undefined) buttons[button] = action
      else if (bindingModifier === modifier) modifierButtons[button] = action
    }
  }

  return { ...buttons, ...modifierButtons }
}
