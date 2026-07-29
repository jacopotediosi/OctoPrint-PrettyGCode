import { Settings } from './settings'
import { Viewer } from './viewer/viewer'
import { loadGcodeFile, cancelGcodeLoad } from './gcode/loader'
import { PrintTimeline } from './gcode/print-timeline'
import { PrintExclusions } from './gcode/exclusions'
import { GCodeModel, DEFAULT_NOZZLE_DIAMETER } from './gcode/gcode-model'
import { initSettingsPanel } from './ui/settings-panel'
import { initOverlayWindows } from './ui/overlay-windows'
import { updateDashboardOverlay } from './ui/dashboard'
import { updateWebcamOverlay } from './ui/webcam'
import { initLayerSlider, updateLayerSliderMax, setLayerSliderValue, applyLayerSliderVisibility } from './ui/layer-slider'
import { initSegmentSlider, updateSegmentSliderMax, setSegmentSliderValue, applySegmentSliderVisibility } from './ui/segment-slider'
import { initToggleButtons } from './ui/toggle-buttons'
import { setStatusBarText, applyStatusBarVisibility } from './ui/status-bar'
import { showLoadingScreen, hideLoadingScreen } from './ui/loading-screen'
import { showLargeFileConfirmation, hideLargeFileConfirmation } from './ui/large-file-confirmation'
import type { ParsedGcode } from './gcode/parser'
import type { ParserColors } from './gcode/model-colors'
import type { BedVolume } from './viewer/bed'
import type { ViewAngle } from './viewer/navigation'
import type { PrintViewUpdate } from './viewer/viewer'
import type { Vector3 } from 'three'

/** Printer state reported by OctoPrint */
interface PrinterState {
  flags: { printing: boolean, paused: boolean }
}

/** OctoPrint current/history data payload */
interface PrinterDataPayload {
  logs: string[]
  job: { file: { path: string, date: number, size: number } }
  state: PrinterState
  progress: { filepos: number }
}

/** Selector of the plugin tab */
const PG_TAB = '#tab_plugin_prettygcode'
/** Selector of the plugin settings tab */
const PG_SETTINGS_TAB = '#settings_plugin_prettygcode'

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

  /** The 3D view */
  private readonly viewer = new Viewer(this.settings, () => this.bedVolume, (deltaSeconds) => this.updatePrintView(deltaSeconds))
  /** Print exclusions of the loaded gcode */
  private readonly exclusions = new PrintExclusions()
  /** Print timeline of the loaded gcode */
  private readonly printTimeline = new PrintTimeline(this.exclusions)
  /** The rendered gcode model */
  private readonly gcodeModel = new GCodeModel(this.settings, this.printTimeline, this.exclusions, this.viewer.mirrorBoundsPlanes)

  /** Parsed gcode of the currently loaded job */
  private parsedGcode: ParsedGcode | null = null

  /** Print bed geometry */
  private bedVolume: BedVolume = { depth: 0, height: 0, origin: '', width: 0 }

  /** Nozzle diameter from the active printer profile */
  private nozzleDiameter: number | null = null

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

  /** Prefix of received terminal log lines */
  private readonly recvLogPrefix = parseInt(VERSION, 10) < 2 ? 'Recv: ' : '<<< '

  /**
   * @param viewModels - OctoPrint view models
   */
  constructor ({ printerProfilesVM, settingsVM }: { printerProfilesVM: any, settingsVM: any }) {
    this.printerProfilesVM = printerProfilesVM
    this.settingsVM = settingsVM
    this.settings.load()
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
        // Bed geometry and nozzle size, kept in sync with the active printer profile
        this.updateBedVolume()
        this.updateNozzleDiameter()
        this.printerProfilesVM.currentProfileData.subscribe(() => {
          this.updateBedVolume()
          this.updateNozzleDiameter()
          this.updateLineWidth()
          this.viewer.updateBedMesh()
          this.viewer.resetCameraTarget()
        })

        // 3D view and gcode
        this.viewer.init()
        this.viewer.scene.add(this.gcodeModel.linesGroup)
        this.viewer.scene.add(this.exclusions.regionMarkersGroup)
        this.loadGcode(this.currentJobPath)
        this.fetchExclusions()
        this.updateExclusionMarkersVisibility()

        // UI controls
        initSettingsPanel(this)
        initLayerSlider(this)
        initSegmentSlider(this)
        initOverlayWindows(this.settings)
        initToggleButtons(this)
        this.updateDarkMode()

        // Set view as initialized
        this.viewInitialized = true
      }
      this.updateWindowStates()
    } else if (previous === PG_TAB) {
      this.updateWindowStates()
    }
  }

  /**
   * Feeds the app OctoPrint's live printer data
   * @param data - OctoPrint current data payload
   */
  fromCurrentData (data: PrinterDataPayload): void {
    this.updatePrinterData(data)
    if (!this.viewInitialized) return

    // Update status bar with the reported temperatures
    data.logs.forEach((e) => {
      if (e.startsWith(this.recvLogPrefix + 'T:')) {
        setStatusBarText(e.substr(this.recvLogPrefix.length).split('@')[0])
      }
    })
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
  }

  /* ---- Gcode loading ---- */

  /** Layer count of the loaded gcode */
  get layerCount (): number {
    return this.parsedGcode?.layers.length ?? 0
  }

  /**
   * Loads a job file and displays it in the 3D view
   * @param jobPath - Server path of the job file
   * @param preserveView - Whether to keep the current layer and camera instead of framing the whole model
   */
  private async loadGcode (jobPath: string, preserveView = false): Promise<void> {
    // Supersede the load in flight and clear the view
    const sequence = ++this.loadSequence
    hideLargeFileConfirmation()
    this.unloadGcode()

    // Ask before loading a large file, which takes long and can bog the browser down
    const largeFileThreshold = Number(this.settingsVM.settings?.plugins?.prettygcode?.largeFileThresholdMb?.() ?? 0) * 1024 * 1024
    if (jobPath && !this.largeFileApproved && largeFileThreshold && this.currentJobSize > largeFileThreshold) {
      cancelGcodeLoad()
      showLargeFileConfirmation(this.currentJobSize, () => {
        this.largeFileApproved = true
        this.loadGcode(jobPath, preserveView)
      }, () => this.settingsVM.show(PG_SETTINGS_TAB))
      return
    }

    // Cover the view while the file loads
    showLoadingScreen()

    try {
      // The object marker tag comes from the Cancel Object plugin settings
      const objectTag = this.settingsVM.settings?.plugins?.cancelobject?.reptag?.()
      const colors: ParserColors = { colorRules: this.settings.modelColorRules, defaultColor: this.settings.modelDefaultColor }
      // Whether G90/G91 affect extrusion follows OctoPrint's firmware setting
      const g90InfluencesExtruder = this.settingsVM.settings?.feature?.g90InfluencesExtruder?.() ?? false
      const parsedGcode = await loadGcodeFile(jobPath, objectTag, colors, g90InfluencesExtruder)

      // Stop if a newer load has started
      if (sequence !== this.loadSequence) return

      this.parsedGcode = parsedGcode
      this.exclusions.setGcodeObjectNames(this.parsedGcode.objectNames)

      // Index the timeline and build the model
      this.printTimeline.index(this.parsedGcode.layers)
      this.gcodeModel.build(this.parsedGcode.layers)
      this.updateLineWidth()

      // Apply the gcode bounds
      this.viewer.applyGcodeBounds(this.parsedGcode.bounds)

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
      console.error('PrettyGCode: gcode load failed', error)
    } finally {
      hideLoadingScreen()
    }
  }

  /** Empties the 3D view of the loaded gcode */
  private unloadGcode (): void {
    this.parsedGcode = null
    this.printTimeline.index([])
    this.gcodeModel.build([])
    updateLayerSliderMax(this)
    updateSegmentSliderMax(this)
    this.viewer.requestRender()
  }

  /** Updates the drawn line thickness to the current nozzle diameter */
  private updateLineWidth (): void {
    // The slicer's nozzle diameter wins over the printer profile
    this.gcodeModel.applyLineWidth(this.parsedGcode?.slicerNozzleDiameter ?? this.nozzleDiameter)
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

    this.printTimeline.index(this.parsedGcode.layers)
    this.gcodeModel.rebuild()
    this.updateLayerHighlight()
  }

  /* ---- Print tracking ---- */

  /**
   * Advances the displayed print progress for a new frame
   * @param deltaSeconds - Seconds elapsed since the previous call
   * @returns Whether the scene changed, the nozzle position to show, if any, and the nozzle diameter
   */
  private updatePrintView (deltaSeconds: number): PrintViewUpdate {
    const state = this.currentPrinterState
    const tracking = state && !this.manualSliding && (state.flags.printing || state.flags.paused)

    let needRender = false
    let nozzlePosition: Vector3 | null = null
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

    const nozzleDiameter = this.parsedGcode?.slicerNozzleDiameter ?? this.nozzleDiameter ?? DEFAULT_NOZZLE_DIAMETER
    return { needRender, nozzlePosition, nozzleDiameter }
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

  /** Z height of the current layer */
  get currentLayerZ (): number {
    return this.parsedGcode?.layers[this._currentLayerNumber - 1]?.z ?? 0
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
    this._currentSegmentNumber = Math.min(Math.max(segmentNumber, 0), this.currentLayerSegmentCount)
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

  /** Resets the camera to the default view */
  resetView (): void {
    this.viewer.applyDefaultView(true)
  }

  /**
   * Rotates the camera to a named view angle
   * @param view - View angle to rotate to
   */
  applyViewAngle (view: ViewAngle): void {
    this.viewer.applyViewAngle(view, true)
  }

  /** (Re)applies the navigation mode setting to the 3D view */
  updateNavigationMode (): void {
    this.viewer.applyNavigationMode(this.settings.navigationMode)
  }

  /** (Re)applies the projection mode setting to the 3D view */
  updateProjectionMode (): void {
    this.viewer.applyProjectionMode(this.settings.projectionMode)
  }

  /** (Re)applies the dark mode setting */
  updateDarkMode (): void {
    $('html').toggleClass('pg-dark', this.settings.darkMode)
    this.viewer.applyBackground(this.settings.darkMode)
    this.viewer.updateBedMesh()
  }

  /** (Re)applies the antialias setting to the 3D view */
  updateAntialias (): void {
    this.viewer.applyAntialias(this.settings.antialias)
  }

  /** (Re)applies the layer highlight setting to the displayed layer */
  updateLayerHighlight (): void {
    this.gcodeModel.highlightLayer(this.currentLayerNumber)
    this.viewer.requestRender()
  }

  /** Rebuilds the displayed gcode model to reflect the current settings */
  rebuildGcodeModel (): void {
    this.gcodeModel.rebuild()
    this.viewer.requestRender()
  }

  /** (Re)applies the model color settings */
  updateModelColors (): void {
    this.settings.save()
    this.loadGcode(this.currentJobPath, true)
  }

  /** (Re)applies the show bed setting to the 3D view */
  updateBedVisibility (): void {
    this.viewer.applyBedVisibility(this.settings.showBed)
  }

  /** (Re)applies the show exclusion markers setting to the 3D view */
  updateExclusionMarkersVisibility (): void {
    this.exclusions.regionMarkersGroup.visible = this.settings.showExclusionMarker
    this.viewer.requestRender()
  }

  /** Shows or hides the overlay windows to match the current settings */
  updateWindowStates (): void {
    applyStatusBarVisibility(this.settings.showStatusBar)

    applyLayerSliderVisibility(this.settings.showLayerSlider)
    applySegmentSliderVisibility(this.settings.showSegmentSlider)
    if (!this.settings.showLayerSlider) this.setCurrentLayerNumber(this.layerCount)
    else if (!this.settings.showSegmentSlider) this.setCurrentSegmentNumber(this.currentLayerSegmentCount)

    $('#state_wrapper').toggleClass('pg-hidden', !this.settings.showState)
    $('#files_wrapper').toggleClass('pg-hidden', !this.settings.showFiles)

    updateDashboardOverlay(this.settings)
    updateWebcamOverlay(this.settings)
  }

  /* ---- Printer profile ---- */

  /** Refreshes the nozzle diameter from the active printer profile */
  private updateNozzleDiameter (): void {
    const currentProfileData = this.printerProfilesVM.currentProfileData()
    const extruder = currentProfileData && currentProfileData.extruder
    this.nozzleDiameter = extruder && typeof extruder.nozzleDiameter === 'function' ? extruder.nozzleDiameter() : null
  }

  /** Refreshes the print bed geometry from the active printer profile */
  private updateBedVolume (): void {
    const currentProfileData = this.printerProfilesVM.currentProfileData()
    if (!currentProfileData || !currentProfileData.volume) return

    const volume = currentProfileData.volume

    const dims: Omit<BedVolume, 'origin'> = typeof volume.custom_box === 'function'
      ? { width: volume.width(), height: volume.height(), depth: volume.depth() }
      : {
          width: volume.custom_box.x_max() - volume.custom_box.x_min(),
          height: volume.custom_box.z_max() - volume.custom_box.z_min(),
          depth: volume.custom_box.y_max() - volume.custom_box.y_min()
        }

    this.bedVolume = { ...dims, origin: volume.origin() }
  }
}
