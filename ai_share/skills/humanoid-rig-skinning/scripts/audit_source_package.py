#!/usr/bin/env python3
"""Create a reproducible, privacy-safe inventory for a downloaded source package."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import zipfile


LICENSE_NAMES = {"license", "licence", "copying", "copyright", "readme"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def jpeg_dimensions(path: Path) -> list[int] | None:
    with path.open("rb") as stream:
        if stream.read(2) != b"\xff\xd8":
            return None
        while True:
            marker_start = stream.read(1)
            if not marker_start:
                return None
            if marker_start != b"\xff":
                continue
            marker = stream.read(1)
            while marker == b"\xff":
                marker = stream.read(1)
            if marker in {bytes([value]) for value in range(0xC0, 0xC4)} | {
                bytes([value]) for value in range(0xC5, 0xC8)
            } | {bytes([value]) for value in range(0xC9, 0xCC)} | {
                bytes([value]) for value in range(0xCD, 0xD0)
            }:
                length = struct.unpack(">H", stream.read(2))[0]
                payload = stream.read(length - 2)
                height, width = struct.unpack(">HH", payload[1:5])
                return [width, height]
            if marker in {b"\xd8", b"\xd9"}:
                continue
            length_bytes = stream.read(2)
            if len(length_bytes) != 2:
                return None
            stream.seek(struct.unpack(">H", length_bytes)[0] - 2, 1)


def looks_like_license(name: str) -> bool:
    stem = Path(name).stem.lower()
    return any(token in stem for token in LICENSE_NAMES)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("texture_dir", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source-label", required=True)
    options = parser.parse_args()

    source = options.source.resolve()
    texture_dir = options.texture_dir.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    if not texture_dir.is_dir():
        raise NotADirectoryError(texture_dir)

    archive_entries = []
    archive_license_files = []
    if zipfile.is_zipfile(source):
        with zipfile.ZipFile(source) as archive:
            for info in sorted(archive.infolist(), key=lambda item: item.filename.lower()):
                archive_entries.append(
                    {
                        "name": info.filename,
                        "bytes": info.file_size,
                        "crc32": f"{info.CRC:08x}",
                    }
                )
                if looks_like_license(info.filename):
                    archive_license_files.append(info.filename)

    textures = []
    for path in sorted(texture_dir.iterdir(), key=lambda item: item.name.lower()):
        if not path.is_file():
            continue
        textures.append(
            {
                "name": path.name,
                "bytes": path.stat().st_size,
                "sha256": sha256(path),
                "dimensions": jpeg_dimensions(path) if path.suffix.lower() in {".jpg", ".jpeg"} else None,
            }
        )

    sibling_license_files = [
        path.name
        for path in sorted(source.parent.parent.rglob("*"))
        if path.is_file() and looks_like_license(path.name)
    ]
    payload = {
        "schemaVersion": 1,
        "source": {
            "label": options.source_label,
            "name": source.name,
            "bytes": source.stat().st_size,
            "sha256": sha256(source),
            "isZip": zipfile.is_zipfile(source),
        },
        "archiveEntries": archive_entries,
        "textures": textures,
        "licenseFiles": sorted(set(archive_license_files + sibling_license_files)),
        "provenanceConclusion": (
            "No bundled license or provenance document was found; use the separately captured "
            "Sketchfab model-page/API evidence and retain all author-listed third-party credits."
            if not archive_license_files and not sibling_license_files
            else "Bundled license/provenance files require manual review."
        ),
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
