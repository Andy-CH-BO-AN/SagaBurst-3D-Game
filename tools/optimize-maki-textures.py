#!/usr/bin/env python3
"""Repack opaque Maki maps as 8-bit JPEG; preserve all non-image bytes exactly.
Run after Blender export and before animation retarget (requires Pillow).
"""
from pathlib import Path
from PIL import Image
import json,struct,io
root=Path('public/models')
encoded_images={};outputs={}
for path in [*(root/'characters/v2/maki-archer-t4').glob('lod?.glb'),root/'weapons/maki-ranger-bow/bow.glb']:
 raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+length]);binary=raw[28+length:]
 alpha_images={d['textures'][m['pbrMetallicRoughness']['baseColorTexture']['index']]['source'] for m in d.get('materials',[]) if m.get('alphaMode','OPAQUE')!='OPAQUE'}
 alpha_views={d['images'][i]['bufferView'] for i in alpha_images}
 image_views={i['bufferView']:i for i in d['images']};chunks=[];offset=0;sizes=[]
 for index,view in enumerate(d['bufferViews']):
  data=binary[view.get('byteOffset',0):][:view['byteLength']]
  if index in image_views:
   im=Image.open(io.BytesIO(data));sizes.append(im.size)
   # The builder reuses the same immutable source images across body LODs.
   # Encode each named image/resolution once. Blender 5.2 can emit a broken
   # duplicate PNG stream on a later export even when the image is unchanged.
   key=(str(path.parent),image_views[index].get('name'),im.size,index in alpha_views)
   if key not in encoded_images:
    out=io.BytesIO()
    if index in alpha_views:im.convert('RGBA').save(out,format='PNG',optimize=True);mime='image/png'
    else:im.convert('RGB').save(out,format='JPEG',quality=95,subsampling=0,optimize=True);mime='image/jpeg'
    encoded_images[key]=(out.getvalue(),mime)
   data,image_views[index]['mimeType']=encoded_images[key]
  pad=(-offset)%4
  if pad:chunks.append(bytes(pad));offset+=pad
  view['byteOffset']=offset;view['byteLength']=len(data);chunks.append(data);offset+=len(data)
 d['buffers'][0]['byteLength']=offset;b=b''.join(chunks);b+=bytes((-len(b))%4);j=json.dumps(d,separators=(',',':')).encode();j+=b' '*((-len(j))%4)
 result=b'glTF'+struct.pack('<II',2,28+len(j)+len(b))+struct.pack('<I',len(j))+b'JSON'+j+struct.pack('<I',len(b))+b'BIN\0'+b;outputs[path]=result
 print(path,len(raw),'->',len(result),'textures',sorted(set(sizes)))
for path,result in outputs.items():path.write_bytes(result)
