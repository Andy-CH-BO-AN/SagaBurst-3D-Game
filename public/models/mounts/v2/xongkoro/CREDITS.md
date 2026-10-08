# xongkoro source and rebuild

“White Eagle Animation Fast Fly” by **GremorySaiyan**, licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

Source: [Sketchfab model 30203bf39e5145f19c79e83c550139d3](https://sketchfab.com/3d-models/white-eagle-animation-fast-fly-30203bf39e5145f19c79e83c550139d3), published March 11, 2021. The source page identifies the author and CC Attribution license; the user supplied the downloadable ZIP. Archive and FBX SHA-256 values are recorded in `manifest.json`.

License verified against the [official Sketchfab model API](https://api.sketchfab.com/v3/models/30203bf39e5145f19c79e83c550139d3) on October 9, 2026; `source-license.json` preserves its relevant source fields, including the explicit CC BY 4.0 URL and attribution requirement.

The supplied archive contains `source/Eagle Fly.zip` with `EAGLE FLY.fbx`, `Texture Base.tga`, `Texture Alpha.tga`, and `Texture Normal.tga`, plus separate base/normal PNGs. The FBX contains one rigged eagle and one fast-flight take (frames 1–19 at 30 fps). It has no attack, takeoff, landing, or death clip.

SagaBurst modifications: fixed uniform anatomical head/body/tail length of 10 m; coordinate normalization to local +Z forward; removal of donor root trajectory; three source-derived LODs; torso standing socket and head/claw attack sockets; embedded supplied base/alpha/normal textures; runtime procedural head/neck and claw attack layered over the sampled flight pose. Grounded flight playback is held; takeoff, landing, falling and corpse translation use gameplay physics. No substitute bird or viewer dependency is used.

Rebuild from the original user archive with Blender 5.2:

```sh
rtk proxy /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build-xongkoro.py -- --source /path/to/white-eagle-animation-fast-fly.zip
```

The script stores source extraction in ignored `output/xongkoro-build/`. The GLB embeds its textures for Web and Desktop packaging. The source alpha uses glTF `MASK` cutouts (cutoff 0.5), preserving opaque depth writes on the body and feather surfaces. `base-color.png` and `normal.png` are retained as derived texture provenance. The manifest records the anatomical reference and measured full-cycle dimensions, not the maximum bounding-box edge as body length.
