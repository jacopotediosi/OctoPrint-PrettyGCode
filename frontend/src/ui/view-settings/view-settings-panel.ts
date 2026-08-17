import GUI, { type Controller } from 'lil-gui'
import { NAVIGATION_MODES } from '../../viewer/navigation'
import { initFeatureTypeColorsModal } from './feature-type-colors-modal'
import { addSettingResetButtons, type ResetEntry } from './setting-reset-buttons'
import type { FeatureTypeColorPreset } from '../../gcode/colors/fixed-colors/feature-type'
import type { Settings, SettingKey } from '../../settings'
import type { PrettyGCodeApp } from '../../app'

/** Handles of a view settings panel */
export interface ViewSettingsPanel {
  /** Brings the panel back in sync with the settings */
  refresh: () => void
}

/** What a view settings panel edits and where it is built */
interface ViewSettingsPanelDefinition {
  /** Element holding the panel header and receiving the controls */
  container: HTMLElement
  /** Settings the panel edits */
  settings: Settings
  /** Callback called after a setting change */
  onChange?: () => void
  /** Application to update live, absent to only edit the values */
  app?: PrettyGCodeApp
}

/** What a setting row edits and how it is shown */
interface SettingRowDefinition {
  /** Folder holding the row */
  folder: GUI
  /** Setting the row edits */
  prop: SettingKey
  /** Label shown for the row */
  name: string
  /** Text shown when hovering the row */
  help: string
  /** Values the row lets pick, by label */
  choices?: Record<string, string>
  /** Lowest and highest value the row takes, and the step between them */
  range?: [min: number, max: number, step: number]
  /** Whether the row picks a color */
  color?: boolean
  /** Tells whether the row is shown, absent for a row always shown */
  shownWhen?: () => boolean
}

/**
 * Builds the panel editing the view settings of this browser
 * @param app - Application instance
 * @returns The created panel
 */
export function initViewSettingsPanel (app: PrettyGCodeApp): ViewSettingsPanel {
  const container = document.getElementById('pg-view-settings')!
  return buildViewSettingsPanel({ container, settings: app.settings, onChange: () => app.settings.save(), app })
}

/**
 * Builds a view settings panel
 * @param def - Element to build the panel in, settings it edits and what to update on a change
 * @returns The created panel
 */
export function buildViewSettingsPanel ({ container, settings, onChange, app }: ViewSettingsPanelDefinition): ViewSettingsPanel {
  const gui = new GUI({ autoPlace: false })

  /** Callbacks bringing a row back in sync with the settings */
  const refreshers: Array<() => void> = []

  /** Brings every row back in sync with the settings */
  const refreshRows = (): void => refreshers.forEach((refresh) => refresh())

  gui.onChange(() => {
    onChange?.()
    refreshRows()
  })
  gui.onFinishChange((event) => app?.applySettings([event.property as SettingKey]))

  /**
   * Adds a row editing a setting
   * @param def - What the row edits and how it is shown
   */
  const option = ({ folder, prop, name, help, choices, range, color, shownWhen }: SettingRowDefinition): void => {
    let controller: Controller
    if (color) controller = folder.addColor(settings, prop)
    else if (choices) controller = folder.add(settings, prop, choices)
    else if (range) controller = folder.add(settings, prop, ...range)
    else controller = folder.add(settings, prop)

    controller.name(name)
    controller.domElement.title = help
    if (shownWhen) refreshers.push(() => controller.show(shownWhen()))
  }

  /* ---- Interface ---- */

  const interfaceFolder = gui.addFolder('Interface')

  option({
    folder: interfaceFolder,
    prop: 'darkMode',
    name: 'Dark mode',
    help: 'Use a dark theme.'
  })

  option({
    folder: interfaceFolder,
    prop: 'showStatusBar',
    name: 'Status bar',
    help: 'Show the temperature status bar across the top of the view.'
  })

  option({
    folder: interfaceFolder,
    prop: 'showLayerSlider',
    name: 'Layer slider',
    help: 'Show the layer slider along the right edge of the view.'
  })

  option({
    folder: interfaceFolder,
    prop: 'showSegmentSlider',
    name: 'Segment slider',
    help: 'Show the segment slider along the bottom edge of the view.'
  })

  option({
    folder: interfaceFolder,
    prop: 'antialias',
    name: 'Antialiasing',
    help: 'Smooth jagged edges in the 3D view.'
  })

  /* ---- Camera ---- */

  const cameraFolder = gui.addFolder('Camera')

  const navigationOptions = Object.fromEntries(Object.entries(NAVIGATION_MODES).map(([key, mode]) => [mode.name, key]))
  option({
    folder: cameraFolder,
    prop: 'navigationMode',
    name: 'Navigation mode',
    help: 'Set which mouse buttons rotate, pan and zoom the 3D view.',
    choices: navigationOptions
  })

  option({
    folder: cameraFolder,
    prop: 'projectionMode',
    name: 'Projection mode',
    help: 'Set whether the 3D view is drawn with a perspective or an orthographic projection.',
    choices: { Perspective: 'perspective', Orthographic: 'orthographic' }
  })

  option({
    folder: cameraFolder,
    prop: 'showCameraControls',
    name: 'Camera controls',
    help: 'Show the camera controls (view cube, reset view button).'
  })

  option({
    folder: cameraFolder,
    prop: 'orbitWhenIdle',
    name: 'Orbit when idle',
    help: 'After 5 seconds with no mouse/camera movement the camera slowly orbits around the center.'
  })

  /* ---- Printer ---- */

  const printerFolder = gui.addFolder('Printer')

  option({
    folder: printerFolder,
    prop: 'beltPrinter',
    name: 'Belt printer',
    help: 'Set whether the printer prints onto a moving belt.'
  })

  option({
    folder: printerFolder,
    prop: 'beltPrinterGantryAngle',
    name: 'Gantry angle',
    help: 'Set the angle between the belt and the printer gantry.',
    range: [1, 89, 1],
    shownWhen: () => settings.beltPrinter
  })

  /* ---- Nozzle ---- */

  const nozzleFolder = gui.addFolder('Nozzle')

  option({
    folder: nozzleFolder,
    prop: 'nozzleStyle',
    name: 'Nozzle style',
    help: 'Set the marker shown at the current print position.',
    choices: { None: 'none', '3D model': 'model', Dot: 'dot' }
  })

  option({
    folder: nozzleFolder,
    prop: 'nozzleSize',
    name: 'Nozzle size',
    help: 'Set the size of the nozzle marker, in percent of its default.',
    range: [50, 200, 5],
    shownWhen: () => settings.nozzleStyle !== 'none'
  })

  option({
    folder: nozzleFolder,
    prop: 'nozzleColor',
    name: 'Nozzle color',
    help: 'Set the color of the nozzle marker.',
    color: true,
    shownWhen: () => settings.nozzleStyle !== 'none'
  })

  option({
    folder: nozzleFolder,
    prop: 'nozzleTransparency',
    name: 'Nozzle transparency',
    help: 'Set how transparent the nozzle marker at the current print position is.',
    range: [0, 100, 1],
    shownWhen: () => settings.nozzleStyle !== 'none'
  })

  option({
    folder: nozzleFolder,
    prop: 'nozzleReflection',
    name: 'Nozzle reflection',
    help: 'Reflect the surrounding scene on the nozzle 3D model.',
    shownWhen: () => settings.nozzleStyle === 'model'
  })

  /* ---- Travel moves ---- */

  const travelMovesFolder = gui.addFolder('Travel moves')

  option({
    folder: travelMovesFolder,
    prop: 'travelScope',
    name: 'Travel moves',
    help: 'Set where the non-extruding moves between printed lines are drawn.',
    choices: { Off: 'none', 'Displayed layer': 'displayedLayer', 'Whole model': 'wholeModel' }
  })

  option({
    folder: travelMovesFolder,
    prop: 'travelColor',
    name: 'Travel color',
    help: 'Set the color of the travel moves.',
    color: true,
    shownWhen: () => settings.travelScope !== 'none'
  })

  /* ---- Gcode model ---- */

  const gcodeModelFolder = gui.addFolder('G-code model')

  option({
    folder: gcodeModelFolder,
    prop: 'thickLines',
    name: 'Thick lines',
    help: 'Display lines with thickness, based on nozzle size.'
  })

  option({
    folder: gcodeModelFolder,
    prop: 'highlightIntensity',
    name: 'Highlight layer',
    help: 'Set how strongly the topmost displayed layer is shaded.',
    range: [0, 100, 1]
  })

  option({
    folder: gcodeModelFolder,
    prop: 'showExcluded',
    name: 'Excluded gcode',
    help: 'Show gcode excluded by the Exclude Region and Cancel Object plugins, greyed out.'
  })

  const featureTypeColorPresets: FeatureTypeColorPreset[] = JSON.parse(container.dataset.featureTypeColorPresets ?? '[]')
  const featureTypeColorsModal = initFeatureTypeColorsModal(settings, featureTypeColorPresets, () => {
    onChange?.()
    app?.applySettings(['featureTypeColorRules', 'featureTypeDefaultColor'])
    refreshRows()
  })
  const customizeFeatureTypeColors = gcodeModelFolder.add({ customize: () => featureTypeColorsModal.open() }, 'customize').name('Feature type colors...')
  customizeFeatureTypeColors.domElement.title = 'Customize the colors of the G-code feature types.'

  /* ---- Bed ---- */

  const bedFolder = gui.addFolder('Bed')

  option({
    folder: bedFolder,
    prop: 'showBed',
    name: 'Bed',
    help: 'Show the print bed.'
  })

  option({
    folder: bedFolder,
    prop: 'showMirror',
    name: 'Mirror',
    help: 'Show a reflection of the print on the bed.',
    shownWhen: () => settings.showBed
  })

  option({
    folder: bedFolder,
    prop: 'showExclusionMarker',
    name: 'Exclusion marker',
    help: 'Show the markers of the excluded regions.'
  })

  /* ---- Reset buttons ---- */

  /**
   * Tells whether the feature type colors are at their default
   * @returns True when both the color rules and the default color are unchanged
   */
  const featureTypeColorsAtDefault = (): boolean => settings.isDefault('featureTypeDefaultColor') && settings.isDefault('featureTypeColorRules')

  // Rows that reset through their own logic instead of loading a default value
  const customResets: ResetEntry[] = [
    { controller: customizeFeatureTypeColors, atDefault: featureTypeColorsAtDefault, resetToDefault: featureTypeColorsModal.resetToDefault }
  ]

  refreshers.push(...addSettingResetButtons({ gui, container, settings, customResets }))

  container.append(gui.domElement)
  refreshRows()

  /* ---- Return ---- */

  return {
    refresh: () => {
      gui.controllersRecursive().forEach((controller) => controller.updateDisplay())
      refreshRows()
    }
  }
}
