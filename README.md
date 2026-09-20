# SagaBurst 3D Game

**English** | [繁體中文](./README.zh-TW.md)

**SagaBurst** is a browser-based 3D action RPG prototype built with **Three.js**, **TypeScript**, and **Vite**.

The current gameplay entry point is **Custom Battle**: configure Viking and Roman armies, choose troop types, tiers, battle deployment mode, Player Faction, and the player's starting loadout, while both AI armies automatically engage across a large battlefield.

## ⚔️ Custom Battle

Each side can field **1–200 AI troops**. Viking and Roman army sizes can be asymmetric, including scenarios such as `1 vs 200` or `200 vs 1`.

Each faction has its own unit preset catalog. Every preset supports **T1 / T2 / T3**, with the preset defining the starting loadout while live combat behavior is determined by the unit's current weapon, shield, mount state, and combat rules.

**Viking presets**

| Unit | Battlefield role |
| --- | --- |
| Viking Veteran | Shielded sword infantry with same-tier round shield |
| Spearman | Foot Lance anti-cavalry unit with a same-tier sword sidearm |
| Archer | Foot Bow unit with a fixed T1 dagger fallback |
| Sword Cavalry | Mounted sword + round-shield unit |
| Lancer | Mounted Lance unit built around high-speed charge attacks |
| Mounted Archer | Mounted Bow unit with a fixed T1 dagger fallback |

**Roman presets**

| Unit | Battlefield role |
| --- | --- |
| Heavy Infantry | Gladius + Scutum defensive frontline |
| Spearman | Foot Lance anti-cavalry unit |
| Archer | Foot Bow unit with a fixed T1 Gladius fallback |
| Javelin Infantry | Pilum/Javelin ranged unit with a fixed T1 Gladius fallback |
| Sword Cavalry | Mounted Gladius + Scutum unit |
| Lancer | Mounted Lance charge unit |
| Mounted Archer | Mounted Bow unit with a fixed T1 Gladius fallback |

Quick presets are available for **10 vs 10**, **25 vs 25**, **50 vs 50**, **100 vs 100**, and **200 vs 200**, or you can build an army manually with the setup controls.

Battle deployment is selected independently from army size:

- **Formation Battle** — Viking and Roman armies spawn in deterministic formations on opposite sides of the battlefield.
- **Scattered Battle** — the Player, Viking NPCs, and Roman NPCs are deterministically scattered across the battlefield while normal Viking-vs-Roman faction, friendly-fire, and victory rules remain unchanged.

Player faction is selected independently from army composition and deployment mode:

- **Viking Player** — Viking NPCs are allies, Roman NPCs are enemies, and Formation Battle starts the player on the Viking (+Z) side facing the Roman army.
- **Roman Player** — Roman NPCs are allies, Viking NPCs are enemies, and Formation Battle starts the player on the Roman (-Z) side facing the Viking army.

Changing an army preset only changes army composition; it preserves the selected **Battle Mode**, **Player Faction**, **Player Loadout**, and **Spectator** setting.

The player is an additional participant on the selected side and does **not** count toward that faction's configured 1–200 AI troop total or the army-survival victory count. Player HP is independently configurable from **1–9999** in Army Setup; the default Player and NPC HP is **200**.

### Battle flow

1. Open the game and use **Army Setup** to configure both armies, Player Faction, and **Formation Battle** or **Scattered Battle**.
2. Open **Player Loadout** and choose a melee weapon, ranged weapon, shield (or no shield), and whether to start **Mounted** or **On Foot**.
3. Optional: enable **Spectator** to enter the battle directly with a free-flying camera instead of spawning a player character or starting horse.
4. Click **START BATTLE**.
5. Actors spawn according to the selected deployment mode: opposite-side formations in Formation Battle, or deterministic mixed positions across the battlefield in Scattered Battle. The AI armies then automatically engage.
6. Fight alongside the selected allied army using swords, gladii, lances, bows, pila, shields, and horses.
7. A battle ends when either configured AI army is eliminated.
8. Use **REMATCH** to replay the same battle configuration or **BACK TO SETUP** to build another battle.

If both AI armies are eliminated at the same time, the result is a **DRAW**.

## 🧰 Player Loadout & Starting State

Custom Battle now has a dedicated **Player Loadout** page. Before starting the battle, choose exactly one melee weapon, one ranged weapon, an optional shield, and whether the player begins **Mounted** or **On Foot**.

Player equipment is independent from Player Faction, so Viking and Roman gear can be mixed freely:

- **Melee** — Viking swords, Roman gladii, or T1 / T2 / T3 Lances.
- **Ranged** — Viking bows or Roman pila.
- **Shield** — Viking round shields, Roman scuta, or no shield.
- **Starting state** — **Mounted** creates and mounts the normal starting horse; **On Foot** does not create the special starting horse.

An explicit custom loadout gives the player only the selected starting equipment rather than also granting unrelated top-tier gear. Army presets and Reset preserve the selected Player Loadout.

Bow and Pilum controls intentionally differ: bows use the existing draw-and-release flow, while a Pilum is aimed with the right mouse button and committed with a left click. Entering ranged aim still unequips an equipped shield using the existing ranged-weapon behavior.

For backward compatibility, battle configurations that do not contain `playerLoadout` keep the legacy default start: **Steel Lance**, **Elven Runebow**, **Round Shield T3**, and mounted. Initial Spectator mode overrides the loadout and does not create a starting horse.

The player's starting horse is separate from the spare horses placed in the faction camps. **Player death is permanent for the current battle**: after dying, the player does not respawn and instead switches to free spectator mode while the remaining Viking and Roman NPCs continue fighting until the battle ends. REMATCH starts a fresh battle using the same configuration. Mounted save/load continues to preserve the player's mounted state and the mount's world position, while loaded save inventory overrides fresh-battle starting equipment.

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

### Combat data architecture

Combat values are intentionally split into authoritative data sources instead of being hardcoded across Player / NPC / UI code:

- `src/rpg/WeaponDatabase.ts` — weapon base stats and `combatKind`.
- `src/combat/CombatBalance.ts` — HP defaults, multipliers, ranges, cooldowns, Lance rules, Berserker rules, and Mount Impact formula.
- `src/battle/UnitPresetCatalog.ts` — faction unit presets and T1 / T2 / T3 starting loadouts.
- `src/combat/DamageRouter.ts` — shared shield, rider, mount, death, and dismount damage routing.
- `src/combat/MountImpact.ts` — shared swept-path mount impact resolution for Player and NPC cavalry.

The intended runtime model is:

```text
Unit + Faction + Current Equipment + Current Mount State + CombatBalance
= Current Combat Behavior
```

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
| `?devcombat=d` | 100 vs 100 cavalry / horse-archer stress scenario |
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
http://localhost:5173/?devmodels=humans&nolock
http://localhost:5173/?devmodels=mounts&nolock
```

There is no separate hardcoded **Standard** battle mode. Normal gameplay is fully driven by Custom Battle configuration.


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
