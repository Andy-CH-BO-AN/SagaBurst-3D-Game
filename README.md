# SagaBurst 3D Game

**English** | [繁體中文](./README.zh-TW.md)

**SagaBurst** is a browser-based 3D action RPG prototype built with **Three.js**, **TypeScript**, and **Vite**.

The current gameplay entry point is **Custom Battle**: configure Viking and Roman armies, choose troop types and tiers, then join the Viking side as the player while both AI armies automatically engage on the battlefield.

## ⚔️ Custom Battle

Each side can field **1–50 AI troops**. Viking and Roman army sizes can be asymmetric, including scenarios such as `1 vs 50`.

Each faction can be configured independently across four unit roles and three tiers:

| Unit | Role |
| --- | --- |
| Infantry | Foot melee unit |
| Archer | Foot ranged unit |
| Cavalry | Mounted melee / lancer unit |
| Horse Archer | Mounted ranged unit |

Every unit role supports **T1 / T2 / T3**. Higher tiers use stronger faction-appropriate equipment and damage values.

Quick presets are available for **10 vs 10**, **25 vs 25**, and **50 vs 50**, or you can build an army manually with the setup controls.

The player is an additional Viking participant and does **not** count toward the configured Viking AI army total or victory condition.

### Battle flow

1. Open the game and configure both armies in the Custom Battle Setup screen.
2. Click **START BATTLE**.
3. The two AI armies spawn in deterministic formations and automatically move to engage each other.
4. Fight alongside the Viking army using melee weapons, bows, shields, lances, and horses.
5. A battle ends when either configured AI army is eliminated.
6. Use **REMATCH** to replay the same configuration or **BACK TO SETUP** to build another battle.

If both AI armies are eliminated at the same time, the result is a **DRAW**.

## 🐎 Player Starting Loadout

Normal Custom Battles now start the player as a fully equipped Viking heavy cavalry fighter, already mounted on a warhorse at the Viking spawn point.

Default equipment:

- **Steel Lance** — equipped melee weapon for mounted combat and high-speed lance charges.
- **Elven Runebow** — equipped Tier 3 ranged weapon.
- **Round Shield T3** — equipped Viking shield.
- **Runic Greatsword** — carried in the inventory as an alternate Tier 3 melee weapon.

After dismounting, open the Equipment UI with `Tab` or `I` to switch from the lance to the Runic Greatsword. The existing two-handed weapon behavior automatically moves the equipped shield to the player's back while the greatsword is in use.

The player's starting horse is separate from the five spare horses in the Viking camp. Mounted save/load also preserves the player's mounted state and the mount's world position, while legacy saves keep their existing inventory instead of being automatically upgraded to the new elite loadout.

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
| Left Mouse Button | Melee attack |
| Hold Right Mouse Button + Left Mouse Button | Aim / shoot bow |
| `E` | Pick up equipment / mount horse / dismount |
| `Tab` or `I` | Open character & inventory |
| `0` | Open game menu |
| `Esc` | Close UI / release pointer lock |

## 🏹 Combat & RPG Systems

- **Melee combat** — use daggers, swords, greatswords, and lances.
- **Archery** — hold right mouse to aim, then use the left mouse button to draw and fire.
- **Mounted combat** — cavalry can charge with lances while mounted ranged units fight from horseback.
- **Tiered equipment** — T1 / T2 / T3 weapons and ranged equipment have distinct combat values.
- **Shields** — Viking round shields and Roman scuta are available from battle camps.
- **Equipment pickups** — approach camp equipment and press `E` to collect it.
- **Arrow supplies** — refill ranged ammunition from camp supply pickups.
- **Horses** — approach an available horse and press `E` to mount; press `E` again to dismount.
- **Character progression** — player combat continues to feed the existing RPG skill and progression systems.
- **Save / Load** — saves restore player progression, inventory, equipped shield, mounted state, mount appearance, and mount position.

## 🧪 Developer / QA Modes

The main gameplay URL always uses Custom Battle Setup unless a developer scene mode is explicitly requested.

| Query | Purpose |
| --- | --- |
| `?devcombat` | Fixed 50 vs 50 mounted combat / performance scenario using the shared battle spawner; no camps or spare camp horses |
| `?devmodels=humans` | Humanoid model / animation studio |
| `?devmodels=mounts` | Horse, saddle, rider, gait, jump, and dismount QA studio |
| `?legacyhumanoids` | Use the legacy humanoid rendering path as a modifier |
| `?nolock` | Disable normal pointer-lock requirements for browser QA |

Examples:

```text
http://localhost:5173/?devcombat&nolock
http://localhost:5173/?devmodels=humans&nolock
http://localhost:5173/?devmodels=mounts&nolock
http://localhost:5173/?devcombat&legacyhumanoids&nolock
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

## 🚧 Project Status

SagaBurst is an actively evolving 3D action RPG prototype focused on large AI battles, melee and ranged combat, mounted gameplay, equipment progression, and browser-based 3D character systems.

Current development is centered on improving battle quality, combat behavior, animation fidelity, performance, and the Custom Battle experience.
