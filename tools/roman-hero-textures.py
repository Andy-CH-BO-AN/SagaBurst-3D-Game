#!/usr/bin/env python3
"""Recolour only named material atlases; skin/eye/normal images are byte-preserved.
Requires Pillow + numpy. Called by build-roman-hero.mjs, never on source files.
"""
import io, json, struct, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

source, output = map(Path, sys.argv[1:3])
output.mkdir(parents=True, exist_ok=True)
raw = source.read_bytes()
n = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20+n]); binary = raw[28+n:]
report = []
for index, item in enumerate(doc['images']):
    name = item['name']
    if not name.endswith('_TXTR') or name.startswith(('New_', 'Ties')):
        continue
    view = doc['bufferViews'][item['bufferView']]
    image = Image.open(io.BytesIO(binary[view['byteOffset']:view['byteOffset']+view['byteLength']])).convert('RGB')
    rgb = np.asarray(image).astype(float) / 255
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    luminance = .2126*r + .7152*g + .0722*b
    result = rgb.copy()
    active = luminance > .018
    # Saturated authored borders are distinct from low-saturation rust/wear.
    gold = active & (r-g > .065) & (g-b > .11)
    if name.startswith(('Armour_', 'Full_figure_', 'Helmet')):
        kernel = max(5, (image.width//512)*8+1)
        mask = Image.fromarray(np.uint8(gold)*255)
        mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
        mask = mask.filter(ImageFilter.MaxFilter(kernel)).filter(ImageFilter.MinFilter(kernel))
        gold = (np.asarray(mask) > 127) & active
        if name.startswith('Helmet'):
            # These eight UV islands are metal bosses, NOT skin.
            # Human face/ears/neck use the untouched New_head atlas.
            islands = Image.new('L', image.size)
            draw = ImageDraw.Draw(islands)
            for x0,x1,y0,y1 in [(.508,.636,.180,.326),(.435,.577,.015,.174),(.032,.147,.011,.151),(.694,.826,.732,.866),(.879,.987,.334,.475),(.387,.493,.228,.368),(.760,.886,.010,.169),(.836,.957,.171,.328)]:
                draw.rectangle((x0*image.width-1,y0*image.height-1,x1*image.width+1,y1*image.height+1), fill=255)
            gold = (np.asarray(islands) > 127) & active
            # Author the existing curved brow border as one continuous UV band.
            rim = Image.new('L', image.size)
            draw = ImageDraw.Draw(rim)
            angles = np.linspace(0, np.pi, 100)
            arc = [((.230+.222*np.cos(a))*image.width, (.686-.220*np.sin(a))*image.height) for a in angles]
            arc += [((.230+.201*np.cos(a))*image.width, (.686-.199*np.sin(a))*image.height) for a in angles[::-1]]
            draw.polygon(arc, fill=255)
            gold |= (np.asarray(rim)>127) & active
        elif name.startswith('Armour_'):
            # Exact disconnected boss UV bounds measured from the source mesh.
            # Some islands touch a panel in the atlas, so use bounded masks.
            boss = Image.new('L', image.size)
            draw = ImageDraw.Draw(boss)
            for x0,x1,y0,y1 in [(.218,.242,.099,.132),(.843,.881,.692,.720),(.960,.993,.569,.605),(.725,.761,.007,.035),(.633,.656,.002,.036),(.882,.916,.936,.962),(.308,.344,.111,.139),(.374,.405,.068,.103)]:
                draw.rectangle((x0*image.width-2,y0*image.height-2,x1*image.width+2,y1*image.height+2),fill=255)
            gold |= (np.asarray(boss)>127) & active
        steel = active & ~gold
        shade = .045 + luminance*.20
        result[steel] = (shade[..., None]*np.array([.88, .96, 1.06]))[steel]
        # Keep engraved normals and mild tone variation, not painted black pits.
        result[gold] = ((.53+luminance*.09)[..., None]*np.array([1., .77, .40]))[gold]
    elif name.startswith('Tunic_'):
        result[active] = ((.08+luminance*.47)[..., None]*np.array([.17, .29, .48]))[active]
    elif name.startswith('Wrist_'):
        # Wrist guards are leather; their straps remain dark, not gold flecks.
        result[active] = ((.055+luminance*.23)[..., None]*np.array([.72, .72, .76]))[active]
    elif name.startswith(('Boots', 'Dangles')):
        result[active] = ((.06+luminance*.35)[..., None]*np.array([.70, .52, .38]))[active]
    else:
        continue
    path = output / f'{index}.png'
    Image.fromarray(np.uint8(np.clip(result, 0, 1)*255)).save(path)
    report.append({'index': index, 'name': name, 'file': str(path), 'width': image.width,
                   'height': image.height, 'changedPixels': int(np.any(abs(result-rgb) > 1/255, axis=2).sum())})
(output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
