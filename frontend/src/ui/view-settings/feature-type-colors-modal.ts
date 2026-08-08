import { type FeatureTypeColorPreset, type FeatureTypeColorRule, cloneFeatureTypeColorRules } from '../../gcode/feature-type-colors'
import type { Settings } from '../../settings'

/** Handles of the feature type colors modal */
export interface FeatureTypeColorsModal {
  /** Opens the modal */
  open: () => void
  /** Resets the colors to their defaults */
  resetToDefault: () => void
}

/**
 * Turns an HTML string into an element
 * @param markup - HTML with a single root element
 * @returns The element the markup describes
 */
function htmlStringToElement (markup: string): HTMLElement {
  const template = document.createElement('template')
  template.innerHTML = markup.trim()
  return template.content.firstElementChild as HTMLElement
}

/** Markup of the feature type colors modal */
const MODAL_MARKUP = `
  <div class="modal hide fade pg-modal-color">
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal">&times;</button>
      <h3 class="pg-modal-color-title">
        Feature type colors
        <button type="button" class="pg-reset pg-modal-color-reset" title="Reset colors to their defaults"><i class="fa-solid fa-arrow-rotate-left"></i></button>
      </h3>
    </div>
    <div class="modal-body">
      <p class="help-block">
        Each row below colors the gcode wherever a slicer comment contains one of its keywords.
        Drag the rows to set priority: the first match from the top wins, and anything unmatched uses the Default color.
      </p>
      <div class="pg-modal-color-preset">
        <span class="pg-modal-color-preset-label">Slicer preset</span>
        <select class="pg-modal-color-preset-select" title="Preset of colors to load into the rules below"></select>
        <button type="button" class="btn pg-modal-color-preset-load">Load</button>
      </div>
      <div class="pg-modal-color-default">
        <span class="pg-modal-color-default-label">Default color</span>
        <input type="color" class="pg-modal-color-swatch" title="Color of segments matching no color rule">
      </div>
      <div class="pg-modal-color-rules"></div>
      <button type="button" class="btn pg-modal-color-add"><i class="fa-solid fa-plus"></i> Add color</button>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn" data-dismiss="modal">Close</button>
    </div>
  </div>
`

/** Markup of a single color rule row */
const ROW_MARKUP = `
  <div class="pg-modal-color-rule">
    <span class="pg-modal-color-handle" draggable="true" title="Drag to reorder"><i class="fa-solid fa-grip-vertical"></i></span>
    <input type="text" class="pg-modal-color-keywords" placeholder="keywords" title="Keywords to look for in gcode comments, separated by commas">
    <input type="color" class="pg-modal-color-swatch" title="Color to paint the matching segments">
    <button type="button" class="btn btn-small pg-modal-color-remove" title="Remove this color rule"><i class="fa-solid fa-trash-can"></i></button>
  </div>
`

/**
 * Builds the modal to customize the feature type colors
 * @param settings - Settings holding the feature type colors to customize
 * @param colorPresets - Color presets offered for loading into the settings
 * @param onChange - Callback called after a color change
 * @returns A handle to open and reset the modal
 */
export function initFeatureTypeColorsModal (settings: Settings, colorPresets: FeatureTypeColorPreset[], onChange: () => void): FeatureTypeColorsModal {
  const modal = htmlStringToElement(MODAL_MARKUP)

  const resetButton = modal.querySelector<HTMLButtonElement>('.pg-modal-color-reset')!

  const presetSelect = modal.querySelector<HTMLSelectElement>('.pg-modal-color-preset-select')!
  const presetLoadButton = modal.querySelector<HTMLButtonElement>('.pg-modal-color-preset-load')!

  const defaultColorInput = modal.querySelector<HTMLInputElement>('.pg-modal-color-default .pg-modal-color-swatch')!

  const colorRulesContainer = modal.querySelector<HTMLElement>('.pg-modal-color-rules')!
  const addButton = modal.querySelector<HTMLElement>('.pg-modal-color-add')!

  let draggedRow: HTMLElement | null = null

  /* ---- Preset & reset controls ---- */

  /** Index of the preset matching the current colors, or -1 when they match none */
  const currentPresetIndex = (): number =>
    colorPresets.findIndex((preset) =>
      settings.matches('featureTypeDefaultColor', preset.defaultColor) && settings.matches('featureTypeColorRules', preset.colorRules))

  /** Enables preset Load button only when the selected option is not the current preset */
  const refreshPresetLoadButton = (): void => {
    const selected = Number(presetSelect.value)
    presetLoadButton.disabled = selected < 0 || selected === currentPresetIndex()
  }

  /** Refreshes controls to reflect the current colors */
  const refreshControls = (): void => {
    // Reset button
    resetButton.disabled = settings.isDefault('featureTypeDefaultColor') && settings.isDefault('featureTypeColorRules')

    // Preset select
    const current = currentPresetIndex()
    const options = colorPresets.map((preset, i) => new Option(preset.name, String(i)))
    if (current < 0) options.unshift(new Option('Custom', String(current)))
    presetSelect.replaceChildren(...options)
    presetSelect.value = String(current)
    refreshPresetLoadButton()
  }

  /* ---- Committing ---- */

  /** Applies the current colors */
  const applyChange = (): void => {
    onChange()
    refreshControls()
  }

  /** Saves the input values to the settings and applies them */
  const commit = (): void => {
    settings.featureTypeDefaultColor = defaultColorInput.value
    settings.featureTypeColorRules = [...colorRulesContainer.querySelectorAll<HTMLElement>('.pg-modal-color-rule')].map((row) => ({
      keywords: row.querySelector<HTMLInputElement>('.pg-modal-color-keywords')!.value.split(',').map((keyword) => keyword.trim()).filter(Boolean),
      color: row.querySelector<HTMLInputElement>('.pg-modal-color-swatch')!.value
    }))
    applyChange()
  }

  /* ---- Rule rows ---- */

  /**
   * Builds a color rule row
   * @param rule - Color rule to show
   * @returns The row element
   */
  const createRow = (rule: FeatureTypeColorRule): HTMLElement => {
    const row = htmlStringToElement(ROW_MARKUP)

    const keywords = row.querySelector<HTMLInputElement>('.pg-modal-color-keywords')!
    keywords.value = rule.keywords.join(',')
    keywords.addEventListener('change', commit)

    const swatch = row.querySelector<HTMLInputElement>('.pg-modal-color-swatch')!
    swatch.value = rule.color
    swatch.addEventListener('change', commit)

    row.querySelector('.pg-modal-color-remove')!.addEventListener('click', () => { row.remove(); commit() })

    return row
  }

  /** Fills the inputs with the current colors */
  const fillInputs = (): void => {
    defaultColorInput.value = settings.featureTypeDefaultColor
    colorRulesContainer.replaceChildren(...settings.featureTypeColorRules.map(createRow))
  }

  /**
   * Finds the first row below the mouse
   * @param y - Mouse vertical position on the screen
   * @returns That row, or null if the mouse is past the last row
   */
  const firstRowBelow = (y: number): HTMLElement | null =>
    [...colorRulesContainer.querySelectorAll<HTMLElement>('.pg-modal-color-rule:not(.pg-modal-color-dragging)')]
      .find((row) => y < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2) ?? null

  colorRulesContainer.addEventListener('dragstart', (event) => {
    const handle = (event.target as HTMLElement).closest('.pg-modal-color-handle')
    if (!handle) { event.preventDefault(); return }
    draggedRow = handle.closest<HTMLElement>('.pg-modal-color-rule')
    draggedRow?.classList.add('pg-modal-color-dragging')
    event.dataTransfer!.effectAllowed = 'move'
  })
  colorRulesContainer.addEventListener('dragover', (event) => {
    if (!draggedRow) return
    event.preventDefault()
    const nextRow = firstRowBelow(event.clientY)
    if (nextRow == null) colorRulesContainer.append(draggedRow)
    else if (nextRow !== draggedRow) colorRulesContainer.insertBefore(draggedRow, nextRow)
  })
  colorRulesContainer.addEventListener('drop', (event) => event.preventDefault())
  colorRulesContainer.addEventListener('dragend', () => {
    if (!draggedRow) return
    draggedRow.classList.remove('pg-modal-color-dragging')
    draggedRow = null
    commit()
  })

  addButton.addEventListener('click', () => {
    const row = createRow({ keywords: [], color: '#ffffff' })
    colorRulesContainer.append(row)
    row.querySelector<HTMLInputElement>('.pg-modal-color-keywords')!.focus()
  })

  /* ---- Lifecycle ---- */

  /**
   * Replaces the colors with the given ones and applies them
   * @param defaultColor - New default color
   * @param rules - New color rules
   */
  const replaceColors = (defaultColor: string, rules: FeatureTypeColorRule[]): void => {
    settings.featureTypeDefaultColor = defaultColor
    settings.featureTypeColorRules = rules
    fillInputs()
    applyChange()
  }

  /** Opens the modal */
  const open = (): void => { fillInputs(); refreshControls(); $(modal).modal('show') }

  /** Reset to the default colors */
  const resetToDefault = (): void => replaceColors(settings.defaultOf('featureTypeDefaultColor'), cloneFeatureTypeColorRules(settings.defaultOf('featureTypeColorRules')))

  // Control listeners
  presetSelect.addEventListener('change', refreshPresetLoadButton)
  presetLoadButton.addEventListener('click', () => {
    const preset = colorPresets[Number(presetSelect.value)]
    replaceColors(preset.defaultColor, cloneFeatureTypeColorRules(preset.colorRules))
  })
  defaultColorInput.addEventListener('change', commit)
  resetButton.addEventListener('click', resetToDefault)

  // Append modal to body
  document.body.appendChild(modal)
  $(modal).modal({ show: false })

  // Return
  return { open, resetToDefault }
}
