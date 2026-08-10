import type { PrettyGCodeApp } from '../../app'
import { bindStepButton } from './slider-step-button'
import { clamp } from '../../utils/numbers'
import { secondsFromNowToClockText, secondsToDurationText } from '../../utils/time'

/** Revealed layer the slider is showing */
let revealedLayer = -1
/** Highest layer the slider can reach */
let maxLayer = -1

/**
 * Creates the layer slider
 * @param app - Application instance
 */
export function initLayerSlider (app: PrettyGCodeApp): void {
  const onStart = (): void => app.setManualSliding(true)
  const onStop = (): void => app.setManualSliding(false)

  /**
   * Moves the displayed layer by a delta
   * @param delta - Layers to move by, negative to go down
   */
  const stepLayer = (delta: number): void => {
    const layer = clamp(app.currentLayerNumber + delta, 0, app.layerCount)
    app.setCurrentLayerNumber(layer)
  }

  // Create HTML elements, slider last so its handle paints over the step buttons
  $('.pg-view').append(
    '<button id="pg-layer-step-up-button" class="pg-step-button pg-layer-step-button btn" title="Layer up" disabled><i class="fa-solid fa-chevron-up"></i></button>',
    '<button id="pg-layer-step-down-button" class="pg-step-button pg-layer-step-button btn" title="Layer down" disabled><i class="fa-solid fa-chevron-down"></i></button>',
    '<div id="pg-layer-slider"></div>'
  )

  // Initialize the slider
  $('#pg-layer-slider').slider({
    id: 'pg-layer-slider-ui',
    orientation: 'vertical',
    reversed: true,
    selection: 'after',
    formatter: () => {
      const height = `${app.settings.beltPrinter ? 'Belt' : 'Z'}: ${app.currentLayerZ}`

      const untilLayer = app.secondsUntilLayer(app.currentLayerNumber)
      if (!untilLayer) return height

      const { seconds, stabilized } = untilLayer
      const left = stabilized
        ? `in ${secondsToDurationText(seconds, 'm')} (~${secondsFromNowToClockText(seconds)})`
        : `in ${formatFuzzyPrintTime(seconds)} (still stabilizing)`

      return [height, left].join('\n')
    },
    min: 0,
    max: 100,
    value: 100
  }).on('slide', (event: any) => {
    app.setCurrentLayerNumber(event.value)
  }).on('slideStart', onStart).on('slideStop', onStop)

  // Step layers with the mouse wheel while hovering the slider
  $('#pg-layer-slider-ui').on('wheel', (event: any) => {
    event.preventDefault()
    const deltaY = (event.originalEvent as WheelEvent).deltaY
    if (deltaY) stepLayer(deltaY < 0 ? 1 : -1)
  })

  // On hover, re-apply the value to reposition the tooltip onto the handle
  $('#pg-layer-slider-ui').on('mouseenter', () => {
    const slider = $('#pg-layer-slider')
    slider.slider('setValue', slider.slider('getValue'))
  })

  // Bind the step buttons
  bindStepButton('#pg-layer-step-up-button', { onStep: () => stepLayer(1), onStart, onStop })
  bindStepButton('#pg-layer-step-down-button', { onStep: () => stepLayer(-1), onStart, onStop })

  // Show the slider tooltip while hovering the step buttons
  $('.pg-layer-step-button').on('mouseenter mouseleave', (event: any) => {
    $('#pg-layer-slider-ui').trigger(event.type)
  })
}

/**
 * Shows or hides the layer slider
 * @param show - True to show the layer slider
 */
export function applyLayerSliderVisibility (show: boolean): void {
  $('#pg-layer-slider-ui, .pg-layer-step-button').toggleClass('pg-hidden', !show)
}

/**
 * (Re)adapts the slider to the loaded gcode's layer count
 * @param app - Application instance
 */
export function updateLayerSliderMax (app: PrettyGCodeApp): void {
  if (!$('#pg-layer-slider').length) return

  if (app.layerCount !== maxLayer) {
    $('#pg-layer-slider').slider('setMax', Math.max(app.layerCount, 1))
    $('#pg-layer-slider').slider(app.layerCount ? 'enable' : 'disable')
  }

  setLayerSliderValue(app, app.layerCount)
}

/**
 * Moves the slider to a layer
 * @param app - Application instance
 * @param layer - 1-based layer number
 */
export function setLayerSliderValue (app: PrettyGCodeApp, layer: number): void {
  if (!$('#pg-layer-slider').length) return
  if (layer === revealedLayer && app.layerCount === maxLayer) return
  revealedLayer = layer
  maxLayer = app.layerCount

  $('#pg-layer-slider').slider('setValue', layer)
  $('#pg-layer-slider-ui .slider-handle').text(layer)

  $('#pg-layer-step-up-button').prop('disabled', layer >= app.layerCount)
  $('#pg-layer-step-down-button').prop('disabled', layer <= 0)
}
