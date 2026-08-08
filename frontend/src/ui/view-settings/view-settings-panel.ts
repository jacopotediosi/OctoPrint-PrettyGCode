import GUI, { type Controller } from 'lil-gui'
import { NAVIGATION_MODES } from '../../viewer/navigation'
import { initFeatureTypeColorsModal } from './feature-type-colors-modal'
import type { FeatureTypeColorPreset } from '../../gcode/feature-type-colors'
import type { Settings, SettingKey } from '../../settings'
import type { PrettyGCodeApp } from '../../app'

/** Handles of a view settings panel */
export interface ViewSettingsPanel {
  /** Brings the panel back in sync with the settings */
  refresh: () => void
}

/**
 * Builds the panel editing the view settings of this browser
 * @param app - Application instance
 * @returns The created panel
 */
export function initViewSettingsPanel (app: PrettyGCodeApp): ViewSettingsPanel {
  const container = document.getElementById('pg-view-settings')!
  return buildViewSettingsPanel(container, app.settings, () => app.settings.save(), app)
}

/**
 * Builds a view settings panel
 * @param container - Element holding the panel header and receiving the controls
 * @param settings - Settings the panel edits
 * @param onChange - Callback called after a setting change, null for none
 * @param app - Application to update live, null to only edit the values
 * @returns The created panel
 */
export function buildViewSettingsPanel (container: HTMLElement, settings: Settings, onChange: (() => void) | null, app: PrettyGCodeApp | null): ViewSettingsPanel {
  const gui = new GUI({ autoPlace: false })

  const refreshers: Array<() => void> = []
  const refreshResets = (): void => refreshers.forEach((refresh) => refresh())
  gui.onChange(() => {
    onChange?.()
    refreshResets()
  })
  gui.onFinishChange((event) => app?.applySettings([event.property as SettingKey]))

  const option = (folder: GUI, prop: SettingKey, name: string, help: string): Controller => {
    const controller = folder.add(settings, prop).name(name)
    controller.domElement.title = help
    return controller
  }

  /* ---- Interface ---- */

  const interfaceFolder = gui.addFolder('Interface')

  option(
    interfaceFolder,
    'darkMode',
    'Dark mode',
    'Use a dark theme.'
  )

  option(
    interfaceFolder,
    'showStatusBar',
    'Status bar',
    'Show the temperature status bar across the top of the view.'
  )

  option(
    interfaceFolder,
    'showLayerSlider',
    'Layer slider',
    'Show the layer slider along the right edge of the view.'
  )

  option(
    interfaceFolder,
    'showSegmentSlider',
    'Segment slider',
    'Show the segment slider along the bottom edge of the view.'
  )

  option(
    interfaceFolder,
    'antialias',
    'Antialiasing',
    'Smooth jagged edges in the 3D view.'
  )

  /* ---- Camera ---- */

  const cameraFolder = gui.addFolder('Camera')

  const navigationOptions = Object.fromEntries(Object.entries(NAVIGATION_MODES).map(([key, mode]) => [mode.name, key]))
  const navigation = cameraFolder.add(settings, 'navigationMode', navigationOptions).name('Navigation mode')
  navigation.domElement.title = 'Set which mouse buttons rotate, pan and zoom the 3D view.'

  const projection = cameraFolder.add(settings, 'projectionMode', { Perspective: 'perspective', Orthographic: 'orthographic' }).name('Projection mode')
  projection.domElement.title = 'Set whether the 3D view is drawn with a perspective or an orthographic projection.'

  option(
    cameraFolder,
    'showCameraControls',
    'Camera controls',
    'Show the camera controls (view cube, reset view button).'
  )

  option(
    cameraFolder,
    'orbitWhenIdle',
    'Orbit when idle',
    'After 5 seconds with no mouse/camera movement the camera slowly orbits around the center.'
  )

  /* ---- Printer ---- */

  const printerFolder = gui.addFolder('Printer')

  const beltPrinter = option(
    printerFolder,
    'beltPrinter',
    'Belt printer',
    'Set whether the printer prints onto a moving belt.'
  )

  const beltPrinterGantryAngle = printerFolder.add(settings, 'beltPrinterGantryAngle', 1, 89, 1).name('Gantry angle')
  beltPrinterGantryAngle.domElement.title = 'Set the angle between the belt and the printer gantry.'

  beltPrinter.onFinishChange(() => beltPrinterGantryAngle.show(settings.beltPrinter))
  beltPrinterGantryAngle.show(settings.beltPrinter)

  /* ---- Nozzle ---- */

  const nozzleFolder = gui.addFolder('Nozzle')

  const nozzleStyle = nozzleFolder.add(settings, 'nozzleStyle', { None: 'none', '3D model': 'model', Dot: 'dot' }).name('Nozzle style')
  nozzleStyle.domElement.title = 'Set the marker shown at the current print position.'

  const nozzleSize = nozzleFolder.add(settings, 'nozzleSize', 50, 200, 5).name('Nozzle size')
  nozzleSize.domElement.title = 'Set the size of the nozzle marker, in percent of its default.'

  const nozzleColor = nozzleFolder.addColor(settings, 'nozzleColor').name('Nozzle color')
  nozzleColor.domElement.title = 'Set the color of the nozzle marker.'

  const nozzleTransparency = nozzleFolder.add(settings, 'nozzleTransparency', 0, 100, 1).name('Nozzle transparency')
  nozzleTransparency.domElement.title = 'Set how transparent the nozzle marker at the current print position is.'

  const nozzleReflection = option(
    nozzleFolder,
    'nozzleReflection',
    'Nozzle reflection',
    'Reflect the surrounding scene on the nozzle 3D model.'
  )

  const refreshNozzleControls = (): void => {
    nozzleSize.show(settings.nozzleStyle !== 'none')
    nozzleColor.show(settings.nozzleStyle !== 'none')
    nozzleTransparency.show(settings.nozzleStyle !== 'none')
    nozzleReflection.show(settings.nozzleStyle === 'model')
  }
  nozzleStyle.onFinishChange(refreshNozzleControls)
  refreshNozzleControls()

  /* ---- Travel moves ---- */

  const travelMovesFolder = gui.addFolder('Travel moves')

  const travelScope = travelMovesFolder.add(settings, 'travelScope', { Off: 'none', 'Displayed layer': 'displayedLayer', 'Whole model': 'wholeModel' }).name('Travel moves')
  travelScope.domElement.title = 'Set where the non-extruding moves between printed lines are drawn.'

  const travelColor = travelMovesFolder.addColor(settings, 'travelColor').name('Travel color')
  travelColor.domElement.title = 'Set the color of the travel moves.'

  travelScope.onFinishChange(() => travelColor.show(settings.travelScope !== 'none'))
  travelColor.show(settings.travelScope !== 'none')

  /* ---- Gcode model ---- */

  const gcodeModelFolder = gui.addFolder('G-code model')

  option(
    gcodeModelFolder,
    'thickLines',
    'Thick lines',
    'Display lines with thickness, based on nozzle size.'
  )

  const highlightIntensity = gcodeModelFolder.add(settings, 'highlightIntensity', 0, 100, 1).name('Highlight layer')
  highlightIntensity.domElement.title = 'Set how strongly the topmost displayed layer is shaded.'

  option(
    gcodeModelFolder,
    'showExcluded',
    'Excluded gcode',
    'Show gcode excluded by the Exclude Region and Cancel Object plugins, greyed out.'
  )

  const featureTypeColorPresets: FeatureTypeColorPreset[] = JSON.parse(container.dataset.featureTypeColorPresets ?? '[]')
  const featureTypeColorsModal = initFeatureTypeColorsModal(settings, featureTypeColorPresets, () => {
    onChange?.()
    app?.applySettings(['featureTypeColorRules', 'featureTypeDefaultColor'])
    refreshResets()
  })
  const customizeFeatureTypeColors = gcodeModelFolder.add({ customize: () => featureTypeColorsModal.open() }, 'customize').name('Feature type colors…')
  customizeFeatureTypeColors.domElement.title = 'Customize the colors of the G-code feature types.'

  /* ---- Bed ---- */

  const bedFolder = gui.addFolder('Bed')

  const bed = option(
    bedFolder,
    'showBed',
    'Bed',
    'Show the print bed.'
  )

  const mirror = option(
    bedFolder,
    'showMirror',
    'Mirror',
    'Show a reflection of the print on the bed.'
  )

  option(
    bedFolder,
    'showExclusionMarker',
    'Exclusion marker',
    'Show the markers of the excluded regions.'
  )

  bed.onFinishChange(() => mirror.show(settings.showBed))
  mirror.show(settings.showBed)

  /* ---- Reset buttons ---- */

  /**
   * Gets the setting a row edits
   * @param controller - Controller of a setting row
   * @returns Name of that setting
   */
  const keyOf = (controller: Controller): SettingKey => controller.property as SettingKey

  /**
   * Tells whether the feature type colors are at their default
   * @returns True when both the color rules and the default color are unchanged
   */
  const featureTypeColorsAtDefault = (): boolean => settings.isDefault('featureTypeDefaultColor') && settings.isDefault('featureTypeColorRules')

  /**
   * Builds a reset button
   * @param title - Tooltip of the button
   * @returns The button, with no click handler attached
   */
  const makeResetButton = (title: string): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'pg-reset'
    button.title = title
    const icon = document.createElement('i')
    icon.className = 'fa-solid fa-arrow-rotate-left'
    button.append(icon)
    return button
  }

  // How to reset a setting row and tell whether it is at its default
  type ResetEntry = { controller: Controller, atDefault: () => boolean, resetToDefault: () => void }

  // Rows that reset through their own logic instead of loading a default value
  const customResets: ResetEntry[] = [
    { controller: customizeFeatureTypeColors, atDefault: featureTypeColorsAtDefault, resetToDefault: featureTypeColorsModal.resetToDefault }
  ]
  const customControllers = new Set(customResets.map((entry) => entry.controller))

  // One reset entry per setting row, the custom ones keeping their own logic
  const resetEntries: ResetEntry[] = [
    ...gui.controllersRecursive()
      .filter((controller) => !customControllers.has(controller))
      .map((controller) => ({
        controller,
        atDefault: () => settings.isDefault(keyOf(controller)),
        resetToDefault: () => { controller.load(settings.defaultOf(keyOf(controller))) }
      })),
    ...customResets
  ]

  // One reset button at the right of each setting's row, disabled while the setting is at its default
  for (const { controller, atDefault, resetToDefault } of resetEntries) {
    const button = makeResetButton('Reset this setting to its default value')
    button.addEventListener('click', resetToDefault)
    controller.domElement.append(button)
    refreshers.push(() => { button.disabled = atDefault() })
  }

  // Panel header has a "reset all settings" button, disabled while all are at their default
  const resetAll = makeResetButton('Reset all settings to their default values')
  resetAll.classList.add('pg-reset-all')
  resetAll.addEventListener('click', () => resetEntries.forEach((entry) => entry.resetToDefault()))
  container.querySelector('.pg-view-settings-header')!.append(resetAll)
  refreshers.push(() => { resetAll.disabled = resetEntries.every((entry) => entry.atDefault()) })

  container.append(gui.domElement)
  refreshResets()

  /* ---- Return ---- */

  return {
    refresh: () => {
      gui.controllersRecursive().forEach((controller) => controller.updateDisplay())
      beltPrinterGantryAngle.show(settings.beltPrinter)
      refreshNozzleControls()
      travelColor.show(settings.travelScope !== 'none')
      mirror.show(settings.showBed)
      refreshResets()
    }
  }
}
