"""Package a visually reviewed staged corgi. Run after build-corgi.py.
Blender -b --python tools/package-corgi.py -- staged-directory output-directory
"""
import bpy, hashlib, json, struct, sys
from pathlib import Path
args=sys.argv[sys.argv.index('--')+1:]
staged,out=Path(args[0]).resolve(),Path(args[1]).resolve()
out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(staged/'corgi.blend'))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(out/'corgi.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='ACTIONS',export_skins=True,
    export_all_influences=False,export_extras=True,export_yup=True,export_apply=False,
    export_meshopt_compression_enable=True,export_meshopt_extension='EXT_meshopt_compression')
raw=(out/'corgi.glb').read_bytes()
length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length])
build=json.loads((staged/'build.json').read_text())
url='https://sketchfab.com/3d-models/corgi-dog-7afb2c8ef92c40819abc690584e6772a'
attribution='Corgi by leijiaoshou, Sketchfab, CC BY 4.0. Modified for SagaBurst.'
manifest={'schemaVersion':1,'id':'corgi-v2','status':'ready','forward':'+Z','file':'corgi.glb',
    'source':{'title':'Corgi','author':'leijiaoshou','url':url,'license':'CC-BY-4.0',
        'licenseUrl':'https://creativecommons.org/licenses/by/4.0/','sourceSha256':build['sourceSha256']},
    'attribution':attribution,'modifications':['Uniform 4x scale and baked +Z heading','Fitted 21-joint canine skin',
        'Nine in-place animations','Source-derived body LODs','Thin source-fitted rounded cushion and stirrups','1024px original base-color map','Meshopt compression'],
    'metrics':{'triangles':build['triangles'],'textureMaxSize':1024,'packageBytes':len(raw),'saddleHeightM':build['saddleHeightM']},
    'lodNodes':['corgi_body_lod0','corgi_body_lod1','corgi_body_lod2'],'clips':list(build['clips']),
    'sockets':['socket_saddle_seat','socket_camera'],'sha256':hashlib.sha256(raw).hexdigest()}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(out/'bone-map.json').write_text(json.dumps(build['landmarks'],indent=2)+'\n')
(out/'CREDITS.md').write_text(f'''# Corgi

{attribution}

- Model and supplied base-color map: [leijiaoshou corgi dog]({url}).
- License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- Source SHA-256: `{build['sourceSha256']}`.
- Source geometry and coat are preserved; uniform scale and heading are baked into the asset.
- SagaBurst additions: fitted canine skeleton, skin weights, idle/walk/trot/canter/gallop/jump/land/hit/death clips, three body LODs, saddle and stirrups.
- The original 1024px texture is preserved; geometry uses EXT_meshopt_compression. One immutable package is shared; each corgi has its own skeleton and mixer.

Rebuild with `tools/build-corgi.py`, inspect staged rest and animation exports, then run `tools/package-corgi.py`. Original downloads and Blender working files remain outside the shipped package.
''')
print(json.dumps({'bytes':len(raw),'extensions':doc.get('extensionsUsed'),'animations':len(doc.get('animations',[]))}))
