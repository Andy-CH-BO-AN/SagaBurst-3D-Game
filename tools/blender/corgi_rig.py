"""Use the reviewed Corgi bind rig and deterministic reference; rebase legacy clips.

Rig node/IBM changes are canonical in corgi_rig.mjs and the small correction JSON.
No geometry or scene cat is edited here. Auxiliary clips evaluate the immutable
original rig in GUI Blender, then transfer its skin transforms to the new bind.
"""
from pathlib import Path
import hashlib
import json
import math
import runpy

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output/mount-retarget"
SOURCE = ROOT / "tools/blender/corgi-rig-correction.json"
BASES = ROOT / "tools/blender/corgi-reference-bases.json"


def target_reference(rig):
    import bpy
    from mathutils import Matrix, Vector
    spec = json.loads(SOURCE.read_text())
    bases = json.loads(BASES.read_text())
    assert spec["baselineSha256"] == bases["baselineSha256"]
    for key, points in spec["landmarks"].items():
        for role, point in points.items():
            bone = "corgi_"+key.split("_")[0]+("_paw_" if role=="wrist" else "_ankle_")+key[-1]
            assert (rig.data.bones[bone].head_local-Vector(point)).length < 2e-5, "Prepare the reviewed canonical Corgi rig first: "+bone
    retarget=runpy.run_path(str(ROOT/"tools/blender/retarget_animals.py"))
    retarget["select_action"](rig,None)
    for pose in rig.pose.bones:
        pose.rotation_mode="QUATERNION"
        pose.matrix_basis=Matrix(bases["basis"][pose.name])
    bpy.context.view_layer.update()
    reference={p.name:{"basis":[list(r)for r in p.matrix_basis],"worldRotation":list(p.matrix.to_quaternion()),
                       "head":list(p.head),"tail":list(p.tail),"restRotation":list(p.bone.matrix_local.to_quaternion())}
               for p in rig.pose.bones}
    (OUT/"corgi-reference.json").write_text(json.dumps(reference,indent=2))
    metadata={"action":"immutable baseline idle first-frame local bases on reviewed corrected bind rig",
              "sourceFrame":1,"reference":"maintained corgi-reference-bases.json; independent of old-basis input actions",
              "boneHeuristic":"BLENDER","boneCount":len(reference),"rigAlgorithm":spec["algorithm"]}
    (OUT/"corgi-reference-metadata.json").write_text(json.dumps(metadata,indent=2))
    return reference


def legacy_source():
    import bpy
    spec=json.loads(SOURCE.read_text())
    assert hashlib.sha256((OUT/"corgi-baseline.glb").read_bytes()).hexdigest()==spec["baselineSha256"]
    existing=bpy.data.objects.get("CorgiLegacy__corgi_rig")
    if existing:
        return existing,{name:bpy.data.actions[action] for name,action in json.loads(existing["legacy_actions"]).items()}
    before_objects=set(bpy.data.objects);before_actions=set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(OUT/"corgi-legacy-input.glb"),bone_heuristic="BLENDER")
    objects=set(bpy.data.objects)-before_objects;actions=set(bpy.data.actions)-before_actions
    rig=next(o for o in objects if o.type=="ARMATURE")
    rig.name="CorgiLegacy__corgi_rig"
    keep={}
    for clip in ("jump","land","hit"):
        action=next(a for a in actions if a.name.split("|")[-1].split(".")[0].lower()==clip)
        action.name="corgi_legacy_source__"+clip;action.use_fake_user=True;keep[clip]=action
    rig["legacy_actions"]=json.dumps({n:a.name for n,a in keep.items()})
    # This read-only donor proxy needs only its armature and actual imported Actions.
    for ob in objects:
        if ob!=rig:
            bpy.data.objects.remove(ob,do_unlink=True)
    rig.hide_set(True);rig.hide_render=True
    return rig,keep


def bake_legacy(clips=("jump","land","hit")):
    import bpy
    from mathutils import Matrix
    bpy.context.scene.render.fps=60
    retarget=runpy.run_path(str(ROOT/"tools/blender/retarget_animals.py"))
    rig=bpy.data.objects["corgi_rig"];source,actions=legacy_source()
    assert max(abs(a-b)for ra,rb in zip(rig.matrix_world,source.matrix_world)for a,b in zip(ra,rb))<1e-5
    report={"method":"GUI Blender original evaluated pose @ inverse original bind @ corrected bind; target Action bake",
            "clips":{}}
    previous=OUT/"corgi-legacy-bake-report.json"
    if previous.exists():
        report["clips"].update(json.loads(previous.read_text()).get("clips",{}))
    for clip in clips:
        donor=actions[clip];retarget["select_action"](source,donor)
        start,end=donor.frame_range;count=round(end)
        old=bpy.data.actions.get("corgi__"+clip)
        if old:
            bpy.data.actions.remove(old)
        action=bpy.data.actions.new("corgi__"+clip);action.use_fake_user=True;retarget["select_action"](rig,action)
        maximum_error=0.;maximum_scale_error=0.
        for index in range(count+1):
            source_frame=end*index/count;retarget["update"](source_frame)
            desired={p.name:p.matrix@p.bone.matrix_local.inverted()@rig.data.bones[p.name].matrix_local
                     for p in source.pose.bones}
            for p in rig.pose.bones:
                parent=p.parent
                p.rotation_mode="QUATERNION"
                p.matrix_basis=p.bone.convert_local_to_pose(desired[p.name],p.bone.matrix_local,
                    parent_matrix=desired[parent.name]if parent else Matrix.Identity(4),
                    parent_matrix_local=parent.bone.matrix_local if parent else Matrix.Identity(4),invert=True)
                maximum_scale_error=max(maximum_scale_error,max(abs(v-1)for v in p.scale))
                assert max(abs(v-1)for v in p.scale)<1e-5,"Legacy conversion changed bone scale"
                p.scale=(1,1,1);p.rotation_quaternion.normalize()
            bpy.context.view_layer.update()
            for p in rig.pose.bones:
                actual=p.matrix@p.bone.matrix_local.inverted()
                original=source.pose.bones[p.name].matrix@source.data.bones[p.name].matrix_local.inverted()
                maximum_error=max(maximum_error,max(abs(a-b)for ra,rb in zip(actual,original)for a,b in zip(ra,rb)))
                p.keyframe_insert("rotation_quaternion",frame=index+1,group=p.name)
                p.keyframe_insert("location",frame=index+1,group=p.name)
                p.keyframe_insert("scale",frame=index+1,group=p.name)
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:
                            key.interpolation="LINEAR"
        runpy.run_path(str(ROOT/"tools/blender/animal_quaternion.py"))["stabilize_action"](action)
        assert maximum_error<1e-5,"Legacy basis conversion drift"
        report["clips"][clip]={"originalDuration":end/60,"firstSourceKeySeconds":start/60,"leadingHoldPreserved":True,
                                 "duration":count/60,"frameRange":[1,count+1],
                                 "maximumSkinTransformMatrixError":maximum_error,"maximumScaleError":maximum_scale_error}
    retarget["select_action"](rig,bpy.data.actions["corgi__run"])
    (OUT/"corgi-legacy-bake-report.json").write_text(json.dumps(report,indent=2));print(json.dumps(report))
    return report
