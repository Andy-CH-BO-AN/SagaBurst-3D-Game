"""Package a visually reviewed staged black cat. Run after build-black-cat.py.
Blender -b --python tools/package-black-cat.py -- staged-directory output-directory
"""
import bpy, hashlib, json, struct, sys
from pathlib import Path
args=sys.argv[sys.argv.index('--')+1:]
staged,out=Path(args[0]).resolve(),Path(args[1]).resolve()
out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(staged/'black-cat.blend'))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(out/'black-cat.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='ACTIONS',export_skins=True,
    export_all_influences=False,export_extras=True,export_yup=True,export_apply=False,
    export_meshopt_compression_enable=True,export_meshopt_extension='EXT_meshopt_compression')
raw=(out/'black-cat.glb').read_bytes()
length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length])
build=json.loads((staged/'build.json').read_text())
url='https://sketchfab.com/3d-models/black-cat-dd0adc10d8b94bc99dfffe0268818e0b'
attribution='Black Cat by 3D Creator (3DChuang-Ke-Ji), Sketchfab, CC BY 4.0. Modified for SagaBurst.'
manifest={'schemaVersion':1,'id':'black-cat-v2','status':'ready','forward':'+Z','file':'black-cat.glb',
    'source':{'title':'Black Cat','author':'3D Creator (3DChuang-Ke-Ji)','url':url,'license':'CC-BY-4.0',
        'licenseUrl':'https://creativecommons.org/licenses/by/4.0/','sourceSha256':build['sourceSha256']},
    'attribution':attribution,'modifications':['Uniform 3.5x scale and baked +Z heading','Fitted 25-joint feline skin',
        'Forward-facing neck and head pose','Nine in-place animations','Source-derived body LODs','Fitted saddle and leather armour','2048px source PBR maps','Meshopt compression'],
    'metrics':{'triangles':build['triangles'],'textureMaxSize':2048,'packageBytes':len(raw),'saddleHeightM':1.65},
    'lodNodes':['cat_body_lod0','cat_body_lod1','cat_body_lod2'],'clips':list(build['clips']),
    'sockets':['socket_saddle_seat','socket_camera'],'sha256':hashlib.sha256(raw).hexdigest()}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(out/'bone-map.json').write_text(json.dumps(build['landmarks'],indent=2)+'\n')
(out/'CREDITS.md').write_text(f'''# Black Cat

{attribution}

- Model and supplied base-color, normal and roughness maps: [3D Creator's Black Cat]({url}).
- License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- Source SHA-256: `{build['sourceSha256']}`.
- Source geometry and coat are preserved; uniform scale and heading are baked into the asset.
- SagaBurst additions: fitted feline skeleton, skin weights, forward-facing neck and head pose, idle/walk/trot/canter/gallop/jump/land/hit/death clips, three body LODs, saddle, stirrups and leather plates.
- Textures are reduced to 2048 pixels; geometry uses EXT_meshopt_compression. One immutable package is shared; each cat has its own skeleton and mixer.

Rebuild with `tools/build-black-cat.py`, inspect staged rest and animation exports, then run `tools/package-black-cat.py`. Original downloads and Blender working files remain outside the shipped package.
''')
print(json.dumps({'bytes':len(raw),'extensions':doc.get('extensionsUsed'),'animations':len(doc.get('animations',[]))}))
