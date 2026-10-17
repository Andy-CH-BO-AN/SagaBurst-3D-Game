# Final offline visual evidence

These are Blender/Cycles CPU round-trip renders of the final production GLBs, with original exported materials. They are not browser screenshots or proof of gameplay integration/GPU performance.

- `appearance-lods.jpg`: front/side/back idle, anatomical A-pose stress view, LOD1/2. LOD2 retains approximately 4K body triangles because 2K destroyed facial/hand features.
- `locomotion.jpg`: four walk and four run phases, front/side.
- `attack-hit-death.jpg`: attack start, preparation, before/at/after 0.252 s contact, recovery, hit and grounded final death.
- `hammer-grip.jpg`: idle/run/contact/death closeups after static source-finger fitting. Topology/UVs/weights, palm, thumb web, wrist and free left hand are preserved. There are no new finger bones. The grip remains a loose angular partial C, not a fully closed natural fist; residual local shaft overlap of approximately 6 mm is documented in the manifest.
- `roman-foot-axe-parity.jpg`: 30 body/clip before/after render pairs across all three LODs, pixel-identical. Contact is 0.13090909090909092 s; 0.252 s is mid-attack for Roman T4. Runtime axe/shield, equipped idle, events and live LOD switching are excluded.

## Final Bandit files

- `lod0.glb`: `ead0fbaf590d2f2cdf92a2b18474332a3dd417d6716bf22ab2b5a45e020dbf73`
- `lod1.glb`: `5a5849c8c09195f742216b31b577e9929397088a79560457b027e9c04acbf27a`
- `lod2.glb`: `173274702a597f48a5d22744cf1ae13ef0077e30ce358e59a303164166b93e13`

The independent 41-sample run sweep found zero head/hammer triangle intersections and checks 0:.02:.8 seconds for head/hammer triangle intersections. Contact at the gripping hand is expected; this is a bounded collision diagnostic, not complete art/gameplay acceptance.

Actual Chromium was blocked before navigation by an execution-sandbox socket denial. Actual Bandit NPC spawn/chase/attack/hit/death, camp/patrol/mission flows, instance independence and live LOD transitions remain pending. Keep the PR Draft.
