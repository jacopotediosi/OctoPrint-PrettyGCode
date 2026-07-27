/**
 * Sets the status bar text
 * @param text - Text to show
 */
export function setStatusBarText (text: string): void {
  $('.pg-status').text(text)
}

/**
 * Shows or hides the status bar
 * @param show - True to show the status bar
 */
export function applyStatusBarVisibility (show: boolean): void {
  $('.pg-status').toggleClass('pg-hidden', !show)
}
