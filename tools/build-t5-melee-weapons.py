#!/usr/bin/env python3
"""Build the three supplied T5 melee assets without shipping raw sources.

Requires Python 3 + Pillow, and Blender 4.3.2 on PATH (or --blender).
Usage: python tools/build-t5-melee-weapons.py /path/to/source-directory
Only the axe is re-meshed; sword and lance geometry/accessor bytes survive.
Source files are checked by SHA-256. Intermediate GLBs/reports stay in output/.
See public/models/weapons/t5/ATTRIBUTION.md for licenses and coordinate choices.
"""
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'sword': ('paladin_longsword_free_download.glb',
              '4575d1edabaa30b768329e76546e44e54c9a4da6a80a3e6429ab127c6cee034b'),
    'axe': ('decorative_double-bladed_battle_axe.glb',
            'a006114f00892d2483589116cbb23e77b5943ee5cc4ae5791befb21a7a3986f1'),
    'lance': ('lowpoly_cartoon_spearpike.glb',
              '6ca01f58e473f82abc2e85ef90c30fc1b97640837a56f00e8fcd0ca2c2bfd63d'),
}


def read_glb(path):
    data = Path(path).read_bytes()
    if data[:4] != b'glTF' or struct.unpack_from('<I', data, 4)[0] != 2:
        raise ValueError(f'Expected GLB 2.0: {path}')
    length = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20 + length]), data[28 + length:]


def write_glb(path, document, binary):
    document['buffers'] = [{'byteLength': len(binary)}]
    payload = json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode()
    payload += b' ' * (-len(payload) % 4)
    binary += b'\0' * (-len(binary) % 4)
    data = (b'glTF' + struct.pack('<II', 2, 28 + len(payload) + len(binary))
            + struct.pack('<I4s', len(payload), b'JSON') + payload
            + struct.pack('<I4s', len(binary), b'BIN\0') + binary)
    Path(path).write_bytes(data)


def normalize(document, name):
    """Use authored mesh axes; discard Sketchfab presentation transforms."""
    if name == 'sword':
        # Source blade is -X, broad face XY; grip leather centre X=.65.
        scale = (1.3275 - .15) / (1 + .65)
        matrix = [0, -scale, 0, 0, scale, 0, 0, 0, 0, 0, scale, 0,
                  0, .15 + .65 * scale, 0, 1]
        grip = [.65, 0, 0]
    elif name == 'axe':
        # Source shaft +X, blade span Z, thickness Y. No wrist workaround.
        scale = (1.51 - .15) / (425.99628 - 70)
        matrix = [0, scale, 0, 0, 0, 0, scale, 0, scale, 0, 0, 0,
                  -51.1448 * scale, .15 - 70 * scale, -6.5761 * scale, 1]
        grip = [70, 6.5761, 51.1448]
    else:
        # Retain the source's authored .3756176 transverse scale.
        # Tip is source -Y; rotate broad blade to XY and fit T4's 3.1m extent.
        scale = 3.1 / (20.266434 + 14.672966)
        radial = .3756175935268402
        matrix = [0, 0, radial * scale, 0, 0, -scale, 0, 0,
                  radial * scale, 0, 0, 0, 0, 2.6 - 14.672966 * scale, 0, 1]
        grip = [0, (2.6 - .15) / scale - 14.672966, 0]
    nodes = [{'name': f't5-{name}-part-{i}', 'mesh': i}
             for i in range(len(document['meshes']))]
    nodes.append({'name': f't5-{name}-attachment-space', 'matrix': matrix,
                  'children': list(range(len(nodes)))})
    document['nodes'] = nodes
    document['scenes'] = [{'name': f'T5 {name}', 'nodes': [len(nodes) - 1]}]
    document['scene'] = 0
    document['asset'].setdefault('extras', {})['attachmentSpace'] = {
        'longAxis': '+Y', 'broadFace': 'XY', 'gripCenter': [0, .15, 0],
        'sourceGripCenter': grip, 'sourceToAttachmentMatrix': matrix,
        **({'supportGripCenter': [0, .33, 0]} if name == 'lance' else {}),
    }


def compress_images(document, binary, maximum=512):
    """Preserve all maps/material roles; PNG normals, JPEG colour/ORM at Q90."""
    replacements = {}
    normals = {document['textures'][m['normalTexture']['index']]['source']
               for m in document.get('materials', []) if 'normalTexture' in m}
    for i, image in enumerate(document.get('images', [])):
        view = document['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        pixels = Image.open(io.BytesIO(binary[start:start + view['byteLength']]))
        pixels.thumbnail((maximum, maximum), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        # Source maps have no meaningful transparency; guard against losing it.
        transparent = pixels.mode == 'RGBA' and pixels.getextrema()[3][0] < 255
        if i in normals or transparent:
            pixels.save(output, format='PNG', optimize=True)
            image['mimeType'] = 'image/png'
        else:
            pixels.convert('RGB').save(output, format='JPEG', quality=90,
                                       subsampling=0, optimize=True)
            image['mimeType'] = 'image/jpeg'
        replacements[image['bufferView']] = output.getvalue()
    # Repack buffer views; all non-image bytes are copied byte-for-byte.
    result = bytearray()
    for i, view in enumerate(document['bufferViews']):
        start = view.get('byteOffset', 0)
        payload = replacements.get(i, binary[start:start + view['byteLength']])
        result.extend(b'\0' * (-len(result) % 4))
        view.update(buffer=0, byteOffset=len(result), byteLength=len(payload))
        result.extend(payload)
    return bytes(result)


def deduplicate_textures(document):
    """Blender can emit two identical base-colour/emissive texture entries."""
    unique, mapping = [], {}
    for i, texture in enumerate(document.get('textures', [])):
        if texture not in unique:
            unique.append(texture)
        mapping[i] = unique.index(texture)
    if not mapping:
        return
    def remap(value):
        if isinstance(value, dict):
            if 'index' in value:
                value['index'] = mapping[value['index']]
            for child in value.values():
                remap(child)
        elif isinstance(value, list):
            for child in value:
                remap(child)
    for material in document.get('materials', []):
        remap(material)
    document['textures'] = unique


def stats(path):
    document, binary = read_glb(path)
    images = []
    for image in document.get('images', []):
        view = document['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        pixels = Image.open(io.BytesIO(binary[start:start + view['byteLength']]))
        images.append({'width': pixels.width, 'height': pixels.height,
                       'mimeType': image['mimeType'], 'bytes': view['byteLength']})
    triangles = sum(document['accessors'][primitive.get('indices', primitive['attributes']['POSITION'])]['count'] // 3
                    for mesh in document['meshes'] for primitive in mesh['primitives'])
    data = Path(path).read_bytes()
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'triangles': triangles, 'meshes': len(document['meshes']),
            'primitives': sum(len(m['primitives']) for m in document['meshes']),
            'materials': len(document.get('materials', [])),
            'textures': len(document.get('textures', [])), 'images': images}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_directory', type=Path)
    parser.add_argument('--blender', default='blender')
    args = parser.parse_args()
    output = ROOT / 'public/models/weapons/t5'
    evidence = ROOT / 'output/t5-melee-assets'
    output.mkdir(parents=True, exist_ok=True)
    evidence.mkdir(parents=True, exist_ok=True)
    records = []
    for name, (filename, expected) in SOURCES.items():
        source = args.source_directory / filename
        source_stats = stats(source)
        if source_stats['sha256'] != expected:
            raise ValueError(f'Source SHA-256 mismatch for {filename}')
        document, binary = read_glb(source)
        credit = copy.deepcopy(document['asset']['extras'])
        normalize(document, name)
        attachment = copy.deepcopy(document['asset']['extras']['attachmentSpace'])
        before = evidence / f'{name}-before.glb'
        write_glb(before, document, binary)
        if name == 'axe':
            reduced = evidence / 'axe-reduced.glb'
            subprocess.run([args.blender, '-b', '-t', '4', '--python',
                            str(ROOT / 'tools/blender/decimate-t5-axe.py'), '--',
                            str(before), str(reduced), '.53'], check=True)
            document, binary = read_glb(reduced)
        document['asset']['extras'] = {
            **credit, 'sourceFile': filename, 'sourceSha256': expected,
            'build': 'tools/build-t5-melee-weapons.py',
            'attachmentSpace': attachment,
            'modifications': 'Offline axis/grip normalization; ' + (
                '53% collapse reduction, 512px texture maps.' if name == 'axe' else
                'original mesh/accessor bytes preserved, 512px texture maps.' if name == 'sword' else
                'original mesh/accessor bytes and materials preserved; no reduction.'),
        }
        deduplicate_textures(document)
        binary = compress_images(document, binary) if name != 'lance' else binary
        target = output / f'{name}.glb'
        write_glb(target, document, binary)
        record = {'weapon': name, **credit, 'sourceFile': filename,
                  'source': {**source_stats, 'url': credit['source']},
                  'final': stats(target), 'attachmentSpace': attachment}
        records.append(record)
        print(name, json.dumps(record['final']))
    (output / 'sources.json').write_text(json.dumps(records, indent=2) + '\n')
    (evidence / 'asset-report.json').write_text(json.dumps(records, indent=2) + '\n')


if __name__ == '__main__':
    main()
