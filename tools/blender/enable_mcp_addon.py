"""Enable the installed upstream addon in a new GUI Blender; preserve scene contents.

Usage: blender --python tools/blender/enable_mcp_addon.py [-- --port 9876]
Installation only. Modeling and smoke tests must use mcp_client.py.
"""
import argparse
import json
import sys

import bpy

if bpy.app.background:
    raise RuntimeError("Launch GUI Blender without --background for MCP")
parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=9876)
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
args = parser.parse_args(argv)
bpy.utils.refresh_script_paths()
if "blender_mcp" not in bpy.context.preferences.addons:
    bpy.ops.preferences.addon_enable(module="blender_mcp")
prefs = bpy.context.preferences.addons["blender_mcp"].preferences
prefs.telemetry_consent = False
for field in ("blendermcp_use_polyhaven", "blendermcp_use_hyper3d",
              "blendermcp_use_sketchfab", "blendermcp_use_polypizza"):
    if hasattr(bpy.context.scene, field):
        setattr(bpy.context.scene, field, False)
bpy.context.scene.blendermcp_port = args.port
bpy.context.scene.blendermcp_auto_start_server = True
bpy.ops.wm.save_userpref()
bpy.ops.blendermcp.start_server()
print("SAGABURST_MCP_GUI_READY " + json.dumps({
    "background": bpy.app.background, "version": bpy.app.version_string,
    "scene": bpy.context.scene.name, "server_running": bpy.context.scene.blendermcp_server_running,
    "objects": sorted(obj.name for obj in bpy.context.scene.objects),
}), flush=True)
