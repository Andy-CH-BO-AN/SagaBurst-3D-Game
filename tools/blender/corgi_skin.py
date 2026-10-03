"""Corgi skin repair on immutable bind geometry.

Connected paw surfaces seed asymmetric limb domains. Paw and shaft anchors stay
rigid; a harmonic surface solve spans joint and attachment bands on both sides
of each initial envelope. Anatomical body seeds exclude limb motion, and lower
chest tissue does not amplify residual head weights. No mesh or rest bone is
changed here. Execute apply() through GUI Blender MCP for scene verification.
"""
from collections import defaultdict
from pathlib import Path
import hashlib
import heapq
import json
import math

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output/mount-retarget"
RIG_SOURCE = ROOT / "tools/blender/corgi-rig-correction.json"
LANDMARKS = json.loads(RIG_SOURCE.read_text())["landmarks"]


def smooth(a, b, value):
    t = max(0., min(1., (value - a) / (b - a)))
    return t * t * (3 - 2 * t)


def surface_graph(data):
    vertices = data["vertices"]
    grouped = {}
    mapping = []
    points = []
    for point in vertices:
        key = tuple(round(v, 6) for v in point)
        if key not in grouped:
            grouped[key] = len(points)
            points.append(point)
        mapping.append(grouped[key])
    graph = [dict() for _ in points]
    for face in data["faces"]:
        for a, b in zip(face, face[1:] + face[:1]):
            a, b = mapping[a], mapping[b]
            if a == b:
                continue
            distance = math.dist(points[a], points[b])
            graph[a][b] = distance
            graph[b][a] = distance
    return points, mapping, graph


def paw_cores(points, graph):
    cores = {}
    for end, height in [("front", .16), ("rear", .14)]:
        allowed = {i for i, p in enumerate(points)
                   if p[2] < height and (p[1] < -.36 if end == "front" else p[1] > .5)}
        remaining = set(allowed)
        components = []
        while remaining:
            seed = remaining.pop()
            component, pending = {seed}, [seed]
            while pending:
                node = pending.pop()
                adjacent = set(graph[node]) & remaining
                remaining.difference_update(adjacent)
                component.update(adjacent)
                pending.extend(adjacent)
            components.append(component)
        for component in sorted(components, key=len, reverse=True):
            center_x = sum(points[i][0] for i in component) / len(component)
            side = "l" if center_x > 0 else "r"
            name = "corgi_" + end + "_paw_" + side
            if name not in cores:
                cores[name] = component
        assert all("corgi_" + end + "_paw_" + side in cores for side in ("l", "r")), end
    return cores


def distances(graph, seeds):
    result = [math.inf] * len(graph)
    heap = []
    for node in seeds:
        result[node] = 0.
        heap.append((0., node))
    heapq.heapify(heap)
    while heap:
        distance, node = heapq.heappop(heap)
        if distance != result[node]:
            continue
        for adjacent, step in graph[node].items():
            candidate = distance + step
            if candidate < result[adjacent]:
                result[adjacent] = candidate
                heapq.heappush(heap, (candidate, adjacent))
    return result


def shaft_weights(end, side, height):
    prefix = "corgi_" + end + "_"
    if end == "front":
        if height <= .16:
            return {prefix + "paw_" + side: 1.}
        if height < .27:
            t = smooth(.16, .27, height)
            return {prefix + "paw_" + side: 1 - t, prefix + "lower_" + side: t}
        if height < .35:
            return {prefix + "lower_" + side: 1.}
        if height < .50:
            t = smooth(.35, .50, height)
            return {prefix + "lower_" + side: 1 - t, prefix + "upper_" + side: t}
        return {prefix + "upper_" + side: 1.}
    if height <= .14:
        return {prefix + "paw_" + side: 1.}
    if height < .20:
        t = smooth(.14, .20, height)
        return {prefix + "paw_" + side: 1 - t, prefix + "ankle_" + side: t}
    if height < .30:
        t = smooth(.20, .30, height)
        return {prefix + "ankle_" + side: 1 - t, prefix + "lower_" + side: t}
    if height < .36:
        return {prefix + "lower_" + side: 1.}
    if height < .53:
        t = smooth(.36, .53, height)
        return {prefix + "lower_" + side: 1 - t, prefix + "upper_" + side: t}
    return {prefix + "upper_" + side: 1.}


def limb_distance(point, name):
    end,side=name.split("_")[1],name[-1];x=.29 if side=="l" else -.29
    wrist=LANDMARKS[end+"_"+side]["wrist"]
    if end=="front":
        points=[[x,-.69,.85],[x,-.69,.43],wrist]
    else:
        hock=LANDMARKS[end+"_"+side]["hock"]
        points=[[x,.98,.89],[x,.82,.45],hock,wrist]
    def dist(a,b):
        v=[b[k]-a[k] for k in range(3)];length=sum(t*t for t in v)
        t=max(0.,min(1.,sum((point[k]-a[k])*v[k]for k in range(3))/length))
        return math.dist(point,[a[k]+t*v[k]for k in range(3)])
    return min(dist(a,b)for a,b in zip(points,points[1:]))


def plan(data, stage="paw-probe"):
    assert stage in ("paw-probe", "limbs")
    points, mapping, graph = surface_graph(data)
    cores = paw_cores(points, graph)
    foot_distances = {name: distances(graph, nodes) for name, nodes in cores.items()}
    body_seeds = {i for i, p in enumerate(points) if p[2] > .80
                  or (-.35 < p[1] < .5 and p[2] > .18)
                  or (p[1] < -1.02 and p[2] > .30)
                  or (abs(p[0]) < .13 and p[1] > .95 and p[2] > .34)}
    body_distance = distances(graph, body_seeds)
    revised = []
    regions = []
    for index, point in enumerate(data["vertices"]):
        before = data["weights"][index]
        node = mapping[index]
        name = min(foot_distances, key=lambda n: foot_distances[n][node])
        distance = foot_distances[name][node]
        ownership = 1.
        if stage == "limbs" and distance > .065:
            scores = {n:limb_distance(point,n)+.18*foot_distances[n][node] for n in cores}
            ordered = sorted(scores,key=scores.__getitem__)
            name = ordered[0];distance=foot_distances[name][node]
            ownership = smooth(0.,.10,scores[ordered[1]]-scores[name])
        if stage == "paw-probe":
            strength = 1 - smooth(0., .07, distance) if name == "corgi_front_paw_l" else 0.
            target = {name: 1.}
        else:
            # Body seeds exclude all limb motion. Proximal ownership follows
            # aligned bone segments after paw components join the body mesh.
            strength = smooth(-.10, .10, body_distance[node] - .25 * distance)
            strength *= smooth(0., .08, body_distance[node]) * ownership
            # A surface path can reach the dewlap/belly before the torso seeds.
            # Its proximity to a paw does not make that tissue part of a leg.
            strength *= 1 - smooth(.115, .205, limb_distance(point, name))
            if node in cores[name]:
                strength = 1.
            if not math.isfinite(distance):
                strength = 0.
            end, side = name.split("_")[1], name[-1]
            target = shaft_weights(end, side, point[2])
        body_cleanup = stage == "limbs"
        if body_cleanup:
            # Rebuild the axial remainder before adding the anatomical limb
            # envelope. Never retain a stray limb weight outside that envelope,
            # or normalize a tiny head weight into full lower-chest ownership.
            axial = {n:w for n,w in before.items() if "_front_" not in n and "_rear_" not in n}
            missing = max(0., 1 - sum(axial.values()))
            axial["corgi_torso"] = axial.get("corgi_torso", 0.) + missing
            upper_body = smooth(.62, 1.05, point[2])
            for bone in ("corgi_head", "corgi_neck"):
                removed = axial.get(bone, 0.) * (1 - upper_body)
                axial[bone] = axial.get(bone, 0.) - removed
                axial["corgi_chest"] = axial.get("corgi_chest", 0.) + removed
            total = sum(axial.values())
            before = {n:w/total for n,w in axial.items() if w > 1e-9}
        after = dict(before)
        if strength > 0:
            after = {k: v * (1 - strength) for k, v in before.items()}
            for bone, weight in target.items():
                after[bone] = after.get(bone, 0.) + weight * strength
        if strength <= 0:
            revised.append(dict(before))
        else:
            ordered = sorted(((k, v) for k, v in after.items() if v > 1e-7), key=lambda row: (-row[1],row[0]))
            cutoff = ordered[4][1] if len(ordered)>4 else 0.
            values = [(k,v-cutoff) for k,v in ordered[:4] if v-cutoff>1e-7]
            total = sum(v for _, v in values)
            revised.append({k: v / total for k, v in values})
        regions.append({"bone": name, "strength": strength, "distance": distance if math.isfinite(distance) else None,
                        "bodyDistance": body_distance[node] if math.isfinite(body_distance[node]) else None, "core": node in cores[name], "bodyCleanup":body_cleanup if stage=="limbs" else False})
    if stage == "limbs":
        revised, transition_nodes = transition_weights(revised,regions,mapping,graph)
    else:
        transition_nodes = 0
    return revised, regions, {"transitionNodes": transition_nodes, "transitionIterations": 180, "coreNodes": {k: len(v) for k, v in cores.items()},
                              "surfaceNodes": len(points), "stage": stage,
                              "protectedBodySeedNodes":len(body_seeds),
                              "pawMembership":"connected welded surface components, including left forepaw across x=0",
                              "shaftMembership":"aligned bind segment envelopes; harmonic attachments between rigid cores and protected body seeds"}


def transition_weights(revised, regions, mapping, graph, iterations=180):
    """Harmonic surface interpolation between anatomical bone/body anchors.

    The whole attachment is solved, including vertices initially labelled body.
    Freezing the zero side of an envelope made adjacent vertices tear apart.
    Welded duplicates always share exactly the same resulting weights.
    """
    first = {}
    for i,node in enumerate(mapping):
        first.setdefault(node,i)
    fields = {node:dict(revised[i]) for node,i in first.items()}
    editable = {node for node,i in first.items() if not regions[i]["core"]
                and regions[i]["bodyDistance"] and regions[i]["bodyDistance"] > 0
                and not (regions[i]["strength"] >= 1 and len(revised[i]) == 1)}
    neighbours = {node: [(other, 1/max(length,.002)) for other,length in graph[node].items()]
                  for node in editable}
    for iteration in range(iterations):
        updated = {}
        for node in sorted(editable):
            average = defaultdict(float);total=0.
            for other,factor in neighbours[node]:
                total+=factor
                for name,weight in fields[other].items():
                    average[name]+=factor*weight
            if total<=0:
                continue
            values={n:w/total for n,w in average.items() if w/total>1e-7}
            total=sum(values.values());updated[node]={n:w/total for n,w in values.items()}
        fields.update(updated)
    output=[]
    for i,node in enumerate(mapping):
        values=sorted(fields[node].items(),key=lambda v:(-v[1],v[0]))
        values=[(n,w)for n,w in values[:4] if w>1e-7];total=sum(w for n,w in values)
        output.append({n:w/total for n,w in values})
    return output,len(editable)


def apply(stage="paw-probe", lods=(0,), canonical=True):
    import bpy
    original_path = OUT / "corgi-skin-original-all-lods.json"
    if not original_path.exists():
        original = {}
        for lod in (0, 1, 2):
            mesh = bpy.data.objects["corgi_body_lod" + str(lod)]
            original[mesh.name] = {"vertices": [list(v.co) for v in mesh.data.vertices],
                                   "faces": [list(p.vertices) for p in mesh.data.polygons],
                                   "weights": [{mesh.vertex_groups[g.group].name: g.weight for g in v.groups}
                                               for v in mesh.data.vertices]}
        original_path.write_text(json.dumps(original))
    original = json.loads(original_path.read_text())
    report = {"algorithm": "corgi-anatomical-limbs-v4", "stage": stage, "meshes": []}
    patches = {}
    for lod in lods:
        mesh = bpy.data.objects["corgi_body_lod" + str(lod)]
        data = original[mesh.name]
        assert [list(v.co) for v in mesh.data.vertices] == data["vertices"], "Geometry changed"
        canonical_path = OUT / "corgi-canonical-skin-patch.json"
        if stage == "limbs" and canonical and canonical_path.exists():
            canonical_mesh = json.loads(canonical_path.read_text())["meshes"][mesh.name]
            revised, regions, metadata = canonical_mesh["weights"], canonical_mesh["regions"], canonical_mesh["metadata"]
            assert len(revised) == len(mesh.data.vertices), "Canonical vertex order changed"
        else:
            revised, regions, metadata = plan(data, stage)
        changed = []
        for i, weights in enumerate(revised):
            current = {mesh.vertex_groups[g.group].name: g.weight for g in mesh.data.vertices[i].groups}
            error = max(abs(current.get(n, 0.) - weights.get(n, 0.))
                        for n in set(current) | set(weights))
            if error < 1e-7:
                continue
            changed.append(i)
            for group in mesh.vertex_groups:
                group.remove([i])
            for name, weight in weights.items():
                group = mesh.vertex_groups.get(name) or mesh.vertex_groups.new(name=name)
                group.add([i], weight, "REPLACE")
        patches[mesh.name] = {"weights": revised, "regions": regions}
        report["meshes"].append({"name": mesh.name, "changedVertices": len(changed), **metadata})
    (OUT / ("corgi-skin-" + stage + "-patch.json")).write_text(json.dumps(patches))
    (OUT / ("corgi-skin-" + stage + "-report.json")).write_text(json.dumps(report, indent=2))
    bpy.context.view_layer.update()
    print(json.dumps(report))
    return report


def audit(clip="run", samples=13, lods=(0, 1, 2)):
    """Measure actual evaluated cores in their owning bone frames."""
    import bpy
    from mathutils import Vector
    import runpy
    retarget = runpy.run_path(str(ROOT / "tools/blender/retarget_animals.py"))
    rig = bpy.data.objects["corgi_rig"]
    action = bpy.data.actions["corgi__" + clip]
    retarget["select_action"](rig, action)
    start, end = action.frame_range
    originals = json.loads((OUT / "corgi-skin-original-all-lods.json").read_text())
    patch = json.loads((OUT / "corgi-skin-limbs-patch.json").read_text())
    report = {"clip": clip, "samples": samples, "lods": {}}
    for lod in lods:
        name = "corgi_body_lod" + str(lod)
        mesh = bpy.data.objects[name]
        original, candidate = originals[name], patch[name]
        groups = defaultdict(list)
        for i, values in enumerate(candidate["weights"]):
            region = candidate["regions"][i]
            if region["core"]:
                groups[region["bone"]].append(i)
            elif region["strength"] >= 1 and len(values) == 1:
                groups[next(iter(values))].append(i)
        rest_points = {bone: [rig.data.bones[bone].matrix_local.inverted()
                             @ Vector(original["vertices"][i]) for i in ids]
                       for bone, ids in groups.items()}
        def box(points):
            return [[min(p[axis] for p in points), max(p[axis] for p in points)]
                    for axis in range(3)]
        reference = {bone: box(points) for bone, points in rest_points.items()}
        unique_edges = set()
        for face in original["faces"]:
            for a, b in zip(face, face[1:] + face[:1]):
                if a == b:
                    continue
                a, b = sorted((a, b))
                region_a, region_b = candidate["regions"][a], candidate["regions"][b]
                if region_a["bone"] != region_b["bone"]:
                    continue
                if max(region_a["strength"], region_b["strength"]) <= 0:
                    continue
                length = math.dist(original["vertices"][a], original["vertices"][b])
                if length > .001:
                    unique_edges.add((a, b, length))
        records = []
        for sample in range(samples):
            phase = sample / (samples - 1)
            retarget["update"](start + (end - start) * phase)
            evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
            actual = {}
            for bone, ids in groups.items():
                inverse = (rig.matrix_world @ rig.pose.bones[bone].matrix).inverted()
                points = [inverse @ evaluated.matrix_world @ evaluated.data.vertices[i].co for i in ids]
                residuals = sorted((a - b).length for a, b in zip(points, rest_points[bone]))
                actual_box = box(points)
                before_size = [b - a for a, b in reference[bone]]
                after_size = [b - a for a, b in actual_box]
                actual[bone] = {"vertices": len(ids),
                                "maximumLocalResidualM": residuals[-1],
                                "p95LocalResidualM": residuals[int(.95 * len(residuals))],
                                "maximumDimensionErrorM": max(abs(a - b) for a, b in zip(before_size, after_size)),
                                "dimensionRatios": [b / a if a > 1e-6 else None for a, b in zip(before_size, after_size)]}
            core_error, joint_max, joint_min, attachment_max = 0., 0., math.inf, 0.
            worst_attachment = None
            strain={name:[] for name in ("core","joint","attachment")}
            for a, b, length in unique_edges:
                ra, rb = candidate["regions"][a], candidate["regions"][b]
                wa, wb = candidate["weights"][a], candidate["weights"][b]
                ratio = (evaluated.data.vertices[a].co - evaluated.data.vertices[b].co).length / length
                if len(wa) == len(wb) == 1 and next(iter(wa)) == next(iter(wb)):
                    category="core";core_error = max(core_error, abs(ratio - 1))
                elif ra["strength"] >= 1 and rb["strength"] >= 1:
                    category="joint";joint_max, joint_min = max(joint_max, ratio), min(joint_min, ratio)
                else:
                    category="attachment"
                    if ratio > attachment_max:
                        attachment_max = ratio
                        worst_attachment = {"vertices": [a, b], "restPoints": [original["vertices"][a], original["vertices"][b]],
                                            "actualPoints": [list(evaluated.data.vertices[a].co), list(evaluated.data.vertices[b].co)], "ratio": ratio}
                strain[category].append({"vertices":[a,b],"restLengthM":length,"actualLengthM":length*ratio,
                                         "extensionM":length*(ratio-1),"ratio":ratio})
            def quantile(values,fraction):
                values=sorted(values);return values[min(len(values)-1,int(len(values)*fraction))]
            edge_stats={}
            for category,rows in strain.items():
                if not rows:
                    continue
                edge_stats[category]={"edges":len(rows),"p95Ratio":quantile([r["ratio"]for r in rows],.95),
                    "p99Ratio":quantile([r["ratio"]for r in rows],.99),"p95ExtensionM":quantile([r["extensionM"]for r in rows],.95),
                    "p99ExtensionM":quantile([r["extensionM"]for r in rows],.99),"maximumExtensionM":max(r["extensionM"]for r in rows),
                    "worstByRatio":max(rows,key=lambda r:r["ratio"]),"worstByExtension":max(rows,key=lambda r:r["extensionM"])}
            records.append({"phase": phase, "cores": actual,
                            "maximumCoreEdgeRatioError": core_error,
                            "maximumJointEdgeRatio": joint_max,
                            "minimumJointEdgeRatio": joint_min if math.isfinite(joint_min) else None,
                            "maximumAttachmentEdgeRatio": attachment_max,
                            "worstAttachment": worst_attachment,"edgeStrain":edge_stats,
                            "boneLengthRatios": {p.name: (p.tail - p.head).length / p.bone.length
                                                 for p in rig.pose.bones if "_front_" in p.name or "_rear_" in p.name}})
        report["lods"][name] = {"coreVertices": {k: len(v) for k, v in groups.items()},
                                "maximumLocalResidualM": max(v["maximumLocalResidualM"] for r in records for v in r["cores"].values()),
                                "maximumDimensionErrorM": max(v["maximumDimensionErrorM"] for r in records for v in r["cores"].values()),
                                "maximumCoreEdgeRatioError": max(r["maximumCoreEdgeRatioError"] for r in records),
                                "maximumJointEdgeRatio": max(r["maximumJointEdgeRatio"] for r in records),
                                "maximumAttachmentEdgeRatio": max(r["maximumAttachmentEdgeRatio"] for r in records),
                                "records": records,
                                "edgeStrain":{category:{key:max(r["edgeStrain"][category][key]for r in records if category in r["edgeStrain"])
                                    for key in ("p95Ratio","p99Ratio","p95ExtensionM","p99ExtensionM","maximumExtensionM")}
                                    for category in ("core","joint","attachment") if any(category in r["edgeStrain"]for r in records)}}
    (OUT / ("corgi-skin-" + clip + "-audit.json")).write_text(json.dumps(report, indent=2))
    print(json.dumps({"clip": clip, "samples": samples, "lods": {k: {n: v for n, v in data.items() if n != "records"}
                                                                    for k, data in report["lods"].items()}}))
    return report


if __name__ == "__main__":
    # Node packaging supplies exact immutable baseline geometry in Blender axes.
    # This pure standard-library entry point never imports bpy or touches scene.
    import sys
    if sys.argv[1:] != ["--plan-stdin"]:
        raise SystemExit("Usage: corgi_skin.py --plan-stdin")
    request = json.load(sys.stdin)
    response = {"algorithm": "corgi-anatomical-limbs-v4", "meshes": []}
    for data in request["meshes"]:
        weights, regions, metadata = plan(data, "limbs")
        response["meshes"].append({"name": data["name"], "weights": weights,
                                   "regions": regions, "metadata": metadata})
    json.dump(response, sys.stdout, allow_nan=False)
