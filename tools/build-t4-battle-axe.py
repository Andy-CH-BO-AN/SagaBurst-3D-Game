#!/usr/bin/env python3
"""Normalize the supplied T4 axe without altering geometry or embedded PBR maps.

Usage: python3 tools/build-t4-battle-axe.py /path/to/source.glb
The exact source hash guards the authored shaft centre and source +X direction.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
SOURCE_SHA = "7bce3b5be271e96319610e09c56553acd4543268943466f48ffc2410f319997e"


def read(path):
    raw = path.read_bytes()
    assert raw[:4] == b"glTF" and struct.unpack_from("<I", raw, 4)[0] == 2
    size = struct.unpack_from("<I", raw, 12)[0]
    return json.loads(raw[20:20 + size]), raw[28 + size:]


def positions(doc, binary):
    primitive = doc["meshes"][0]["primitives"][0]
    accessor = doc["accessors"][primitive["attributes"]["POSITION"]]
    view = doc["bufferViews"][accessor["bufferView"]]
    assert accessor["componentType"] == 5126 and accessor["type"] == "VEC3"
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    return [struct.unpack_from("<3f", binary, offset + i * view.get("byteStride", 12))
            for i in range(accessor["count"])]


def bounds(points):
    return ([min(p[i] for p in points) for i in range(3)],
            [max(p[i] for p in points) for i in range(3)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    assert hashlib.sha256(args.source.read_bytes()).hexdigest() == SOURCE_SHA, "Wrong source revision"
    doc, binary = read(args.source)
    assert len(doc["nodes"]) == 1 and not doc.get("skins") and not doc.get("animations")
    points = positions(doc, binary)
    low, high = bounds(points)
    scale = 1.60 / (high[0] - low[0])
    # Rz(+90deg): source +X shaft -> +Y, broad XY face remains XY.
    # Centre the wooden shaft, not the asymmetric blade bounding box.
    shaft_y, shaft_z = .795, -.0018
    # Match T5 upper extent 1.51; leave .24m of real wood below the .15 grip.
    offset = [shaft_y * scale, -.09 - low[0] * scale, -shaft_z * scale]
    matrix = [0, scale, 0, 0, -scale, 0, 0, 0, 0, 0, scale, 0, *offset, 1]
    doc["nodes"][0] = {"name": "t4-battle-axe-attachment-space", "mesh": 0, "matrix": matrix}
    metadata = {
        "sourceFile": args.source.name, "sourceSha256": SOURCE_SHA,
        "sourceProvider": "Meshy; user-supplied textured GLB",
        "build": "tools/build-t4-battle-axe.py",
        "attachmentSpace": {"longAxis": "+Y", "broadFace": "XY", "gripCenter": [0, .15, 0],
                            "sourceGripCenter": [(.15 - offset[1]) / scale, shaft_y, shaft_z],
                            "sourceToAttachmentMatrix": matrix, "uniformScale": scale,
                            "rotationZDegrees": 90},
        "geometryPolicy": "All source geometry/accessor and embedded texture bytes unchanged; no decimation or image re-encoding.",
    }
    doc["asset"].setdefault("extras", {}).update(metadata)
    payload = json.dumps(doc, separators=(",", ":")).encode()
    payload += b" " * (-len(payload) % 4)
    raw = (b"glTF" + struct.pack("<II", 2, 28 + len(payload) + len(binary))
           + struct.pack("<I4s", len(payload), b"JSON") + payload
           + struct.pack("<I4s", len(binary), b"BIN\0") + binary)
    folder = ROOT / "public/models/weapons/paladin"
    target = folder / "axe.glb"
    target.write_bytes(raw)
    # Re-read exported geometry and its actual node transform, not accessor bounds.
    exported, final_binary = read(target)
    assert final_binary == binary
    m = exported["nodes"][0]["matrix"]
    transformed = [[sum(p[j] * m[j * 4 + i] for j in range(3)) + m[12 + i]
                    for i in range(3)] for p in positions(exported, final_binary)]
    low, high = bounds(transformed)
    size = [high[i] - low[i] for i in range(3)]
    assert abs(size[1] - 1.60) < 1e-6
    primitive = exported["meshes"][0]["primitives"][0]
    triangles = exported["accessors"][primitive["indices"]]["count"] // 3
    assert triangles == 3150 and len(exported["images"]) == 3
    metadata.update(finalSha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw), triangles=triangles,
                    measuredBounds={"min": low, "max": high, "size": size})
    (folder / "axe.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
