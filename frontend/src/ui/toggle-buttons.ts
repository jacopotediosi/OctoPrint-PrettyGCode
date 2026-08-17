import type { PrettyGCodeApp } from '../app'
import { toggleFullscreen, toggleMaximized } from './page-layout'
import { closeOtherTopLeftWindows, type TopLeftWindowKey } from './windows/top-left-windows'

/** Settings keys of the toggleable windows */
type WindowKey = TopLeftWindowKey | 'showDashboard' | 'showWebcam'

/**
 * Wires the view's toggle buttons
 * @param app - Application instance
 */
export function initToggleButtons (app: PrettyGCodeApp): void {
  /**
   * Toggles a window open or closed
   * @param key - Settings key of the window to toggle
   */
  const toggleWindow = (key: WindowKey): void => {
    app.settings[key] = !app.settings[key]

    // Opening a top left window closes the other ones
    const closed = closeOtherTopLeftWindows(app.settings, key)

    app.settings.save()
    app.applySettings([key, ...closed])
  }

  /* ---- Top left buttons ---- */

  $('.pg-toggle-state').on('click', () => toggleWindow('showState'))
  $('.pg-toggle-files').on('click', () => toggleWindow('showFiles'))
  $('.pg-toggle-legend').on('click', () => toggleWindow('showLegend'))

  /* ---- Top right buttons ---- */

  $('.pg-toggle-view-settings').on('click', () => $('#pg-view-settings').toggleClass('pg-hidden'))

  $('.pg-toggle-maximized').on('click', () => toggleMaximized())
  $('.pg-toggle-fullscreen').on('click', () => toggleFullscreen())

  /* ---- Bottom buttons ---- */

  $('.pg-toggle-dashboard').on('click', () => toggleWindow('showDashboard'))
  $('.pg-toggle-webcam').on('click', () => toggleWindow('showWebcam'))
}
