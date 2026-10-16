from PIL import Image,ImageChops
from pathlib import Path
import os
p=Path(os.environ['HORSE_BUILD_WORK'])/'textures'
body=Image.open(p/'source-2.jpg').convert('RGB')
body.save(p/'paint_01.png')
for name,tint in [('paint_02',(140,100,70)),('paint_03',(65,69,76))]:
 ImageChops.multiply(body,Image.new('RGB',body.size,tint)).save(p/(name+'.png'))
print([(f.name,Image.open(f).size)for f in p.iterdir()if f.suffix in ['.png','.jpg']])

from pathlib import Path
import subprocess
p=Path(os.environ['HORSE_BUILD_WORK'])/'textures'
out=p.parent/'package'/'textures';out.mkdir(parents=True,exist_ok=True)
exe=os.environ['HORSE_BUILD_TOKTX']
for name in ['source-0','source-1','source-3','source-4','paint_01','paint_02','paint_03']:
 color=name in ['source-0','paint_01','paint_02','paint_03']
 subprocess.run([exe,'--t2','--encode','etc1s','--qlevel','200','--clevel','4','--genmipmap','--assign_oetf','srgb' if color else 'linear',str(out/(name+'.ktx2')),str(p/(name+'.png'))],check=True)
 print(name,(out/(name+'.ktx2')).stat().st_size,flush=True)
