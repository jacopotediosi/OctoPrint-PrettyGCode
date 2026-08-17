/**
 * Matches a slicer's layer change comment
 * - ;LAYER_CHANGE   PrusaSlicer/SuperSlicer, OrcaSlicer (non-Bambu-Lab printers)
 * - ; CHANGE_LAYER  Bambu Studio, OrcaSlicer (Bambu Lab printers)
 * - ;LAYER:<number> Cura, ideaMaker
 * - ; layer <number> Simplify3D
 */
export const LAYER_CHANGE_COMMENT_PATTERN = /^;\s*(?:layer[_ ]?change|change[_ ]?layer|layer[ :]\d)/i
