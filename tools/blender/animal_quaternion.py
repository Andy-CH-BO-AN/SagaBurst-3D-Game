"""Keep sampled quaternion keys on one hemisphere before Blender interpolation.

Blender linearly interpolates four scalar curves and then normalizes. Opposite
representations of the same rotation otherwise pass through zero, unlike glTF
shortest-path SLERP. This changes representations, not the keyed orientations.
"""
import math


def continuous_quaternions(values, loop=False):
    result = []
    flips = 0
    for value in values:
        norm = math.sqrt(sum(v * v for v in value))
        assert math.isfinite(norm) and norm > 1e-8, "Invalid sampled quaternion"
        q = [v / norm for v in value]
        if result and sum(a * b for a, b in zip(result[-1], q)) < 0:
            q = [-v for v in q]
            flips += 1
        result.append(q)
    if loop and len(result) > 1:
        assert sum(a * b for a, b in zip(result[0], result[-1])) >= 0, "Loop hemisphere discontinuity"
    return result, flips


def stabilize_action(action, loop=False):
    groups = {}
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    if curve.data_path.endswith(".rotation_quaternion"):
                        groups.setdefault(curve.data_path, {})[curve.array_index] = curve
    records = {}
    for name, curves in groups.items():
        assert set(curves) == {0, 1, 2, 3}, "Incomplete quaternion tracks: " + name
        frames = [key.co.x for key in curves[0].keyframe_points]
        for index in range(1, 4):
            assert [key.co.x for key in curves[index].keyframe_points] == frames
        original = [[curves[k].keyframe_points[i].co.y for k in range(4)] for i in range(len(frames))]
        values, flips = continuous_quaternions(original, loop)
        for i, q in enumerate(values):
            for k in range(4):
                key = curves[k].keyframe_points[i]
                key.co.y = q[k]
                key.interpolation = "LINEAR"
        for curve in curves.values():
            curve.update()
        records[name] = {"keys": len(values), "flippedKeys": flips}
    return {"action": action.name, "loop": loop, "tracks": records,
            "flippedKeys": sum(v["flippedKeys"] for v in records.values())}
