"""Match helmet steel/trim to the existing T4 torso atlas, preserving source UV art."""
import io, json, struct, sys
from pathlib import Path
import numpy as np
from PIL import Image

def images(path):
    raw=Path(path).read_bytes(); n=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+n]); binary=raw[28+n:]
    def read(index):
        v=doc['bufferViews'][doc['images'][index]['bufferView']]
        return Image.open(io.BytesIO(binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])).convert('RGB')
    return doc, read
source, body, output=sys.argv[1:]; output=Path(output); output.mkdir(parents=True,exist_ok=True)
doc,read=images(body)
atlas=next(i for i,im in enumerate(doc['images']) if im.get('name')=='Armour_top_TXTR')
rgb=np.asarray(read(atlas)).astype(float)/255
luma=rgb@np.array([.2126,.7152,.0722]); gold=(rgb[:,:,0]-rgb[:,:,1]>.065)&(rgb[:,:,1]-rgb[:,:,2]>.11)
steel_color=np.median(rgb[(luma>.025)&~gold],axis=0); gold_color=np.median(rgb[gold],axis=0)
for lod,size in enumerate([2048,1024,512]):
    source_image=Image.open(output/f'source-bake{lod}.png').convert('RGB')
    rgb=np.asarray(source_image).astype(float)/255
    luma=rgb@np.array([.2126,.7152,.0722]); r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
    # The source's warm trim, excluding its desaturated bronze corrosion.
    trim=np.clip(np.minimum((r-g-.025)/.055,(g-b-.03)/.08),0,1)
    shade=np.clip(.86+luma*.45,.86,1.15)
    result=shade[:,:,None]*(steel_color[None,None,:]*(1-trim[:,:,None])+gold_color[None,None,:]*trim[:,:,None])
    Image.fromarray(np.uint8(np.clip(result,0,1)*255)).save(output/f'albedo{lod}.png')
(output/'palette.json').write_text(json.dumps({'bodyAtlas':'Armour_top_TXTR','steelSRGB':steel_color.tolist(),'goldSRGB':gold_color.tolist(),'metallicFactor':.62,'roughnessFactor':.48,'redAccents':'No red in the current T4 torso palette; no new red painted.'},indent=2)+'\n')
