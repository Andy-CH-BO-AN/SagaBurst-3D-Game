"""Finalize provenance/metrics and deterministically shrink retained hammer textures.
Run after build-meshy-bandit.py and retarget-meshy-bandit.mjs; audit afterwards.
"""
from pathlib import Path
from PIL import Image
import io,json,struct,hashlib
root=Path('public/models/characters/v2/bandit');work=Path('output/meshy-bandit')
old=json.loads(Path('output/meshy-bandit-donor/manifest.json').read_text())
report=json.loads((work/'retarget-report.json').read_text())
measure=json.loads((work/'body-build-metrics.json').read_text()) if (work/'body-build-metrics.json').exists() else {}
hashes={};texture_report={}
for lod,size in enumerate([2048,1024,512]):
 path=root/f'lod{lod}.glb';raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);binary=raw[28+length:];chunks=[];offset=0
 images={i['bufferView']:i for i in doc.get('images',[])};dims=[]
 for idx,view in enumerate(doc['bufferViews']):
  data=binary[view.get('byteOffset',0):][:view['byteLength']]
  if idx in images:
   im=Image.open(io.BytesIO(data));im.load()
   if im.mode=='RGBA' and im.getextrema()[3]==(255,255):im=im.convert('RGB')
   # One deterministic final encode after all geometry/animation work.
   im.thumbnail((size,size),Image.Resampling.LANCZOS);out=io.BytesIO()
   if im.mode in ['RGBA','LA']:im.save(out,format='PNG',optimize=True);images[idx]['mimeType']='image/png'
   else:im.convert('RGB').save(out,format='JPEG',quality=90,subsampling=0,optimize=True);images[idx]['mimeType']='image/jpeg'
   data=out.getvalue()
   dims.append({'width':im.width,'height':im.height,'rgba8DecodedBytes':im.width*im.height*4})
  pad=(-offset)%4;chunks.append(bytes(pad));offset+=pad;view['byteOffset']=offset;view['byteLength']=len(data);chunks.append(data);offset+=len(data)
 doc['buffers'][0]['byteLength']=offset;b=b''.join(chunks);b+=bytes((-len(b))%4);j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4)
 result=b'glTF'+struct.pack('<II',2,28+len(j)+len(b))+struct.pack('<I',len(j))+b'JSON'+j+struct.pack('<I',len(b))+b'BIN\0'+b
 path.write_bytes(result);hashes[f'lod{lod}']=hashlib.sha256(result).hexdigest();texture_report[f'lod{lod}']=dims
manifest={**old,'source':{'title':'Meshy medieval outlaw (user supplied)','author':'Meshy AI / user-supplied generation','filename':'Meshy_AI_ragged_warrior_rerigg_All_Animations.glb','sourceSha256':'fcc975506d11b7ecd2e3eaadee55f0b28ae280e05bb814bafa5e75e8588cef64','tool':'Meshy AI','plan':'Free, confirmed by owner','license':'CC BY 4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','url':'https://www.meshy.ai/'},'attribution':'Body: user-supplied Meshy AI generation, CC BY 4.0. Animations and original hammer: Fantasy Bandit by tokeshi / CGTrader, original incorporated-game-use license retained.','modifications':['Baked source centimetre root scale to metres, ground-centred +Z forward; uniform target height 1.75 m','Retained Meshy cloth/hair/body appearance and native skin weights; canonical bone aliases and sockets','Offline anatomical retarget of all six original tokeshi clips to the new bind pose, including both arms and palm axes','Original tokeshi hammer attached to calibrated right palm; bounded static distal-finger surface curl with original topology, UVs and weights; no old hand geometry or fabricated finger bones','Three LODs and 2K/1K/512 textures; removed unintended body emission; rough nonmetal cloth','Run-only coherent right-arm carry correction keeps original hammer away from new face; torso/left arm/combat clips unchanged','Attack duration 0.48 s and contact 0.252 s unchanged; no runtime retarget or gameplay changes'],'fileSha256':hashes,'donor':{'commit':'bb517258398423039a7a0dfa983681322c92a51d','path':'public/models/characters/v2/bandit/lod0.glb','sha256':old['fileSha256']['lod0'],'source':old['source'],'licenseNote':old['attribution'],'originalFiles':old['fileSha256']},'textureMemory':{'definition':'Uncompressed RGBA8 estimates, before mipmaps; actual GPU format not measured','images':texture_report},'lodPolicy':{'lod0':'Original body topology','lod1':'Approximately 6K body triangles','lod2':'Approximately 4K body triangles, deliberately above 1.5K–2.5K suggestion: 2K candidates visibly collapsed face/hands; preserve facial/hand features and boot endpoints'},'visualAcceptance':{'offline':'See PR evidence; structural audit is not art acceptance','browser':'Pending, execution sandbox blocks Chromium socket creation','gpuPerformance':'Not measured; no real GPU/display environment'}}
manifest['metrics']={**old['metrics'],'heightM':1.75,'triangles':{f"lod{r['level']}":r['triangles'] for r in report}}
if measure:
 scale=report[0]['uniformScale'];bones=measure['bones']
 distance=lambda a,b:sum((x-y)**2 for x,y in zip(bones[a]['headGltf'],bones[b]['headGltf']))**.5*scale
 manifest['metrics']['neckLengthM']=distance('neck','head')
 manifest['metrics']['shoulderWidthM']=distance('upper_arm_l','upper_arm_r')
 manifest['staticGripFit']=measure.get('staticRightHandGrip',{})
 manifest['metricDefinitions']={'heightM':'Final retargeted idle skinned body bounds, calibrated uniformly to 1.75 m','shoulderWidthM':'Rest shoulder-joint span, not cloth surface width','neckLengthM':'Rest neck-to-head joint distance'}
 (root/'bone-map.json').write_text(json.dumps(measure['boneAliasesSourceToCanonical'],indent=2)+'\n')
manifest['gripLimitations']='Static low-poly fingers, no articulated finger rig. Pre-export actual-triangle diagnostic improved intersecting hand faces 25 to 21 (edited region 8 to 4); approximately 6 mm deepest sampled edited-region overlap remains source baseline. Final visual evidence is separate.'
manifest['animations']={'embedded':old['animations']['embedded'],'runtimeGenerated':[]}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(root/'ATTRIBUTION.md').write_text('''# Bandit asset credits

## Body
Meshy_AI_ragged_warrior_rerigg_All_Animations.glb, generated with Meshy AI.
User confirmed Meshy Free plan. Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Original SHA-256: fcc975506d11b7ecd2e3eaadee55f0b28ae280e05bb814bafa5e75e8588cef64.
No individual public generation URL was supplied. Tool: https://www.meshy.ai/.
Changes: unit/height normalization, canonical rig aliases/sockets, offline animation retarget, LOD reduction,
texture resizing, local distal-finger surface fitting, and removal of unwanted emission.
Original source and Blender intermediates are not shipped.

## Original animations and iron hammer
Fantasy Bandit by tokeshi: https://www.cgtrader.com/free-3d-models/character/man/fantasy-bandit.
CGTrader Royalty Free (no AI), incorporated game use; no standalone redistribution.
License: https://www.cgtrader.com/pages/terms-and-conditions.
These are retained third-party assets, not Meshy originals. Six animation FBX hashes and take ranges remain in manifest.json.
Immutable pre-replacement source: commit bb517258398423039a7a0dfa983681322c92a51d,
public/models/characters/v2/bandit/lod0.glb, SHA-256 76244820ef8c5e1304ef2ac2e3f246958c8d2f47b50ef0f7bcab72249e5f575c.
Only original hammer geometry/textures and baked animation values are carried into the replacement.
The old complete body is not loaded at runtime.

Rebuild: see tools/meshy-bandit.md. Final file hashes and separate source licenses are recorded in manifest.json.
''')
print(json.dumps({'hashes':hashes,'textureImages':texture_report},indent=2))
