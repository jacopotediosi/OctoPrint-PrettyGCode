import { Settings, type SettingKey, type SettingValues } from '../../settings'
import { buildViewSettingsPanel } from './view-settings-panel'

/** Handles of the panel editing the default view settings, null until it is built */
let panel: { refresh: () => void, save: () => void } | null = null

/** Saves the edited default view settings into the OctoPrint settings */
export function saveDefaultViewSettings (): void {
  panel?.save()
}

/**
 * Brings the panel editing the default view settings in the plugin settings tab up to date, building it on first use
 * @param settingsVM - OctoPrint settings view model
 */
export function updateDefaultViewSettingsPanel (settingsVM: any): void {
  if (!panel) {
    const container = document.getElementById('pg-default-view-settings')!
    const defaultDefaultViewSettings: Partial<SettingValues> = JSON.parse(container.dataset.defaultDefaultViewSettings ?? '{}')
    const settings = new Settings()

    /** Gets the observables holding the stored defaults */
    const stored = (): any => settingsVM.settings.plugins.prettygcode.defaultViewSettings

    /** Reads the stored defaults into the settings */
    const readStored = (): void => { settings.set(defaultDefaultViewSettings, ko.mapping.toJS(stored())) }
    readStored()

    const { refresh } = buildViewSettingsPanel(container, settings, null, null)

    panel = {
      refresh: () => {
        readStored()
        refresh()
      },
      save: () => {
        const observables = stored()
        for (const key of Object.keys(defaultDefaultViewSettings) as SettingKey[]) {
          observables[key](settings.isDefault(key) ? defaultDefaultViewSettings[key] : settings[key])
        }
      }
    }
  } else {
    panel.refresh()
  }
}
