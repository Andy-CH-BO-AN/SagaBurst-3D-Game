#!/usr/bin/env python3
"""Offline visual review only, before Meshopt packing; never a performance test.
blender -b --python tools/render-tiered-soldier-review.py -- full CLIP PHASE LOD OUTPUT [IDS]
blender -b --python tools/render-tiered-soldier-review.py -- grip ID CLIP PHASE l|r OUTPUT
Mock cylinder is diagnostic only, not shipped equipment or proof of runtime contact.
"""
import sys
mode = sys.argv[sys.argv.index('--')+1]
sys.argv.remove(mode)
if mode == "full":
 import bpy,sys,math,json
 from pathlib import Path
 from mathutils import Vector
 args=sys.argv[sys.argv.index('--')+1:];clip=args[0];phase=float(args[1]);lod=int(args[2]);out=Path(args[3]);close=len(args)>4 and args[4]=='hand'
 bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.render.fps=30;scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=False
 rigs=[]
 for row,id in enumerate(args[4].split(',') if len(args)>4 else ['roman-t1','roman-t2','viking-t1','viking-t2']):
  for col,angle in enumerate([0,math.pi/2]):
   before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(Path('public/models/characters/v2')/id/f'lod{lod}.glb'));imported=set(bpy.data.objects)-before
   rig=next(o for o in imported if o.type=='ARMATURE');tracks=list(rig.animation_data.nla_tracks);action=next(t.strips[0].action for t in tracks if t.name==clip or t.name.startswith(clip+'.'))
   for t in tracks:rig.animation_data.nla_tracks.remove(t)
   rig.animation_data.action=action;rig.data.pose_position='POSE';first,last=action.frame_range;frame=first+(last-first)*phase;scene.frame_set(int(frame),subframe=frame%1)
   wrapper=bpy.data.objects.new(id+'_view',None);bpy.context.collection.objects.link(wrapper)
   for o in imported:
    if o.parent is None:o.parent=wrapper
   wrapper.location=(col*2.1,0,-row*2.0);wrapper.rotation_euler.z=angle;rigs.append(rig)
 scene.world=bpy.data.worlds.new('World');scene.world.color=(.32,.32,.32)
 for loc,power,size in [((2,-6,7),1800,7),((-4,-2,1),1300,5),((4,4,4),1800,5)]:
  bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.size=size;o.rotation_euler=(Vector((1,0,-2))-o.location).to_track_quat('-Z','Y').to_euler()
 bpy.ops.object.camera_add(location=(1,-18,-2.1));camera=bpy.context.object;camera.rotation_euler=(Vector((1,0,-2.1))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=8.5;scene.camera=camera
 scene.render.resolution_x=1400;scene.render.resolution_y=2100;scene.render.resolution_percentage=100;scene.render.filepath=str(out.resolve());out.parent.mkdir(parents=True,exist_ok=True);bpy.ops.render.render(write_still=True)
elif mode == "grip":
 import bpy,sys,json,math
 from pathlib import Path
 from mathutils import Vector
 args=sys.argv[sys.argv.index('--')+1:];id,clip,phase,side=args[:4];phase=float(phase);out=Path(args[4]);root=Path('public/models/characters/v2')/id
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(root/'lod0.glb'));scene=bpy.context.scene;scene.render.fps=30;rig=next(o for o in scene.objects if o.type=='ARMATURE')
 tracks=list(rig.animation_data.nla_tracks);a=next(t.strips[0].action for t in tracks if t.name==clip)
 for t in tracks:rig.animation_data.nla_tracks.remove(t)
 rig.animation_data.action=a;first,last=a.frame_range;frame=first+(last-first)*phase;scene.frame_set(int(frame),subframe=frame%1);bpy.context.view_layer.update()
 m=json.load(open(root/'manifest.json'));f=m['swordGripFrames']['lod0'] if side=='r' else m['shieldGripFrames']['lod0'];b=rig.pose.bones['hand_'+side];matrix=rig.matrix_world@b.matrix
 center=matrix@Vector(f['gripCenterLocal']);axis=(matrix.to_3x3()@Vector(f['gripAxisLocal'])).normalized();normal=(matrix.to_3x3()@Vector(f['palmNormalLocal'])).normalized();along=(matrix.to_3x3()@Vector(f['fingerDirection'])).normalized()
 bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=.022,depth=.32,location=center);rod=bpy.context.object;rod.rotation_euler=axis.to_track_quat('Z','Y').to_euler();mat=bpy.data.materials.new('Mock_Grip_Only');mat.diffuse_color=(.12,.035,.008,1);rod.data.materials.append(mat)
 if side=='r' and clip in ['bowHold','bowLoad','bowRelease']:rod.hide_render=True
 scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=False;scene.render.resolution_x=1000;scene.render.resolution_y=800;scene.render.resolution_percentage=100;scene.world=bpy.data.worlds.new('World');scene.world.color=(.3,.3,.3)
 for loc,power in [((2,-4,4),1000),((-3,-2,2),700),((0,3,3),900)]:
  bpy.ops.object.light_add(type='AREA',location=Vector(loc));o=bpy.context.object;o.data.energy=power;o.data.size=4
 bpy.ops.object.camera_add(location=center+normal*.45+axis*.3+along*.2);cam=bpy.context.object;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.clip_start=.001;cam.data.ortho_scale=.40;scene.camera=cam
 scene.render.filepath=str(out.resolve());out.parent.mkdir(parents=True,exist_ok=True);bpy.ops.render.render(write_still=True)
else:
 raise ValueError("Expected full or grip review mode")
