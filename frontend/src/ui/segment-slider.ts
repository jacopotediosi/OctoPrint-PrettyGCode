import type { PrettyGCodeApp } from '../app'
import { bindStepButton } from './slider-step-button'

/**
 * Creates the segment slider
 * @param app - Application instance
 */
export function initSegmentSlider (app: PrettyGCodeApp) {
  const onStart = () => app.setManualSliding(true)
  const onStop = () => app.setManualSliding(false)

  /**
   * Moves the displayed segment by a delta
   * @param delta - Segments to move by, negative to go back
   */
  const stepSegment = (delta: number) => {
    const segment = Math.min(Math.max(app.currentSegmentNumber + delta, 0), app.currentLayerSegmentCount)
    app.setCurrentSegmentNumber(segment)
  }

  // Create HTML elements, slider last so its handle paints over the step buttons
  $('.pg-view').append(
    '<button id="pg-segment-step-back-button" class="pg-segment-step-button btn" title="Segment back" disabled><i class="fa-solid fa-chevron-left"></i></button>',
    '<button id="pg-segment-step-forward-button" class="pg-segment-step-button btn" title="Segment forward" disabled><i class="fa-solid fa-chevron-right"></i></button>',
    '<div id="pg-segment-slider"></div>'
  )

  // Initialize the slider
  $('#pg-segment-slider').slider({
    id: 'pg-segment-slider-ui',
    orientation: 'horizontal',
    selection: 'before',
    tooltip: 'hide',
    min: 0,
    max: 100,
    value: 100
  }).on('slide', (event: any) => {
    app.setCurrentSegmentNumber(event.value)
  }).on('slideStart', onStart).on('slideStop', onStop)

  // Step segments with the mouse wheel while hovering the slider
  $('#pg-segment-slider-ui').on('wheel', (event: any) => {
    event.preventDefault()
    const deltaY = (event.originalEvent as WheelEvent).deltaY
    if (deltaY) stepSegment(deltaY < 0 ? 1 : -1)
  })

  // Bind the step buttons
  bindStepButton('#pg-segment-step-back-button', { onStep: () => stepSegment(-1), onStart, onStop })
  bindStepButton('#pg-segment-step-forward-button', { onStep: () => stepSegment(1), onStart, onStop })
}

/**
 * (Re)adapts the slider to the current layer's segment count
 * @param app - Application instance
 */
export function updateSegmentSliderMax (app: PrettyGCodeApp) {
  if (!$('#pg-segment-slider').length) return

  const segmentCount = app.currentLayerSegmentCount
  $('#pg-segment-slider').slider('setMax', Math.max(segmentCount, 1))
  $('#pg-segment-slider').slider(segmentCount ? 'enable' : 'disable')

  setSegmentSliderValue(app, app.currentSegmentNumber)
}

/**
 * Moves the slider to a within-layer position
 * @param app - Application instance
 * @param segment - Segments of the current layer to show
 */
export function setSegmentSliderValue (app: PrettyGCodeApp, segment: number) {
  if (!$('#pg-segment-slider').length) return

  const segmentCount = app.currentLayerSegmentCount

  $('#pg-segment-slider').slider('setValue', segment)
  $('#pg-segment-slider-ui .slider-handle').text(segmentCount ? Math.round(segment / segmentCount * 100) + '%' : '0%')

  $('#pg-segment-step-back-button').prop('disabled', segment <= 0)
  $('#pg-segment-step-forward-button').prop('disabled', segment >= segmentCount)
}
