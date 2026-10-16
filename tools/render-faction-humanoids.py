#!/usr/bin/env python3
"""Offline front/side/rear deformation evidence, not GPU or gameplay acceptance.
blender -b --python tools/render-faction-humanoids.py -- ROOT CLIP PHASE LOD OUTPUT.png
Rows: Nordic, Roman, Shadow. Columns: front, strict side, rear. CLIP=rest allowed.
"""
import bpy,sys,math
from pathlib import Path
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:];root=Path(args[0]);clip=args[1]if len(args)>1 else'rest';phase=float(args[2])if len(args)>2 else .5;lod=int(args[3])if len(args)>3 else 0;out=Path(args[4])if len(args)>4 else Path('output/faction-humanoids')/f'{clip}-{phase}-lod{lod}.png';out.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.render.fps=30
for row,id in enumerate(['viking-civilian','roman-civilian','maki-archer-t4']):
 for column,angle in enumerate([0,math.pi/2,math.pi]):
  before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(root/id/f'lod{lod}.glb'));imported=set(bpy.data.objects)-before
  for o in imported:
   if o.type!='ARMATURE':continue
   if clip=='rest':o.animation_data_clear();o.data.pose_position='REST'
   else:
    tracks=list(o.animation_data.nla_tracks)if o.animation_data else[];action=next((t.strips[0].action for t in tracks if t.name==clip or t.name.startswith(clip+'.')),None)
    if action is None:
     action=next((t.strips[0].action for t in tracks if clip in t.name),None)
    if action is None:raise ValueError(f'Missing action {clip} for {id}: {[t.name for t in tracks]}')
    for t in tracks:o.animation_data.nla_tracks.remove(t)
    o.animation_data.action=action;o.data.pose_position='POSE'
    first,last=action.frame_range;action['reviewSampleFrame']=float(first+(last-first)*phase)
  wrapper=bpy.data.objects.new(f'{id}_view{column}',None);bpy.context.collection.objects.link(wrapper)
  for o in imported:
   if o.parent is None:o.parent=wrapper
  wrapper.location=(column*2.2,0,-row*2.25);wrapper.rotation_euler.z=angle
# Each clip has one common duration; evaluate same normalized phase for all.
rigs=[o for o in bpy.data.objects if o.type=='ARMATURE'];frame=rigs[0].animation_data.action['reviewSampleFrame']if clip!='rest'else 0
scene.frame_set(int(frame),subframe=frame%1)
scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=False;scene.world=bpy.data.worlds.new('World');scene.world.color=(.30,.30,.30)
for loc,power,size in [((2,-6,7),1400,7),((-4,-2,1),1000,5),((4,4,4),1600,5)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.size=size;o.rotation_euler=(Vector((2.2,0,-1.4))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(2.2,-18,-1.25));camera=bpy.context.object;camera.rotation_euler=(Vector((2.2,0,-1.25))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=7.3;scene.camera=camera
scene.render.resolution_x=1800;scene.render.resolution_y=1750;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(out.resolve());bpy.ops.render.render(write_still=True)
