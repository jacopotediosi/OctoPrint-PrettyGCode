import type { PrettyGCodeApp } from '../app'

/**
 * Wires the camera controls
 * @param app - Application instance
 */
export function initCameraControls (app: PrettyGCodeApp): void {
  $('.pg-reset-view').on('click', () => app.resetView())
}

/**
 * Shows or hides the camera controls
 * @param visible - True to show the camera controls
 */
export function applyCameraControlsVisibility (visible: boolean): void {
  $('.pg-camera-controls').toggleClass('pg-hidden', !visible)
}
