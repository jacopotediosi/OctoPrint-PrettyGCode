/**
 * Matches a slicer's feature-type comment, capturing the label that follows the marker
 * - ;TYPE:<label>      PrusaSlicer/SuperSlicer/Cura, OrcaSlicer (non-Bambu-Lab printers)
 * - ; FEATURE: <label> Bambu Studio, OrcaSlicer (Bambu Lab printers)
 * - ; feature <label>  Simplify3D
 */
export const FEATURE_TYPE_COMMENT_PATTERN = /;\s*(?:type:|feature[ :])(.*)/i

/**
 * Matches a slicer's layer change comment
 * - ;LAYER_CHANGE   PrusaSlicer/SuperSlicer, OrcaSlicer (non-Bambu-Lab printers)
 * - ; CHANGE_LAYER  Bambu Studio, OrcaSlicer (Bambu Lab printers)
 * - ;LAYER:<number> Cura, ideaMaker
 * - ; layer <number> Simplify3D
 */
export const LAYER_CHANGE_COMMENT_PATTERN = /;\s*(?:layer[_ ]?change|change[_ ]?layer|layer[ :]\d)/i

/** Matches one color a slicer states for a tool, e.g. "#800080" */
export const TOOL_COLOR_PATTERN = /^#[0-9a-f]{6}$/

/**
 * Matches a slicer's color change comment, capturing the tool and the color it states after it
 * - ;COLOR_CHANGE,T<n>,#rrggbb  PrusaSlicer/SuperSlicer, OrcaSlicer (non-Bambu-Lab printers)
 * - ; COLOR_CHANGE,T<n>,#rrggbb Bambu Studio, OrcaSlicer (Bambu Lab printers)
 */
export const COLOR_CHANGE_COMMENT_PATTERN = /;\s*color_change(?!\w)(.*)/i

/** Matches the extrusion width the slicer states, e.g. ";WIDTH:0.42" or "; LINE_WIDTH: 0.42" */
export const WIDTH_COMMENT_PATTERN = /;\s*(?:line_)?width:\s*([\d.]+)/i

/** Matches the extrusion height the slicer states, e.g. ";HEIGHT:0.2" or "; LAYER_HEIGHT: 0.2" */
export const HEIGHT_COMMENT_PATTERN = /;\s*(?:layer_)?height:\s*([\d.]+)/i

/** Matches the extrusion height a slicer states for a belt printer, measured square to the belt, e.g. ";HEIGHT-BELT:0.2" */
export const BELT_HEIGHT_COMMENT_PATTERN = /;\s*height-belt:\s*([\d.]+)/i

/** Prefix, lowercased, of the comment stating the print time elapsed so far */
export const TIME_ELAPSED_COMMENT_PREFIX = ';time_elapsed:'
