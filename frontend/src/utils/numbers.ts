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

/**
 * Measures the length of a vector
 * @param x - Length along the X axis
 * @param y - Length along the Y axis
 * @param z - Length along the Z axis
 * @returns The length of the vector
 */
export function vectorLength (x: number, y: number, z: number): number {
  // Math.hypot would do the same, but it costs about five times as much to guard against an overflow
  // that the printer-sized values measured here never reach
  return Math.sqrt(x * x + y * y + z * z)
}
