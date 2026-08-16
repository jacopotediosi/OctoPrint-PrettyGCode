/** Matches the extrusion width the slicer states, e.g. ";WIDTH:0.42" or "; LINE_WIDTH: 0.42" */
const WIDTH_COMMENT_PATTERN = /;\s*(?:line_)?width:\s*([\d.]+)/i

/** Matches the extrusion height the slicer states, e.g. ";HEIGHT:0.2" or "; LAYER_HEIGHT: 0.2" */
const HEIGHT_COMMENT_PATTERN = /;\s*(?:layer_)?height:\s*([\d.]+)/i

/** Matches the extrusion height a slicer states for a belt printer, measured square to the belt, e.g. ";HEIGHT-BELT:0.2" */
const BELT_HEIGHT_COMMENT_PATTERN = /;\s*height-belt:\s*([\d.]+)/i

/** Highest extrusion height the first layer takes from its own Z, which a purge line laid high above the bed would overstate */
const HIGHEST_FIRST_LAYER_HEIGHT_MM = 2
/** Extrusion height the layers take until one of them gives its own */
const DEFAULT_LAYER_HEIGHT_MM = 0.2

/** Collects the size of the lines a gcode extrudes, from the slicer's own comments and from the layer steps in Z */
export class ExtrusionSizeCollector {
  /** Width of the lines the parsed moves extrude in mm, 0 where the slicer states none */
  private _width = 0
  /** Extrusion height the slicer states, null until it states one */
  private slicerHeight: number | null = null
  /** Height of the layer being printed, taken from its step in Z */
  private layerHeight = DEFAULT_LAYER_HEIGHT_MM
  /** Machine Z of the layer printed before the one starting, null for the first one */
  private previousLayerZ: number | null = null

  /** Width of the lines the parsed moves extrude in mm, 0 where the slicer states none */
  get width (): number {
    return this._width
  }

  /** Height of the lines the parsed moves extrude in mm */
  get height (): number {
    return this.slicerHeight ?? this.layerHeight
  }

  /**
   * Records the extrusion size a comment states
   * @param commentLower - Comment to read, lowercased
   */
  addComment (commentLower: string): void {
    const widthMatch = commentLower.match(WIDTH_COMMENT_PATTERN)
    if (widthMatch) this._width = parseFloat(widthMatch[1])
    const heightMatch = commentLower.match(HEIGHT_COMMENT_PATTERN)
    if (heightMatch) this.slicerHeight = parseFloat(heightMatch[1])
    const beltHeightMatch = commentLower.match(BELT_HEIGHT_COMMENT_PATTERN)
    if (beltHeightMatch) this.slicerHeight = parseFloat(beltHeightMatch[1])
  }

  /**
   * Records a layer, whose step in Z gives the height of the lines printed on it
   * @param z - Machine Z the layer is printed at
   */
  addLayer (z: number): void {
    // The first layer is as tall as the Z it sits at, the ones above it as tall as their step in Z
    const height = this.previousLayerZ == null ? Math.min(z, HIGHEST_FIRST_LAYER_HEIGHT_MM) : z - this.previousLayerZ

    // Keep the height of the layers before when an object printed after another starts back at the bottom
    if (height > 0) this.layerHeight = height
    this.previousLayerZ = z
  }
}
