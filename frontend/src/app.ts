import * as THREE from './three-exports'
import { Settings, type SettingKey, type SettingValues } from './settings'
import { Viewer } from './viewer/viewer'
import { loadGcodeFile, cancelGcodeLoad } from './gcode/parsing/loader'
import { ObservedPrintSpeed } from './gcode/timeline/observed-print-speed'
import { PrintTimeline } from './gcode/timeline/print-timeline'
import { PrintExclusions } from './gcode/exclusions'
import { GcodeModel } from './gcode/rendering/gcode-model'
import { initViewSettingsPanel, type ViewSettingsPanel } from './ui/view-settings/view-settings-panel'
import { saveDefaultViewSettings, updateDefaultViewSettingsPanel } from './ui/view-settings/default-view-settings-panel'
import { initOverlayWindows } from './ui/overlays/overlay-windows'
import { updateDashboardOverlay } from './ui/overlays/dashboard'
import { updateWebcamOverlay } from './ui/overlays/webcam'
import { initLayerSlider, updateLayerSliderMax, setLayerSliderValue, applyLayerSliderVisibility } from './ui/sliders/layer-slider'
import { initSegmentSlider, updateSegmentSliderMax, setSegmentSliderValue, applySegmentSliderVisibility } from './ui/sliders/segment-slider'
import { initToggleButtons } from './ui/toggle-buttons'
import { initLegend, updateLegend, applyLegendVisibility } from './ui/legend'
import { setStatusBarTemperatures, applyStatusBarVisibility } from './ui/status-bar'
import { showLoadingScreen, hideLoadingScreen } from './ui/notices/loading-screen'
import { showLargeFileConfirmation, hideLargeFileConfirmation } from './ui/notices/large-file-confirmation'
import { emptyGcode, type ParsedGcode } from './gcode/parsing/parser'
import { clamp } from './utils/numbers'
import type { BedVolume } from './viewer/bed'
import type { PrintViewUpdate } from './viewer/viewer'

/** Temperatures read at one moment, by heater name */
export interface PrinterTemperatures {
  /** Moment the temperatures were read, in seconds since the epoch */
  time: number
  /** Actual and target temperature of one heater, each unknown until the printer reports it */
  [heater: string]: { actual: number | null, target: number | null } | number
}

/** Printer state reported by OctoPrint */
interface PrinterState {
  flags: { printing: boolean, paused: boolean }
}

/** OctoPrint current/history data payload */
interface PrinterDataPayload {
  temps: PrinterTemperatures[]
  job: { file: { path: string, date: number, size: number } }
  state: PrinterState
  progress: { filepos: number, printTime: number }
}

/** Selector of the plugin tab */
export const PG_TAB = '#tab_plugin_prettygcode'
/** Selector of the plugin settings tab */
const PG_SETTINGS_TAB = '#settings_plugin_prettygcode'
/** Selector of the OctoPrint page container */
export const PAGE_CONTAINER = '.page-container'
/** Class marking the page as filled by the plugin view */
export const MAXIMIZED_CLASS = 'pg-maximized'

/** Nozzle diameter in mm assumed when the printer profile does not state one */
const DEFAULT_NOZZLE_DIAMETER_MM = 0.4

/** Bed width, depth and height in mm assumed until the printer profile is read */
const DEFAULT_BED_SIZE_MM = 200
/** Bed origin assumed until the printer profile is read */
const DEFAULT_BED_ORIGIN = 'lowerleft'

/** Main plugin container, orchestrating all its components */
export class PrettyGCodeApp {
  /** OctoPrint printer profiles view model */
  private readonly printerProfilesVM: any
  /** OctoPrint settings view model */
  private readonly settingsVM: any

  /** Plugin frontend settings */
  readonly settings = new Settings()

  /** Whether the plugin view has been initialized */
  private viewInitialized = false

  /** The panel editing the view settings of this browser */
  private viewSettingsPanel!: ViewSettingsPanel

  /** The 3D view */
  private readonly viewer = new Viewer(this.settings, () => this.bedVolume, () => this.nozzleDiameter, (deltaSeconds) => this.updatePrintView(deltaSeconds))
  /** Print exclusions of the loaded gcode */
  private readonly exclusions = new PrintExclusions(this.settings)
  /** Print timeline of the loaded gcode */
  private readonly printTimeline = new PrintTimeline(this.exclusions)
  /** Speed the running print is going at */
  private readonly observedPrintSpeed = new ObservedPrintSpeed()
  /** The rendered gcode model */
  private readonly gcodeModel = new GcodeModel(this.settings, () => this.nozzleDiameter, this.printTimeline, this.exclusions, this.viewer.mirrorBoundsPlanes)

  /** Parsed gcode of the currently loaded job */
  private parsedGcode: ParsedGcode | null = null
  /** Belt printer gantry angle the loaded gcode was parsed with */
  private parsedBeltPrinterGantryAngle: number | null = null

  /** Print bed geometry */
  private bedVolume: BedVolume = { depth: DEFAULT_BED_SIZE_MM, height: DEFAULT_BED_SIZE_MM, origin: DEFAULT_BED_ORIGIN, width: DEFAULT_BED_SIZE_MM }

  /** Nozzle diameter in mm from the active printer profile */
  private profileNozzleDiameter = DEFAULT_NOZZLE_DIAMETER_MM

  /** Server path of the currently loaded job */
  private currentJobPath = ''
  /** Upload date of the currently loaded job */
  private currentJobDate = 0
  /** Size in bytes of the currently loaded job */
  private currentJobSize = 0
  /** Whether the user approved loading the current job despite its size */
  private largeFileApproved = false
  /** Id of the most recent gcode load */
  private loadSequence = 0

  /** Latest printer state reported by OctoPrint */
  private currentPrinterState: PrinterState | null = null
  /** Bytes of the job file sent to the printer so far */
  private currentFilePosition = 0
  /** 1-based current layer */
  private _currentLayerNumber = 0
  /** Revealed segments of the current layer */
  private _currentSegmentNumber = 0
  /** Whether the user is sliding the layer or segment manually */
  private manualSliding = false

  /**
   * @param viewModels - OctoPrint view models
   */
  constructor ({ printerProfilesVM, settingsVM }: { printerProfilesVM: any, settingsVM: any }) {
    this.printerProfilesVM = printerProfilesVM
    this.settingsVM = settingsVM
  }

  /* ---- OctoPrint events ---- */

  /**
   * Reacts to an OctoPrint tab switch, bringing the view up to date
   * @param current - Selector of the now selected tab
   * @param previous - Selector of the previously selected tab
   */
  onTabChange (current: string, previous: string): void {
    if (current === PG_TAB) {
      if (!this.viewInitialized) {
        // Load settings, layered over the defaults configured on the server
        this.settings.load(this.defaultViewSettings())

        // Printer profile, synced now and on every change
        this.updatePrinterProfile()
        this.printerProfilesVM.currentProfileData.subscribe(() => this.updatePrinterProfile())

        // 3D view and gcode
        this.viewer.init()
        this.viewer.add(this.gcodeModel.linesGroup)
        this.viewer.add(this.exclusions.regionMarkersGroup)
        this.loadGcode(this.currentJobPath)
        this.fetchExclusions()

        // UI controls
        this.viewSettingsPanel = initViewSettingsPanel(this)
        initLayerSlider(this)
        initSegmentSlider(this)
        initOverlayWindows(this.settings)
        initToggleButtons(this)
        initLegend(this)

        // Apply the loaded settings
        this.applySettings(this.settings.keys())

        // Set view as initialized
        this.viewInitialized = true
      } else {
        this.updateWindowStates()
      }
    } else if (previous === PG_TAB) {
      this.updateWindowStates()
    }
  }

  /** Reacts to the OctoPrint settings dialog saving, handing it the edited default view settings */
  onSettingsBeforeSave (): void {
    saveDefaultViewSettings()
  }

  /** Reacts to the OctoPrint settings dialog closing, re-applying the view settings */
  onSettingsHidden (): void {
    if (!this.viewInitialized) return

    const changed = this.settings.load(this.defaultViewSettings())
    this.viewSettingsPanel.refresh()
    this.applySettings(changed)
  }

  /** Reacts to the OctoPrint settings dialog opening, bringing the plugin settings tab up to date */
  onSettingsShown (): void {
    updateDefaultViewSettingsPanel(this.settingsVM)
  }

  /**
   * Gets the default view settings configured on the server
   * @returns Their values by name
   */
  private defaultViewSettings (): Partial<SettingValues> {
    return ko.mapping.toJS(this.settingsVM.settings?.plugins?.prettygcode?.defaultViewSettings ?? {})
  }

  /**
   * Feeds the app OctoPrint's live printer data
   * @param data - OctoPrint current data payload
   */
  fromCurrentData (data: PrinterDataPayload): void {
    this.updatePrinterData(data)
    if (!this.viewInitialized) return

    setStatusBarTemperatures(data.temps)
  }

  /**
   * Feeds the app the printer data OctoPrint sends on connect
   * @param data - OctoPrint history data payload
   */
  fromHistoryData (data: PrinterDataPayload): void {
    this.updatePrinterData(data)
  }

  /**
   * Handles a plugin message broadcast by the OctoPrint server
   * @param plugin - Identifier of the sending plugin
   * @param data - Message payload
   */
  onDataUpdaterPluginMessage (plugin: string, data: any): void {
    if (this.exclusions.applyPluginMessage(plugin, data)) this.updateExclusions()
  }

  /**
   * Syncs the app with a printer data payload, loading the newly selected job if it changed
   * @param data - OctoPrint data payload
   */
  private updatePrinterData (data: PrinterDataPayload): void {
    // On a newly selected file, reload the gcode
    const job = data.job
    if (this.currentJobPath !== job.file.path || this.currentJobDate !== job.file.date) {
      this.currentJobPath = job.file.path
      this.currentJobDate = job.file.date
      this.currentJobSize = job.file.size
      this.largeFileApproved = false
      if (this.viewInitialized) this.loadGcode(this.currentJobPath)
    }

    // Live printer state and progress
    this.currentPrinterState = data.state
    this.currentFilePosition = data.progress.filepos

    // Speed of the job the printer is on
    if (data.state.flags.printing) {
      this.observedPrintSpeed.track(data.progress.printTime, this.printTimeline.estimatedSecondsAt(this.currentFilePosition))
    } else {
      this.observedPrintSpeed.restart()
    }
  }

  /* ---- Gcode loading ---- */

  /** Parsed gcode of the currently loaded job */
  get gcode (): ParsedGcode {
    return this.parsedGcode ?? emptyGcode()
  }

  /**
   * Gets how long a layer takes to print
   * @param layerNumber - 1-based layer number
   * @returns The estimated seconds
   */
  layerSeconds (layerNumber: number): number {
    return this.printTimeline.layerSeconds(layerNumber)
  }

  /** Layer count of the loaded gcode */
  get layerCount (): number {
    return this.parsedGcode?.layers.length ?? 0
  }

  /** Angle between the belt and the printer gantry in degrees, null for non-belt printers */
  private get beltPrinterGantryAngle (): number | null {
    return this.settings.beltPrinter ? this.settings.beltPrinterGantryAngle : null
  }

  /**
   * Loads a job file and displays it in the 3D view
   * @param jobPath - Server path of the job file
   * @param preserveView - Whether to keep the current layer and camera instead of framing the whole model
   */
  private async loadGcode (jobPath: string, preserveView = false): Promise<void> {
    // Supersede the load in flight and clear the view
    const sequence = ++this.loadSequence
    hideLoadingScreen()
    hideLargeFileConfirmation()
    this.unloadGcode()
    this.parsedBeltPrinterGantryAngle = this.beltPrinterGantryAngle

    // Ask before loading a large file, which takes long and can bog the browser down
    const largeFileThreshold = Number(this.settingsVM.settings?.plugins?.prettygcode?.largeFileThresholdMb?.() ?? 0) * 1024 * 1024
    if (jobPath && !this.largeFileApproved && largeFileThreshold && this.currentJobSize > largeFileThreshold) {
      cancelGcodeLoad()
      showLargeFileConfirmation(this.currentJobSize, () => {
        this.largeFileApproved = true
        this.loadGcode(jobPath, preserveView)
      })
      return
    }

    // Cover the view while the file loads
    showLoadingScreen()

    try {
      // The object marker tag comes from the Cancel Object plugin settings
      const objectTag = this.settingsVM.settings?.plugins?.cancelobject?.reptag?.()
      // Whether G90/G91 affect extrusion follows OctoPrint's firmware setting
      const g90InfluencesExtruder = this.settingsVM.settings?.feature?.g90InfluencesExtruder?.() ?? false
      const parsedGcode = await loadGcodeFile(jobPath, objectTag, g90InfluencesExtruder, this.parsedBeltPrinterGantryAngle)

      // Stop if a newer load has started
      if (sequence !== this.loadSequence) return

      this.parsedGcode = parsedGcode
      this.exclusions.setGcodeObjectNames(this.parsedGcode.objectNames)

      // Index the timeline and build the model
      this.printTimeline.build(this.parsedGcode.layers, this.parsedGcode.slicerTimeMarks)
      this.observedPrintSpeed.restart()
      this.gcodeModel.build(this.parsedGcode)

      // Apply the gcode bounds
      this.viewer.applyGcodeBounds(this.parsedGcode.bounds)
      updateLegend(this)

      updateLayerSliderMax(this)
      if (preserveView) {
        // Keep the current layer
        this.setCurrentLayerNumber(Math.min(this.currentLayerNumber || this.layerCount, this.layerCount))
      } else {
        // Show the whole model: current layer at the top and the camera reset to the default view
        this.setCurrentLayerNumber(this.layerCount)
        this.resetView()
      }
      this.viewer.requestRender()
    } catch (error) {
      if (sequence === this.loadSequence) console.error('PrettyGCode: gcode load failed', error)
    } finally {
      if (sequence === this.loadSequence) hideLoadingScreen()
    }
  }

  /** Empties the 3D view of the loaded gcode */
  private unloadGcode (): void {
    this.parsedGcode = null
    this.printTimeline.build([], null)
    this.observedPrintSpeed.restart()
    this.gcodeModel.build(emptyGcode())
    updateLayerSliderMax(this)
    updateSegmentSliderMax(this)
    this.viewer.requestRender()
  }

  /* ---- Exclusions ---- */

  /** Fetches the current exclusions and applies them to the view */
  private async fetchExclusions (): Promise<void> {
    if (await this.exclusions.fetch()) this.updateExclusions()
  }

  /** (Re)applies the current exclusions to the timeline and the model */
  private updateExclusions (): void {
    if (!this.viewInitialized || !this.parsedGcode) return

    this.printTimeline.build(this.parsedGcode.layers, this.parsedGcode.slicerTimeMarks)
    this.observedPrintSpeed.restart()
    this.gcodeModel.rebuild()
    this.updateLayerHighlight()
  }

  /* ---- Print tracking ---- */

  /**
   * Advances the displayed print progress for a new frame
   * @param deltaSeconds - Seconds elapsed since the previous call
   * @returns Whether the scene changed and the nozzle position to show, if any
   */
  private updatePrintView (deltaSeconds: number): PrintViewUpdate {
    const state = this.currentPrinterState
    const tracking = state && !this.manualSliding && (state.flags.printing || state.flags.paused)

    let needRender = false
    let nozzlePosition: THREE.Vector3 | null = null
    let revealedLayer: number | null = null

    if (tracking) {
      // Reveal gcode up to where the nozzle has passed
      const spot = this.printTimeline.advance(this.currentFilePosition, deltaSeconds)
      if (spot) {
        this.gcodeModel.revealTo(spot)
        const { layerNumber, segmentNumber } = this.printTimeline.revealPosition(spot.segmentIndex)
        this.setReveal(layerNumber, segmentNumber)
        revealedLayer = layerNumber
      }
      needRender = true
      nozzlePosition = this.printTimeline.getNozzlePosition()
    } else {
      // Reveal gcode up to the selected within-layer position
      needRender = this.gcodeModel.syncToLayerSegment(this.currentLayerNumber, this.currentSegmentNumber)
      if (needRender) revealedLayer = this.currentLayerNumber
    }

    // Highlight the revealed layer
    if (revealedLayer != null) this.gcodeModel.highlightLayer(revealedLayer)

    return { needRender, nozzlePosition }
  }

  /* ---- UI events ---- */

  /** 1-based current layer */
  get currentLayerNumber (): number {
    return this._currentLayerNumber
  }

  /** Revealed segments of the current layer, 0 to its total */
  get currentSegmentNumber (): number {
    return this._currentSegmentNumber
  }

  /** Total segments the current layer is made of */
  get currentLayerSegmentCount (): number {
    return this.printTimeline.layerSegmentCount(this._currentLayerNumber)
  }

  /** Machine Z of the current layer */
  get currentLayerZ (): number {
    return this.parsedGcode?.layers[this._currentLayerNumber - 1]?.z ?? 0
  }

  /**
   * Gets how long the running print still takes to reach a layer
   * @param layerNumber - 1-based layer number
   * @returns The seconds left and whether the measurement behind them has stabilized, or null when
   * the print is not running, the gcode carries no slicer time marks, or the layer is already behind
   */
  secondsUntilLayer (layerNumber: number): { seconds: number, stabilized: boolean } | null {
    if (!this.currentPrinterState?.flags.printing || !this.parsedGcode?.slicerTimeMarks) return null

    const reachedSeconds = this.printTimeline.estimatedSecondsAt(this.currentFilePosition)
    const layerSeconds = this.printTimeline.estimatedSecondsAtLayer(layerNumber)
    if (layerSeconds <= reachedSeconds) return null

    return this.observedPrintSpeed.toRealSeconds(layerSeconds - reachedSeconds)
  }

  /**
   * Selects the current layer, revealing it whole
   * @param layerNumber - 1-based layer number
   */
  setCurrentLayerNumber (layerNumber: number): void {
    this.setReveal(layerNumber, this.printTimeline.layerSegmentCount(layerNumber))
  }

  /**
   * Reveals a part of the current layer, up to a within-layer segment
   * @param segmentNumber - Segments of the current layer to reveal
   */
  setCurrentSegmentNumber (segmentNumber: number): void {
    this._currentSegmentNumber = clamp(segmentNumber, 0, this.currentLayerSegmentCount)
    setSegmentSliderValue(this, this._currentSegmentNumber)
  }

  /**
   * Sets the reveal position and syncs both layer and segment sliders
   * @param layerNumber - 1-based layer number
   * @param segmentNumber - Revealed segments of that layer
   */
  private setReveal (layerNumber: number, segmentNumber: number): void {
    this._currentLayerNumber = layerNumber
    this._currentSegmentNumber = segmentNumber
    setLayerSliderValue(this, layerNumber)
    updateSegmentSliderMax(this)
  }

  /**
   * Turns manual sliding on or off
   * @param manual - True to enable manual sliding
   */
  setManualSliding (manual: boolean): void {
    this.manualSliding = manual
  }

  /** Opens the plugin settings tab */
  showPluginSettings (): void {
    this.settingsVM.show(PG_SETTINGS_TAB)
  }

  /** Resets the camera to the default view */
  resetView (): void {
    this.viewer.applyDefaultView(true)
  }

  /**
   * (Re)applies the given settings to the view
   * @param keys - Names of the settings to apply
   */
  applySettings (keys: SettingKey[]): void {
    const toApply = new Set(keys)

    /**
     * Tells whether any of the given settings is among the ones to apply
     * @param names - Names of the settings to look for
     * @returns True when at least one of them is to apply
     */
    const anyOf = (...names: SettingKey[]): boolean => names.some((name) => toApply.has(name))

    const beltPrinterChanged = anyOf('beltPrinter', 'beltPrinterGantryAngle') &&
      this.beltPrinterGantryAngle !== this.parsedBeltPrinterGantryAngle

    // Belt printer changes require a reload, which rebuilds the model on its own
    if (beltPrinterChanged) this.loadGcode(this.currentJobPath)
    else if (anyOf('thickLines', 'showExcluded', 'showBed', 'showMirror')) {
      this.gcodeModel.rebuild()
      this.viewer.requestRender()
    } else if (anyOf('colorMode', 'featureTypeColorRules', 'featureTypeDefaultColor')) {
      this.gcodeModel.recolor()
      this.viewer.requestRender()
    }
    if (anyOf('colorMode', 'featureTypeColorRules', 'featureTypeDefaultColor')) updateLegend(this)

    if (anyOf('darkMode')) {
      $('html').toggleClass('pg-dark', this.settings.darkMode)
      this.viewer.applyBackground(this.settings.darkMode)
      this.viewer.applyViewCubeTheme(this.settings.darkMode)
      this.viewer.rebuildBed()
    }
    if (anyOf('antialias')) this.viewer.applyAntialias(this.settings.antialias)

    if (anyOf('navigationMode')) this.viewer.applyNavigationMode(this.settings.navigationMode)
    if (anyOf('projectionMode')) this.viewer.applyProjectionMode(this.settings.projectionMode)

    if (anyOf('beltPrinter', 'beltPrinterGantryAngle')) {
      this.exclusions.placeRegionMarkers()
      this.viewer.requestRender()
    }

    if (anyOf('travelScope', 'travelColor')) {
      this.gcodeModel.rebuildTravelLines()
      this.viewer.requestRender()
    }

    if (anyOf('showBed')) this.viewer.applyBedVisibility(this.settings.showBed)
    if (anyOf('showExclusionMarker')) {
      this.exclusions.applyRegionMarkersVisibility(this.settings.showExclusionMarker)
      this.viewer.requestRender()
    }

    if (anyOf('highlightIntensity')) this.updateLayerHighlight()

    if (
      anyOf(
        'showStatusBar',
        'showLayerSlider',
        'showSegmentSlider',
        'showCameraControls',
        'showState',
        'showFiles',
        'showLegend',
        'showDashboard',
        'dashboardHeight',
        'showWebcam',
        'webcamHeight'
      )
    ) this.updateWindowStates()
  }

  /** (Re)applies the layer highlight setting to the displayed layer */
  private updateLayerHighlight (): void {
    this.gcodeModel.highlightLayer(this.currentLayerNumber)
    this.viewer.requestRender()
  }

  /** Shows or hides the view's controls and windows to match the current settings */
  updateWindowStates (): void {
    applyStatusBarVisibility(this.settings.showStatusBar)

    applyLayerSliderVisibility(this.settings.showLayerSlider)
    applySegmentSliderVisibility(this.settings.showSegmentSlider)
    if (!this.settings.showLayerSlider) this.setCurrentLayerNumber(this.layerCount)
    else if (!this.settings.showSegmentSlider) this.setCurrentSegmentNumber(this.currentLayerSegmentCount)

    $('.pg-camera-controls').toggleClass('pg-hidden', !this.settings.showCameraControls)
    this.viewer.applyViewCubeVisibility(this.settings.showCameraControls)

    $('#state_wrapper').toggleClass('pg-hidden', !this.settings.showState)
    $('#files_wrapper').toggleClass('pg-hidden', !this.settings.showFiles)
    applyLegendVisibility(this.settings.showLegend)

    updateDashboardOverlay(this.settings)
    updateWebcamOverlay(this.settings)
  }

  /* ---- Printer profile ---- */

  /** Nozzle diameter in mm the print is drawn with */
  private get nozzleDiameter (): number {
    return this.parsedGcode?.slicerNozzleDiameter ?? this.profileNozzleDiameter
  }

  /** Syncs the app with the active printer profile */
  private updatePrinterProfile (): void {
    this.updateBedVolume()
    this.updateProfileNozzleDiameter()
    this.gcodeModel.updateLineWidth()
    this.viewer.rebuildBed()
    this.viewer.resetCameraTarget()
    this.viewer.requestRender()
  }

  /** Refreshes the nozzle diameter from the active printer profile */
  private updateProfileNozzleDiameter (): void {
    const currentProfileData = this.printerProfilesVM.currentProfileData()
    const extruder = currentProfileData && currentProfileData.extruder
    const extruderNozzleDiameter = extruder && typeof extruder.nozzleDiameter === 'function' ? extruder.nozzleDiameter() : null
    this.profileNozzleDiameter = extruderNozzleDiameter ?? DEFAULT_NOZZLE_DIAMETER_MM
  }

  /** Refreshes the print bed geometry from the active printer profile */
  private updateBedVolume (): void {
    const currentProfileData = this.printerProfilesVM.currentProfileData()
    if (!currentProfileData || !currentProfileData.volume) return

    const volume = currentProfileData.volume
    this.bedVolume = { depth: volume.depth(), height: volume.height(), origin: volume.origin(), width: volume.width() }
  }
}
