# Measured faction run cape profiles

These are offline, target-specific clearance curves for the existing run clip.
They add the same bounded posterior pitch to the existing `cape_mid` and
`cape_lower` world orientations in chest-yaw space. The upper cape, body tracks,
geometry, source length, action timing and events are preserved. There is no
cloth simulation, new helper chain or runtime collision search.

Each profile records normalized-phase samples and its measurement provenance.
The builder checks the immutable original model SHA. The retarget tool also
checks the verified animation-input hash, fitted geometry/skin accessor digest
and rest-rig digest before applying
the curve. Texture packing and animation serialization do not affect those
bind digests. A changed fit or skin requires new contact measurements and visual
review rather than bypassing the guards.

The run curve is baked only into the run clip. The normal mixer handles run/idle
fades. The existing mounted cloth layer replaces the same main helpers with its
measured seated pose, so running mount gait does not add a second cape lift.
Actual production-pose run phases, opposite-leg phases, fades and moving
BlackCat bow/axe views were used to review that composition.

Finite triangle-contact sampling is not continuous collision detection and
does not prove every cloth seam is collision-free. Structural checks, measured
contact checks and visual acceptance remain separate.
