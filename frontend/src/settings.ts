import type { NavigationModeKey, ProjectionMode } from './viewer'

/** localStorage key holding the settings */
const STORAGE_KEY = 'pg-settings'

/** Plugin frontend settings, persisted in the browser */
export class Settings {
  /* ---- Interface ---- */

  /** Whether to use a dark theme */
  darkMode = false
  /** Whether to show the temperature status bar */
  showStatusBar = true
  /** Whether to antialias the 3D view */
  antialias = true

  /* ---- Camera ---- */

  /** Navigation mode of the 3D view */
  navigationMode: NavigationModeKey = 'prusaslicer'
  /** Projection mode of the 3D view */
  projectionMode: ProjectionMode = 'perspective'
  /** Whether to auto-orbit the camera when idle */
  orbitWhenIdle = false

  /* ---- GCode model ---- */

  /** Whether to draw the lines with their real thickness */
  thickLines = true
  /** Shading intensity of the topmost displayed layer, in percent */
  highlightIntensity = 30
  /** Whether to show a reflection of the print on the bed */
  showMirror = false
  /** Whether to show gcode excluded from printing, greyed out */
  showExcluded = true

  /* ---- Nozzle ---- */

  /** Transparency of the nozzle model, in percent */
  nozzleTransparency = 0
  /** Whether to reflect the scene on the nozzle model */
  nozzleReflection = true

  /* ---- Top windows ---- */

  /** Whether to show the state top window */
  showState = true
  /** Whether to show the files top window */
  showFiles = false

  /* ---- Bottom windows ---- */

  /** Whether to show the dashboard overlay */
  showDashboard = false
  /** Dashboard overlay height in px, 0 for the default */
  dashboardHeight = 0

  /** Whether to show the webcam overlay */
  showWebcam = false
  /** Webcam overlay height in px, 0 for the default */
  webcamHeight = 0

  /** Restores the saved settings */
  load () {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      for (const key in saved) {
        if (key in this) {
          (this as any)[key] = saved[key]
        }
      }
    } catch {}
  }

  /** Persists the current settings */
  save () {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this }))
    } catch {}
  }
}
