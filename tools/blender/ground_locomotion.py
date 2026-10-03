"""Raise baked quadruped actions only enough to keep the evaluated mesh clear.

Run through GUI Blender MCP after retarget/finalize and before export. Rest
bones, geometry, weights, horizontal travel and relative pose stay unchanged.
Integer frames and half-frame SLERP poses are checked. Each integer correction
also covers both adjacent midpoints so sampled GLB export preserves clearance.
"""
import json
import math
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

SPECS = {"black-cat": ("black_cat_rig", "cat"), "corgi": ("corgi_rig", "corgi")}


def ground_locomotion(animal, clips=("idle", "walk", "run")):
    rig_name, prefix = SPECS[animal]
    rig = bpy.data.objects[rig_name]
    torso = rig.pose.bones[prefix + "_torso"]
    assert torso.parent is None, "Ground correction requires the target torso root"
    meshes = [o for o in rig.children if o.type == "MESH"
              and (animal == "corgi" or not o.name.endswith(("lod1", "lod2")))]
    assert any(o.name == prefix + "_body_lod0" for o in meshes), "Missing target LOD0"
    to_local = (torso.bone.matrix_local.to_3x3().inverted()
                @ rig.matrix_world.to_3x3().inverted())
    out = Path(__file__).resolve().parents[2] / "output/mount-retarget"
    path = out / (animal + "-ground-locomotion-report.json")
    report = {"animal": animal, "minimumGroundZ": .005,
              "sampleStepFrames": .5, "meshes": [o.name for o in meshes], "clips": {}}
    if path.exists():
        report["clips"].update(json.loads(path.read_text())["clips"])

    def frame(value):
        bpy.context.scene.frame_set(math.floor(value), subframe=value % 1)
        bpy.context.view_layer.update()

    buffers = {mesh.name: np.empty(len(mesh.data.vertices) * 3, dtype=np.float32)
               for mesh in meshes}

    def bounds():
        graph = bpy.context.evaluated_depsgraph_get()
        minima = {}
        for mesh in meshes:
            obj = mesh.evaluated_get(graph)
            row = obj.matrix_world[2]
            coordinates = buffers[mesh.name]
            obj.data.vertices.foreach_get("co", coordinates)
            points = coordinates.reshape((-1, 3))
            if abs(row[0]) < 1e-8 and abs(row[1]) < 1e-8 and row[2] > 0:
                minimum = float(points[:, 2].min()) * row[2] + row[3]
            else:
                minimum = float((points @ np.array(row[:3], dtype=np.float32)).min()) + row[3]
            minima[mesh.name] = minimum
        return min(minima.values()), minima

    for clip in clips:
        assert clip in ("idle", "walk", "run", "jump", "land", "hit"), "Death uses finalize_animals"
        loops = clip in ("idle", "walk", "run")
        action = bpy.data.actions[animal + "__" + clip]
        rig.animation_data_create()
        for track in rig.animation_data.nla_tracks:
            track.mute = True
        rig.animation_data.action = action
        if action.slots:
            rig.animation_data.action_slot = action.slots[0]
        start, end = map(int, action.frame_range)
        source = []
        originals = {}
        for sample in range((end - start) * 2 + 1):
            f = start + sample / 2
            frame(f)
            minimum, values = bounds()
            assert math.isfinite(minimum), (animal, clip, f, "Nonfinite bounds")
            source.append({"frame": f, "minimumZ": minimum, "meshes": values,
                           "requiredRaiseM": max(0., .005 - minimum)})
            if sample % 2 == 0:
                originals[int(f)] = torso.location.copy()
        corrections = []
        for f in range(start, end + 1):
            sample = (f - start) * 2
            neighbours = source[max(0, sample - 1):min(len(source), sample + 2)]
            corrections.append(max(r["requiredRaiseM"] for r in neighbours))
        # Only locomotion wraps; auxiliary one-shots retain independent endpoints.
        if loops:
            corrections[0] = corrections[-1] = max(corrections[0], corrections[-1])
        for f, raise_m in zip(range(start, end + 1), corrections):
            torso.location = originals[f] + to_local @ Vector((0, 0, raise_m))
            torso.keyframe_insert("location", frame=f, group=torso.name)
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:
                            key.interpolation = "LINEAR"
        actual = []
        for sample in range((end - start) * 2 + 1):
            f = start + sample / 2
            frame(f)
            minimum, values = bounds()
            actual.append({"frame": f, "minimumZ": minimum, "meshes": values})
            assert minimum >= .005 - 1e-5, (animal, clip, f, minimum)
        report["clips"][clip] = {
            "frameRange": [start, end], "samples": len(actual),
            "minimumRaiseM": min(corrections), "maximumRaiseM": max(corrections),
            "minimumOriginalZ": min(r["minimumZ"] for r in source),
            "minimumFinalZ": min(r["minimumZ"] for r in actual),
            "loop": loops,
            "loopEndpointRaiseM": corrections[0] if loops else None,
            "corrections": [{"frame": f, "raiseM": value}
                            for f, value in zip(range(start, end + 1), corrections)],
            "originalBounds": source, "finalBounds": actual,
        }
        path.write_text(json.dumps(report, indent=2))
        print(json.dumps({"animal": animal, "clip": clip,
                          **{k: v for k, v in report["clips"][clip].items()
                             if k not in ("corrections", "originalBounds", "finalBounds")}}))
    return report
