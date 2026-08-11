import { COLOR_MODES, resolveSegmentColoring } from '../../gcode/colors/color-modes'
import type { ColorModeId } from '../../gcode/colors/color-modes'
import { rgbColorToHexString, type RgbColor } from '../../utils/colors'
import { htmlStringToElement } from '../../utils/html'
import type { PrettyGCodeApp } from '../../app'

/** Markup of a legend row */
const ROW_MARKUP = '<div class="pg-legend-row"><span class="pg-legend-swatch"></span><span class="pg-legend-label"></span></div>'

/** Markup of the row naming the columns */
const COLUMN_NAMES_ROW_MARKUP = '<div class="pg-legend-row pg-legend-column-names"><span class="pg-legend-label"></span></div>'

/** Markup of a measure shown on the right of a row */
const VALUE_MARKUP = '<span class="pg-legend-value"></span>'

/**
 * Adds the measures shown on the right of a row
 * @param row - Row to add them to
 * @param values - Measures to show, in the order of the columns
 */
function addValues (row: HTMLElement, values: string[]): void {
  for (const value of values) {
    const measure = htmlStringToElement(VALUE_MARKUP)
    measure.textContent = value
    row.append(measure)
  }
}

/**
 * Builds the row naming the columns
 * @param names - Name of each column, the swatch one included, the last one covering every column left
 * @returns The row element
 */
function createColumnNamesRow (names: string[]): HTMLElement {
  const row = htmlStringToElement(COLUMN_NAMES_ROW_MARKUP)

  row.querySelector('.pg-legend-label')!.textContent = names[0]
  addValues(row, names.slice(1))
  return row
}

/**
 * Builds a legend row
 * @param color - Color the row stands for
 * @param label - Text naming what the row stands for
 * @param values - Measures shown on the right of the row
 * @returns The row element
 */
function createRow (color: RgbColor, label: string, values: string[]): HTMLElement {
  const row = htmlStringToElement(ROW_MARKUP)

  row.querySelector<HTMLElement>('.pg-legend-swatch')!.style.background = rgbColorToHexString(color)
  row.querySelector('.pg-legend-label')!.textContent = label
  addValues(row, values)
  return row
}

/**
 * Fills the legend window with what the current color mode stands for
 * @param app - Application instance
 */
export function updateLegend (app: PrettyGCodeApp): void {
  const rowsContainer = document.getElementById('pg-legend-rows')!
  const { columnNames, entries } = resolveSegmentColoring(app.gcode, app.settings, (layerNumber) => app.layerSeconds(layerNumber)).legend()

  const rows = entries.map((entry) => createRow(entry.color, entry.label, entry.values))
  if (columnNames.length) rows.unshift(createColumnNamesRow(columnNames))

  // The value columns fit the widest row, the column names one included
  const valueColumns = Math.max(0, columnNames.length - 1, ...entries.map((entry) => entry.values.length))

  rowsContainer.style.gridTemplateColumns = `auto minmax(0, 1fr)${' auto'.repeat(valueColumns)}`
  rowsContainer.replaceChildren(...rows)
}

/**
 * Wires the legend window
 * @param app - Application instance
 */
export function initLegend (app: PrettyGCodeApp): void {
  const modeSelect = document.querySelector<HTMLSelectElement>('.pg-legend-mode')!
  modeSelect.replaceChildren(...Object.entries(COLOR_MODES).map(([id, mode]) => new Option(mode.name, id)))
  modeSelect.value = app.settings.colorMode

  modeSelect.addEventListener('change', () => {
    app.settings.colorMode = modeSelect.value as ColorModeId
    app.settings.save()
    app.applySettings(['colorMode'])
  })
}
