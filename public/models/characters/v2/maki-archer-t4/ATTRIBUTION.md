# Maki T4 Ranger

Maki (Archer) by Blue Spirit.

Source: https://sketchfab.com/3d-models/maki-archer-f8fe68c9b6b14ded84172a06c9bd9b20

The source GLB labels the model Creative Commons Attribution (CC BY 4.0):
https://creativecommons.org/licenses/by/4.0/

The original author states that Maki is a remodel and redesign of the Mixamo character Akai (disclosure supplied with the request; live page fetch returned 403 on 2026-09-27).

Adapted for SagaBurst.

Modifications:
- Idle preserves the original Maki bind pose without importing another character posture
- Melee uses the same T4 bow in the left hand; the existing two-handed axe take supplies the strike timing/arc, with baked bow-handle support contact and acquisition/recovery to source bow idle; no axe equipment or axe idle
- Assigned sleeve weights along garment topology; separated both sleeve/body branches below the measured axillary junction, diffused shoulder weights between fixed body and sleeve regions, and transferred the same field to the overlapping hood shoulder flap; kept torso ornaments separate and smoothed skirt centre weights
- Bow poses start from the original Maki body pose and raise the arms with a two-bone solve and drawing-side clavicle elevation; the original side-on draw is retained in the chest frame and the complete standing pose turns at the hips to aim along gameplay +Z; walking and mounted locomotion transfer that heading above the pelvis, the head and neck follow the same sight line, and the drawing hand anchors beside the jaw; other locomotion retargets arm direction using Maki rest frames; constrained both bow wrists to their anatomical rest orientation relative to the forearm; solved arm reach from source frames; left thumb web rises through gradual forearm pronation with a neutral wrist and distributed skin twist; weapon facing never drives limb rotation
- Baked complete source transforms and grounded shoe outsole; preserved source dimensions and original character surfaces/materials
- Built fitted project-humanoid-v1 skeleton with six forearm twist deformation bones and a local left deltoid support bone; subdivided bow-hand pronation into three adjacent skinning intervals to preserve forearm cross-section; limited deltoid support to the shoulder joint so it cannot drag the axillary body panel; measured elbow centres from original skin cross-sections; normalized region-aware skin weights because source has no rig
- Baked existing project animations to fitted bone and hand frames; shared identical animation samples across all LODs
- Generated three runtime LODs; resized original textures and encoded opaque maps as JPEG95 while preserving masked alpha maps as PNG
- Extracted original Spirit Bow, normalized its grip pivot, removed original static string for existing dynamic bow-string rendering
- Removed the independent held arrow; preserved quiver and back arrow stack as visual accessories
- Added equipment sockets, bow contact landmarks and Maki-specific hand grip metadata; corrected left thumb direction for forehand bow grasp

Mixamo game-use information:
https://helpx.adobe.com/tw/creative-cloud/faq/mixamo-faq.html

Animation sources and their licenses remain separately documented in manifest.json and attribution-evidence.json: Kevin Iglesias / Unity Asset Store EULA; Quaternius / CC0; existing SagaBurst death profile. The final GLBs are not declared wholly CC BY.

Source SHA-256: de18d6e174d8b0e282dfa30a16382af44e1b815512187b8dc5ffea312dd08601

No endorsement by Blue Spirit, Adobe, Mixamo, or other original creators is implied.
