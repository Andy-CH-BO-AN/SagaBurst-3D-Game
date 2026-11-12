"""將 Owner 提供的 Meshy 靜態裝飾轉成公尺、底部 y=0；保留拓樸與 UV，貼圖縮為 1024 JPEG。
Usage: python3 tools/build-town-ornaments.py <source-directory>
"""
import hashlib, json, struct, sys, math
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
def split_roman_crossbar(target):
 """Separate the measured upper 4.5% crossbar/loops from cloth, preserving interpolated UVs/normals.
 The supplied Meshy banner is one primitive. Named meshes allow one crossbar
 with two outward cloth faces, rather than cloning a second pole/rod.
 """
 raw=target.read_bytes(); n=struct.unpack_from('<I',raw,12)[0]
 doc=json.loads(raw[20:20+n]); binary=bytearray(raw[28+n:])
 if any(node.get('name')=='Crossbar' for node in doc['nodes']): return
 primitive=doc['meshes'][0]['primitives'][0]
 def values(index):
  a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
  components={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']]
  code={5126:'f',5125:'I',5123:'H',5121:'B'}[a['componentType']]
  size=struct.calcsize(code)*components;stride=v.get('byteStride',size)
  return [struct.unpack_from('<'+str(components)+code,binary,v.get('byteOffset',0)+a.get('byteOffset',0)+i*stride) for i in range(a['count'])]
 attributes={key:values(index) for key,index in primitive['attributes'].items() if key in ['POSITION','NORMAL','TEXCOORD_0']}
 indices=[v[0] for v in values(primitive['indices'])]
 cutoff=.955
 def clip(poly,upper):
  result=[]
  for i,b in enumerate(poly):
   a=poly[i-1]; ay=a['POSITION'][1];by=b['POSITION'][1]
   ai=ay>=cutoff if upper else ay<=cutoff;bi=by>=cutoff if upper else by<=cutoff
   if ai!=bi:
    t=(cutoff-ay)/(by-ay);result.append({k:tuple(x+(y-x)*t for x,y in zip(a[k],b[k])) for k in a})
   if bi: result.append(b)
  return result
 meshes=[]
 for name,upper in [('BannerCloth',False),('Crossbar',True)]:
  out={key:[] for key in attributes}
  for i in range(0,len(indices),3):
   poly=clip([{k:attributes[k][index] for k in attributes} for index in indices[i:i+3]],upper)
   for j in range(1,len(poly)-1):
    for vertex in [poly[0],poly[j],poly[j+1]]:
     for key in out:
      row=vertex[key]
      if key=='NORMAL':
       length=math.sqrt(sum(v*v for v in row));row=tuple(v/length for v in row) if length else row
      out[key].append(row)
  accessor_ids={}
  for key,rows in out.items():
   binary.extend(b'\0'*((-len(binary))%4));offset=len(binary)
   for row in rows: binary.extend(struct.pack('<'+str(len(row))+'f',*row))
   view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(binary)-offset,'target':34962})
   a={'bufferView':view,'componentType':5126,'count':len(rows),'type':'VEC'+str(len(rows[0]))}
   if key=='POSITION': a.update(min=[min(v[k] for v in rows) for k in range(3)],max=[max(v[k] for v in rows) for k in range(3)])
   accessor_ids[key]=len(doc['accessors']);doc['accessors'].append(a)
  meshes.append({'name':name,'primitives':[{'attributes':accessor_ids,'material':primitive.get('material',0),'mode':4}]})
 doc['meshes']=meshes;doc['nodes']=[{'name':m['name'],'mesh':i} for i,m in enumerate(meshes)];doc['scenes']=[{'nodes':[0,1]}];doc['scene']=0
 binary.extend(b'\0'*((-len(binary))%4));doc['buffers']=[{'byteLength':len(binary)}]
 encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
 target.write_bytes(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary)

def runtime_metadata(target):
 raw=target.read_bytes();n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n])
 triangles=sum(doc['accessors'][p['indices'] if 'indices' in p else p['attributes']['POSITION']]['count']//3 for m in doc['meshes'] for p in m['primitives'])
 result={'sha256':hashlib.sha256(raw).hexdigest(),'triangles':triangles}
 if target.stem=='roman-legion-banner': result.update(parts=['BannerCloth','Crossbar'],crossbarBaseY=.955)
 return result

if sys.argv[1]=='--split-roman':
 target=OUT/'roman-legion-banner.glb';split_roman_crossbar(target)
 path=OUT/'ornaments-sources.json';records=json.loads(path.read_text())
 for row in records:
  if row['asset']==target.name:
   row.update(runtime_metadata(target))
 path.write_text(json.dumps(records,indent=2,ensure_ascii=False)+'\n');sys.exit(0)

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
 if name=='roman-legion-banner': split_roman_crossbar(target)
 records.append({'asset':target.name,'source':filename,'sourceSha256':hashlib.sha256(raw).hexdigest(),**runtime_metadata(target),'texture':'1024x1024 JPEG','height':1,'forward':'+Z','permission':'Owner supplied Meshy GLB and explicitly requested inclusion in SagaBurst on 2026-11-12.'})
(OUT/'ornaments-sources.json').write_text(json.dumps(records,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(records,indent=2))
