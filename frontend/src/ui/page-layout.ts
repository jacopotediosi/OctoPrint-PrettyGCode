/* ---- Selectors ---- */

/** Selector of the plugin tab */
export const PG_TAB = '#tab_plugin_prettygcode'

/** Selector of the plugin settings tab */
export const PG_SETTINGS_TAB = '#settings_plugin_prettygcode'

/** Selector of the OctoPrint page container */
const PAGE_CONTAINER = '.page-container'

/** Class marking the page as filled by the plugin view */
const MAXIMIZED_CLASS = 'pg-maximized'

/* ---- Setup ---- */

/** Callback called after the page layout changes, null until the layout is set up */
let notifyLayoutChange: (() => void) | null = null

/**
 * Sets the page layout up
 * @param onLayoutChange - Callback called after the page layout changes
 */
export function initPageLayout (onLayoutChange: () => void): void {
  notifyLayoutChange = onLayoutChange

  // Restore the maximized layout from the URL (bookmarked/embedded maximized view)
  if (new URLSearchParams(location.search).get('maximized')) $(PAGE_CONTAINER).addClass(MAXIMIZED_CLASS)

  $(document).on('fullscreenchange', () => {
    if (document.fullscreenElement) {
      // Fullscreen fills the whole screen with the view
      $(PAGE_CONTAINER).addClass(MAXIMIZED_CLASS)
    } else {
      // Leaving fullscreen restores the maximized state from before entering it
      $(PAGE_CONTAINER).toggleClass(MAXIMIZED_CLASS, wasMaximized)
    }
    onLayoutChange()
  })
}

/* ---- Theme ---- */

/**
 * Repaints the page in the light or dark theme
 * @param darkMode - True for the dark theme
 */
export function applyPageTheme (darkMode: boolean): void {
  $('html').toggleClass('pg-dark', darkMode)
}

/* ---- Maximized view ---- */

/** Last known maximized state */
let wasMaximized = false

/**
 * Tells whether the plugin view fills the page
 * @returns True while the view is maximized
 */
export function isMaximized (): boolean {
  return $(PAGE_CONTAINER).hasClass(MAXIMIZED_CLASS)
}

/** Fills the page with the plugin view, or brings the rest of the page back */
export function toggleMaximized (): void {
  if (document.fullscreenElement) {
    // Fullscreen goes back to the page it came from
    document.exitFullscreen()
  } else {
    const maximized = $(PAGE_CONTAINER).toggleClass(MAXIMIZED_CLASS).hasClass(MAXIMIZED_CLASS)

    // Update maximized parameter in URL
    const url = new URL(window.location.href)
    if (maximized) url.searchParams.set('maximized', '1')
    else url.searchParams.delete('maximized')
    history.replaceState(null, '', url)

    notifyLayoutChange?.()
  }
}

/** Fills the screen with the plugin view, or brings the page back */
export function toggleFullscreen (): void {
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    // Remember the maximized state from before entering fullscreen, to restore it on exit
    wasMaximized = isMaximized()
    document.documentElement.requestFullscreen()
  }
}
