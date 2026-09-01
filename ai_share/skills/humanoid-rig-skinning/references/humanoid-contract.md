# Project Humanoid Contract

## Coordinate and scale

- Units: metres; exported scene scale `(1, 1, 1)`.
- Character root origin: ground projection below the pelvis.
- Up: `+Y`; character forward: `-Z`; right: `+X`.
- Viking height: `1.86 m`; Roman height: `1.78 m`; tolerance `±0.02 m`.
- Viking outer shoulder width: at most `0.54 m`; Roman: at most `0.46 m`.
- Neck landmark length: `0.09 m`, tolerance `±0.015 m`.
- Knee height: about `0.29 × height`; head height: about `0.13 × height`.
- Never use non-uniform runtime scale to meet these values.

## Required deform bones

`hips`, `spine`, `chest`, `neck`, `head`, and bilateral:

- `upper_arm_l/r`, `lower_arm_l/r`, `hand_l/r`
- `upper_leg_l/r`, `lower_leg_l/r`, `foot_l/r`, `toe_l/r`

Extra twist, clavicle, finger, facial, and skirt bones are allowed. Record source-to-project aliases in `bone-map.json`.

## Required sockets and landmarks

- `socket_hand_l`, `socket_hand_r`
- `socket_back`, `socket_head`, `socket_pelvis`
- `socket_foot_l`, `socket_foot_r`
- `sole_l`, `sole_r` landmarks at the lowest boot point

Sockets may be non-deforming bones or named empties parented to the relevant bone. They must survive GLB export.

## Deformation poses

Approve front and side neutral pose plus: arms overhead, arms forward, elbow 120°, deep knee bend, wide mounted hips, bow draw, shield guard, two-handed thrust, walk extremes, jump tuck, and death side fall. Reject collapsing axillae, candy-wrapper limbs, detached armour, pelvis gaps, or large saddle/leg intersections.

## Runtime LOD targets

- LOD0: about 60k triangles, 2K maps.
- LOD1: about 20k triangles, 1K maps.
- LOD2: about 6k triangles, 512 maps.

Preserve the same bone names, material roles, sockets, animation clip names, and approximate bounds across LODs.

