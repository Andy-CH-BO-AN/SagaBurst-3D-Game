# Midnight Rider Black Cat

Model created with Meshy – CC BY 4.0 License.

- Creator platform: [Meshy](https://www.meshy.ai/).
- License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- User-provided free-plan model: `Meshy_AI_Midnight_Rider_1017070200_texture.glb`.
- Original SHA-256: `9e6ce0835095dfec2de0e953f38a0dbaa987a50da0a28bf4e8c241ee2ac7f81a`.
- [Meshy's free-plan commercial-use and attribution guidance](https://help.meshy.ai/en/articles/16102098-can-i-use-meshy-assets-commercially).
- No individual creator or public asset URL was supplied; none is inferred.

SagaBurst modifications: source-specific measured feline rest skeleton and skin,
seven retargeted/baked mount actions, local malformed whisker-web removal and
texture repair, six head-bound replacement whiskers, source saddle/armor
visibility separation, reconstruction of concealed fur for equipment-off mode,
three compatible LODs, normalized transform and saddle/camera sockets, texture
optimization and Meshopt buffer compression. Original exposed geometry and
source tack are retained except the documented local repair/graft boundaries.
There is no live hair, cloth or whisker physics.

## Animation sources and derivation

The animation donor is SagaBurst's accepted black-cat asset at immutable commit
`2b3447f990772cc133f5cff28a5b96c2763a7e8d`, compressed SHA-256
`0e5d7a40f1230d8b9d21a56512b8c37d038166573fd488a03aa7eb6c4f5a3986`.
The new package transfers its motion into the newly measured rest bases. It does
not contain the old animal mesh, old saddle or old textures.

- Idle/walk: [Doginx - Assets](https://tomate-salat.itch.io/doginx-assets), Tomate Salat, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- Run: [Lowpoly Cat + Run Animation](https://dailylowpoly.itch.io/lowpoly-cat-running), Daily Lowpoly. Creator permits commercial project use. Motion was retargeted and baked by SagaBurst; donor mesh/textures are not included.
- Death, jump, land and hit: existing SagaBurst-authored/accepted target animations.
- Historical accepted donor model: [Black Cat by 3D Creator (3DChuang-Ke-Ji)](https://sketchfab.com/3d-models/black-cat-dd0adc10d8b94bc99dfffe0268818e0b), CC BY 4.0. Listed for derivation history; its geometry and textures are replaced.

Reproduction: [Black Cat build instructions](../../../../../tools/meshy-mounts/black-cat-build.md).
Original downloads, intermediate blends and review renders are excluded from the shipped assets.
