/**
 * Holds a value within a range
 * @param value - Value to hold
 * @param lowest - Lowest value it can take
 * @param highest - Highest value it can take
 * @returns The value, held within the range
 */
export function clamp (value: number, lowest: number, highest: number): number {
  return Math.min(Math.max(value, lowest), highest)
}
