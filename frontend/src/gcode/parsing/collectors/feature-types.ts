import type { FeatureType } from '../parsed-gcode'

/**
 * Matches a slicer's feature-type comment, capturing the label that follows the marker
 * - ;TYPE:<label>      PrusaSlicer/SuperSlicer/Cura, OrcaSlicer (non-Bambu-Lab printers)
 * - ; FEATURE: <label> Bambu Studio, OrcaSlicer (Bambu Lab printers)
 * - ; feature <label>  Simplify3D
 */
const FEATURE_TYPE_COMMENT_PATTERN = /;\s*(?:type:|feature[ :])(.*)/i

/** Collects the feature types a gcode states over the moves printing them */
export class FeatureTypesCollector {
  /** Feature types stated so far, by feature type id */
  private readonly _featureTypes: FeatureType[] = []
  /** Id of the feature type the parsed moves belong to, -1 for none */
  private _currentFeatureTypeId = -1
  /** Whether the parsed moves belong to the slicer's own custom gcode */
  private _customGcode = false
  /** Whether a feature type comment of the printed model has been seen yet */
  private featureTypeCommentSeen = false

  /** Feature types stated so far, by feature type id */
  get featureTypes (): FeatureType[] {
    return this._featureTypes
  }

  /** Id of the feature type the parsed moves belong to, -1 for none */
  get currentFeatureTypeId (): number {
    return this._currentFeatureTypeId
  }

  /** Whether the parsed moves belong to the slicer's own custom gcode */
  get customGcode (): boolean {
    return this._customGcode
  }

  /**
   * Records the feature type a comment states, which the moves after it belong to
   * @param rawLine - Gcode line holding the comment
   * @param commentLower - Gcode line holding the comment, lowercased
   * @returns True when the comment states the first feature type of the printed model
   */
  addComment (rawLine: string, commentLower: string): boolean {
    const featureTypeMatch = rawLine.match(FEATURE_TYPE_COMMENT_PATTERN)
    if (!featureTypeMatch) return false

    const id = this._featureTypes.findIndex((featureType) => featureType.comment === commentLower)
    this._currentFeatureTypeId = id >= 0
      ? id
      : this._featureTypes.push({ comment: commentLower, label: featureTypeMatch[1].trim() }) - 1

    this._customGcode = commentLower.includes('custom')

    // First feature type seen, not counting the slicers' own start gcode
    if (this.featureTypeCommentSeen || this._customGcode) return false
    this.featureTypeCommentSeen = true
    return true
  }
}
