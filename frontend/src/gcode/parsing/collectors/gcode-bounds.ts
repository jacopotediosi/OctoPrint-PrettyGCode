import { emptyBounds } from '../parsed-gcode'
import type { GcodeBounds, ScenePoint } from '../parsed-gcode'

/** Collects the box the points of a gcode fit in */
export class GcodeBoundsCollector {
  /** Box the points recorded so far fit in */
  private _bounds = emptyBounds()

  /** Box the points recorded so far fit in */
  get bounds (): GcodeBounds {
    return this._bounds
  }

  /**
   * Grows the box to contain a point
   * @param point - Point to contain
   */
  addPoint (point: ScenePoint): void {
    const bounds = this._bounds
    bounds.minX = Math.min(bounds.minX, point.x)
    bounds.minY = Math.min(bounds.minY, point.y)
    bounds.minZ = Math.min(bounds.minZ, point.z)
    bounds.maxX = Math.max(bounds.maxX, point.x)
    bounds.maxY = Math.max(bounds.maxY, point.y)
    bounds.maxZ = Math.max(bounds.maxZ, point.z)
  }

  /** Drops the points recorded so far */
  reset (): void {
    this._bounds = emptyBounds()
  }

  /**
   * Moves the box along the Y axis
   * @param offset - Distance in mm to move it by
   */
  slideY (offset: number): void {
    this._bounds.minY += offset
    this._bounds.maxY += offset
  }
}
