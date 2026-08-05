import { MAXIMIZED_CLASS, PAGE_CONTAINER, type PrettyGCodeApp } from '../app'

/** Settings keys of the toggleable windows */
type WindowKey = 'showState' | 'showFiles' | 'showWebcam' | 'showDashboard'

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
   * @param closes - Settings key of the window to close when the toggled one opens
   */
  const toggleWindow = (key: WindowKey, closes?: WindowKey): void => {
    app.settings[key] = !app.settings[key]
    if (app.settings[key] && closes) app.settings[closes] = false
    app.settings.save()
    app.applySettings(closes ? [key, closes] : [key])
  }

  /* ---- Top left buttons ---- */

  $('.pg-toggle-state').on('click', () => toggleWindow('showState', 'showFiles'))
  $('.pg-toggle-files').on('click', () => toggleWindow('showFiles', 'showState'))

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
