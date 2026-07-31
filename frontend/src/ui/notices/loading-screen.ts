/** Shows the loading screen */
export function showLoadingScreen (): void {
  $('#pg-loading').removeClass('pg-hidden')
}

/** Hides the loading screen */
export function hideLoadingScreen (): void {
  $('#pg-loading').addClass('pg-hidden')
}
