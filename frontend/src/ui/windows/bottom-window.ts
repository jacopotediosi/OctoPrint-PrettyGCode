import { htmlStringToElement } from '../../utils/html'
import { clamp } from '../../utils/numbers'
import type { Settings } from '../../settings'

/** Markup of a drag handle resizing a window */
const HANDLE_MARKUP = '<div class="pg-resize-handle"></div>'

/** Settings key holding the height of a window in px */
export type BottomWindowHeightKey = 'dashboardHeight' | 'webcamHeight'

/** Side of a window a drag handle sits on */
type ResizeHandleSide = 'top' | 'left' | 'right'

/** How a window is resized and where its size is kept */
interface BottomWindowDefinition {
  /** Element the window is drawn in */
  $element: JQuery
  /** Setting holding the window height in px, 0 for the default one */
  heightSetting: BottomWindowHeightKey
  /** Resizes the window to the given height in px */
  applyHeight: (height: number) => void
  /** Sides the window is resized by dragging */
  handles: ResizeHandleSide[]
  /** Brings the window back to the height it must have, absent to just resize it */
  refresh?: () => void
}

/** A resizable window sized through its height in px */
interface BottomWindow {
  /** Element the window is drawn in */
  $element: JQuery
  /** Callback called with the new height in px while the window is dragged */
  apply: (height: number) => void
  /** Callback called when the drag ends, saving the window size in settings */
  persist: () => void
}

/** Minimum window height in px */
const MIN_WINDOW_HEIGHT = 50
/** Maximum window height as a share of the viewport height */
const MAX_WINDOW_HEIGHT_FRACTION = 0.9
/** Default window height as a share of the viewport height */
const DEFAULT_WINDOW_HEIGHT_FRACTION = 1 / 3

/**
 * Gets the height a bottom window must have
 * @param settings - Plugin frontend settings
 * @param heightSetting - Setting holding the window height in px, 0 for the default one
 * @returns The height in px
 */
export function bottomWindowHeight (settings: Settings, heightSetting: BottomWindowHeightKey): number {
  return settings[heightSetting] || Math.round(window.innerHeight * DEFAULT_WINDOW_HEIGHT_FRACTION)
}

/**
 * Clamps a bottom window height to the allowed range
 * @param height - Desired height in px
 * @returns The clamped height in px
 */
export function clampBottomWindowHeight (height: number): number {
  return clamp(height, MIN_WINDOW_HEIGHT, window.innerHeight * MAX_WINDOW_HEIGHT_FRACTION)
}

/**
 * Makes a window resizable by dragging a handle, scaling its height proportionally to the drag
 * @param $handle - Drag handle element
 * @param bottomWindow - Window to resize
 * @param axis - Pointer axis the drag follows
 * @param direction - 1 if dragging along the axis grows the window, -1 otherwise
 */
function makeResizable ($handle: JQuery, bottomWindow: BottomWindow, axis: 'x' | 'y', direction: 1 | -1): void {
  const pointerCoord = axis === 'x' ? 'clientX' : 'clientY'
  $handle.on('pointerdown', function (e) {
    const pointerEvent = (e.originalEvent ?? e) as PointerEvent
    e.preventDefault()
    e.stopPropagation()

    const startSize = bottomWindow.$element[0].getBoundingClientRect()
    const startCoord = pointerEvent[pointerCoord]
    const startDimension = axis === 'x' ? startSize.width : startSize.height
    if (this.setPointerCapture) this.setPointerCapture(pointerEvent.pointerId)

    const onMove = (ev: JQuery.TriggeredEvent): void => {
      const delta = direction * (((ev.originalEvent ?? ev) as PointerEvent)[pointerCoord] - startCoord)
      if (startDimension) bottomWindow.apply(startSize.height * (startDimension + delta) / startDimension)
    }
    const onUp = (): void => {
      $handle.off('pointermove', onMove).off('pointerup pointercancel', onUp)
      bottomWindow.persist()
    }
    $handle.on('pointermove', onMove).on('pointerup pointercancel', onUp)
  })
}

/**
 * Creates a resizable window, keeping its height in step with its content
 * @param settings - Plugin frontend settings
 * @param def - How the window is resized and where its size is kept
 */
export function createBottomWindow (settings: Settings, def: BottomWindowDefinition): void {
  const { $element, heightSetting, applyHeight, handles } = def
  const refresh = def.refresh ?? (() => applyHeight(bottomWindowHeight(settings, heightSetting)))

  const bottomWindow: BottomWindow = {
    $element,
    apply (height: number) {
      settings[heightSetting] = Math.round(clampBottomWindowHeight(height))
      applyHeight(settings[heightSetting])
    },
    persist: () => settings.save()
  }

  // Pointer axis each side is dragged along, and the direction dragging it away from the window grows it
  const handleDrags: Record<ResizeHandleSide, { axis: 'x' | 'y', direction: 1 | -1 }> = {
    top: { axis: 'y', direction: -1 },
    left: { axis: 'x', direction: -1 },
    right: { axis: 'x', direction: 1 }
  }

  for (const side of handles) {
    const handle = htmlStringToElement(HANDLE_MARKUP)
    handle.classList.add('pg-resize-' + side)
    $element.append(handle)

    const { axis, direction } = handleDrags[side]
    makeResizable($(handle), bottomWindow, axis, direction)
  }

  refresh()

  // The content fills in after startup: keep the window in step with it
  // Resize on the next frame so the observer does not react to its own changes
  const contentObserver = new ResizeObserver(() => requestAnimationFrame(refresh))
  contentObserver.observe($element[0])
}
