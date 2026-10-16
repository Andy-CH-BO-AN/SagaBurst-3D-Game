#!/usr/bin/env python3
"""Compact exported GLBs and resize embedded maps to actual 2K/1K/512 pixels.
Usage: python3 tools/pack-faction-humanoid-textures.py ASSET_ROOT [comma-separated-IDs] [comma-separated-LOD-levels] [--lossless-recompress]
Does not alter geometry, skinning, node transforms or animation accessor bytes.
--lossless-recompress accepts already animated, uncompressed GLBs: PNG encoding
only, with decoded RGBA equality checks. JPEG payloads are copied byte-for-byte.
"""
import sys,json,struct,io,hashlib
from pathlib import Path
from PIL import Image
import numpy as np
lossless='--lossless-recompress'in sys.argv;args=[a for a in sys.argv[1:]if a!='--lossless-recompress'];root=Path(args[0]);cache=Path('output/faction-humanoid-texture-cache');cache.mkdir(parents=True,exist_ok=True);ids=(args[1]if len(args)>1 else'viking-civilian,roman-civilian,maki-archer-t4').split(',')
def read(path):
 raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];return json.loads(raw[20:20+n]),raw[28+n:]
def encode(d,b):
 js=json.dumps(d,separators=(',',':')).encode();js+=b' '*((-len(js))%4);b+=b'\0'*((-len(b))%4)
 return struct.pack('<III',0x46546c67,2,28+len(js)+len(b))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(b),0x004e4942)+b
for id in ids:
 manifest=json.loads((root/id/'manifest.json').read_text());hashes=dict(manifest.get('fileSha256',{}));lods=[];equality=[]
 for level,size in enumerate([2048,1024,512]):
  if len(args)>2 and str(level)not in args[2].split(','):continue
  path=root/id/f'lod{level}.glb';d,b=read(path);images=[];replacements={}
  beforeSha=hashlib.sha256(path.read_bytes()).hexdigest();originalViews=[dict(v)for v in d['bufferViews']]
  if any('EXT_meshopt_compression'in v.get('extensions',{})for v in d['bufferViews']):raise ValueError(f'{path}: recompress PNGs before meshopt buffer packing')
  if not lossless and d.get('asset',{}).get('extras',{}).get('factionHumanoidAnimationBuild'):raise ValueError(f'{path}: pack textures before animation bake, or explicitly use --lossless-recompress')
  normals={d['textures'][m['normalTexture']['index']]['source']for m in d['materials']if 'normalTexture'in m}
  for i,im in enumerate(d['images']):
   view=d['bufferViews'][im['bufferView']];raw=b[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
   if lossless:
    original=Image.open(io.BytesIO(raw));original.load();pixels=original.convert('RGBA').tobytes();encoded=raw
    if im['mimeType']=='image/png':
     key=hashlib.sha256(raw+b'lossless-png-optimize9-v1').hexdigest();cached=cache/key
     if cached.exists():candidate=cached.read_bytes()
     else:
      out=io.BytesIO();original.save(out,format='PNG',compress_level=9,optimize=True);candidate=out.getvalue();cached.write_bytes(candidate)
     if len(candidate)<len(raw):encoded=candidate
    elif im['mimeType']!='image/jpeg':raise ValueError(f'Unsupported image encoding {im["mimeType"]}')
    decoded=Image.open(io.BytesIO(encoded));assert decoded.size==original.size and decoded.convert('RGBA').tobytes()==pixels
    replacements[im['bufferView']]=encoded
    images.append({'name':im.get('name',str(i)),'width':original.width,'height':original.height,'bytes':len(encoded),'encoding':im['mimeType'],'beforeBytes':len(raw),'inputEncodedSha256':hashlib.sha256(raw).hexdigest(),'outputEncodedSha256':hashlib.sha256(encoded).hexdigest(),'decodedRgbaSha256':hashlib.sha256(pixels).hexdigest(),'decodedRgbaIdentical':True,'jpegBytesUnchanged':im['mimeType']!='image/jpeg'or encoded==raw})
    continue
   original=Image.open(io.BytesIO(raw));original.load();original=original.convert('RGB'if original.mode!='RGBA'else'RGBA');original.thumbnail((size,size),Image.Resampling.LANCZOS)
   if i in normals:
    a=np.asarray(original).copy();n=a[:,:,:3].astype(np.float32)/127.5-1;n/=np.maximum(np.linalg.norm(n,axis=2,keepdims=True),1e-6);a[:,:,:3]=np.clip((n+1)*127.5,0,255).astype(np.uint8);original=Image.fromarray(a)
   base=any(d['textures'][m.get('pbrMetallicRoughness',{}).get('baseColorTexture',{}).get('index',-1)]['source']==i for m in d['materials']if m.get('pbrMetallicRoughness',{}).get('baseColorTexture'))
   jpeg=base and original.mode=='RGB';key=hashlib.sha256(raw+str((size,i in normals,jpeg)).encode()).hexdigest();cached=cache/key
   if cached.exists():encoded=cached.read_bytes()
   else:
    out=io.BytesIO()
    if jpeg:original.save(out,format='JPEG',quality=95,subsampling=0,optimize=True)
    else:original.save(out,format='PNG',compress_level=3)
    encoded=out.getvalue();cached.write_bytes(encoded)
   replacements[im['bufferView']]=encoded;im['mimeType']='image/jpeg'if jpeg else'image/png'
   images.append({'name':im.get('name',str(i)),'width':original.width,'height':original.height,'bytes':len(encoded),'normalVectorRenormalized':i in normals,'encoding':im['mimeType']})
  # Copy every referenced payload without numeric round-trips. Image buffers
  # are replaced, not appended behind obsolete full-resolution maps.
  chunks=[];offset=0
  for vi,v in enumerate(d['bufferViews']):
   old=v.get('byteOffset',0);payload=replacements.get(vi,b[old:old+v['byteLength']]);pad=(-offset)%4;chunks.append(b'\0'*pad);offset+=pad;v['byteOffset']=offset;v['byteLength']=len(payload);chunks.append(payload);offset+=len(payload)
  d['buffers']=[{'byteLength':offset}];payload=encode(d,b''.join(chunks));path.write_bytes(payload);hashes[f'lod{level}']=hashlib.sha256(payload).hexdigest()
  if lossless:
   packed=b''.join(chunks);imageViews={im['bufferView']for im in d['images']}
   for vi,(old,new)in enumerate(zip(originalViews,d['bufferViews'])):
    if vi not in imageViews:assert b[old.get('byteOffset',0):old.get('byteOffset',0)+old['byteLength']]==packed[new['byteOffset']:new['byteOffset']+new['byteLength']]
   equality.append({'level':level,'inputSha256':beforeSha,'outputSha256':hashes[f'lod{level}'],'nonImageBufferViewsByteIdentical':len(d['bufferViews'])-len(imageViews),'accessorDefinitionsUnchanged':len(d['accessors']),'images':images})
  lods.append({'level':level,'triangles':sum(d['accessors'][p['indices']]['count']//3 for m in d['meshes']for p in m['primitives']),'bytes':len(payload),'sha256':hashes[f'lod{level}'],'meshes':len(d['meshes']),'materials':len(d['materials']),'images':images})
 manifest['fileSha256']=hashes;manifest['metrics']['triangles'].update({f"lod{r['level']}":r['triangles']for r in lods})
 if lossless:
  manifest['losslessTexturePacking']={'method':'PNG optimize level 9; retain smaller existing payload; JPEG copied unchanged','equalityAudit':'texture-recompression-audit.json'}
  full={'sourceSha256':manifest['source']['sourceSha256'],'method':manifest['losslessTexturePacking']['method'],'lods':equality}
  reportRoot=Path('output/faction-humanoid-lossless-audits')/hashlib.sha256(str(root.resolve()).encode()).hexdigest()[:12]/id;reportRoot.mkdir(parents=True,exist_ok=True)
  (reportRoot/'texture-recompression-full.json').write_text(json.dumps(full,indent=2)+'\n')
  compact=[]
  for row in equality:
   summary={k:v for k,v in row.items()if k!='images'};summary.update({'imageCount':len(row['images']),'decodedRgbaIdentical':all(i['decodedRgbaIdentical']for i in row['images']),'jpegBytesUnchanged':all(i['jpegBytesUnchanged']for i in row['images'])})
   for field in ['inputEncodedSha256','outputEncodedSha256','decodedRgbaSha256']:summary[field]=hashlib.sha256(''.join(i[field]for i in row['images']).encode()).hexdigest()
   compact.append(summary)
  (root/id/'texture-recompression-audit.json').write_text(json.dumps({'schemaVersion':2,'sourceSha256':manifest['source']['sourceSha256'],'method':full['method'],'digestDefinition':'SHA-256 of ordered image SHA-256 hex strings concatenated without separators','lods':compact},indent=2)+'\n')
  for row in lods:row['images']=[{k:v for k,v in im.items()if k in ['name','width','height','bytes','encoding']}for im in row['images']]
  audit=json.loads((root/id/'lod-audit.json').read_text());oldLods={r['level']:r for r in audit['lods']};oldLods.update({r['level']:r for r in lods});audit['lods']=list(oldLods.values());audit['losslessRecompression']=manifest['losslessTexturePacking']
 else:audit={'sourceSha256':manifest['source']['sourceSha256'],'lods':lods,'imageDecodeVerified':True,'normalResize':'Lanczos followed by RGB vector normalization','visualAcceptance':'Pending runtime deformation review'}
 (root/id/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 (root/id/'lod-audit.json').write_text(json.dumps(audit,indent=2)+'\n')
 print(id,json.dumps(lods))
