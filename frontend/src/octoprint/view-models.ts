import type { SettingValues } from '../settings'
import type { BedVolume } from '../viewer/bed'

/* ---- View models ---- */

/** OctoPrint settings view model */
export type SettingsViewModel = any

/** OctoPrint printer profiles view model */
export type PrinterProfilesViewModel = any

/* ---- Settings ---- */

/**
 * Reads the default view settings configured on the server
 * @param settingsVM - OctoPrint settings view model
 * @returns Their values by name
 */
export function defaultViewSettings (settingsVM: SettingsViewModel): Partial<SettingValues> {
  return ko.mapping.toJS(settingsVM.settings?.plugins?.prettygcode?.defaultViewSettings ?? {})
}

/**
 * Writes the default view settings configured on the server
 * @param settingsVM - OctoPrint settings view model
 * @param values - Values to write, by name
 */
export function setDefaultViewSettings (settingsVM: SettingsViewModel, values: Partial<SettingValues>): void {
  const observables = settingsVM.settings.plugins.prettygcode.defaultViewSettings
  for (const [key, value] of Object.entries(values)) observables[key](value)
}

/**
 * Reads the gcode file size past which the user is asked before loading
 * @param settingsVM - OctoPrint settings view model
 * @returns The size in bytes, 0 when no size is configured
 */
export function largeFileThresholdBytes (settingsVM: SettingsViewModel): number {
  return Number(settingsVM.settings?.plugins?.prettygcode?.largeFileThresholdMb?.() ?? 0) * 1024 * 1024
}

/**
 * Reads the tag the Cancel Object plugin marks the printed objects with
 * @param settingsVM - OctoPrint settings view model
 * @returns The tag, undefined when the plugin states none
 */
export function cancelObjectTag (settingsVM: SettingsViewModel): string | undefined {
  return settingsVM.settings?.plugins?.cancelobject?.reptag?.()
}

/**
 * Reads whether the printer firmware has G90/G91 switch the extrusion mode too
 * @param settingsVM - OctoPrint settings view model
 * @returns True when they switch it
 */
export function g90InfluencesExtruder (settingsVM: SettingsViewModel): boolean {
  return settingsVM.settings?.feature?.g90InfluencesExtruder?.() ?? false
}

/**
 * Opens the OctoPrint settings dialog on a tab
 * @param settingsVM - OctoPrint settings view model
 * @param tab - Selector of the tab to open
 */
export function showSettingsDialog (settingsVM: SettingsViewModel, tab: string): void {
  settingsVM.show(tab)
}

/* ---- Printer profile ---- */

/** Nozzle diameter in mm assumed when the printer profile states none */
export const DEFAULT_NOZZLE_DIAMETER_MM = 0.4

/** Bed width, depth and height in mm assumed until the printer profile is read */
const DEFAULT_BED_SIZE_MM = 200

/** Print bed geometry assumed until the printer profile is read */
export const DEFAULT_BED_VOLUME: BedVolume = { depth: DEFAULT_BED_SIZE_MM, height: DEFAULT_BED_SIZE_MM, origin: 'lowerleft', width: DEFAULT_BED_SIZE_MM }

/**
 * Reads the nozzle diameter of the active printer profile
 * @param printerProfilesVM - OctoPrint printer profiles view model
 * @returns The diameter in mm, the assumed one when the profile states none
 */
export function printerProfileNozzleDiameter (printerProfilesVM: PrinterProfilesViewModel): number {
  const extruder = printerProfilesVM.currentProfileData()?.extruder
  const nozzleDiameter = typeof extruder?.nozzleDiameter === 'function' ? extruder.nozzleDiameter() : null
  return nozzleDiameter ?? DEFAULT_NOZZLE_DIAMETER_MM
}

/**
 * Reads the print bed geometry of the active printer profile
 * @param printerProfilesVM - OctoPrint printer profiles view model
 * @returns The bed geometry, null when the profile states none
 */
export function printerProfileBedVolume (printerProfilesVM: PrinterProfilesViewModel): BedVolume | null {
  const volume = printerProfilesVM.currentProfileData()?.volume
  if (!volume) return null

  return { depth: volume.depth(), height: volume.height(), origin: volume.origin(), width: volume.width() }
}

/**
 * Watches the active printer profile
 * @param printerProfilesVM - OctoPrint printer profiles view model
 * @param onChange - Callback called after the active printer profile changes
 */
export function onPrinterProfileChange (printerProfilesVM: PrinterProfilesViewModel, onChange: () => void): void {
  printerProfilesVM.currentProfileData.subscribe(onChange)
}

/* ---- Selected tab ---- */

/**
 * Reads the tab the user is on
 * @returns Selector of the selected tab
 */
export function selectedTab (): string {
  return OctoPrint.coreui.selectedTab
}

/* ---- Webcam ---- */

/** Has OctoPrint 1.9+ start or stop the webcam streams by where their containers now sit */
export function refreshWebcamStreams (): void {
  OctoPrint.coreui.viewmodels?.controlViewModel?.recreateIntersectionObservers?.()
}

/** Starts the webcam streams on OctoPrint <= 1.8, whose control view model refuses to stream while its tab is not the selected one */
export function startWebcamStreams (): void {
  const controlVM = OctoPrint.coreui.viewmodels?.controlViewModel
  if (!controlVM) return

  clearTimeout(controlVM.webcamDisableTimeout)
  controlVM.webcamDisableTimeout = undefined

  const tab = OctoPrint.coreui.selectedTab
  OctoPrint.coreui.selectedTab = '#control'
  try {
    controlVM._enableWebcam()
  } finally {
    OctoPrint.coreui.selectedTab = tab
  }
}

/** Stops the webcam streams on OctoPrint <= 1.8 */
export function stopWebcamStreams (): void {
  OctoPrint.coreui.viewmodels?.controlViewModel?._disableWebcam?.()
}
