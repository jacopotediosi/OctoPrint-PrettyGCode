/** Collects the nozzle temperature a gcode sets for each of its tools */
export class NozzleTemperaturesCollector {
  /** Nozzle temperature set for each tool in degrees Celsius, by tool id */
  private readonly toolTemperatures: number[] = []
  /** Nozzle temperature the parsed moves are extruded at, in degrees Celsius */
  private _currentTemperature = 0
  /** Id of the tool the parsed moves are extruded with */
  private currentToolId = 0

  /** Nozzle temperature the parsed moves are extruded at, in degrees Celsius */
  get currentTemperature (): number {
    return this._currentTemperature
  }

  /**
   * Records the nozzle temperature set for a tool
   * @param temperature - Temperature it is set to, in degrees Celsius
   * @param toolId - Id of the tool it is set for, the tool in use by default
   */
  addTemperature (temperature: number, toolId: number = this.currentToolId): void {
    this.toolTemperatures[toolId] = temperature
    if (toolId === this.currentToolId) this._currentTemperature = temperature
  }

  /**
   * Selects the tool the parsed moves are extruded with, bringing back its nozzle temperature
   * @param toolId - Id of the tool to select
   */
  selectTool (toolId: number): void {
    this.currentToolId = toolId
    this._currentTemperature = this.toolTemperatures[toolId] ?? 0
  }
}
