$(function () {
  function PrettyGCodeViewModel (parameters) {
    /* ---- View models ---- */
    const accessVM = parameters[0]
    const loginStateVM = parameters[1]
    const printerProfilesVM = parameters[2]
    const settingsVM = parameters[3]

    /* ---- Application ---- */
    const app = new PrettyGCode.App({ printerProfilesVM, settingsVM })

    /* ---- Template bindings ---- */
    this.access = accessVM
    this.loginState = loginStateVM
    this.showPluginSettings = () => app.showPluginSettings()

    /* ---- OctoPrint callbacks ---- */
    this.fromCurrentData = (data) => app.fromCurrentData(data)
    this.fromHistoryData = (data) => app.fromHistoryData(data)
    this.onDataUpdaterPluginMessage = (plugin, data) => app.onDataUpdaterPluginMessage(plugin, data)
    this.onSettingsBeforeSave = () => app.onSettingsBeforeSave()
    this.onSettingsHidden = () => app.onSettingsHidden()
    this.onSettingsShown = () => app.onSettingsShown()
    this.onTabChange = (current, previous) => app.onTabChange(current, previous)
  }

  OCTOPRINT_VIEWMODELS.push({
    construct: PrettyGCodeViewModel,
    dependencies: ['accessViewModel', 'loginStateViewModel', 'printerProfilesViewModel', 'settingsViewModel'],
    elements: ['#tab_plugin_prettygcode']
  })
})
