import type { Settings, SettingKey } from '../../settings'

/** Settings keys of the windows shown in the top left corner, only one open at a time */
const TOP_LEFT_WINDOWS = ['showState', 'showFiles', 'showLegend'] as const

/** Settings key of a top left window */
export type TopLeftWindowKey = typeof TOP_LEFT_WINDOWS[number]

/**
 * Closes the top left windows an opened one takes the place of
 * @param settings - Plugin frontend settings
 * @param opened - Name of the setting that was just turned on
 * @returns Names of the settings turned off
 */
export function closeOtherTopLeftWindows (settings: Settings, opened: SettingKey): TopLeftWindowKey[] {
  if (!settings[opened] || !(TOP_LEFT_WINDOWS as readonly SettingKey[]).includes(opened)) return []

  const closed = TOP_LEFT_WINDOWS.filter((key) => key !== opened)
  for (const key of closed) settings[key] = false
  return closed
}

/**
 * Shows or hides the top left windows to match the current settings
 * @param settings - Plugin frontend settings
 * @param gcodeLoaded - True when a gcode is loaded
 */
export function updateTopLeftWindows (settings: Settings, gcodeLoaded: boolean): void {
  $('#state_wrapper').toggleClass('pg-hidden', !settings.showState)
  $('#files_wrapper').toggleClass('pg-hidden', !settings.showFiles)

  $('#pg-legend').toggleClass('pg-hidden', !settings.showLegend || !gcodeLoaded)
  $('.pg-toggle-legend').toggleClass('pg-hidden', !gcodeLoaded)
}
