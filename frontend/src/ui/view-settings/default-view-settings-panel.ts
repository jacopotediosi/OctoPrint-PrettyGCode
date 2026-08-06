import { Settings, type SettingKey, type SettingValues } from '../../settings'
import { buildViewSettingsPanel, type ViewSettingsPanel } from './view-settings-panel'

/** Handles of the panel editing the default view settings */
interface DefaultViewSettingsPanel extends ViewSettingsPanel {
  /** Saves the edited settings into the OctoPrint settings */
  save: () => void
}

/** The panel editing the default view settings, null until it is built */
let panel: DefaultViewSettingsPanel | null = null

/** Saves the edited default view settings into the OctoPrint settings */
export function saveDefaultViewSettings (): void {
  panel?.save()
}

/**
 * Builds the panel editing the default view settings
 * @param settingsVM - OctoPrint settings view model
 * @returns The created panel
 */
function initDefaultViewSettingsPanel (settingsVM: any): DefaultViewSettingsPanel {
  const container = document.getElementById('pg-default-view-settings')!
  const defaultDefaultViewSettings: Partial<SettingValues> = JSON.parse(container.dataset.defaultDefaultViewSettings ?? '{}')
  const settings = new Settings()

  /** Gets the observables holding the stored defaults */
  const stored = (): any => settingsVM.settings.plugins.prettygcode.defaultViewSettings

  /** Reads the stored defaults into the settings */
  const readStored = (): void => { settings.set(defaultDefaultViewSettings, ko.mapping.toJS(stored())) }
  readStored()

  const { refresh } = buildViewSettingsPanel(container, settings, null, null)

  return {
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
}

/**
 * Brings the panel editing the default view settings in the plugin settings tab up to date
 * @param settingsVM - OctoPrint settings view model
 */
export function updateDefaultViewSettingsPanel (settingsVM: any): void {
  panel ??= initDefaultViewSettingsPanel(settingsVM)
  panel.refresh()
}
