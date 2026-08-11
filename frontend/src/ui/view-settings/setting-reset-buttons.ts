import type GUI from 'lil-gui'
import type { Controller } from 'lil-gui'
import { htmlStringToElement } from '../../utils/html'
import type { Settings, SettingKey } from '../../settings'

/** Markup of a reset button */
const BUTTON_MARKUP = '<button type="button" class="pg-reset"><i class="fa-solid fa-arrow-rotate-left"></i></button>'

/** How to reset a setting row and tell whether it is at its default */
export interface ResetEntry {
  /** Controller of the setting row */
  controller: Controller
  /** Tells whether the row is at its default */
  atDefault: () => boolean
  /** Resets the row to its default */
  resetToDefault: () => void
}

/** Panel the reset buttons are added to */
interface ResetButtonsPanel {
  /** GUI holding the setting rows */
  gui: GUI
  /** Element holding the panel header */
  container: HTMLElement
  /** Settings the rows edit */
  settings: Settings
  /** Rows that reset through their own logic instead of loading a default value */
  customResets: ResetEntry[]
}

/**
 * Gets the setting a row edits
 * @param controller - Controller of a setting row
 * @returns Name of that setting
 */
const keyOf = (controller: Controller): SettingKey => controller.property as SettingKey

/**
 * Builds a reset button
 * @param title - Tooltip of the button
 * @returns The button, with no click handler attached
 */
const makeResetButton = (title: string): HTMLButtonElement => {
  const button = htmlStringToElement(BUTTON_MARKUP) as HTMLButtonElement
  button.title = title
  return button
}

/**
 * Adds a reset button to every setting row, and to the panel header one resetting them all
 * @param panel - GUI and container holding the rows, settings they edit and rows resetting through their own logic
 * @returns Callbacks bringing every button back in sync with the settings
 */
export function addSettingResetButtons ({ gui, container, settings, customResets }: ResetButtonsPanel): Array<() => void> {
  const refreshers: Array<() => void> = []
  const customControllers = new Set(customResets.map((entry) => entry.controller))

  // One reset entry per setting row, the custom ones keeping their own logic
  const resetEntries: ResetEntry[] = [
    ...gui.controllersRecursive()
      .filter((controller) => !customControllers.has(controller))
      .map((controller) => ({
        controller,
        atDefault: () => settings.isDefault(keyOf(controller)),
        resetToDefault: () => { controller.load(settings.defaultOf(keyOf(controller))) }
      })),
    ...customResets
  ]

  // One reset button at the right of each setting's row, disabled while the setting is at its default
  for (const { controller, atDefault, resetToDefault } of resetEntries) {
    const button = makeResetButton('Reset this setting to its default value')
    button.addEventListener('click', resetToDefault)
    controller.domElement.append(button)
    refreshers.push(() => { button.disabled = atDefault() })
  }

  // Panel header has a "reset all settings" button, disabled while all are at their default
  const resetAll = makeResetButton('Reset all settings to their default values')
  resetAll.classList.add('pg-reset-all')
  resetAll.addEventListener('click', () => resetEntries.forEach((entry) => entry.resetToDefault()))
  container.querySelector('.pg-view-settings-header')!.append(resetAll)
  refreshers.push(() => { resetAll.disabled = resetEntries.every((entry) => entry.atDefault()) })

  return refreshers
}
