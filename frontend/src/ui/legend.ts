import { COLOR_MODES, colorModeContext, propertyRange, propertyRangeColorAt, propertyRangeSteps, propertyValueUsage } from '../gcode/colors/segment'
import type { ColorMode, ColorModeContext, ColorModeId, PropertyFixedColors, PropertyValueUsage } from '../gcode/colors/segment'
import { rgbColorToHexString, type RgbColor } from '../utils/colors'
import { htmlStringToElement } from '../utils/html'
import { secondsToDurationText } from '../utils/time'
import type { PrettyGCodeApp } from '../app'

/** What the legend window shows */
interface LegendRows {
  /** Row elements, the column names one included */
  rows: HTMLElement[]
  /** How many measures the rows show on the right of their label */
  valueColumns: number
}

/** Markup of a measure shown on the right of a row */
const VALUE_MARKUP = '<span class="pg-legend-value"></span>'

/**
 * Builds the row naming the columns of the feature type rows
 * @param names - Name of each column, the swatch one included, the last one covering every column left
 * @returns The row element
 */
function createColumnNamesRow (names: string[]): HTMLElement {
  const row = htmlStringToElement(`
    <div class="pg-legend-row pg-legend-column-names">
      <span class="pg-legend-label"></span>
      ${VALUE_MARKUP.repeat(names.length - 1)}
    </div>
  `)

  names.forEach((name, column) => { row.children[column].textContent = name })
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
  const row = htmlStringToElement(`
    <div class="pg-legend-row">
      <span class="pg-legend-swatch"></span>
      <span class="pg-legend-label"></span>
      ${VALUE_MARKUP.repeat(values.length)}
    </div>
  `)

  row.querySelector<HTMLElement>('.pg-legend-swatch')!.style.background = rgbColorToHexString(color)
  row.querySelector('.pg-legend-label')!.textContent = label
  row.querySelectorAll('.pg-legend-value').forEach((measure, column) => { measure.textContent = values[column] })
  return row
}

/**
 * Builds the rows describing the values a color mode paints one by one
 * @param app - Application instance
 * @param mode - Color mode to describe
 * @param context - What the color modes read the gcode with
 * @param fixedColors - Colors the values of the mode's property are fixed to
 * @returns The rows, last printed first where the values run with the print, most used first otherwise
 */
function fixedColorRows (app: PrettyGCodeApp, mode: ColorMode, context: ColorModeContext, fixedColors: PropertyFixedColors): LegendRows {
  const gcode = app.gcode

  // Weighing the filament takes a diameter and a density only some slicers state
  const density = mode.measuresFilamentUsage && gcode.slicerFilamentDiameter != null ? gcode.slicerFilamentDensity : null

  // Tells whether a value has a color of its own, the others sharing the default one
  const colored = (used: PropertyValueUsage): boolean => fixedColors.colors[used.value] !== undefined

  const usage = propertyValueUsage(gcode.layers, (layer, layerNumber) => mode.propertyOf(layer, layerNumber, context))
  if (fixedColors.inPrintOrder) {
    usage.reverse()
  } else {
    usage.sort((first, second) => Number(colored(second)) - Number(colored(first)) || second.timeShare - first.timeShare)
  }

  const rows = usage.map((used) => {
    const values = mode.measuresFilamentUsage ? [(used.timeShare * 100).toFixed(1) + ' %', (used.filamentMm / 1000).toFixed(2) + ' m'] : []
    if (density != null) values.push((used.filamentMm * context.filamentArea * density / 1000).toFixed(1) + ' g')

    return createRow(fixedColors.colors[used.value] ?? fixedColors.defaultColor, fixedColors.nameOf(used.value), values)
  })

  const columnNames = mode.measuresFilamentUsage ? [mode.name, 'Percentage', 'Used filament'] : [mode.name]
  const valueColumns = mode.measuresFilamentUsage ? (density != null ? 3 : 2) : 0
  return { rows: [createColumnNamesRow(columnNames), ...rows], valueColumns }
}

/**
 * Builds the rows describing the range a color mode spreads over
 * @param app - Application instance
 * @param mode - Color mode to describe
 * @param context - What the color modes read the gcode with
 * @returns The rows, from the highest value to the lowest
 */
function rangeRows (app: PrettyGCodeApp, mode: ColorMode, context: ColorModeContext): LegendRows {
  const range = propertyRange(app.gcode.layers, (layer, layerNumber) => mode.propertyOf(layer, layerNumber, context), mode.decimals)

  const rows = propertyRangeSteps(range, mode.logarithmic).map((value) =>
    createRow(propertyRangeColorAt(value, range, mode.logarithmic), mode.duration ? secondsToDurationText(value, 's') : value.toFixed(mode.decimals) + ' ' + mode.unit, [])
  ).reverse()

  return { rows, valueColumns: 0 }
}

/**
 * Fills the legend window with what the current color mode stands for
 * @param app - Application instance
 */
export function updateLegend (app: PrettyGCodeApp): void {
  const rowsContainer = document.getElementById('pg-legend-rows')!
  const mode: ColorMode = COLOR_MODES[app.settings.colorMode]
  const context = colorModeContext(app.gcode, (layerNumber) => app.layerSeconds(layerNumber))

  const fixedColors = mode.fixedColors?.(app.gcode, app.settings)
  const { rows, valueColumns } = fixedColors
    ? fixedColorRows(app, mode, context, fixedColors)
    : rangeRows(app, mode, context)

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

/**
 * Shows or hides the legend window
 * @param visible - True to show it
 */
export function applyLegendVisibility (visible: boolean): void {
  $('#pg-legend').toggleClass('pg-hidden', !visible)
}
