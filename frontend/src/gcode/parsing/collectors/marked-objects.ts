/** Collects the objects a gcode marks around the moves printing them */
export class MarkedObjectsCollector {
  /** Tag the "@<tag> <name>" markers carry, lowercased */
  private readonly tag: string
  /** Name of each object marked so far, by object id */
  private readonly _objectNames: string[] = []
  /** Id of the object the parsed moves belong to, -1 for none */
  private _currentObjectId = -1

  /**
   * @param tag - Tag of the "@<tag> <name>" markers
   */
  constructor (tag: string) {
    this.tag = tag.toLowerCase()
  }

  /** Name of each object marked so far, by object id */
  get objectNames (): string[] {
    return this._objectNames
  }

  /** Id of the object the parsed moves belong to, -1 for none */
  get currentObjectId (): number {
    return this._currentObjectId
  }

  /**
   * Records the object a marker states, which the moves after it belong to
   * @param rawLine - Marker line, starting with "@"
   */
  addMarker (rawLine: string): void {
    const space = rawLine.indexOf(' ')
    const command = (space < 0 ? rawLine : rawLine.slice(0, space)).slice(1).toLowerCase()

    if (command === this.tag + 'stop') {
      this._currentObjectId = -1
    } else if (command === this.tag && space > 0) {
      const name = rawLine.slice(space + 1).trim()
      if (!name) return

      const id = this._objectNames.indexOf(name)
      this._currentObjectId = id >= 0 ? id : this._objectNames.push(name) - 1
    }
  }
}
