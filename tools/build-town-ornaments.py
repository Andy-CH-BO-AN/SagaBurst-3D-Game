"""將 Owner 提供的 Meshy 靜態裝飾轉成公尺、底部 y=0；保留拓樸與 UV，貼圖縮為 1024 JPEG。
Usage: python3 tools/build-town-ornaments.py <source-directory>
"""
import hashlib, json, struct, sys
from io import BytesIO
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/models/architecture'
SOURCES = {
 'roman-legion-banner': 'Meshy_AI_Roman_Legion_Banner_1111160339_texture(1).glb',
 'viking-cat-banner': 'Meshy_AI_Viking_Cat_Banner_1111160153_texture(1).glb',
 'carved-lynx-head': 'Meshy_AI_Carved_Lynx_Head_1111160016_texture(1).glb',
}
records=[]
for name,filename in SOURCES.items():
 src=Path(sys.argv[1])/filename
 if not src.exists(): src=Path(sys.argv[1])/filename.replace('(1)', '')
 raw=src.read_bytes(); n=struct.unpack_from('<I',raw,12)[0]
 doc=json.loads(raw[20:20+n]); binary=bytearray(raw[28+n:]); accessor=doc['accessors'][doc['meshes'][0]['primitives'][0]['attributes']['POSITION']]
 view=doc['bufferViews'][accessor['bufferView']]; offset=view.get('byteOffset',0)+accessor.get('byteOffset',0); stride=view.get('byteStride',12)
 lo,hi=accessor['min'],accessor['max']; height=hi[1]-lo[1]; centre=[(lo[0]+hi[0])/2,lo[1],(lo[2]+hi[2])/2]
 for i in range(accessor['count']):
  p=struct.unpack_from('<3f',binary,offset+i*stride); struct.pack_into('<3f',binary,offset+i*stride,*[(p[k]-centre[k])/height for k in range(3)])
 accessor['min']=[(lo[k]-centre[k])/height for k in range(3)];accessor['max']=[(hi[k]-centre[k])/height for k in range(3)]
 output=bytearray()
 for index,v in enumerate(doc['bufferViews']):
  content=binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
  for im in doc.get('images',[]):
   if im.get('bufferView')==index:
    image=Image.open(BytesIO(content)).convert('RGB');image.thumbnail((1024,1024)); buffer=BytesIO();image.save(buffer,format='JPEG',quality=88);content=buffer.getvalue();im['mimeType']='image/jpeg'
  output.extend(b'\0'*((-len(output))%4));v['byteOffset']=len(output);v['byteLength']=len(content);output.extend(content)
 output.extend(b'\0'*((-len(output))%4));doc['buffers']=[{'byteLength':len(output)}]
 encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
 target=OUT/(name+'.glb');target.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(output))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(output),0x004e4942)+output)
 records.append({'asset':target.name,'source':filename,'sourceSha256':hashlib.sha256(raw).hexdigest(),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'triangles':doc['accessors'][doc['meshes'][0]['primitives'][0]['indices']]['count']//3,'texture':'1024x1024 JPEG','height':1,'forward':'+Z','permission':'Owner supplied Meshy GLB and explicitly requested inclusion in SagaBurst on 2026-11-12.'})
(OUT/'ornaments-sources.json').write_text(json.dumps(records,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(records,indent=2))
