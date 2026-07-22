/** Milliseconds a step button must be held before it auto-repeats */
const STEP_HOLD_DELAY_MS = 500
/** Milliseconds between steps while a step button is held */
const STEP_HOLD_REPEAT_MS = 50

/** Callbacks driving a hold-to-repeat slider step button */
interface StepButtonActions {
  onStep: () => void
  onStart: () => void
  onStop: () => void
}

/**
 * Makes a button run an action once per click and repeatedly while held
 * @param button - Selector of the step button
 * @param actions - Step, start and stop callbacks
 */
export function bindStepButton (button: string, { onStep, onStart, onStop }: StepButtonActions) {
  let delayTimer: number | undefined
  let repeatTimer: number | undefined
  let repeated = false

  const release = () => {
    clearTimeout(delayTimer)
    clearInterval(repeatTimer)
    onStop()
    $(document).off('pointerup pointercancel', release)
  }

  $(button).on('pointerdown', () => {
    repeated = false
    onStart()
    delayTimer = window.setTimeout(() => {
      repeatTimer = window.setInterval(() => {
        repeated = true
        onStep()
      }, STEP_HOLD_REPEAT_MS)
    }, STEP_HOLD_DELAY_MS)
    $(document).on('pointerup pointercancel', release)
  }).on('click', () => {
    if (!repeated) onStep()
    repeated = false
  })
}
