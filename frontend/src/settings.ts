import type { NavigationModeKey, ProjectionMode } from './viewer/navigation'
import type { NozzleStyle } from './viewer/nozzle'
import { type ColorRule, DEFAULT_COLOR_RULES, DEFAULT_COLOR, cloneColorRules } from './gcode/model-colors'

/** localStorage key holding the settings */
const STORAGE_KEY = 'pg-settings'

/** Plugin frontend settings, persisted in the browser */
export class Settings {
  /* ---- Interface ---- */

  /** Whether to use a dark theme */
  darkMode = false
  /** Whether to show the temperature status bar */
  showStatusBar = true
  /** Whether to show the layer slider */
  showLayerSlider = true
  /** Whether to show the segment slider */
  showSegmentSlider = true
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
  highlightIntensity = 40
  /** Whether to show gcode excluded from printing, greyed out */
  showExcluded = true
  /** Model color rules, tried in order */
  modelColorRules: ColorRule[] = cloneColorRules(DEFAULT_COLOR_RULES)
  /** Color of segments matching no color rule */
  modelDefaultColor = DEFAULT_COLOR

  /* ---- Nozzle ---- */

  /** Marker shown at the nozzle position */
  nozzleStyle: NozzleStyle = 'model'
  /** Size of the nozzle marker, in percent of its default */
  nozzleSize = 100
  /** Color of the nozzle marker */
  nozzleColor = '#e6d36b'
  /** Transparency of the nozzle marker, in percent */
  nozzleTransparency = 0
  /** Whether to reflect the scene on the nozzle model */
  nozzleReflection = true

  /* ---- Bed ---- */

  /** Whether to show the print bed */
  showBed = true
  /** Whether to show a reflection of the print on the bed */
  showMirror = false
  /** Whether to show the markers of the excluded regions */
  showExclusionMarker = true

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
