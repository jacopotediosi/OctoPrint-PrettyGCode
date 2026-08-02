from __future__ import annotations

from typing import TYPE_CHECKING

import octoprint.plugin

if TYPE_CHECKING:
    from typing import TypedDict

    class ModelColorRuleDef(TypedDict):
        """Gcode feature and the slicer comment keywords identifying it"""

        id: str
        keywords: list[str]

    class ModelColorPresetDef(TypedDict):
        """Named set of colors, one per gcode feature"""

        name: str
        defaultColor: str
        colors: dict[str, str]


GITHUB_URL = "https://github.com/jacopotediosi/OctoPrint-PrettyGCode"

MODEL_COLOR_RULE_DEFS: list[ModelColorRuleDef] = [
    # Prusa/SuperSlicer "Overhang perimeter", Bambu/Orca "Overhang wall"
    {"id": "overhang", "keywords": ["overhang"]},
    # Prusa/SuperSlicer "External perimeter", Bambu/Orca "Outer wall", Cura "WALL-OUTER", Simplify3D "outer perimeter"/"external single extrusion"
    {"id": "externalWall", "keywords": ["external", "outer"]},
    # Prusa/SuperSlicer "Perimeter", Bambu/Orca "Inner wall", Cura "WALL-INNER", Simplify3D "inner perimeter"/"internal single extrusion"
    {"id": "innerWall", "keywords": ["perimeter", "inner", "internal single"]},
    # Prusa/SuperSlicer "Top solid infill", Bambu/Orca "Top surface", Cura "SKIN"
    {"id": "topSurface", "keywords": ["top", "skin"]},
    # Bambu/Orca "Bottom surface"
    {"id": "bottomSurface", "keywords": ["bottom"]},
    # Prusa/SuperSlicer "Solid infill", Bambu/Orca "Internal solid infill", Simplify3D "solid layer"
    {"id": "solidInfill", "keywords": ["solid"]},
    # SuperSlicer "Internal bridge infill"
    {"id": "internalBridge", "keywords": ["internal bridge infill"]},
    # Prusa/SuperSlicer "Bridge infill", Bambu/Orca "Bridge", Orca "Internal Bridge", Simplify3D "bridge"
    {"id": "bridge", "keywords": ["bridge"]},
    # Bambu "Support ironing"
    {"id": "supportIroning", "keywords": ["support ironing"]},
    # Prusa/SuperSlicer/Bambu/Orca "Ironing"
    {"id": "ironing", "keywords": ["ironing"]},
    # Prusa/SuperSlicer "Gap fill", Bambu/Orca "Gap infill", Simplify3D "gap fill"
    {"id": "gap", "keywords": ["gap"]},
    # Prusa/SuperSlicer/Bambu/Orca "Skirt", Cura "SKIRT", Simplify3D "skirt"
    {"id": "skirt", "keywords": ["skirt"]},
    # Bambu/Orca "Brim", Simplify3D "raft"
    {"id": "brim", "keywords": ["brim", "raft"]},
    # Prusa/SuperSlicer "Support material interface", Bambu/Orca "Support interface", Cura "SUPPORT-INTERFACE"
    {"id": "supportInterface", "keywords": ["interface"]},
    # Bambu/Orca "Support transition"
    {"id": "supportTransition", "keywords": ["support transition"]},
    # Prusa/SuperSlicer "Support material", Bambu/Orca "Support", Cura "SUPPORT", Simplify3D "support"
    {"id": "support", "keywords": ["support"]},
    # Prusa/SuperSlicer/Bambu "Wipe tower", Orca "Prime tower", Simplify3D "prime pillar"/"ooze shield"
    {"id": "primeTower", "keywords": ["tower", "pillar", "ooze"]},
    # SuperSlicer "Thin wall"
    {"id": "thinWall", "keywords": ["thin wall"]},
    # Bambu "Floating vertical shell"
    {"id": "floatingShell", "keywords": ["floating vertical shell"]},
    # Prusa/SuperSlicer "Internal infill", Bambu/Orca "Sparse infill", Cura "FILL", Simplify3D "infill"
    {"id": "sparseInfill", "keywords": ["fill"]},
]
"""Definition of color rules: keywords for gcode feature, in priority order (first match from the top wins)"""

MODEL_COLOR_PRESET_DEFS: list[ModelColorPresetDef] = [
    {
        "name": "PrusaSlicer / SuperSlicer / Bambu Studio / OrcaSlicer",
        "defaultColor": "#e6b3b3",
        "colors": {
            "overhang": "#1f1fff",
            "externalWall": "#ff7d38",
            "innerWall": "#ffe64d",
            "topSurface": "#f04040",
            "bottomSurface": "#665cc7",
            "solidInfill": "#9654cc",
            "internalBridge": "#c94a42",
            "bridge": "#4d80ba",
            "supportIroning": "#99ff99",
            "ironing": "#ff8c69",
            "gap": "#ffffff",
            "skirt": "#00876e",
            "brim": "#003b6e",
            "supportInterface": "#008000",
            "supportTransition": "#004000",
            "support": "#00ff00",
            "primeTower": "#b3e3ab",
            "thinWall": "#00ff66",
            "floatingShell": "#e6b2b2",
            "sparseInfill": "#b03029",
        },
    },
    {
        "name": "Cura",
        "defaultColor": "#ffffff",
        "colors": {
            "overhang": "#1f1fff",
            "externalWall": "#e60000",
            "innerWall": "#00e600",
            "topSurface": "#e6e600",
            "bottomSurface": "#665cc7",
            "solidInfill": "#9654cc",
            "internalBridge": "#c94a42",
            "bridge": "#4d80ba",
            "supportIroning": "#99ff99",
            "ironing": "#ff8c69",
            "gap": "#ffffff",
            "skirt": "#00e6e6",
            "brim": "#003b6e",
            "supportInterface": "#3f7fff",
            "supportTransition": "#004000",
            "support": "#00e6e6",
            "primeTower": "#00ffff",
            "thinWall": "#00ff66",
            "floatingShell": "#e6b2b2",
            "sparseInfill": "#e67300",
        },
    },
]
"""Definition of color presets: preset names and match between features and colors"""

# Check that every preset def is complete and colors exactly the color rule defs
assert MODEL_COLOR_PRESET_DEFS, "There must be at least one model color preset"
for preset in MODEL_COLOR_PRESET_DEFS:
    assert preset.get("name"), "Every model color preset must have a name"
    assert preset.get("defaultColor"), f"Model color preset {preset['name']} must have a default color"
    assert set(preset.get("colors", {})) == {rule["id"] for rule in MODEL_COLOR_RULE_DEFS}, (
        f"Model color preset {preset['name']} must define a color for every model color rule, and for no other"
    )

MODEL_COLOR_PRESETS = [
    {
        "name": preset["name"],
        "defaultColor": preset["defaultColor"],
        "colorRules": [
            {"keywords": rule["keywords"], "color": preset["colors"][rule["id"]]} for rule in MODEL_COLOR_RULE_DEFS
        ],
    }
    for preset in MODEL_COLOR_PRESET_DEFS
]
"""Built-in color presets"""

DEFAULT_DEFAULT_VIEW_SETTINGS = {
    # ---- Interface ----
    # Whether to use a dark theme
    "darkMode": False,
    # Whether to show the temperature status bar
    "showStatusBar": True,
    # Whether to show the layer slider
    "showLayerSlider": True,
    # Whether to show the segment slider
    "showSegmentSlider": True,
    # Whether to antialias the 3D view
    "antialias": True,
    # ---- Camera ----
    # Navigation mode of the 3D view
    "navigationMode": "prusaslicer",
    # Projection mode of the 3D view
    "projectionMode": "perspective",
    # Whether to auto-orbit the camera when idle
    "orbitWhenIdle": False,
    # ---- Printer ----
    # Whether the printer prints onto a moving belt
    "beltPrinter": False,
    # Angle between the belt and the printer gantry, in degrees
    "beltPrinterGantryAngle": 45,
    # ---- Gcode model ----
    # Whether to draw the lines with their real thickness
    "thickLines": True,
    # Shading intensity of the topmost displayed layer, in percent
    "highlightIntensity": 40,
    # Whether to show gcode excluded from printing, greyed out
    "showExcluded": True,
    # Model color rules, tried in order
    "modelColorRules": MODEL_COLOR_PRESETS[0]["colorRules"],
    # Color of segments matching no color rule
    "modelDefaultColor": MODEL_COLOR_PRESETS[0]["defaultColor"],
    # ---- Nozzle ----
    # Marker shown at the nozzle position
    "nozzleStyle": "model",
    # Size of the nozzle marker, in percent of its default
    "nozzleSize": 100,
    # Color of the nozzle marker
    "nozzleColor": "#e6d36b",
    # Transparency of the nozzle marker, in percent
    "nozzleTransparency": 0,
    # Whether to reflect the scene on the nozzle model
    "nozzleReflection": True,
    # ---- Bed ----
    # Whether to show the print bed
    "showBed": True,
    # Whether to show a reflection of the print on the bed
    "showMirror": False,
    # Whether to show the markers of the excluded regions
    "showExclusionMarker": True,
}
"""Default value of the default view settings"""


class PrettyGCodePlugin(
    octoprint.plugin.AssetPlugin,
    octoprint.plugin.SettingsPlugin,
    octoprint.plugin.StartupPlugin,
    octoprint.plugin.TemplatePlugin,
):
    def get_assets(self):
        return {
            "js": [
                "js/pg-main.bundle.js",  # main bundle, built by `task build-frontend`
                "js/prettygcode.js",
            ],
            "css": ["css/prettygcode.css"],
        }

    def is_template_autoescaped(self):
        return True

    def get_template_vars(self):
        return {
            "default_settings": self.get_settings_defaults(),
            "github_url": GITHUB_URL,
            "model_color_presets": MODEL_COLOR_PRESETS,
            "plugin_version": self._plugin_version,
        }

    def get_template_configs(self):
        return [{"type": "settings", "custom_bindings": False}]

    def get_settings_defaults(self):
        return {"largeFileThresholdMb": 50, "defaultViewSettings": DEFAULT_DEFAULT_VIEW_SETTINGS}

    def get_update_information(self):
        return {
            "prettygcode": {
                "displayName": self._plugin_name,
                "displayVersion": self._plugin_version,
                "type": "github_release",
                "user": "jacopotediosi",
                "repo": "OctoPrint-PrettyGCode",
                "current": self._plugin_version,
                "pip": GITHUB_URL + "/archive/{target_version}.zip",
            }
        }


__plugin_name__ = "PrettyGCode"
__plugin_pythoncompat__ = ">=3.7,<4"
__plugin_implementation__ = PrettyGCodePlugin()
__plugin_hooks__ = {"octoprint.plugin.softwareupdate.check_config": __plugin_implementation__.get_update_information}
