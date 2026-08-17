import { HEX_COLOR_PATTERN } from '../../../utils/colors'

/** Matches the nozzle diameter stated by the slicer, e.g. "; nozzle_diameter = 0.4" */
const NOZZLE_DIAMETER_COMMENT_PATTERN = /;\s*nozzle[_ ]?diameter\s*[:=]\s*([\d.]+)/i

/** Matches the filament diameter stated by the slicer, e.g. "; filament_diameter = 1.75" */
const FILAMENT_DIAMETER_COMMENT_PATTERN = /;\s*filament[_ ]?diameter\s*[:=,]\s*([\d.]+)/i

/** Matches the filament density stated by the slicer, e.g. "; filament_density = 1.24" */
const FILAMENT_DENSITY_COMMENT_PATTERN = /;\s*filament[_ ]?density\s*[:=,]\s*([\d.]+)/i

/** Matches the tool colors stated by the slicer, e.g. "; extruder_colour = #800080;#ffffff" */
const TOOL_COLORS_COMMENT_PATTERN = /;\s*(extruder|filament)_colou?r\s*=\s*(.*)/i

/** Print settings a slicer states in the configuration block of its gcode */
export interface SlicerConfig {
  /** Nozzle diameter in mm the slicer states, null when it states none */
  nozzleDiameter: number | null
  /** Filament diameter in mm the slicer states, null when it states none */
  filamentDiameter: number | null
  /** Filament density in g/cm3 the slicer states, null when it states none */
  filamentDensity: number | null
  /** Color the slicer states for each tool, empty where it states none */
  toolColors: string[]
}

/**
 * Takes the number a comment states, keeping the one stated first
 * @param stated - Number stated so far, null when none is
 * @param comment - Comment to read, lowercased
 * @param pattern - Pattern matching the number
 * @returns The number to keep
 */
const statedNumber = (stated: number | null, comment: string, pattern: RegExp): number | null => {
  if (stated != null) return stated

  const match = comment.match(pattern)
  return match ? parseFloat(match[1]) : null
}

/** Collects the print settings a slicer states along its gcode */
export class SlicerConfigCollector {
  /** Nozzle diameter in mm stated so far, null when none is */
  private nozzleDiameter: number | null = null
  /** Filament diameter in mm stated so far, null when none is */
  private filamentDiameter: number | null = null
  /** Filament density in g/cm3 stated so far, null when none is */
  private filamentDensity: number | null = null
  /** Color stated for each extruder, empty where none is */
  private extruderColors: string[] = []
  /** Color stated for the filament of each extruder, empty where none is */
  private filamentColors: string[] = []

  /**
   * Records the settings a comment states
   * @param commentLower - Comment to read, lowercased
   */
  addComment (commentLower: string): void {
    // First diameters and density the slicer states win
    this.nozzleDiameter = statedNumber(this.nozzleDiameter, commentLower, NOZZLE_DIAMETER_COMMENT_PATTERN)
    this.filamentDiameter = statedNumber(this.filamentDiameter, commentLower, FILAMENT_DIAMETER_COMMENT_PATTERN)
    this.filamentDensity = statedNumber(this.filamentDensity, commentLower, FILAMENT_DENSITY_COMMENT_PATTERN)

    // Tool colors the slicer states, the extruder ones taking over from the filament ones
    const toolColorsMatch = commentLower.match(TOOL_COLORS_COMMENT_PATTERN)
    if (toolColorsMatch) {
      const colors = toolColorsMatch[2].split(';')
        .map((color) => color.trim().replaceAll('"', ''))
        .map((color) => HEX_COLOR_PATTERN.test(color) ? color : '')
      if (toolColorsMatch[1] === 'extruder') this.extruderColors = colors
      else this.filamentColors = colors
    }
  }

  /** Print settings collected so far */
  get config (): SlicerConfig {
    const tools = Math.max(this.extruderColors.length, this.filamentColors.length)

    return {
      nozzleDiameter: this.nozzleDiameter,
      filamentDiameter: this.filamentDiameter,
      filamentDensity: this.filamentDensity,
      toolColors: Array.from({ length: tools }, (_unused, tool) => this.extruderColors[tool] || this.filamentColors[tool] || '')
    }
  }
}
