# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp==1.30.0"]
# ///
"""Use the upstream MCP server over stdio; never connect to Blender's socket directly."""
from __future__ import annotations

import argparse
import asyncio
import base64
from datetime import datetime, timezone, timedelta
import json
import math
import os
from pathlib import Path
import shutil
import sys
import uuid

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

SERVER_PACKAGE = "mcp-for-blender==2.1.3"
DEFAULT_PROMPT = "安裝並驗證 Blender MCP"

SNAPSHOT_CODE = """import bpy, json
print(json.dumps({
    "background": bpy.app.background,
    "version": bpy.app.version_string,
    "file": bpy.data.filepath,
    "scene": bpy.context.scene.name,
    "frame": bpy.context.scene.frame_current,
    "mode": bpy.context.mode,
    "active": bpy.context.view_layer.objects.active.name if bpy.context.view_layer.objects.active else None,
    "selected": sorted(o.name for o in bpy.context.selected_objects),
    "objects": [{"name": o.name, "type": o.type, "location": list(o.location), "rotation": list(o.rotation_euler), "scale": list(o.scale)} for o in sorted(bpy.context.scene.objects, key=lambda o: o.name)]
}))
"""

def text_of(result):
    return "\n".join(c.text for c in result.content if c.type == "text")


def json_of(result):
    text = text_of(result)
    offset = text.find("{")
    if offset < 0:
        raise RuntimeError("Tool returned no JSON: " + text[:1000])
    value, _ = json.JSONDecoder().raw_decode(text[offset:])
    if isinstance(value, dict) and value.get("error"):
        raise RuntimeError(str(value["error"]))
    return value


def serialize_result(result, image_output=None):
    value = result.model_dump(mode="json", exclude_none=True)
    for index, content in enumerate(value.get("content", [])):
        if content.get("type") != "image":
            continue
        data = base64.b64decode(content.pop("data"))
        content["bytes"] = len(data)
        if image_output:
            path = Path(image_output)
            if index:
                path = path.with_name(f"{path.stem}-{index}{path.suffix}")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            content["saved_file"] = str(path)
    return value


async def smoke(session, call, args):
    """Create only an owned temporary mesh; preserve selection, mode, and originals."""
    trace = []
    name = "SagaBurst_MCP_Smoke_" + uuid.uuid4().hex[:12]
    marker = uuid.uuid4().hex
    location = [1.25, -2.5, 3.75]
    rotation = [0.1, 0.2, 0.3]
    scale = [0.5, 1.5, 2.0]
    before = None
    cleanup_error = None

    async def step(label, tool, arguments):
        result = await call(tool, arguments)
        trace.append({"step": label, "method": "tools/call", "tool": tool,
                      "arguments": arguments, "result": serialize_result(result, args.image_output)})
        return result

    report = {"passed": False, "temporary_object": name, "steps": trace}
    try:
        scene = json_of(await step("read_scene", "get_scene_info", {}))
        before = json_of(await step("read_original_state", "execute_blender_code", {"code": SNAPSHOT_CODE}))
        if before["background"]:
            raise RuntimeError("Smoke requires a GUI Blender instance, background was true")
        create = f"""import bpy, bmesh, json
assert {name!r} not in bpy.data.objects
mesh = bpy.data.meshes.new({name!r} + "_Mesh")
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=2.0)
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new({name!r}, mesh)
obj["sagaburst_mcp_smoke_owner"] = {marker!r}
bpy.context.scene.collection.objects.link(obj)
bpy.context.view_layer.update()
print(json.dumps({{"created": obj.name, "vertices": len(mesh.vertices), "polygons": len(mesh.polygons)}}))
"""
        created = json_of(await step("create_cube", "execute_blender_code", {"code": create}))
        if created["created"] != name or created["vertices"] != 8 or created["polygons"] != 6:
            raise RuntimeError("Temporary cube geometry did not match")
        modify = f"""import bpy, json
obj = bpy.data.objects[{name!r}]
assert obj.get("sagaburst_mcp_smoke_owner") == {marker!r}
obj.location = {location!r}
obj.rotation_euler = {rotation!r}
obj.scale = {scale!r}
bpy.context.view_layer.update()
print(json.dumps({{"modified": obj.name}}))
"""
        await step("modify_transform", "execute_blender_code", {"code": modify})
        observed = json_of(await step("read_transform", "get_object_info", {"object_name": name}))
        for key, expected in (("location", location), ("rotation", rotation), ("scale", scale)):
            if len(observed[key]) != 3 or any(not math.isclose(a, b, abs_tol=1e-6) for a, b in zip(observed[key], expected)):
                raise RuntimeError(f"Transform readback mismatch for {key}: {observed[key]}")
        report["expected_transform"] = {"location": location, "rotation": rotation, "scale": scale}
        report["observed_transform"] = {k: observed[k] for k in ("location", "rotation", "scale")}
        if args.image_output:
            await step("viewport_evidence", "get_viewport_screenshot", {"max_size": 1200})
        report["initial_scene"] = scene
    except Exception as error:
        report["error"] = str(error)
    finally:
        cleanup = f"""import bpy, json
obj = bpy.data.objects.get({name!r})
if obj is not None:
    assert obj.get("sagaburst_mcp_smoke_owner") == {marker!r}, "Refusing to remove an unowned object"
    mesh = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if mesh.users == 0:
        bpy.data.meshes.remove(mesh)
print(json.dumps({{"object_absent": {name!r} not in bpy.data.objects, "mesh_absent": {name!r} + "_Mesh" not in bpy.data.meshes}}))
"""
        try:
            removed = json_of(await step("delete_cube", "execute_blender_code", {"code": cleanup}))
            if not removed["object_absent"] or not removed["mesh_absent"]:
                raise RuntimeError("Temporary cube cleanup was incomplete")
            after = json_of(await step("read_final_state", "execute_blender_code", {"code": SNAPSHOT_CODE}))
            await step("read_final_scene", "get_scene_info", {})
            report["original_scene_preserved"] = before is not None and before == after
            report["gui_blender"] = not after["background"]
            if not report["original_scene_preserved"]:
                raise RuntimeError("Original scene objects, transforms, frame, selection, or mode changed")
        except Exception as error:
            cleanup_error = str(error)
            report["cleanup_error"] = cleanup_error
    report["passed"] = "error" not in report and cleanup_error is None
    return report


async def run(args):
    env = dict(os.environ)
    env.update({"UV_PYTHON_PREFERENCE": "only-managed", "DISABLE_TELEMETRY": "true",
                "BLENDER_HOST": args.host, "BLENDER_PORT": str(args.port)})
    parameters = StdioServerParameters(command=args.uvx,
        args=["--python", "3.11", SERVER_PACKAGE, "--host", args.host, "--port", str(args.port)], env=env)
    async with stdio_client(parameters) as (reader, writer):
        async with ClientSession(reader, writer, read_timeout_seconds=timedelta(seconds=args.timeout)) as session:
            initialized = await session.initialize()
            available = await session.list_tools()
            schemas = {tool.name: tool.inputSchema for tool in available.tools}
            report = {"timestamp": datetime.now(timezone.utc).isoformat(), "transport": "stdio",
                      "server_package": SERVER_PACKAGE, "initialize": initialized.model_dump(mode="json"),
                      "tools": list(schemas)}

            async def call(name, arguments):
                if name not in schemas:
                    raise RuntimeError("Tool is unavailable: " + name)
                arguments = dict(arguments)
                if "user_prompt" in schemas[name].get("properties", {}):
                    arguments.setdefault("user_prompt", args.user_prompt)
                result = await session.call_tool(name, arguments)
                text = text_of(result).lstrip()
                if result.isError or text.startswith(("Error ", "Error:", "Rejected by ")):
                    raise RuntimeError(text[:8000])
                return result

            if args.action == "list":
                report["tool_definitions"] = [tool.model_dump(mode="json") for tool in available.tools]
            elif args.action == "smoke":
                report.update(await smoke(session, call, args))
            else:
                if args.action == "scene":
                    name, arguments = "get_scene_info", {}
                elif args.action == "object":
                    name, arguments = "get_object_info", {"object_name": args.name}
                elif args.action == "exec":
                    name = "execute_blender_code"
                    code = Path(args.code_file).read_text() if args.code_file else args.code
                    arguments = {"code": code}
                else:
                    name = args.tool
                    arguments = json.loads(Path(args.arguments_file).read_text() if args.arguments_file else args.arguments_json)
                report["tool"] = name
                report["result"] = serialize_result(await call(name, arguments), args.image_output)
            return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uvx", default=shutil.which("uvx") or "uvx")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9876)
    parser.add_argument("--timeout", type=float, default=180, help="MCP client timeout; upstream bridge caps each call at 180 seconds")
    parser.add_argument("--user-prompt", default=DEFAULT_PROMPT)
    commands = parser.add_subparsers(dest="action", required=True)
    for action in ("list", "scene", "object", "exec", "call", "smoke"):
        command = commands.add_parser(action)
        command.add_argument("--output", type=Path)
        command.add_argument("--image-output", type=Path)
        if action == "object":
            command.add_argument("name")
        elif action == "exec":
            source = command.add_mutually_exclusive_group(required=True)
            source.add_argument("--code-file", type=Path)
            source.add_argument("--code")
        elif action == "call":
            command.add_argument("tool")
            source = command.add_mutually_exclusive_group()
            source.add_argument("--arguments-json", default="{}")
            source.add_argument("--arguments-file", type=Path)
    args = parser.parse_args()
    try:
        report = asyncio.run(run(args))
        encoded = json.dumps(report, ensure_ascii=False, indent=2)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(encoded + "\n")
        print(encoded)
        return 1 if args.action == "smoke" and not report["passed"] else 0
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
