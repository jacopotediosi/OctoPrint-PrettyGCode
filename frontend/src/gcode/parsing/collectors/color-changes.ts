import { HEX_COLOR_PATTERN } from '../../../utils/colors'
import type { ColorChange } from '../parsed-gcode'

/**
 * Matches a slicer's color change comment, capturing the tool and the color it states after it
 * - ;COLOR_CHANGE,T<n>,#rrggbb  PrusaSlicer/SuperSlicer, OrcaSlicer (non-Bambu-Lab printers)
 * - ; COLOR_CHANGE,T<n>,#rrggbb Bambu Studio, OrcaSlicer (Bambu Lab printers)
 */
const COLOR_CHANGE_COMMENT_PATTERN = /;\s*color_change(?!\w)(.*)/i

/** Collects the color changes a gcode states over the moves printing after them */
export class ColorChangesCollector {
  /** Color changes stated so far, in the order the gcode states them */
  private readonly _colorChanges: ColorChange[] = []
  /** Index of the last color change of each tool, by tool id */
  private readonly toolColorChanges: number[] = []
  /** Index of the color change the parsed moves are extruded after, -1 before the first one of their tool */
  private _currentColorChangeId = -1
  /** Id of the tool the parsed moves are extruded with */
  private currentToolId = 0
  /** Whether a stated color change is waiting for the command carrying it out */
  private statedColorChange = false

  /** Color changes stated so far, in the order the gcode states them */
  get colorChanges (): ColorChange[] {
    return this._colorChanges
  }

  /** Index of the color change the parsed moves are extruded after, -1 before the first one of their tool */
  get currentColorChangeId (): number {
    return this._currentColorChangeId
  }

  /**
   * Records the color change a comment states
   * @param commentLower - Comment to read, lowercased
   * @param z - Height in mm the change takes effect at
   */
  addComment (commentLower: string, z: number): void {
    const colorChangeMatch = commentLower.match(COLOR_CHANGE_COMMENT_PATTERN)
    if (!colorChangeMatch) return

    const tokens = colorChangeMatch[1].split(',').map((token) => token.trim())
    const tool = tokens[1]?.startsWith('t') ? parseInt(tokens[1].slice(1)) : this.currentToolId
    this.addColorChange(tool, HEX_COLOR_PATTERN.test(tokens[2] ?? '') ? tokens[2] : '', z)
    this.statedColorChange = true
  }

  /**
   * Records a filament change, unless a comment already stated the color change it carries out
   * @param z - Height in mm the change takes effect at
   */
  addFilamentChange (z: number): void {
    if (this.statedColorChange) this.statedColorChange = false
    else this.addColorChange(this.currentToolId, '', z)
  }

  /**
   * Selects the tool the parsed moves are extruded with, bringing back its last color change
   * @param toolId - Id of the tool to select
   */
  selectTool (toolId: number): void {
    this.currentToolId = toolId
    this._currentColorChangeId = this.toolColorChanges[toolId] ?? -1
  }

  /**
   * Records a color change of a tool, which the segments it extrudes from there on carry
   * @param toolId - Id of the tool it changes the color of
   * @param color - Color the tool prints with from there on, empty when the gcode states none
   * @param z - Height in mm it takes effect at
   */
  private addColorChange (toolId: number, color: string, z: number): void {
    const colorChangeId = this._colorChanges.push({ toolId, color, z }) - 1

    this.toolColorChanges[toolId] = colorChangeId
    if (toolId === this.currentToolId) this._currentColorChangeId = colorChangeId
  }
}
