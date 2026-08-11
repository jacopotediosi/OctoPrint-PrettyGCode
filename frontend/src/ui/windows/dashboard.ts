import { clampBottomWindowHeight, createBottomWindow, bottomWindowHeight } from './bottom-window'
import { isMaximized } from '../page-layout'
import type { Settings } from '../../settings'

/**
 * Resizes the dashboard window
 * @param height - Height in px
 */
function applyDashboardHeight (height: number): void {
  const dashboardElement = document.getElementById('tab_plugin_dashboard')
  if (!dashboardElement) return

  const target = clampBottomWindowHeight(height)

  // The window is a scaled miniature: derive the scale from the content's natural height
  if (dashboardElement.offsetHeight) dashboardElement.style.setProperty('--pg-dashboard-scale', String(target / dashboardElement.offsetHeight))
}

/**
 * Shows or hides the dashboard window to match the current settings
 * @param settings - Plugin frontend settings
 */
export function updateDashboardWindow (settings: Settings): void {
  $('#tab_plugin_dashboard').toggleClass('pg-hidden', !settings.showDashboard)
  if (settings.showDashboard && isMaximized()) applyDashboardHeight(bottomWindowHeight(settings, 'dashboardHeight'))
}

/**
 * Creates the dashboard window
 * @param settings - Plugin frontend settings
 */
export function initDashboardWindow (settings: Settings): void {
  const $dashboard = $('#tab_plugin_dashboard')
  if (!$dashboard.length) return

  createBottomWindow(settings, {
    $element: $dashboard,
    heightSetting: 'dashboardHeight',
    applyHeight: applyDashboardHeight,
    handles: ['top', 'right'],
    refresh: () => updateDashboardWindow(settings)
  })
}
