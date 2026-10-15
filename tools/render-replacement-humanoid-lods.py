"""Offline geometry/UV review only. Does not replace game camera/equipment validation.
Usage: blender -b --python tools/render-replacement-humanoid-lods.py -- <assetroot> [front|side|back|stress]
"""
import bpy,sys,os,math
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:];root=args[0];view=args[1] if len(args)>1 else 'front'
bpy.context.scene.render.fps=30
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for ai,asset in enumerate(['viking','roman','viking-hero-t4']):
 for li in range(3):
  before=set(bpy.data.objects)
  bpy.ops.import_scene.gltf(filepath=os.path.join(root,asset,f'lod{li}.glb'))
  imported=set(bpy.data.objects)-before
  # Explicitly restore the loaded bind/rest pose; importing first action is not a visual acceptance of animation.
  for obj in imported:
   if obj.type=='ARMATURE':
    if view=='stress':
     tracks=list(obj.animation_data.nla_tracks) if obj.animation_data else []
     selected=next((t.strips[0].action for t in tracks if 'axeAttack2H' in t.name),None)
     if selected is None:raise RuntimeError('Missing stress animation')
     for t in tracks:obj.animation_data.nla_tracks.remove(t)
     obj.animation_data.action=selected;obj.data.pose_position='POSE'
    else:obj.animation_data_clear();obj.data.pose_position='REST'
  wrapper=bpy.data.objects.new(f'view_{ai}_{li}',None);bpy.context.collection.objects.link(wrapper)
  for obj in imported:
   if obj.parent is None:obj.parent=wrapper
  wrapper.location=(li*2.2,0,-ai*2.5)
  wrapper.rotation_euler.z={'side':math.pi/2,'back':math.pi}.get(view,0)
scene=bpy.context.scene
scene.frame_set(20 if view=='stress' else 1)
scene.render.engine='CYCLES';scene.cycles.samples=8;scene.cycles.use_denoising=False
scene.world.color=(.3,.3,.3)
for loc,power,size in [((2,-5,8),1600,8),((-4,-1,2),1000,5),((4,4,4),1300,5)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((2,0,-1))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(2.2,-13,-1.5));camera=bpy.context.object;camera.rotation_euler=(Vector((2.2,0,-1.5))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=8;scene.camera=camera
scene.render.resolution_x=1000;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=os.path.abspath(f'output/humanoid-replacement/final-lod-{view}.png')

bpy.ops.render.render(write_still=True)
