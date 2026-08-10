import type { NavigationModeKey, ProjectionMode } from './viewer/navigation'
import type { NozzleStyle } from './viewer/nozzle'
import type { TravelScope } from './gcode/rendering/gcode-model'
import type { FeatureTypeColorRule } from './gcode/colors/feature-type-colors'
import type { ColorModeId } from './gcode/colors/segment-colors'

/** localStorage key holding the settings */
const STORAGE_KEY = 'pg-settings'

/** Value of every setting, by name */
export type SettingValues = { [K in keyof Settings as Settings[K] extends Function ? never : K]: Settings[K] }

/** Name of a setting */
export type SettingKey = keyof SettingValues

/** Plugin frontend settings */
export class Settings {
  /* ---- Interface ---- */

  /** Whether to use a dark theme */
  declare darkMode: boolean
  /** Whether to show the temperature status bar */
  declare showStatusBar: boolean
  /** Whether to show the layer slider */
  declare showLayerSlider: boolean
  /** Whether to show the segment slider */
  declare showSegmentSlider: boolean
  /** Whether to antialias the 3D view */
  declare antialias: boolean

  /* ---- Camera ---- */

  /** Navigation mode of the 3D view */
  declare navigationMode: NavigationModeKey
  /** Projection mode of the 3D view */
  declare projectionMode: ProjectionMode
  /** Whether to show the camera controls */
  declare showCameraControls: boolean
  /** Whether to auto-orbit the camera when idle */
  declare orbitWhenIdle: boolean

  /* ---- Printer ---- */

  /** Whether the printer prints onto a moving belt */
  declare beltPrinter: boolean
  /** Angle between the belt and the printer gantry, in degrees */
  declare beltPrinterGantryAngle: number

  /* ---- Nozzle ---- */

  /** Marker shown at the nozzle position */
  declare nozzleStyle: NozzleStyle
  /** Size of the nozzle marker, in percent of its default */
  declare nozzleSize: number
  /** Color of the nozzle marker */
  declare nozzleColor: string
  /** Transparency of the nozzle marker, in percent */
  declare nozzleTransparency: number
  /** Whether to reflect the scene on the nozzle model */
  declare nozzleReflection: boolean

  /* ---- Travel moves ---- */

  /** Part of the print the travel moves are drawn for */
  declare travelScope: TravelScope
  /** Color of the travel moves */
  declare travelColor: string

  /* ---- Gcode model ---- */

  /** What the segments take their color from */
  declare colorMode: ColorModeId
  /** Whether to draw the lines with their real thickness */
  declare thickLines: boolean
  /** Shading intensity of the topmost displayed layer, in percent */
  declare highlightIntensity: number
  /** Whether to show gcode excluded from printing, greyed out */
  declare showExcluded: boolean
  /** Feature type color rules, tried in order */
  declare featureTypeColorRules: FeatureTypeColorRule[]
  /** Color of segments matching no color rule */
  declare featureTypeDefaultColor: string

  /* ---- Bed ---- */

  /** Whether to show the print bed */
  declare showBed: boolean
  /** Whether to show a reflection of the print on the bed */
  declare showMirror: boolean
  /** Whether to show the markers of the excluded regions */
  declare showExclusionMarker: boolean

  /* ---- Top windows ---- */

  /** Whether to show the state top window */
  declare showState: boolean
  /** Whether to show the files top window */
  declare showFiles: boolean
  /** Whether to show the legend top window */
  declare showLegend: boolean

  /* ---- Bottom windows ---- */

  /** Whether to show the dashboard overlay */
  declare showDashboard: boolean
  /** Dashboard overlay height in px, 0 for the default */
  declare dashboardHeight: number

  /** Whether to show the webcam overlay */
  declare showWebcam: boolean
  /** Webcam overlay height in px, 0 for the default */
  declare webcamHeight: number

  /** Default of the settings the server does not configure */
  private static readonly BROWSER_ONLY_DEFAULTS = {
    showState: true,
    showFiles: false,
    showLegend: false,
    showDashboard: false,
    dashboardHeight: 0,
    showWebcam: false,
    webcamHeight: 0,
    colorMode: 'featureType'
  } satisfies Partial<SettingValues>

  /** Default value of every setting */
  private defaults = {} as SettingValues

  /**
   * Sets every setting from the given defaults and overrides
   * @param defaults - Default values of the settings
   * @param overrides - Values overriding the defaults
   * @returns Names of the settings whose value changed
   */
  set (defaults: Partial<SettingValues>, overrides: Partial<SettingValues>): SettingKey[] {
    this.defaults = { ...Settings.BROWSER_ONLY_DEFAULTS, ...defaults } as SettingValues
    const values = this as any
    const changed: SettingKey[] = []
    for (const key of Object.keys(this.defaults) as SettingKey[]) {
      const value = structuredClone(overrides[key] ?? this.defaults[key])
      if (!this.matches(key, value)) changed.push(key)
      values[key] = value
    }
    return changed
  }

  /**
   * Loads the settings saved in this browser, on top of the given defaults
   * @param defaults - Default values of the settings
   * @returns Names of the settings whose value changed
   */
  load (defaults: Partial<SettingValues>): SettingKey[] {
    let saved: Partial<SettingValues> = {}
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    } catch {}
    return this.set(defaults, saved)
  }

  /** Persists in the browser the settings */
  save (): void {
    const changed = Object.fromEntries(
      (Object.keys(this.defaults) as SettingKey[]).filter((key) => !this.isDefault(key)).map((key) => [key, this[key]])
    )
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(changed))
    } catch {}
  }

  /**
   * Tells whether a setting holds the given value
   * @param key - Name of the setting
   * @param value - Value to compare it with
   * @returns True when the setting equals it
   */
  matches<K extends SettingKey> (key: K, value: SettingValues[K]): boolean {
    // Sorting the keys of every object makes values that differ only in their order compare equal
    const sortKeys = (_key: string, item: unknown): unknown =>
      item !== null && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)))
        : item
    return JSON.stringify(this[key], sortKeys) === JSON.stringify(value, sortKeys)
  }

  /**
   * Tells whether a setting holds its default value
   * @param key - Name of the setting
   * @returns True when the setting is at its default value
   */
  isDefault (key: SettingKey): boolean {
    return this.matches(key, this.defaults[key])
  }

  /**
   * Gets the default value of a setting
   * @param key - Name of the setting
   * @returns Its default value
   */
  defaultOf<K extends SettingKey> (key: K): SettingValues[K] {
    return this.defaults[key]
  }

  /**
   * Gets the name of every setting
   * @returns The setting names
   */
  keys (): SettingKey[] {
    return Object.keys(this.defaults) as SettingKey[]
  }
}
