# SagaBurst 3D Game

**English** | [繁體中文](./README.zh-TW.md)

**SagaBurst** is a browser-based 3D action RPG prototype built with **Three.js**, **TypeScript**, and **Vite**.

The current gameplay entry point is **Custom Battle**: configure Viking and Roman armies, choose troop types, tiers, battle deployment mode, Player Faction, and the player's starting loadout, while both AI armies automatically engage across a large battlefield.

## ⚔️ Custom Battle

Each side can field **1–100 AI troops**. Viking and Roman army sizes can be asymmetric, including scenarios such as `1 vs 100` or `100 vs 1`.

Each faction can be configured independently across four unit roles and three tiers:

| Unit | Role |
| --- | --- |
| Infantry | Foot melee unit |
| Archer | Foot ranged unit |
| Cavalry | Mounted melee / lancer unit |
| Horse Archer | Mounted ranged unit |

Every unit role supports **T1 / T2 / T3**. Higher tiers use stronger faction-appropriate equipment and damage values.

Quick presets are available for **10 vs 10**, **25 vs 25**, **50 vs 50**, and **100 vs 100**, or you can build an army manually with the setup controls.

Battle deployment is selected independently from army size:

- **Formation Battle** — Viking and Roman armies spawn in deterministic formations on opposite sides of the battlefield.
- **Scattered Battle** — the Player, Viking NPCs, and Roman NPCs are deterministically scattered across the battlefield while normal Viking-vs-Roman faction, friendly-fire, and victory rules remain unchanged.

Player faction is selected independently from army composition and deployment mode:

- **Viking Player** — Viking NPCs are allies, Roman NPCs are enemies, and Formation Battle starts the player on the Viking (+Z) side facing the Roman army.
- **Roman Player** — Roman NPCs are allies, Viking NPCs are enemies, and Formation Battle starts the player on the Roman (-Z) side facing the Viking army.

Changing an army preset only changes army composition; it preserves the selected **Battle Mode**, **Player Faction**, **Player Loadout**, and **Spectator** setting.

The player is an additional participant on the selected side and does **not** count toward that faction's configured 1–100 AI troop total or the army-survival victory count.

### Battle flow

1. Open the game and use **Army Setup** to configure both armies, Player Faction, and **Formation Battle** or **Scattered Battle**.
2. Open **Player Loadout** and choose a melee weapon, ranged weapon, shield (or no shield), and whether to start **Mounted** or **On Foot**.
3. Click **START BATTLE**.
4. Actors spawn according to the selected deployment mode: opposite-side formations in Formation Battle, or deterministic mixed positions across the battlefield in Scattered Battle. The AI armies then automatically engage.
5. Fight alongside the selected allied army using swords, gladii, lances, bows, pila, shields, and horses.
6. A battle ends when either configured AI army is eliminated.
7. Use **REMATCH** to replay the same battle configuration or **BACK TO SETUP** to build another battle.

If both AI armies are eliminated at the same time, the result is a **DRAW**.

## 🧰 Player Loadout & Starting State

Custom Battle now has a dedicated **Player Loadout** page. Before starting the battle, choose exactly one melee weapon, one ranged weapon, an optional shield, and whether the player begins **Mounted** or **On Foot**.

Player equipment is independent from Player Faction, so Viking and Roman gear can be mixed freely:

- **Melee** — Viking swords, Roman gladii, or the Steel Lance.
- **Ranged** — Viking bows or Roman pila.
- **Shield** — Viking round shields, Roman scuta, or no shield.
- **Starting state** — **Mounted** creates and mounts the normal starting horse; **On Foot** does not create the special starting horse.

An explicit custom loadout gives the player only the selected starting equipment rather than also granting unrelated top-tier gear. Army presets and Reset preserve the selected Player Loadout.

Bow and Pilum controls intentionally differ: bows use the existing draw-and-release flow, while a Pilum is aimed with the right mouse button and committed with a left click. Entering ranged aim still unequips an equipped shield using the existing ranged-weapon behavior.

For backward compatibility, battle configurations that do not contain `playerLoadout` keep the legacy default start: **Steel Lance**, **Elven Runebow**, **Round Shield T3**, and mounted. Initial Spectator mode overrides the loadout and does not create a starting horse.

The player's starting horse is separate from the spare horses placed in the faction camps. **Player death is permanent for the current battle**: after dying, the player does not respawn and instead switches to free spectator mode while the remaining Viking and Roman NPCs continue fighting until the battle ends. REMATCH starts a fresh battle using the same configuration. Mounted save/load continues to preserve the player's mounted state and the mount's world position, while loaded save inventory overrides fresh-battle starting equipment.

## 🏕️ Battle Camps

Normal Custom Battles include a support camp for each faction.

Each camp provides player-usable equipment, including:

- T1 / T2 / T3 melee weapons
- T1 / T2 / T3 ranged weapons
- T1 / T2 / T3 shields
- One lance
- Arrow supplies
- Five spare horses

Mounted troops use their own assigned mounts; the five spare horses at each camp are separate and remain available to the player.

## 🎮 How to Play

### Install and run

You need **Node.js** and **npm** installed.

```bash
git clone https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game.git
cd SagaBurst-3D-Game
npm ci
npm run dev
```

Open the local URL printed by Vite in a desktop browser. The Custom Battle Setup UI appears before the heavy 3D assets are loaded.

After clicking **START BATTLE**, the game attempts to capture the mouse for camera control. Press `Esc` to release the cursor; click the battle screen again to resume pointer lock when needed.

> The game is currently designed for desktop keyboard + mouse controls.

## 🕹️ Controls

| Control | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Look / control camera |
| `Shift` | Sprint |
| `Space` | Jump |
| Left Mouse Button | Melee attack when not aiming |
| Hold Right Mouse Button + hold/release Left Mouse Button | Aim / draw / fire bow |
| Hold Right Mouse Button + click Left Mouse Button | Aim / throw Pilum |
| `E` | Pick up equipment / mount horse / dismount |
| `Tab` or `I` | Open character & inventory |
| `0` | Open game menu |
| `Esc` | Close UI / release pointer lock |

## 🏹 Combat & RPG Systems

- **Melee combat** — use daggers, swords, greatswords, and lances.
- **Archery** — hold right mouse to aim, hold left mouse to draw, then release left mouse to fire.
- **Pilum throwing** — hold right mouse to aim and click left mouse to commit a Roman Pilum throw.
- **Mounted combat** — cavalry can charge with lances while mounted ranged units fight from horseback.
- **Tiered equipment** — T1 / T2 / T3 Viking and Roman equipment have distinct combat values.
- **Shields** — Viking round shields and Roman scuta can be selected in Player Loadout or collected during battle.
- **Equipment pickups** — approach camp equipment and press `E` to collect it.
- **Arrow supplies** — refill ranged ammunition from camp supply pickups.
- **Horses** — approach an available horse and press `E` to mount; press `E` again to dismount.
- **Character progression** — player combat continues to feed the existing RPG skill and progression systems.
- **Save / Load** — saves restore player progression, inventory, equipped shield, mounted state, mount appearance, and mount position.

## 🧪 Developer / QA Modes

The main gameplay URL always uses Custom Battle Setup unless a developer scene mode is explicitly requested.

### Large-battle profiling scenarios

The `devcombat` mode includes reproducible battle presets used for performance profiling:

| Query | Scenario |
| --- | --- |
| `?devcombat=a` | 50 vs 50 infantry control scenario |
| `?devcombat=b` | 100 vs 100 infantry scaling scenario |
| `?devcombat=c` | 100 vs 100 mixed army scenario |
| `?devcombat=d` | 100 vs 100 formation cavalry / horse-archer stress scenario |
| `?devcombat=e` | 100 vs 100 all-melee cavalry, Scattered Battle, initial spectator, no camps / respawn |
| `?devcombat=f` | 100 vs 100 mixed cavalry (50 melee cavalry + 50 horse archers per faction), Scattered Battle, initial spectator, no camps / respawn |
| `?devcombat` | Legacy fixed 50 vs 50 mounted developer scenario |

`devcombat` exposes a runtime profiling HUD with wall-clock FPS, CPU frame work, NPC update time, collision time, projectile / impact work, renderer submit time, draw calls, triangle count, horse count, and LOD statistics.

Current profiling shows that large-battle performance is primarily constrained by the **render path / draw-call pressure**, while entity collision cost is comparatively small. The profiling infrastructure is intentionally separated from normal gameplay and only runs in developer combat mode.

Other QA modes:

| Query | Purpose |
| --- | --- |
| `?devmodels=humans` | Humanoid model / animation studio |
| `?devmodels=mounts` | Horse, saddle, rider, gait, jump, and dismount QA studio |
| `?legacyhumanoids` | Use the legacy humanoid rendering path as a modifier |
| `?nolock` | Disable normal pointer-lock requirements for browser QA |

Examples:

```text
http://localhost:5173/?devcombat=b&nolock
http://localhost:5173/?devcombat=c&nolock
http://localhost:5173/?devcombat=d&nolock
http://localhost:5173/?devcombat=f&nolock
http://localhost:5173/?devmodels=humans&nolock
http://localhost:5173/?devmodels=mounts&nolock
```

There is no separate hardcoded **Standard** battle mode. Normal gameplay is fully driven by Custom Battle configuration.

## 📊 Performance Profiling

Large-battle profiling is designed around real headed-browser measurements rather than software-rendered headless FPS.

The benchmark runner records the browser / WebGL environment and validates that a hardware renderer is being used before treating a run as a reliable gameplay baseline.

```bash
node tools/profile-large-battles.mjs
```

The broad benchmark suite runs the A–D scenarios and records before-contact and during-combat measurements including FPS, CPU work, renderer submit time, NPC update time, collision cost, draw calls, and triangles.

For shadow-path work, Scenario F is the current mixed-cavalry isolation scene. The fixed-scene runner freezes simulation while keeping the render loop alive, verifies scene invariants, and compares Shadow ON / OFF / ON without treating renderer-submit time as pure GPU time:

```bash
node ai_share/skills/sagaburst-performance-benchmark/scripts/fixed-scene-shadow-benchmark.mjs
```

Recent structural shadow optimizations on `main` include:

- **Roman humanoids** — LOD0 / LOD1 shadow casters reduced from 17 to 5 per instance while LOD2 remains shadow-free.
- **NPC equipment** — Scenario F equipment shadow submissions reduced from 127 to 68 by keeping only silhouette-relevant casters; equipment LOD2 remains shadow-free.
- **NPC projectiles** — flying NPC arrows and pila no longer cast shadows, reducing their structural shadow cost from 1 submission per active projectile to 0. Player-fired projectile shadows are preserved.

Structural submission counts and shadow-census results are treated as the primary causal evidence. Cross-commit FPS / renderer-submit differences are reported only as directional timing evidence unless the exact same scene state is replayed.

## 🧰 Development Commands

```bash
# Start development server
npm run dev

# Run tests
npm test

# Type-check and build production bundle
npm run build

# Preview the production build
npm run preview
```

## 🛠️ Tech Stack

- Three.js
- TypeScript
- Vite
- Vitest
- Playwright

## 🚧 Project Status

SagaBurst is an actively evolving 3D action RPG prototype focused on large AI battles, melee and ranged combat, mounted gameplay, equipment progression, and browser-based 3D character systems.

The game currently supports battles up to **100 vs 100 AI troops**, including infantry, ranged units, cavalry, and mounted ranged units across three equipment tiers.

Current development is centered on improving combat behavior, animation fidelity, large-battle rendering performance, and the Custom Battle experience.
