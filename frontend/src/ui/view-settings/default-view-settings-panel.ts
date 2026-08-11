import { Settings, type SettingKey, type SettingValues } from '../../settings'
import { buildViewSettingsPanel, type ViewSettingsPanel } from './view-settings-panel'
import { defaultViewSettings, setDefaultViewSettings, type SettingsViewModel } from '../../octoprint/view-models'

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
function initDefaultViewSettingsPanel (settingsVM: SettingsViewModel): DefaultViewSettingsPanel {
  const container = document.getElementById('pg-default-view-settings')!
  const defaultDefaultViewSettings: Partial<SettingValues> = JSON.parse(container.dataset.defaultDefaultViewSettings ?? '{}')
  const settings = new Settings()

  /** Reads the stored defaults into the settings */
  const readStored = (): void => { settings.set(defaultDefaultViewSettings, defaultViewSettings(settingsVM)) }
  readStored()

  const { refresh } = buildViewSettingsPanel({ container, settings })

  return {
    refresh: () => {
      readStored()
      refresh()
    },
    save: () => setDefaultViewSettings(settingsVM, Object.fromEntries(
      (Object.keys(defaultDefaultViewSettings) as SettingKey[])
        .map((key) => [key, settings.isDefault(key) ? defaultDefaultViewSettings[key] : settings[key]])
    ))
  }
}

/**
 * Brings the panel editing the default view settings in the plugin settings tab up to date
 * @param settingsVM - OctoPrint settings view model
 */
export function updateDefaultViewSettingsPanel (settingsVM: SettingsViewModel): void {
  panel ??= initDefaultViewSettingsPanel(settingsVM)
  panel.refresh()
}
