"""Recolor source lower-leg atlas from existing T4 steel and boot leather."""
import io,json,struct,sys
from pathlib import Path
import numpy as np
from PIL import Image

def images(path):
    raw=Path(path).read_bytes(); n=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+n]); binary=raw[28+n:]
    def read(i):
        v=doc['bufferViews'][doc['images'][i]['bufferView']]
        return Image.open(io.BytesIO(binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])).convert('RGB')
    return doc,read
source,body,output=sys.argv[1:]; out=Path(output);out.mkdir(parents=True,exist_ok=True)
s,read=images(source); d,bodyread=images(body)
torso=np.asarray(bodyread(next(i for i,im in enumerate(d['images']) if im['name']=='Armour_top_TXTR')))/255
luma=torso@np.array([.2126,.7152,.0722]);gold=(torso[:,:,0]-torso[:,:,1]>.065)&(torso[:,:,1]-torso[:,:,2]>.11)
steel=np.median(torso[(luma>.025)&~gold],axis=0)
# The belt uses the same original T4 dark-brown leather treatment as its boots.
leather_atlas=np.asarray(bodyread(next(i for i,im in enumerate(d['images']) if im['name']=='Dangles_TXTR')))/255
leather_luma=leather_atlas@np.array([.2126,.7152,.0722])
leather=np.median(leather_atlas[leather_luma>.025],axis=0)
rgb=np.asarray(read(0))/255; mr=np.asarray(read(1))/255
metal=np.clip((mr[:,:,2]-.15)/.65,0,1); shade=np.clip(.70+(rgb@np.array([.2126,.7152,.0722]))*.75,.7,1.1)
color=(metal[:,:,None]*steel+(1-metal[:,:,None])*leather)*shade[:,:,None]
pbr=np.ones_like(rgb);pbr[:,:,1]=.70*(1-metal)+.48*metal;pbr[:,:,2]=.62*metal
normal=read(2)
for lod,size in enumerate([2048,1024,512]):
    for name,pixels in [('albedo',color),('metalrough',pbr)]:
        Image.fromarray(np.uint8(np.clip(pixels,0,1)*255)).resize((size,size),Image.Resampling.LANCZOS).save(out/f'{name}{lod}.png')
    normal.resize((size,size),Image.Resampling.LANCZOS).save(out/f'normal{lod}.png')
(out/'palette.json').write_text(json.dumps({'bodyAtlas':'Armour_top_TXTR','steelSRGB':steel.tolist(),'leatherSRGB':leather.tolist(),'metalMetallic':.62,'metalRoughness':.48,'leatherRoughness':.70},indent=2)+'\n')
