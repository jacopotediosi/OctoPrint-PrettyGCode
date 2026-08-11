import type { RgbColor } from '../../utils/colors'

/** The colors the values of a property are fixed to, one each, and the names they go by */
export interface PropertyFixedColors {
  /** Color fixed for each value the property takes, undefined where none is */
  colors: Array<RgbColor | undefined>
  /** Color of the values no color is fixed for */
  defaultColor: RgbColor
  /** Name a value goes by */
  nameOf: (value: number) => string
  /** Whether the values run in the order the print takes them */
  inPrintOrder?: boolean
}
