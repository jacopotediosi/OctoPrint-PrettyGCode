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

/** What a setting row lets the user pick, beyond a plain value */
interface OptionChoices {
  /** Values the row lets pick, by label */
  choices?: Record<string, string>
  /** Lowest and highest value the row takes, and the step between them */
  range?: [min: number, max: number, step: number]
  /** Whether the row picks a color */
  color?: boolean
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
   * @param folder - Folder holding the row
   * @param prop - Setting the row edits
   * @param name - Label shown for the row
   * @param help - Text shown when hovering the row
   * @param picks - What the row lets the user pick, beyond a plain value
   * @returns The row controller
   */
  const option = (folder: GUI, prop: SettingKey, name: string, help: string, picks: OptionChoices = {}): Controller => {
    const { choices, range, color } = picks

    let controller: Controller
    if (color) controller = folder.addColor(settings, prop)
    else if (choices) controller = folder.add(settings, prop, choices)
    else if (range) controller = folder.add(settings, prop, ...range)
    else controller = folder.add(settings, prop)

    controller.name(name)
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
  option(
    cameraFolder,
    'navigationMode',
    'Navigation mode',
    'Set which mouse buttons rotate, pan and zoom the 3D view.',
    { choices: navigationOptions }
  )

  option(
    cameraFolder,
    'projectionMode',
    'Projection mode',
    'Set whether the 3D view is drawn with a perspective or an orthographic projection.',
    { choices: { Perspective: 'perspective', Orthographic: 'orthographic' } }
  )

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

  option(
    printerFolder,
    'beltPrinter',
    'Belt printer',
    'Set whether the printer prints onto a moving belt.'
  )

  const beltPrinterGantryAngle = option(
    printerFolder,
    'beltPrinterGantryAngle',
    'Gantry angle',
    'Set the angle between the belt and the printer gantry.',
    { range: [1, 89, 1] }
  )

  refreshers.push(() => beltPrinterGantryAngle.show(settings.beltPrinter))

  /* ---- Nozzle ---- */

  const nozzleFolder = gui.addFolder('Nozzle')

  option(
    nozzleFolder,
    'nozzleStyle',
    'Nozzle style',
    'Set the marker shown at the current print position.',
    { choices: { None: 'none', '3D model': 'model', Dot: 'dot' } }
  )

  const nozzleSize = option(
    nozzleFolder,
    'nozzleSize',
    'Nozzle size',
    'Set the size of the nozzle marker, in percent of its default.',
    { range: [50, 200, 5] }
  )

  const nozzleColor = option(
    nozzleFolder,
    'nozzleColor',
    'Nozzle color',
    'Set the color of the nozzle marker.',
    { color: true }
  )

  const nozzleTransparency = option(
    nozzleFolder,
    'nozzleTransparency',
    'Nozzle transparency',
    'Set how transparent the nozzle marker at the current print position is.',
    { range: [0, 100, 1] }
  )

  const nozzleReflection = option(
    nozzleFolder,
    'nozzleReflection',
    'Nozzle reflection',
    'Reflect the surrounding scene on the nozzle 3D model.'
  )

  refreshers.push(() => {
    nozzleSize.show(settings.nozzleStyle !== 'none')
    nozzleColor.show(settings.nozzleStyle !== 'none')
    nozzleTransparency.show(settings.nozzleStyle !== 'none')
    nozzleReflection.show(settings.nozzleStyle === 'model')
  })

  /* ---- Travel moves ---- */

  const travelMovesFolder = gui.addFolder('Travel moves')

  option(
    travelMovesFolder,
    'travelScope',
    'Travel moves',
    'Set where the non-extruding moves between printed lines are drawn.',
    { choices: { Off: 'none', 'Displayed layer': 'displayedLayer', 'Whole model': 'wholeModel' } }
  )

  const travelColor = option(
    travelMovesFolder,
    'travelColor',
    'Travel color',
    'Set the color of the travel moves.',
    { color: true }
  )

  refreshers.push(() => travelColor.show(settings.travelScope !== 'none'))

  /* ---- Gcode model ---- */

  const gcodeModelFolder = gui.addFolder('G-code model')

  option(
    gcodeModelFolder,
    'thickLines',
    'Thick lines',
    'Display lines with thickness, based on nozzle size.'
  )

  option(
    gcodeModelFolder,
    'highlightIntensity',
    'Highlight layer',
    'Set how strongly the topmost displayed layer is shaded.',
    { range: [0, 100, 1] }
  )

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
    refreshRows()
  })
  const customizeFeatureTypeColors = gcodeModelFolder.add({ customize: () => featureTypeColorsModal.open() }, 'customize').name('Feature type colors...')
  customizeFeatureTypeColors.domElement.title = 'Customize the colors of the G-code feature types.'

  /* ---- Bed ---- */

  const bedFolder = gui.addFolder('Bed')

  option(
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

  refreshers.push(() => mirror.show(settings.showBed))

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
