"""Rebuild the licensed user-supplied white-eagle FBX as the xongkoro runtime GLB.
Run Blender --background --python tools/build-xongkoro.py -- --source /path/to/white-eagle-animation-fast-fly.zip.
Source downloads and working .blend files stay in ignored output/."""
import argparse, hashlib, json, math, struct, sys, zipfile
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

p = argparse.ArgumentParser()
p.add_argument("--source", required=True)
p.add_argument("--out", default="public/models/mounts/v2/xongkoro")
a = p.parse_args(sys.argv[sys.argv.index("--") + 1:])
source = Path(a.source).resolve(); dest = Path(a.out).resolve(); dest.mkdir(parents=True, exist_ok=True)
work = Path("output/xongkoro-build").resolve(); work.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(source) as z: z.extractall(work)
with zipfile.ZipFile(work / "source/Eagle Fly.zip") as z: z.extractall(work / "fbx")
fbx = work / "fbx/EAGLE FLY.fbx"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(fbx))
scene = bpy.context.scene; scene.render.fps = 30
arm = next(o for o in scene.objects if o.type == "ARMATURE")
body = next(o for o in scene.objects if o.type == "MESH")
original_action = arm.animation_data.action
source_action_name = original_action.name
frames = range(1, 20)
# Preserve skeletal flight, remove the donor absolute root trajectory. Gameplay owns translation.
samples = []
for frame in frames:
 scene.frame_set(frame)
 samples.append({b.name: (b.location.copy(), b.rotation_quaternion.copy(), b.scale.copy()) for b in arm.pose.bones})
root_position = samples[0]["FLY"][0]
arm.animation_data.action = bpy.data.actions.new("fly")
for frame, sample in zip(frames, samples):
 for name, (loc, rot, scale) in sample.items():
  bone = arm.pose.bones[name]; bone.rotation_mode = "QUATERNION"
  bone.location = root_position if name == "FLY" else loc
  bone.rotation_quaternion = rot; bone.scale = scale
  for prop in ("location", "rotation_quaternion", "scale"): bone.keyframe_insert(prop, frame=frame, group=name)
for action in list(bpy.data.actions):
 if action != arm.animation_data.action: bpy.data.actions.remove(action)
scene.frame_start=1; scene.frame_end=19; scene.frame_set(1)

def vertices():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get()); mesh=ev.to_mesh()
 points=[body.matrix_world@v.co for v in mesh.vertices]; ev.to_mesh_clear(); return points

points=vertices()
# Anatomical head/body/tail projection; wings and legs do not define body length.
groups={g.index:g.name for g in body.vertex_groups}
axial=[]
for v in body.data.vertices:
 axial_weight=sum(g.weight for g in v.groups if any(s in groups[g.group] for s in ("Pelvis","Spine","Neck","Head","Jaw","Tai")))
 if axial_weight > .5: axial.append(v.index)
minimum=min(points[i].x for i in axial); maximum=max(points[i].x for i in axial)
scale=10/(maximum-minimum)
centre_x=(minimum+maximum)/2
centre_y=(arm.matrix_world@arm.pose.bones["Bip01_Pelvis"].head).y
ground=min(v.z for v in points)
# Blender +X donor heading -> Blender -Y -> glTF +Z. Uniform one-time normalization.
normalization=Matrix.Rotation(-math.pi/2,4,"Z")@Matrix.Scale(scale,4)@Matrix.Translation(Vector((-centre_x,-centre_y,-ground)))
root=bpy.data.objects.new("xongkoro_asset",None); scene.collection.objects.link(root)
for obj in [o for o in list(scene.objects) if o != root and o.parent is None]: obj.parent=root
root.matrix_world=normalization
bpy.context.view_layer.update()

# Reconstruct the supplied base/alpha/normal maps without remote runtime dependencies.
mat=bpy.data.materials.new("xongkoro_feathers"); mat.use_nodes=True; nodes=mat.node_tree.nodes; nodes.clear()
bs=nodes.new("ShaderNodeBsdfPrincipled"); out=nodes.new("ShaderNodeOutputMaterial"); mat.node_tree.links.new(bs.outputs["BSDF"],out.inputs["Surface"])
bs.inputs["Roughness"].default_value=.82
source_base=bpy.data.images.load(str(work/"fbx/Texture Base.tga")); alpha=bpy.data.images.load(str(work/"fbx/Texture Alpha.tga"))
pixels=list(source_base.pixels[:]); mask=alpha.pixels[:]
for i in range(0,len(pixels),4): pixels[i+3]=mask[i]
base=bpy.data.images.new("base-color",width=source_base.size[0],height=source_base.size[1],alpha=True)
base.pixels=pixels; base.filepath_raw=str(dest/"base-color.png"); base.file_format="PNG"; base.save()
tex=nodes.new("ShaderNodeTexImage"); tex.image=base
mat.node_tree.links.new(tex.outputs["Color"],bs.inputs["Base Color"]); mat.node_tree.links.new(tex.outputs["Alpha"],bs.inputs["Alpha"])
normal=bpy.data.images.load(str(work/"fbx/Texture Normal.tga")); normal.colorspace_settings.name="Non-Color"; normal.pixels=normal.pixels[:]; normal.filepath_raw=str(dest/"normal.png"); normal.file_format="PNG"; normal.save()
nt=nodes.new("ShaderNodeTexImage"); nt.image=normal; nm=nodes.new("ShaderNodeNormalMap"); mat.node_tree.links.new(nt.outputs["Color"],nm.inputs["Color"]); mat.node_tree.links.new(nm.outputs["Normal"],bs.inputs["Normal"])
mat.surface_render_method="DITHERED"; mat.use_backface_culling=False
body.data.materials.clear(); body.data.materials.append(mat); body.name="eagle_body_lod0"

def socket(name, bone_name, donor):
 obj=bpy.data.objects.new(name,None); scene.collection.objects.link(obj)
 obj.parent=arm; obj.parent_type="BONE"; obj.parent_bone=bone_name
 bpy.context.view_layer.update()
 obj.matrix_world=normalization@Matrix.Translation(Vector(donor))
 return obj

# Back between the wing roots; feet, not pelvis. Canonical orientation matches +Z flight.
standing=socket("socket_rider_standing","Bip01_Spine1",(.040,centre_y,.052))
socket("socket_attack_head","Bip01_Head",(.147,-.330,.023))
socket("socket_attack_claw_left","Bip01_L_Foot",(-.080,-.339,-.022))
socket("socket_attack_claw_right","Bip01_R_Foot",(-.080,-.367,-.027))
# All LODs share the same immutable source surface/material, with independently decimated geometry.
triangles=[]
for index,ratio in enumerate((1,.65,.35)):
 mesh=body if index==0 else body.copy()
 if index:
  mesh.data=body.data.copy(); scene.collection.objects.link(mesh); mesh.name=f"eagle_body_lod{index}"
  bpy.context.view_layer.objects.active=mesh
  modifier=mesh.modifiers.new("Source LOD","DECIMATE"); modifier.ratio=ratio
  bpy.ops.object.modifier_apply(modifier=modifier.name)
 triangles.append(sum(len(face.vertices)-2 for face in mesh.data.polygons))

# Conservative measured full-cycle footprint; body collision remains separate in gameplay.
width=0; height=0
for frame in frames:
 scene.frame_set(frame); ps=vertices(); width=max(width,max(v.x for v in ps)-min(v.x for v in ps)); height=max(height,max(v.z for v in ps)-min(v.z for v in ps))
scene.frame_set(1); bpy.context.view_layer.update()
standing_world=standing.matrix_world.translation; standing_gltf=[standing_world.x,standing_world.z,-standing_world.y]
bpy.ops.export_scene.gltf(filepath=str(dest/"xongkoro.glb"),export_format="GLB",export_animations=True,export_animation_mode="ACTIVE_ACTIONS",export_frame_range=True,export_force_sampling=True,export_yup=True,export_skins=True,export_materials="EXPORT")
# Blender's merged ACTIVE_ACTIONS export names its single timeline "Animation".
# Publish the stable gameplay clip name without changing any animation payload.
glb_path=dest/"xongkoro.glb"; raw=glb_path.read_bytes(); json_length=struct.unpack_from("<I",raw,12)[0]
document=json.loads(raw[20:20+json_length]); document["animations"][0]["name"]="fly"
# The supplied alpha is a feather cutout, not a translucent body surface.
# BLEND disables Three.js depth writes and lets the eagle's underside/claws
# render through its back. MASK keeps feather holes while writing solid depth.
for material in document.get("materials",[]):
 material["alphaMode"]="MASK"; material["alphaCutoff"]=.5
payload=json.dumps(document,separators=(",",":")).encode(); payload+=b" "*((-len(payload))%4)
tail=raw[20+json_length:]
glb_path.write_bytes(b"glTF"+struct.pack("<II",2,20+len(payload)+len(tail))+struct.pack("<I",len(payload))+b"JSON"+payload+tail)
manifest={"id":"xongkoro","status":"ready","file":"xongkoro.glb","forward":"+Z","bodyLengthMeters":10,"source":{"title":"White Eagle Animation Fast Fly","author":"GremorySaiyan","url":"https://sketchfab.com/3d-models/white-eagle-animation-fast-fly-30203bf39e5145f19c79e83c550139d3","license":"CC-BY-4.0","licenseUrl":"https://creativecommons.org/licenses/by/4.0/","archiveSha256":hashlib.sha256(source.read_bytes()).hexdigest(),"fbxSha256":hashlib.sha256(fbx.read_bytes()).hexdigest()},"measurement":{"reference":"FBX fast-flight frame 1 at 30 fps; >0.5 cumulative head/neck/spine/pelvis/tail vertex influence; longitudinal +X projection, excludes wings and legs","sourceMinX":minimum,"sourceMaxX":maximum,"uniformScale":scale,"fullCycleWingspanMeters":width,"fullCycleHeightMeters":height,"standingSocketReferenceMeters":standing_gltf},"lodTriangles":triangles,"animations":{"fly":{"sourceTake":source_action_name,"sourceFrames":[1,19],"fps":30}},"missingSourceClips":["attack","takeoff","landing","death"],"procedural":"Grounded pose plants both feet using the source leg chains while retaining the spread wings; takeoff and landing blend with the source flight sample. Attack extends neck/head and legs over the current base pose. Death holds that base pose; translation and corpse descent belong to gameplay.","sockets":{"standing":"socket_rider_standing","head":"socket_attack_head","clawLeft":"socket_attack_claw_left","clawRight":"socket_attack_claw_right"}}
(dest/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
print(json.dumps(manifest,indent=2))
