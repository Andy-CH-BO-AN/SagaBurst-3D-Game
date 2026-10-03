"""Close donor loop seams and ground authored death on the target mesh.

Execute through the GUI Blender MCP after bake and before export. Does not
change rest bones, skin weights, or the user-selected cat run animation.
"""
import json
from pathlib import Path

import bpy
from mathutils import Vector


def finalize(animal, close_loops=("idle", "walk")):
    prefix = "cat" if animal == "black-cat" else "corgi"
    rig = bpy.data.objects["black_cat_rig" if animal == "black-cat" else "corgi_rig"]
    body = bpy.data.objects[prefix + "_body_lod0"]
    meshes = ([o for o in rig.children if o.type == "MESH"]
              if animal == "corgi" else [body])
    report = {"animal": animal, "closedLoops": [], "deathGround": [],
              "deathContactMeshes": [o.name for o in meshes]}

    def minimum_z():
        graph = bpy.context.evaluated_depsgraph_get()
        # Preserve the accepted cat calculation; Corgi checks all body LODs and tack.
        if animal == "black-cat":
            evaluated = body.evaluated_get(graph)
            return min((evaluated.matrix_world @ v.co).z for v in evaluated.data.vertices)
        import numpy as np
        minimum = float("inf")
        for mesh in meshes:
            evaluated = mesh.evaluated_get(graph)
            points = np.empty(len(evaluated.data.vertices) * 3, dtype=np.float32)
            evaluated.data.vertices.foreach_get("co", points)
            row = evaluated.matrix_world[2]
            values = points.reshape((-1, 3)) @ np.array(row[:3], dtype=np.float32) + row[3]
            minimum = min(minimum, float(values.min()))
        return minimum

    def select(action):
        for track in rig.animation_data.nla_tracks:
            track.mute = True
        rig.animation_data.action = action
        if action.slots:
            rig.animation_data.action_slot = action.slots[0]

    def frame(value):
        bpy.context.scene.frame_set(round(value))
        bpy.context.view_layer.update()

    for clip in close_loops:
        action = bpy.data.actions[animal + "__" + clip]
        select(action)
        start, end = map(int, action.frame_range)
        frame(start)
        first = {p.name: (p.location.copy(), p.rotation_quaternion.copy())
                 for p in rig.pose.bones}
        blend_start = start + (end - start) * .92
        # Read the full source window before inserting any replacement keys.
        samples = []
        for f in range(int(blend_start) + 1, end + 1):
            frame(f)
            samples.append((f, {p.name: (p.location.copy(), p.rotation_quaternion.copy())
                               for p in rig.pose.bones}))
        for f, values in samples:
            t = (f - blend_start) / (end - blend_start)
            t = t * t * (3 - 2 * t)
            for p in rig.pose.bones:
                p.location = values[p.name][0].lerp(first[p.name][0], t)
                p.rotation_quaternion = values[p.name][1].slerp(first[p.name][1], t)
                p.keyframe_insert("location", frame=f, group=p.name)
                p.keyframe_insert("rotation_quaternion", frame=f, group=p.name)
        report["closedLoops"].append(clip)

    if animal == "corgi":
        import runpy
        stabilize = runpy.run_path(str(Path(__file__).with_name("animal_quaternion.py")))["stabilize_action"]
        for clip in (*close_loops, "death"):
            stabilize(bpy.data.actions[animal + "__" + clip], loop=clip != "death")

    action = bpy.data.actions[animal + "__death"]
    select(action)
    start, end = map(int, action.frame_range)
    torso = rig.pose.bones[prefix + "_torso"]
    assert torso.parent is None, "Ground correction expects the target torso root"
    delta_to_local = (torso.bone.matrix_local.to_3x3().inverted()
                      @ rig.matrix_world.to_3x3().inverted())
    samples = []
    # All contact meshes inherit the torso root. Use actual evaluated surfaces
    # including Corgi tack, so neither body nor armour passes through the floor.
    for f in range(start, end + 1):
        frame(f)
        minimum = minimum_z()
        phase = (f - start) / (end - start)
        correction = max(0., .005 - minimum) if phase <= .12 else .005 - minimum
        samples.append((f, torso.location.copy() + delta_to_local @ Vector((0, 0, correction))))
    for f, location in samples:
        torso.location = location
        torso.keyframe_insert("location", frame=f, group=torso.name)
    for f in range(start, end + 1):
        frame(f)
        minimum = minimum_z()
        report["deathGround"].append({"frame": f, "minimumZ": minimum})
        assert minimum >= -.001, (animal, "death penetrates floor", f, minimum)
    for clip in (*close_loops, "death"):
        for layer in bpy.data.actions[animal + "__" + clip].layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:
                            key.interpolation = "LINEAR"
    out = Path(__file__).resolve().parents[2] / "output/mount-retarget"
    (out / (animal + "-finalize-report.json")).write_text(json.dumps(report, indent=2))
    print(json.dumps({"animal": animal, "closedLoops": list(close_loops),
                      "minimumDeathZ": min(r["minimumZ"] for r in report["deathGround"])}))
    return report
