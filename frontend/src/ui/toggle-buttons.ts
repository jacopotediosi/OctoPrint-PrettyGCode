import { MAXIMIZED_CLASS, PAGE_CONTAINER, type PrettyGCodeApp } from '../app'

/** Settings keys of the toggleable windows */
type WindowKey = 'showState' | 'showFiles' | 'showLegend' | 'showWebcam' | 'showDashboard'

/** Settings keys of the top left windows */
const TOP_LEFT_WINDOWS: readonly WindowKey[] = ['showState', 'showFiles', 'showLegend']

/** Last known maximized state */
let wasMaximized = false

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
    const closed = app.settings[key] && TOP_LEFT_WINDOWS.includes(key)
      ? TOP_LEFT_WINDOWS.filter((window) => window !== key)
      : []
    for (const window of closed) app.settings[window] = false

    app.settings.save()
    app.applySettings([key, ...closed])
  }

  /* ---- Top left buttons ---- */

  $('.pg-toggle-state').on('click', () => toggleWindow('showState'))
  $('.pg-toggle-files').on('click', () => toggleWindow('showFiles'))
  $('.pg-toggle-legend').on('click', () => toggleWindow('showLegend'))

  /* ---- Top right buttons ---- */

  $('.pg-toggle-view-settings').on('click', () => $('#pg-view-settings').toggleClass('pg-hidden'))

  // Restore the maximized layout from the URL (bookmarked/embedded maximized view)
  if (new URLSearchParams(location.search).get('maximized')) $(PAGE_CONTAINER).addClass(MAXIMIZED_CLASS)

  $('.pg-toggle-maximized').on('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
      return
    }

    // Update maximized parameter in URL
    const maximized = $(PAGE_CONTAINER).toggleClass(MAXIMIZED_CLASS).hasClass(MAXIMIZED_CLASS)
    const url = new URL(window.location.href)
    if (maximized) url.searchParams.set('maximized', '1')
    else url.searchParams.delete('maximized')
    history.replaceState(null, '', url)

    app.updateWindowStates()
  })

  $('.pg-toggle-fullscreen').on('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      // Remember the maximized state from before entering fullscreen, to restore it on exit
      wasMaximized = $(PAGE_CONTAINER).hasClass(MAXIMIZED_CLASS)

      $(PAGE_CONTAINER).addClass(MAXIMIZED_CLASS)
      document.documentElement.requestFullscreen()

      app.updateWindowStates()
    }
  })
  $(document).on('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      // Leaving fullscreen restores the maximized state from before entering it
      $(PAGE_CONTAINER).toggleClass(MAXIMIZED_CLASS, wasMaximized)
      app.updateWindowStates()
    }
  })

  /* ---- Camera controls ---- */

  $('.pg-reset-view').on('click', () => app.resetView())

  /* ---- Bottom buttons ---- */

  $('.pg-toggle-dashboard').on('click', () => toggleWindow('showDashboard'))
  $('.pg-toggle-webcam').on('click', () => toggleWindow('showWebcam'))
}
