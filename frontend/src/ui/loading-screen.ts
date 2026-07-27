/** Shows the loading screen */
export function showLoadingScreen () {
  $('#pg-loading').removeClass('pg-hidden')
}

/** Hides the loading screen */
export function hideLoadingScreen () {
  $('#pg-loading').addClass('pg-hidden')
}
