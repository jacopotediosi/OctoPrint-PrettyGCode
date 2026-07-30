/**
 * Asks the user whether to load a large gcode file
 * @param sizeBytes - Size of the file to load
 * @param onConfirm - Called when the user confirms the load
 */
export function showLargeFileConfirmation (sizeBytes: number, onConfirm: () => void): void {
  $('#pg-large-file-confirmation-size').text(formatSize(sizeBytes))
  $('#pg-large-file-confirmation-load').off('click').on('click', onConfirm)
  $('#pg-large-file-confirmation').removeClass('pg-hidden')
}

/** Hides the large file confirmation */
export function hideLargeFileConfirmation (): void {
  $('#pg-large-file-confirmation').addClass('pg-hidden')
}
