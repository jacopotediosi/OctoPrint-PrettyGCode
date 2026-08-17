import { createBottomWindow, bottomWindowHeight } from './bottom-window'
import { isMaximized, PG_TAB } from '../page-layout'
import { refreshWebcamStreams, selectedTab, startWebcamStreams, stopWebcamStreams } from '../../octoprint/view-models'
import type { Settings } from '../../settings'

/** Placeholder for restoring the webcam containers to their original position */
let restorePlaceholder: Comment | null = null

/* ---- Webcam docking ---- */

/**
 * Finds OctoPrint's webcam containers
 * @returns The webcam plugins container (on OctoPrint 1.9+) or the legacy control tab containers
 */
function getWebcamContainers (): JQuery<HTMLElement> {
  const plugins = $('#webcam_plugins_container')
  return plugins.length ? plugins : $('#webcam_video_container, #webcam_container')
}

/** Moves the webcam containers into the window */
function dockWebcam (): void {
  const containers = getWebcamContainers()
  if (!containers.length || containers.parent().is('#pg-webcam')) return

  // Keep the placeholder from the first dock if another plugin moved the containers meanwhile
  if (!restorePlaceholder) {
    restorePlaceholder = document.createComment('pg-webcam-placeholder')
    containers[0].before(restorePlaceholder)
  }
  containers.prependTo('#pg-webcam')

  if (containers.is('#webcam_plugins_container')) {
    refreshWebcamStreams()
  } else {
    // Reclaim pieces UICustomizer may have moved to its sidebar widget or hidden
    if ($('#UICWebCamWidget').length) {
      const rotator = $('#webcam_rotator')
      if (!rotator.closest('#webcam_container').length) $('#webcam_container').append(rotator)
      containers.removeClass('UICHideHard').css('display', '')
    }

    startWebcamStreams()
  }
}

/** Puts the webcam containers back in their original position */
function undockWebcam (): void {
  if (!restorePlaceholder) return

  const placeholder = restorePlaceholder
  const containers = getWebcamContainers()
  if (containers.parent().is('#pg-webcam')) containers.each(function () { placeholder.before(this) })
  placeholder.remove()
  restorePlaceholder = null

  if (containers.is('#webcam_plugins_container')) refreshWebcamStreams()
  else stopWebcamStreams()
}

/* ---- Window ---- */

/** Markup of the webcam window */
const WINDOW_MARKUP = '<div id="pg-webcam"></div>'

/**
 * Resizes the webcam window
 * @param height - Height in px
 */
function applyWebcamHeight (height: number): void {
  const webcam = $('#pg-webcam')
  if (!webcam.length) return

  // The docked content derives its height from the width, so steer the width toward the target height
  const rect = webcam[0].getBoundingClientRect()
  if (Math.abs(rect.height - height) < 1) return
  const aspect = rect.height ? rect.width / rect.height : 16 / 9
  webcam.css('width', Math.round(height * aspect) + 'px')
}

/**
 * Shows or hides the webcam window to match the current settings, docking or undocking the webcam containers
 * @param settings - Plugin frontend settings
 */
export function updateWebcamWindow (settings: Settings): void {
  const webcamContainersAvailable = getWebcamContainers().length > 0

  $('.pg-view #pg-webcam').toggleClass('pg-hidden', !settings.showWebcam || !webcamContainersAvailable)
  if (settings.showWebcam) applyWebcamHeight(bottomWindowHeight(settings, 'webcamHeight'))

  // Dock only while the window is actually visible: our tab selected, maximized, and the setting enabled
  const visible = webcamContainersAvailable && settings.showWebcam &&
    selectedTab() === PG_TAB && isMaximized()
  if (visible) dockWebcam()
  else undockWebcam()
}

/**
 * Creates the webcam window
 * @param settings - Plugin frontend settings
 */
export function initWebcamWindow (settings: Settings): void {
  $('.pg-view').append(WINDOW_MARKUP)

  createBottomWindow(settings, {
    $element: $('#pg-webcam'),
    heightSetting: 'webcamHeight',
    applyHeight: applyWebcamHeight,
    handles: ['top', 'left']
  })
}
