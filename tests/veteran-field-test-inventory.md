# Veteran field test inventory

Base: origin/dev at 136d46c (PR #221 included).

Before edits: 699 lines, 22 declarations / 38 expanded cases, 0 explicit timeouts, 0 fixed-frame completion waits, 1 frame-by-frame spawn-budget loop (preserved), 465 type diagnostics, 0 in the original field suite.

There is no VeteranFieldController.ts: BanditMissionController owns this runtime. PREPARING/ATTACKING and locked phases belong to other mission kinds; Veteran field uses ASSEMBLING, MARCHING, ENGAGING, RESULT, RETURNING, then settlement clears the mission.

## Original scenario classification

| Original line | Scenario | Responsibility | Destination |
| --- | --- | --- | --- |
| 190 | deploys %s mission enemies at the map edge and scouts at the opposite edge | composition / spawn plan | VeteranFieldDeployment.test.ts |
| 212 | keeps borrowed Town actors at home and orders them to ride or walk to muster in %s | movement / formation | VeteranFieldFormation.test.ts |
| 226 | spawns temporary support at an in-bounds approach and orders it toward the Town muster | composition / spawn plan; movement / formation | VeteranFieldFormation.test.ts |
| 245 | routes temporary support through the Town entry before assigning its final muster slot | movement / formation | VeteranFieldFormation.test.ts |
| 269 | places muster and courtyard goals outside Town building and market obstacle volumes | movement / formation | VeteranFieldFormation.test.ts |
| 307 | keeps every Veteran spawn inside terrain bounds | composition / spawn plan | VeteranFieldDeployment.test.ts |
| 321 | faces each held enemy leader toward the friendly rally | movement / formation | VeteranFieldFormation.test.ts |
| 334 | stages the exact Veteran roster for %s | pure mission contract; composition / spawn plan; mission borrowing | VeteranFieldBorrowing.test.ts |
| 371 | disposes a temporary substitute mount when a borrowed rider has no home mount | mission borrowing | VeteranFieldBorrowing.test.ts |
| 388 | restores the same reequipped residents, mounts, and shortages after reloading %s | checkpoint / persistence; mission borrowing | VeteranFieldCheckpoint.test.ts |
| 419 | restores the latest Player mount state when a four-squad charge checkpoints | checkpoint / persistence; controller state machine | VeteranFieldCheckpoint.test.ts |
| 465 | starts %s when NPCs reach their slots even while the Player stays far away | movement / formation; controller state machine | VeteranFieldFormation.test.ts |
| 492 | departs with a lagging Captain after 90% assemble without snapping him into place | movement / formation | VeteranFieldFormation.test.ts |
| 515 | avoids the old world edge when restoring a legacy mountedMarchPosition | checkpoint / persistence | VeteranFieldCheckpoint.test.ts |
| 533 | restores legacy MARCHING borrowed actors around the saved mounted march anchor | checkpoint / persistence | VeteranFieldCheckpoint.test.ts |
| 546 | persists a held enemy squad activation only after effective damage reaches a Veteran target | combat / encounter integration | VeteranFieldEncounter.test.ts |
| 568 | persists the final 120 seconds before resolving a Player-dead NPC-survived victory | controller state machine; completion / settlement boundary | VeteranFieldControllerLifecycle.test.ts |
| 583 | continues VI after Player death while an NPC survives, but fails on an early full wipe | controller state machine | VeteranFieldControllerLifecycle.test.ts |
| 602 | returns the surviving party from its current position and resumes after reload: %s | checkpoint / persistence; completion / settlement boundary | VeteranFieldCheckpoint.test.ts |
| 645 | elects a living leader and lets a sole surviving Player walk home | controller state machine; completion / settlement boundary | VeteranFieldControllerLifecycle.test.ts |
| 660 | keeps the result and existing orders when saving the return fails | completion / settlement boundary | VeteranFieldControllerLifecycle.test.ts |
| 675 | creates only missing %s NPCs one per frame and waits for the full official roster | composition / spawn plan; controller state machine | VeteranFieldControllerLifecycle.test.ts |

## Adjacent coverage retained

- VeteranMission.test.ts: all six definitions (including outpost I/IV), rank/mount/unlock gates, exact T3/T4 and weapon/mount distribution, v1/v2 compatibility, stable IDs and save parsing. Field contracts are kept lightweight in VeteranFieldMission.test.ts.
- VeteranCavalryReserve.test.ts and TownCavalryReserve.test.ts: matching type, T4 officer-only slots, ENGAGING exclusions, reserve fallback, saved identity mapping.
- TownPatrolMissionInterop.test.ts and VeteranTownSettlement.test.ts: ownership release, return/rejoin, barracks refit, availability policy, saving failures, single settlement/merit award. Current dev explicitly permits borrowing during rejoin (see the existing regression); this PR preserves current behavior rather than introducing the prompt's proposed restriction.
- VeteranTownScene.test.ts: mission board, town acceptance/scene replacement, Player HP/stamina/mount restoration, dead-state presentation.
- VeteranTownMissionCombat.test.ts: Captain/Ranger combat behavior, held squads, ambient/native Town guards, damage and hostile grids.
- CareerMissionCheckpointControllers.test.ts / CareerMissionCheckpoint.test.ts: checkpoint cadence, failed-save retry, commit-before-orders contract.
- MissionTravelEncounter.test.ts / MissionTravelEncounterFlow.test.ts: sensor/leash/resume rules and generic travel. New field encounter cases exercise real mounted field handoff.

## Refactoring decisions

- Pure roster/metadata/identity checks require no scene, NPC, navigation or scheduler. The mixed roster case keeps its integration assertions in Borrowing and gains a separate lightweight contract.
- Deployment geometry is separate from formation and scheduler readiness. This makes the largest suite easier to scan.
- Existing fixed elapsed-time checks (119.9 + 0.1 seconds, checkpoint 5 seconds, loading no-op) remain because time is the contract. State completion uses bounded advanceUntil.
- The fixture uses a real constructor and an instance scheduler, with no prototype controller, private commit replacement, import-time hooks or global stubs. Suites mock only MissionGuide UI.
- Movement doubles explicitly accept test positions; they do not simulate NPC locomotion. Assertions protect controller orders, leader identity, no controller teleport, squad ownership and persisted state. Real NPC movement remains covered by the adjacent movement suites.
- Production source, domain policies, mission counts, equipment, merit, spawn cadence and typecheck ratchet are unchanged.

## Final measurements and validation

| Suite | Lines | Expanded cases |
| --- | ---: | ---: |
| VeteranFieldMission.test.ts | 42 | 4 |
| VeteranFieldControllerLifecycle.test.ts | 135 | 10 |
| VeteranFieldFormation.test.ts | 203 | 14 |
| VeteranFieldBorrowing.test.ts | 76 | 5 |
| VeteranFieldCheckpoint.test.ts | 221 | 10 |
| VeteranFieldEncounter.test.ts | 97 | 3 |
| VeteranFieldDeployment.test.ts | 58 | 5 |

Original 38 expanded cases are preserved; the seven new suites contain 51 cases (30 declarations). The largest is 221 lines. Long fixed-frame completion loops remain 0, explicit timeouts remain 0, and the one spawn-budget frame loop is retained. Type diagnostics remain 465, with 0 in changed/new field tests/helpers; baseline untouched.

Passed: typecheck:test; npm test (193 files / 2930 cases); build; test:release (17 cases); npm test -- VeteranField (8 files / 54 cases, including the unchanged 3-case survival objective suite); git diff --check.

The first full run concurrent with build hit the existing 5-second TownPatrolMovement timeouts; the same npm test command passed after build completed without changing timeouts or configuration.
