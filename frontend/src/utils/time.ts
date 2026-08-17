/** Units a duration is spelled out in, from the largest to the smallest */
const DURATION_UNITS = [
  { suffix: 'd', seconds: 86400 },
  { suffix: 'h', seconds: 3600 },
  { suffix: 'm', seconds: 60 },
  { suffix: 's', seconds: 1 }
] as const

/** Unit a duration is spelled out down to */
export type DurationUnit = typeof DURATION_UNITS[number]['suffix']

/**
 * Spells out how long something takes, in the two largest units it fills
 * @param seconds - Duration to spell out
 * @param smallestUnit - Smallest unit to spell out, taken alone when the duration is under it
 * @returns The duration as text
 */
export function secondsToDurationText (seconds: number, smallestUnit: DurationUnit): string {
  const smallest = DURATION_UNITS.findIndex((unit) => unit.suffix === smallestUnit)
  const largest = DURATION_UNITS.findIndex((unit) => Math.max(seconds, 1) >= unit.seconds)
  const last = Math.max(largest, Math.min(largest + 1, smallest))

  let rest = seconds
  return DURATION_UNITS.slice(largest, last + 1).map((unit, index) => {
    const value = largest + index === last ? Math.round(rest / unit.seconds) : Math.floor(rest / unit.seconds)
    rest -= value * unit.seconds
    return value + unit.suffix
  }).join(' ')
}

/**
 * Reads the clock a number of seconds from now, on a 24 hour dial
 * @param seconds - Seconds from now
 * @returns The time as text, carrying the date when it falls on another day
 */
export function secondsFromNowToClockText (seconds: number): string {
  const futureTime = new Date(Date.now() + seconds * 1000)
  const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }

  if (futureTime.toDateString() !== new Date().toDateString()) {
    options.day = '2-digit'
    options.month = '2-digit'
  }

  return futureTime.toLocaleString([], options)
}
