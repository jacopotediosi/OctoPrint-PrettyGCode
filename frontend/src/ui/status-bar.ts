import type { PrinterTemperatures } from '../app'

/**
 * Sets the temperatures the status bar shows
 * @param temperatures - Temperatures read over time, the latest last
 */
export function setStatusBarTemperatures (temperatures: PrinterTemperatures[]): void {
  const latest = temperatures[temperatures.length - 1]
  if (!latest) return

  const hasSeveralTools = Object.keys(latest).filter((heater) => heater.startsWith('tool')).length > 1

  const readouts: string[] = []
  for (const [heater, temperature] of Object.entries(latest)) {
    // Skip the heaters the printer does not have, which come without a reading
    if (typeof temperature === 'number' || temperature.actual == null) continue

    const label = hasSeveralTools && heater.startsWith('tool') ? 'T' + heater.slice(4) : heater[0].toUpperCase()
    const target = temperature.target == null ? '' : `/${temperature.target.toFixed(1)}`
    readouts.push(`${label}:${temperature.actual.toFixed(1)}${target}`)
  }

  $('.pg-status').text(readouts.join(' '))
}

/**
 * Shows or hides the status bar
 * @param show - True to show the status bar
 */
export function applyStatusBarVisibility (show: boolean): void {
  $('.pg-status').toggleClass('pg-hidden', !show)
}
