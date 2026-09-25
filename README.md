# SagaBurst 3D Game

**English** | [繁體中文](./README.zh-TW.md)

**SagaBurst** is a browser-based 3D action RPG prototype built with **Three.js**, **TypeScript**, and **Vite**.

SagaBurst currently has two main modes: **Custom Battle**, where you build both armies and control the scenario, and **Defense Campaign**, a nine-stage Roman/Viking defense progression with persistent per-faction unlocks.

## ⚔️ At a Glance

| Area | Current support |
| --- | --- |
| Battle size | **1 vs 1 up to 200 vs 200 AI troops** |
| Factions | Viking and Roman |
| Unit progression | T1 / T2 / T3 presets and equipment |
| Deployment | Formation Battle or Scattered Battle |
| Player side | Viking or Roman |
| Player loadout | Melee, ranged, shield, mounted or on foot |
| Combat | Melee, bows, pila, shields, lances, cavalry, horse impact |
| Army command | Select troop groups or the whole army and issue Attack, Defend, Charge, or Formation orders |
| Spectating | Start as spectator or continue as spectator after player death |
| Defense Campaign | 9 sequential defense stages for Roman and Viking, with per-faction progression |
| Replay | REMATCH with the same configuration or return to setup |
| Platform | Desktop browser, keyboard + mouse |

The project is actively evolving, with current work focused on combat behavior, animation fidelity, large-battle rendering performance, and the Custom Battle experience.

## 🏰 Defense Campaign

Choose **Roman Defense** or **Viking Defense**, configure the defending army for the selected stage, and hold the faction's outpost against a growing assault force.

- Stages **1–9** unlock sequentially after victory.
- Roman and Viking progression are stored separately in the browser.
- Each stage has its own defender cap, tier limits, cavalry cap, attacker size, attacker tier mix, and reinforcement tier.
- Destroying the entire attacking army wins immediately; otherwise scheduled cavalry reinforcements can still arrive during a long defense.
- Stage 9 is the final Defense Campaign stage.
- T1 defenders remain selectable in every stage, so players can deliberately run lower-tier challenge armies.

| Stage | Defender cap | Defender tier rule | Attacker force |
| --- | ---: | --- | --- |
| 1 | 80 | T2+T3 ≤ 50 · T3 ≤ 10 | 100 T2 |
| 2 | 85 | T2+T3 ≤ 50 · T3 ≤ 10 | 110 T2 |
| 3 | 90 | T2+T3 ≤ 55 · T3 ≤ 10 | 120 T2 |
| 4 | 90 | T3 ≤ 10 | 100 T2 + 30 T3 |
| 5 | 90 | T3 ≤ 30 | 70 T2 + 70 T3 |
| 6 | 90 | T3 ≤ 60 | 30 T2 + 120 T3 |
| 7 | 90 | T2+T3 ≤ 90 | 160 T3 |
| 8 | 90 | T2+T3 ≤ 90 | 180 T3 |
| 9 | 90 | T2+T3 ≤ 90 | 200 T3 |

## 🚀 Quick Start

You need **Node.js** and **npm** installed.

```bash
git clone https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game.git
cd SagaBurst-3D-Game
npm ci
npm run dev
```

Open the local URL printed by Vite in a desktop browser.

The Custom Battle Setup UI appears before the heavy 3D assets are loaded. After clicking **START BATTLE**, the game attempts to capture the mouse for camera control.

Press `Esc` to release the cursor. Click the battle screen again to resume pointer lock.

> SagaBurst is currently designed for desktop keyboard + mouse controls.

## 🎯 Your First Battle

1. Open **Army Setup** and configure Viking and Roman forces.
2. Choose **Formation Battle** or **Scattered Battle**.
3. Choose whether the player fights for the **Vikings** or **Romans**.
4. Open **Player Loadout** and choose melee weapon, ranged weapon, shield, and mounted/on-foot start.
5. Optional: enable **Spectator** to enter with a free-flying camera instead of spawning a player character.
6. Click **START BATTLE**.
7. Fight alongside the selected allied army or observe the battle.
8. The battle ends when either configured AI army is eliminated.
9. Use **REMATCH** to replay the same setup or **BACK TO SETUP** to configure another battle.

If both AI armies are eliminated at the same time, the result is a **DRAW**.

## 🛡️ Build the Battle You Want

Each side can field **1–200 AI troops**. Army sizes can be asymmetric, including scenarios such as `1 vs 200` or `200 vs 1`.

Quick presets are available for:

- **10 vs 10**
- **25 vs 25**
- **50 vs 50**
- **100 vs 100**
- **200 vs 200**

You can also build both armies manually.

Changing an army preset only changes army composition. It preserves the selected **Battle Mode**, **Player Faction**, **Player Loadout**, and **Spectator** setting.

The player is an additional participant on the selected side and does **not** count toward that faction's configured 1–200 AI troop total or army-survival victory count.

Player HP is independently configurable from **1–9999** in Army Setup. The default Player and NPC HP is **200**.

### Deployment modes

**Formation Battle**

Viking and Roman armies spawn in deterministic formations on opposite sides of the battlefield.

**Scattered Battle**

The Player, Viking NPCs, and Roman NPCs are deterministically scattered across the battlefield while normal Viking-vs-Roman faction, friendly-fire, and victory rules remain unchanged.

### Player faction

**Viking Player**

- Viking NPCs are allies.
- Roman NPCs are enemies.
- Formation Battle starts the player on the Viking (+Z) side facing the Roman army.

**Roman Player**

- Roman NPCs are allies.
- Viking NPCs are enemies.
- Formation Battle starts the player on the Roman (-Z) side facing the Viking army.

## 🪖 Unit Roster

Each faction has its own unit preset catalog. Every preset supports **T1 / T2 / T3**.

A preset defines the starting loadout. Live combat behavior is determined by the unit's current weapon, shield, mount state, and combat rules.

### Viking presets

| Unit | Battlefield role |
| --- | --- |
| Viking Veteran | Shielded sword infantry with same-tier round shield |
| Spearman | Foot Lance anti-cavalry unit with a same-tier sword sidearm |
| Archer | Foot Bow unit with a fixed T1 dagger fallback |
| Sword Cavalry | Mounted sword + round-shield unit |
| Lancer | Mounted Lance unit built around high-speed charge attacks |
| Mounted Archer | Mounted Bow unit with a fixed T1 dagger fallback |

### Roman presets

| Unit | Battlefield role |
| --- | --- |
| Heavy Infantry | Gladius + Scutum defensive frontline |
| Spearman | Foot Lance anti-cavalry unit |
| Archer | Foot Bow unit with a fixed T1 Gladius fallback |
| Javelin Infantry | Pilum/Javelin ranged unit with a fixed T1 Gladius fallback |
| Sword Cavalry | Mounted Gladius + Scutum unit |
| Lancer | Mounted Lance charge unit |
| Mounted Archer | Mounted Bow unit with a fixed T1 Gladius fallback |

## 🧰 Player Loadout & Starting State

Before starting the battle, choose:

- one melee weapon
- one ranged weapon
- an optional shield
- whether to begin **Mounted** or **On Foot**

Player equipment is independent from Player Faction, so Viking and Roman gear can be mixed freely.

### Available loadout categories

- **Melee** — Viking swords, Roman gladii, or T1 / T2 / T3 Lances
- **Ranged** — Viking bows or Roman pila
- **Shield** — Viking round shields, Roman scuta, or no shield
- **Starting state** — Mounted creates and mounts the normal starting horse; On Foot does not create that horse

An explicit custom loadout gives the player only the selected starting equipment rather than also granting unrelated top-tier gear.

Army presets and Reset preserve the selected Player Loadout.

### Bow and Pilum behavior

Bow and Pilum controls intentionally differ:

- **Bow** — hold right mouse to aim, hold left mouse to draw, then release left mouse to fire.
- **Pilum** — hold right mouse to aim and click left mouse to commit the throw.

Entering ranged aim still unequips an equipped shield using the existing ranged-weapon behavior.
Holding right mouse enters first-person ranged aiming. With a Bow, keep holding right mouse after firing to watch the arrow's trajectory in first person, then hold left mouse again to load the next arrow. Releasing right mouse returns to third person. With a Pilum, the camera returns to third person when the projectile leaves the hand; release and press right mouse again to start the next throw.

### Legacy configuration compatibility

Battle configurations without `playerLoadout` keep the legacy default start:

- Steel Lance
- Elven Runebow
- Round Shield T3
- Mounted

Initial Spectator mode overrides the loadout and does not create a starting horse.

## ☠️ Death, Spectator Mode & Replay

You can enable **Spectator** before battle to start directly with a free-flying camera.

The player's starting horse is separate from the spare horses placed in the faction camps.

**Player death is permanent for the current battle.** After dying, the player does not respawn and instead switches to free spectator mode while the remaining Viking and Roman NPCs continue fighting until the battle ends.

**REMATCH** starts a fresh battle using the same configuration.

Mounted save/load preserves the player's mounted state and the mount's world position. Loaded save inventory overrides fresh-battle starting equipment.

## 🎮 Controls

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
| Viking: `1`–`6` + `` ` `` / Roman: `1`–`7` + `` ` `` | Select a friendly troop group; `` ` `` selects ALL and opens the Army Command menu |
| Army Command `1` / `2` / `3` / `4` | Attack / Charge / Defend / Formation |
| Army Command `` ` `` | Go back one command-menu level; the same key selects ALL from the troop list |
| Formation: `E` or Left Mouse Button | Confirm the formation at the center-crosshair location |
| Formation: `` ` `` | Return to the command menu |
| `Esc` | Close UI / release pointer lock |

## 📯 Army Commands

Army Command supports both keyboard shortcuts and mouse-wheel navigation. The HUD shows only friendly unit presets that have actually entered the battle, plus ALL. The first present unit is highlighted by default; scrolling upward from it reaches ALL, while scrolling moves through the visible troop groups. Middle-click enters the highlighted target's command panel. Attack is highlighted first, the wheel moves between Attack / Charge / Defend / Formation, and middle-click confirms. Formation placement can be confirmed with `E`, left click, or middle click.

Select a troop group with its faction shortcut, then choose an order from the command menu.

### Group shortcuts

| Viking | Group | Roman | Group |
| --- | --- | --- | --- |
| `1` | Viking Veteran | `1` | Heavy Infantry |
| `2` | Spearman | `2` | Spearman |
| `3` | Archer | `3` | Archer |
| `4` | Sword Cavalry | `4` | Javelin Infantry |
| `5` | Lancer | `5` | Sword Cavalry |
| `6` | Mounted Archer | `6` | Lancer |
| — | — | `7` | Mounted Archer |
| `` ` `` | ALL | `` ` `` | ALL |

T1 / T2 / T3 units that belong to the same preset are commanded together.

### Orders

| Key | Order | Battlefield behavior |
| --- | --- | --- |
| `1` | **Attack** | Normal aggressive behavior using the unit's **current equipment stance**. Units pursue and engage enemies. |
| `2` | **Charge** | Aggressive pursuit with sprinting while stamina allows. It does not add a separate tactical damage multiplier. |
| `3` | **Defend** | Hold position. Units may face and attack enemies already within the valid range of their current weapon, but do not chase; mounted archers do not orbit. |
| `4` | **Formation** | Choose a destination with the center crosshair. Units move into deterministic ranks, then automatically switch to **Defend** after the active formation participants arrive. |
| `` ` `` | **Back** | Return to the previous command-menu level without issuing a new order. The same key selects ALL from the troop list. |

### Formation placement

After choosing **Formation**:

1. Keep using the mouse to aim the center crosshair at the desired terrain position.
2. The game displays a live formation preview.
3. Press `E`, left-click, or middle-click to confirm.
4. Press `` ` `` to return to the command menu. Formation placement intentionally does not use `Esc`, because `Esc` releases pointer lock.
5. Blocked or otherwise invalid placements are rejected.

A single troop group uses ranks of up to **10 units per row**. **ALL** uses up to **50 units per row**. The final row is centered, and the formation faces the camera's horizontal direction at confirmation time.

### Viking Charge stance

For Viking foot **Veterans, Spearmen, and Archers**, Charge also changes the active combat stance:

- **Charge** switches them to sword-kind melee with no shield.
- **Attack after Charge** keeps that current sword/no-shield stance.
- **Defend** restores their specialist equipment: Veteran shield, Spearman lance, or Archer bow.
- **Formation** ends in Defend after arrival, so it also restores those defensive/specialist loadouts when the formation completes.

Roman units and Viking cavalry keep their normal equipment behavior when commands change.

## 🏹 Combat & RPG Systems

SagaBurst currently includes:

- **Melee combat** — daggers, swords, greatswords, and lances
- **Archery** — aim, draw, and release bow attacks
- **Pilum throwing** — Roman ranged throwing attacks with dedicated input behavior
- **Mounted combat** — cavalry Lance charges and mounted ranged combat
- **Tiered equipment** — T1 / T2 / T3 Viking and Roman gear with distinct combat values
- **Shields** — Viking round shields and Roman scuta
- **Equipment pickups** — collect camp equipment with `E`
- **Arrow supplies** — refill ranged ammunition from camp pickups
- **Horses** — mount and dismount available horses with `E`
- **Character progression** — player combat feeds the existing RPG skill and progression systems
- **Save / Load** — restores progression, inventory, equipped shield, mounted state, mount appearance, and mount position

## 🏕️ Battle Camps

Normal Custom Battles include a support camp for each faction.

Each camp provides player-usable equipment, including:

- T1 / T2 / T3 melee weapons
- T1 / T2 / T3 ranged weapons
- T1 / T2 / T3 shields
- one Lance
- arrow supplies
- five spare horses

Mounted troops use their own assigned mounts. The five spare horses at each camp are separate and remain available to the player.

## ⚖️ Combat Rules & Balance

Combat behavior is evaluated from the unit's **current equipment and mount state**, not from a permanent runtime class identity.

| Rule | Current behavior |
| --- | --- |
| Default HP | Player 200 / NPC 200 |
| Lance progression | T1 30 / T2 45 / T3 60 base damage, 3.9m reach |
| Foot Lance anti-cavalry | Unmounted Lance attacker vs a **currently mounted** target: ×2 damage. The bonus ends after the target dismounts. |
| Mounted Lance charge | Mounted Lance attack above 10 m/s: ×3 damage |
| Charge + Horse Impact | A successful Lance charge suppresses Horse Impact for that same frame so damage does not double-dip; a missed Lance attack does not suppress impact |
| Horse Impact | All controlled mounts can damage hostile targets above 4 m/s using `round(8 + speed × 1.5 × sprintMultiplier)`; sprint multiplier is ×1.5 and same-target cooldown is 0.6s |
| Berserker condition | Viking + on foot + active Sword combat state + no shield: move speed ×1.3, melee damage ×1.2, melee attack rate ×1.2 |
| Bow | Damage ×0.5, attack rate ×1.3, NPC engagement range 50m on foot / 15m mounted |
| Javelin | Damage ×1.5, attack rate ×0.7, NPC engagement range 30m on foot / 15m mounted |
| Shields | T1 10% / T2 15% / T3 20% damage reduction. While mounted, shield reduction is applied before damage is routed to the horse. |

Mounted targets route incoming combat damage to the horse first. When the horse dies, the rider dismounts and subsequent anti-cavalry checks use the rider's new unmounted state.

## 🧪 Developer / QA

Normal gameplay is fully driven by Custom Battle configuration. There is no separate hardcoded **Standard** battle mode.

### Large-battle profiling scenarios

The `devcombat` mode includes reproducible battle presets used for performance profiling:

| Query | Scenario |
| --- | --- |
| `?devcombat=a` | 50 vs 50 infantry control scenario |
| `?devcombat=b` | 100 vs 100 infantry scaling scenario |
| `?devcombat=c` | 100 vs 100 mixed army scenario |
| `?devcombat=d` | 100 vs 100 cavalry / horse-archer stress scenario |
| `?devcombat` | Legacy fixed 50 vs 50 mounted developer scenario |

`devcombat` exposes a runtime profiling HUD with:

- wall-clock FPS
- CPU frame work
- NPC update time
- collision time
- projectile / impact work
- renderer submit time
- draw calls
- triangle count
- horse count
- LOD statistics

Current profiling shows that large-battle performance is primarily constrained by the **render path / draw-call pressure**, while entity collision cost is comparatively small.

The profiling infrastructure is intentionally separated from normal gameplay and only runs in developer combat mode.

### Other QA modes

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
http://localhost:5173/?devmodels=humans&nolock
http://localhost:5173/?devmodels=mounts&nolock
```

## 🧱 Combat Data Architecture

Combat values are split into authoritative data sources instead of being hardcoded across Player / NPC / UI code:

- `src/rpg/WeaponDatabase.ts` — weapon base stats and `combatKind`
- `src/combat/CombatBalance.ts` — HP defaults, multipliers, ranges, cooldowns, Lance rules, Berserker rules, and Mount Impact formula
- `src/battle/UnitPresetCatalog.ts` — faction unit presets and T1 / T2 / T3 starting loadouts
- `src/combat/DamageRouter.ts` — shared shield, rider, mount, death, and dismount damage routing
- `src/combat/MountImpact.ts` — shared swept-path mount impact resolution for Player and NPC cavalry

The intended runtime model is:

```text
Unit + Faction + Current Equipment + Current Mount State + CombatBalance
= Current Combat Behavior
```

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

## 🗺️ Roadmap

- **T4 Elite units — not implemented yet.** Future faction-specific elites may include concepts such as a shield-bearing Viking **Varangian Captain** and a Roman **Centurion**. The goal is to add distinct elite battlefield roles rather than simply scaling T3 stats upward.
- Continue improving 200 vs 200 combat behavior, cavalry interactions, animation fidelity, and render-path performance.

## 🚧 Project Status

SagaBurst is an actively evolving 3D action RPG prototype focused on large AI battles, melee and ranged combat, mounted gameplay, equipment progression, and browser-based 3D character systems.

The game currently supports Custom Battles from **1 vs 1 up to 200 vs 200 AI troops**, including infantry, ranged units, cavalry, and mounted ranged units across three equipment tiers.

Current development is centered on improving combat behavior, animation fidelity, large-battle rendering performance, and the Custom Battle experience.
