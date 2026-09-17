# Equipment geometry reference

`equipment-geometry-cf04fd3.json` records the unmodified equipment builders from
commit `cf04fd38c57aed7a335b1a34856690b84c245b0a`, before rigid consolidation.
This is a maintained regression fixture, not a performance capture.

Each entry contains the original mesh count, attachment metadata, returned tip,
and per-material/render-state triangle counts and SHA-256 fingerprints. The
fingerprint includes transformed positions, normals and UVs, quantized to 1e-4
to tolerate Float32 transform baking. Triangle order and starting corner are
ignored; winding is retained. `equipmentGeometrySignature` defines the encoding.

Do not refresh this fixture from the consolidated implementation just to make a
failure pass. Any intentional shape/material/attachment change requires review
against the original factory and corresponding visual validation.
