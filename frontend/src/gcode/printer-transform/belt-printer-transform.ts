import type { MachineState, ScenePoint } from '../parsing/parser'

/**
 * Coordinate transform of a belt printer: its head hangs from a gantry tilted over a moving belt, so
 * its gcode measures height along the tilted gantry and depth along the belt travel. The shape those
 * coordinates draw is slanted and stretched, and this turns it back into the printed one
 */
export class BeltPrinterTransform {
  /** Cosine of the gantry angle */
  private readonly cosGantryAngle: number
  /** Sine of the gantry angle */
  private readonly sinGantryAngle: number

  /**
   * @param gantryAngle - Angle between the belt and the printer gantry, in degrees
   */
  constructor (readonly gantryAngle: number) {
    const radians = gantryAngle * Math.PI / 180
    this.cosGantryAngle = Math.cos(radians)
    this.sinGantryAngle = Math.sin(radians)
  }

  /** Height gained per unit of travel along the gantry */
  get heightPerGantryTravel (): number {
    return this.sinGantryAngle
  }

  /**
   * Turns a printed height back into the distance along the gantry it was printed from
   * @param height - Height of the printed point
   * @returns The distance travelled along the gantry
   */
  gantryTravelOf (height: number): number {
    return height / this.sinGantryAngle
  }

  /**
   * Turns a machine position into the point it prints at
   * @param state - Machine state to convert
   * @param target - Point the result is written into
   * @returns The written point
   */
  toScenePoint (state: MachineState, target: ScenePoint): ScenePoint {
    const gantry = state.y
    target.x = state.x
    target.y = gantry * this.cosGantryAngle - state.z
    target.z = gantry * this.sinGantryAngle
    return target
  }
}
