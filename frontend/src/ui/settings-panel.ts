import GUI from 'lil-gui'
import { NAVIGATION_MODES } from '../viewer'
import type { Settings } from '../settings'
import type { PrettyGCodeApp } from '../app'

/**
 * Builds the plugin settings panel
 * @param app - Application instance
 * @returns The created panel
 */
export function initSettingsPanel (app: PrettyGCodeApp) {
  const settings = app.settings
  const gui = new GUI({ autoPlace: false })
  $('#pg-view-settings').append(gui.domElement)
  gui.onChange(() => settings.save())

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

  /* ---- Nozzle ---- */

  const nozzleFolder = gui.addFolder('Nozzle')

  const nozzleTransparency = nozzleFolder.add(settings, 'nozzleTransparency', 0, 100, 1).name('Nozzle transparency')
  nozzleTransparency.domElement.title = 'Set how transparent the nozzle 3D model at the current print position is.'

  option(
    nozzleFolder,
    'nozzleReflection',
    'Nozzle reflection',
    'Reflect the surrounding scene on the nozzle 3D model.'
  )

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
    mirror.enable(settings.showBed)
  })
  mirror.enable(settings.showBed)

  return gui
}
