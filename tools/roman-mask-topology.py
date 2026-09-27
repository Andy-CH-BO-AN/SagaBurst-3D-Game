"""Constrained, evenly sampled facial shell topology. Run with Blender Python.
Only 2D topology is generated here; the source Roman geometry is never imported.
"""
import json, sys
from pathlib import Path
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

source, output = map(Path, sys.argv[sys.argv.index('--')+1:])
data = json.loads(source.read_text())
outline, holes, lod = data['outline'], data['holes'], data['lod']
# A long straight brow boundary cuts through the curved forehead even if its
# endpoints fit. Sample the boundary as carefully as the interior surface.
dense_outline = []
for i, a in enumerate(outline):
    b = outline[(i+1)%len(outline)]
    length = ((b[0]-a[0])**2+(b[1]-a[1])**2)**.5
    steps = max(1, int(length / [.004, .006, .009][lod])+1)
    dense_outline.extend([[a[k]+(b[k]-a[k])*j/steps for k in range(2)] for j in range(steps)])
outline = dense_outline

def inside(p, polygon):
    result = False
    for i, b in enumerate(polygon):
        a = polygon[i-1]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:
            result = not result
    return result

points, edges = [], []
for polygon in [outline, *holes]:
    start = len(points)
    points.extend(polygon)
    edges.extend((start+i, start+(i+1)%len(polygon)) for i in range(len(polygon)))

spacing = [.005, .009, .017][lod]
ys = [1.49+i*spacing for i in range(int(.15/spacing)+1)]
ys += [1.505, 1.535, 1.543, 1.550, 1.562, 1.569, 1.582, 1.600, 1.628]
for y in sorted(set(ys)):
    for i in range(-int(.075/spacing), int(.075/spacing)+1):
        p = [i*spacing, y]
        if inside(p, outline) and not any(inside(p, hole) for hole in holes):
            points.append(p)

vertices, _, faces, *_ = delaunay_2d_cdt([Vector(p) for p in points], edges, [], 0, 1e-8)
kept = []
for face in faces:
    center = sum((vertices[i] for i in face), Vector((0, 0))) / len(face)
    if inside(center, outline) and not any(inside(center, hole) for hole in holes):
        kept.append(list(face))
output.write_text(json.dumps({'points': [list(p) for p in vertices], 'faces': kept}))
