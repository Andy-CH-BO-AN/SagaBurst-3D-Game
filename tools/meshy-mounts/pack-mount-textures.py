"""Apply the existing faction texture pipeline's JPEG95/PNG/normal normalization.
Only image bufferViews change; geometry and animation bytes remain identical.
"""
import sys,json,struct,io,hashlib
from pathlib import Path
from PIL import Image
import numpy as np
src,dst=map(Path,sys.argv[1:3]);normal_size=int(sys.argv[3]) if len(sys.argv)>3 else 1024;raw=src.read_bytes();n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);binary=raw[28+n:]
base={doc['textures'][m['pbrMetallicRoughness']['baseColorTexture']['index']]['source']for m in doc['materials']if 'baseColorTexture'in m.get('pbrMetallicRoughness',{})}
normal={doc['textures'][m['normalTexture']['index']]['source']for m in doc['materials']if 'normalTexture'in m}
replacements={};report=[]
for i,image in enumerate(doc['images']):
 view=doc['bufferViews'][image['bufferView']];data=binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
 im=Image.open(io.BytesIO(data)).convert('RGBA');assert im.getextrema()[3]==(255,255),'Unexpected source transparency'
 im=im.convert('RGB');size=2048 if i in base else normal_size if i in normal else 1024;im.thumbnail((size,size),Image.Resampling.LANCZOS)
 if i in normal:
  a=np.asarray(im).astype(np.float32)/127.5-1;a/=np.maximum(np.linalg.norm(a,axis=2,keepdims=True),1e-6);im=Image.fromarray(np.clip((a+1)*127.5,0,255).astype('uint8'))
 out=io.BytesIO()
 if i in base:im.save(out,format='JPEG',quality=95,subsampling=0,optimize=True);image['mimeType']='image/jpeg'
 else:im.save(out,format='PNG',optimize=True,compress_level=9);image['mimeType']='image/png'
 replacements[image['bufferView']]=out.getvalue();report.append({'name':image.get('name'),'width':im.width,'height':im.height,'bytes':len(out.getvalue()),'mimeType':image['mimeType']})
chunks=[];offset=0
for i,v in enumerate(doc['bufferViews']):
 data=replacements.get(i,binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]);pad=(-offset)%4;chunks.append(b'\0'*pad);offset+=pad;v['byteOffset']=offset;v['byteLength']=len(data);chunks.append(data);offset+=len(data)
doc['buffers']=[{'byteLength':offset}];b=b''.join(chunks);b+=b'\0'*((-len(b))%4);js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
dst.write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(b))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(b),0x004e4942)+b)
dst.with_suffix('.texture-audit.json').write_text(json.dumps({'images':report,'nonImageBufferViewsUnchanged':True},indent=2)+'\n')
