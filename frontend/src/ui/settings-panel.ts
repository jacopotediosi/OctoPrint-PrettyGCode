import GUI, { type Controller } from 'lil-gui'
import { NAVIGATION_MODES } from '../viewer/navigation'
import { Settings } from '../settings'
import { initModelColorsModal } from './model-colors-modal'
import type { PrettyGCodeApp } from '../app'

/** Default value of every setting */
const DEFAULTS = new Settings()

/**
 * Builds the plugin settings panel
 * @param app - Application instance
 * @returns The created panel
 */
export function initSettingsPanel (app: PrettyGCodeApp) {
  const settings = app.settings
  const gui = new GUI({ autoPlace: false })
  $('#pg-view-settings').append(gui.domElement)

  const refreshers: Array<() => void> = []
  const refreshResets = () => refreshers.forEach((refresh) => refresh())
  gui.onChange(() => {
    settings.save()
    refreshResets()
  })

  const option = (folder: GUI, prop: keyof Settings, name: string, help: string) => {
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
  ).onFinishChange(() => app.updateDarkMode())

  option(
    interfaceFolder,
    'showStatusBar',
    'Status bar',
    'Show the temperature status bar across the top of the view.'
  ).onFinishChange(() => app.updateWindowStates())

  option(
    interfaceFolder,
    'antialias',
    'Antialiasing',
    'Smooth jagged edges in the 3D view.'
  ).onFinishChange(() => app.updateAntialias())

  /* ---- Camera ---- */

  const cameraFolder = gui.addFolder('Camera')

  const navigationOptions = Object.fromEntries(Object.entries(NAVIGATION_MODES).map(([key, mode]) => [mode.name, key]))
  const navigation = cameraFolder.add(settings, 'navigationMode', navigationOptions).name('Navigation mode')
  navigation.domElement.title = 'Set which mouse buttons rotate, pan and zoom the 3D view.'
  navigation.onFinishChange(() => app.updateNavigationMode())

  const projection = cameraFolder.add(settings, 'projectionMode', { Perspective: 'perspective', Orthographic: 'orthographic' }).name('Projection mode')
  projection.domElement.title = 'Set whether the 3D view is drawn with a perspective or an orthographic projection.'
  projection.onFinishChange(() => app.updateProjectionMode())

  option(
    cameraFolder,
    'orbitWhenIdle',
    'Orbit when idle',
    'After 5 seconds with no mouse/camera movement the camera slowly orbits around the center.'
  )

  /* ---- GCode model ---- */

  const gcodeModelFolder = gui.addFolder('GCode model')

  option(
    gcodeModelFolder,
    'thickLines',
    'Thick lines',
    'Display lines with thickness, based on nozzle size.'
  ).onFinishChange(() => app.rebuildGcodeModel())

  const highlightIntensity = gcodeModelFolder.add(settings, 'highlightIntensity', 0, 100, 1).name('Highlight layer')
  highlightIntensity.domElement.title = 'Set how strongly the topmost displayed layer is shaded.'
  highlightIntensity.onChange(() => app.updateLayerHighlight())

  option(
    gcodeModelFolder,
    'showExcluded',
    'Excluded gcode',
    'Show gcode excluded by the Exclude Region and Cancel Object plugins, greyed out.'
  ).onFinishChange(() => app.rebuildGcodeModel())

  const modelColorsModal = initModelColorsModal(app, refreshResets)
  const customizeColors = gcodeModelFolder.add({ customize: () => modelColorsModal.open() }, 'customize').name('Customize colors…')
  customizeColors.domElement.title = 'Customize the colors used for the gcode model.'

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

  const updateNozzleControls = () => {
    nozzleSize.show(settings.nozzleStyle !== 'none')
    nozzleColor.show(settings.nozzleStyle !== 'none')
    nozzleTransparency.show(settings.nozzleStyle !== 'none')
    nozzleReflection.show(settings.nozzleStyle === 'model')
  }
  nozzleStyle.onFinishChange(updateNozzleControls)
  updateNozzleControls()

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
  ).onFinishChange(() => app.rebuildGcodeModel())

  option(
    bedFolder,
    'showExclusionMarker',
    'Exclusion marker',
    'Show the markers of the excluded regions.'
  ).onFinishChange(() => app.updateExclusionMarkersVisibility())

  bed.onFinishChange(() => {
    app.updateBedVisibility()
    app.rebuildGcodeModel()
    mirror.show(settings.showBed)
  })
  mirror.show(settings.showBed)

  /* ---- Reset buttons ---- */

  const defaultOf = (controller: Controller) => (DEFAULTS as any)[controller.property]
  const isDefault = (controller: Controller) => controller.getValue() === defaultOf(controller)
  const reset = (controller: Controller) => controller.load(defaultOf(controller))
  const colorsAtDefault = () =>
    settings.modelDefaultColor === DEFAULTS.modelDefaultColor &&
    JSON.stringify(settings.modelColorRules) === JSON.stringify(DEFAULTS.modelColorRules)
  const makeResetButton = (title: string) => {
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
    { controller: customizeColors, atDefault: colorsAtDefault, resetToDefault: modelColorsModal.resetToDefault }
  ]
  const customControllers = new Set(customResets.map((entry) => entry.controller))

  // One reset entry per setting row, the custom ones keeping their own logic
  const resetEntries: ResetEntry[] = [
    ...gui.controllersRecursive()
      .filter((controller) => !customControllers.has(controller))
      .map((controller) => ({ controller, atDefault: () => isDefault(controller), resetToDefault: () => reset(controller) })),
    ...customResets
  ]

  // One reset button at the right of each setting's row, disabled while the setting is at its default
  for (const { controller, atDefault, resetToDefault } of resetEntries) {
    const button = makeResetButton('Reset this setting to its default value')
    button.addEventListener('click', resetToDefault)
    controller.domElement.append(button)
    refreshers.push(() => { button.disabled = atDefault() })
  }

  // Panel header: the title and a reset button for every setting, disabled while all are at their default
  const resetAll = makeResetButton('Reset all settings to their default values')
  resetAll.id = 'pg-reset-all'
  resetAll.addEventListener('click', () => resetEntries.forEach((entry) => entry.resetToDefault()))
  const header = document.createElement('div')
  header.id = 'pg-settings-header'
  header.append('Settings', resetAll)
  $('#pg-view-settings').append(header)
  refreshers.push(() => { resetAll.disabled = resetEntries.every((entry) => entry.atDefault()) })

  refreshResets()

  /* ---- Return ---- */

  return gui
}
