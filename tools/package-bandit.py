"""Pack converted Bandit textures and fit its attack to the existing NPC hit clock.
Run after build-bandit.py. Pillow required. Never changes mesh/skin buffers.
"""
from pathlib import Path
from PIL import Image, ImageChops
import io, json, struct, hashlib
root=Path('public/models/characters/v2/bandit')
manifest=json.loads((root/'manifest.json').read_text())
texture_dimensions={}
for lod,size in enumerate([2048,1024,512]):
 path=root/f'lod{lod}.glb';raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0]
 doc=json.loads(raw[20:20+length]);binary=bytearray(raw[28+length:])
 if doc['asset'].get('extras',{}).get('banditPackaged'):
  raise RuntimeError('Already packaged: rebuild with build-bandit.py before repackaging')
 normal_images={doc['textures'][m['normalTexture']['index']]['source'] for m in doc['materials'] if m['name']!='Mat_Eye'}
 normal_views={doc['images'][i]['bufferView'] for i in normal_images}
 # Original contact frame 30 of 2..47 is a forward/downward hammer strike.
 # Preserve source preparation/contact/recovery; remap to the existing .252s
 # sword hit event and .48s total action, without changing NPC damage/cadence.
 attack=next(a for a in doc['animations'] if a['name']=='swordSlash')
 for idx in {s['input'] for s in attack['samplers']}:
  a=doc['accessors'][idx];v=doc['bufferViews'][a['bufferView']];offset=v.get('byteOffset',0)+a.get('byteOffset',0)
  if abs(a['max'][0]-.48)<.00001:continue
  values=[]
  for i in range(a['count']):
   t=struct.unpack_from('<f',binary,offset+i*4)[0];contact=28/30
   t=t/contact*.252 if t<=contact else .252+(t-contact)/(1.5-contact)*.228
   struct.pack_into('<f',binary,offset+i*4,t);values.append(t)
  a['min']=[min(values)];a['max']=[max(values)]
 images={im['bufferView']:im for im in doc['images']};chunks=[];offset=0;dimensions=set()
 for index,view in enumerate(doc['bufferViews']):
  data=binary[view.get('byteOffset',0):][:view['byteLength']]
  if index in images:
   im=Image.open(io.BytesIO(data)).convert('RGB');im.thumbnail((size,size),Image.Resampling.LANCZOS)
   dimensions.add(im.size)
   # Supplied PBR normals are byte-identical to UE4 (DirectX); height-gradient
   # correlation confirms green points against image +Y. glTF requires +Y normals.
   if index in normal_views:
    r,g,b=im.split();im=Image.merge('RGB',(r,ImageChops.invert(g),b))
   output=io.BytesIO();im.save(output,format='JPEG',quality=95,subsampling=0,optimize=True)
   data=output.getvalue();images[index]['mimeType']='image/jpeg'
  padding=(-offset)%4;chunks.append(bytes(padding));offset+=padding
  view['byteOffset']=offset;view['byteLength']=len(data);chunks.append(data);offset+=len(data)
 doc['buffers'][0]['byteLength']=offset
 doc['asset'].setdefault('extras',{})['banditPackaged']=1
 b=b''.join(chunks);b+=bytes((-len(b))%4);j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4)
 result=b'glTF'+struct.pack('<II',2,28+len(j)+len(b))+struct.pack('<I',len(j))+b'JSON'+j+struct.pack('<I',len(b))+b'BIN\0'+b
 path.write_bytes(result)
 texture_dimensions[f'lod{lod}']=sorted(dimensions)
 manifest.setdefault('fileSha256',{})[f'lod{lod}']=hashlib.sha256(result).hexdigest()
 print(path,len(raw),'->',len(result))
next(a for a in manifest['animations']['embedded'] if a['clip']=='swordSlash')['events']={'hit':.252,'actionComplete':.48}
manifest['attackRetiming']={'sourceContactFrame':30,'sourceFrameRange':[2,47],'duration':.48,'hitTime':.252,'method':'piecewise linear through original NPC sword contact; combat rules unchanged'}
manifest['modifications']+=['Source run grip baked into right finger chains for every clip; walking wrist preserved','Per-clip ground calibration baked into hips; no runtime grounding correction','DirectX body/armor/weapon normal green channel inverted for glTF; original eye normal retained','Original attack retimed through existing .252 second hit event, .48 second duration']
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
audit=json.loads((root/'audit.json').read_text());audit['embeddedTextureDimensions']=texture_dimensions
(root/'audit.json').write_text(json.dumps(audit,indent=2)+'\n')
