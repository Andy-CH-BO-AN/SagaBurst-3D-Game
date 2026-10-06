# SagaBurst 3D Game

**English** | [繁體中文](./README.zh-TW.md)

**SagaBurst** is a browser-based 3D action game about fighting alongside and commanding large Viking and Roman armies.

The README focuses on what players need to know: **how to start, available game modes, controls, and army commands**.

## 🚀 Quick Start

SagaBurst is designed for **desktop computers with keyboard + mouse**.

### Play Online

[Play SagaBurst in your browser](https://andy-ch-bo-an.github.io/SagaBurst-3D-Game/) — no installation required. The production site becomes available after the first `main` deployment.

### Download

[Download SagaBurst from GitHub Releases](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/releases).

- **Windows x64:** extract the ZIP and double-click `SagaBurst.exe`. Keep the extracted files together.
- **macOS Apple Silicon:** extract the ZIP, move `SagaBurst.app` to Applications, and open it.

The first v1.0.0 downloads appear after release publication. These builds are unsigned. macOS may require right-click → Open, or **System Settings → Privacy & Security → Open Anyway** after the first attempt. Windows may show Microsoft Defender SmartScreen; choose **More info → Run anyway** if you trust the download.

Career and Campaign use local saves. Browser and desktop saves are separate; v1 does not sync them. Clearing browser site data or the desktop app's user data removes those saves.

When a battle starts, click the game view to capture the mouse. Press `Esc` to release it, then click again to resume camera control.

### Development

Use Node.js 22 or later. Open feature PRs against `dev`.

```bash
git clone --branch dev https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game.git
cd SagaBurst-3D-Game
npm ci
npm run dev
```

Open the local URL printed by Vite. Use `npm test` and `npm run build` to validate changes, or `npm run desktop` to open the desktop build locally. Maintainers: see the [release guide](./docs/RELEASING.md).

## 🎮 Game Modes

### ⚔️ Custom Battle

Build your own Viking vs Roman battle.

- Configure **1–200 AI troops per side**.
- Mix infantry, ranged units, cavalry, and mounted ranged units.
- Choose **Formation Battle** or **Scattered Battle** deployment.
- Choose the player's faction, weapons, shield, and mounted/on-foot start.
- Start as the player or enable **Spectator** to watch the AI battle.
- Use **Preset** or **Squad** command grouping before deployment.

The player joins the selected faction as an additional fighter and does not count toward the configured AI troop total.

### 🏰 Defense Campaign

Choose **Roman Defense** or **Viking Defense** and defend the faction outpost.

- Each faction has **9 stages**.
- Winning unlocks the next stage.
- Roman and Viking progression are saved separately.
- Each stage changes the available defender force and the enemy assault.
- You can organize defenders into squads before battle when Squad grouping is enabled.

### 🏘️ Career

Start a persistent career as a Roman or Viking and progress from a new recruit into an officer with your own troops.

- Choose a faction and starter weapon, then explore your faction's **fortified Career Town** with walls, four gates, training grounds, shops, barracks, guards, and cavalry patrols.
- Talk to service NPCs with `E`, buy and manage equipment and mounts, and use the character/inventory UI for your persistent loadout.
- Take rank-based missions including bandit clearing, patrols, Outpost battles, cavalry operations, Town Defense, Veteran missions, and a **four-gate Enemy Town Assault**. Promotion keeps earlier mission tiers available.
- The town outskirts remain active outside missions: patrols, Bandits, and hostile forces can encounter and fight each other naturally.
- Build five persistent combat skills: **One-Handed, Two-Handed, Ranged, Mounted Impact, and Blocking**. Each can reach level 50, and Career keeps the progress between missions and town visits.
- Once promoted to **Captain** or **Commander**, visit the **HR Center** to build a **Personal Squad** of up to 30 troops. Recruit members, manage their equipment, deploy them with **Follow me**, and send them back with **Dismiss** to return and refit.
- Your Personal Squad can accompany you into Career missions and contribute to your command merit while remaining your persistent troops.
- Earn merit through combat and missions, unlock higher ranks and equipment tiers, and keep your faction, rank, merit, inventory, mounts, skills, and Personal Squad across the Career.

### 🐈 Hero Mount Free Ride

Choose the hero-mount ride option from the main menu to test special mounts such as the **Black Cat** or **Corgi** in an open riding area.

Free ride uses the normal movement, sprint, jump, and mount controls. These special mounts can also be purchased in Career after their unlock requirements are met.

## 🕹️ Controls

| Control | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Look / control camera |
| `Shift` | Sprint |
| `Space` | Jump |
| Left Mouse Button | Melee attack when not aiming |
| Hold Right Mouse | Raise shield, or aim with a ranged weapon |
| Hold Right Mouse + hold/release Left Mouse | Draw / fire Bow |
| Hold Right Mouse + click Left Mouse | Throw Pilum |
| `E` | Interact / pick up equipment / mount / dismount |
| `Tab` or `I` | Character and inventory |
| Mouse wheel | Switch owned weapons / shields; in command mode, select targets or orders |
| `Q` | Enter command-wheel mode / go back one command level |
| Middle Mouse Button | Confirm the highlighted command target or order |
| `Esc` | Close UI / release mouse lock |

### Ranged combat

- **Bow:** hold Right Mouse to aim, hold Left Mouse to draw, then release Left Mouse to fire.
- **Pilum:** hold Right Mouse to aim, then click Left Mouse to throw.
- Right Mouse enters first-person ranged aiming. Bow aiming stays active while Right Mouse remains held; Pilum returns to third person after the throw.

### Shield combat

- Hold Right Mouse while a shield is equipped to raise it.
- A shield only protects you when an attack or projectile physically hits the raised shield; attacks that reach the body from another angle still deal normal damage.
- Shields have limited impact durability during battle, and stronger axe hits consume more of it.
- **Blocking** is a persistent combat skill in Career and improves as you successfully block attacks.

## 📯 Army Commands

You can command one troop group, one squad, or the whole army depending on the grouping chosen before deployment.

### Mouse-wheel command flow

1. Press `Q` to enter command mode.
2. Use the mouse wheel to highlight a troop group, squad, or **ALL**.
3. Press Middle Mouse Button to select it.
4. Use the mouse wheel to choose **Attack**, **Charge**, **Defend**, or **Formation**.
5. Press Middle Mouse Button to issue the selected order.
6. Press `Q` to return to the previous command level or leave command selection.

### Keyboard shortcuts

| Viking | Group | Roman | Group |
| --- | --- | --- | --- |
| `1` | Viking Veteran | `1` | Heavy Infantry |
| `2` | Spearman | `2` | Spearman |
| `3` | Archer | `3` | Archer |
| `4` | Sword Cavalry | `4` | Javelin Infantry |
| `5` | Lancer | `5` | Sword Cavalry |
| `6` | Mounted Archer | `6` | Lancer |
| — | — | `7` | Mounted Archer |
| <kbd>&#96;</kbd> | ALL | <kbd>&#96;</kbd> | ALL |

After selecting a command target:

| Key | Order | What it does |
| --- | --- | --- |
| `1` | **Attack** | Pursue and fight enemies normally |
| `2` | **Charge** | Aggressively pursue enemies and sprint when possible |
| `3` | **Defend** | Hold the current position and fight enemies that enter range |
| `4` | **Formation** | Move the selected troops into a formation at a chosen location |
| `Q` | **Back** | Return to the previous command level |

When commanding your **Personal Squad** in Career, the command menu also provides:

| Key | Order | What it does |
| --- | --- | --- |
| `5` | **Follow me** | Regroup deployed Personal Squad members on the player |
| `6` | **Dismiss** | Send the Personal Squad back to the HR Center to return and refit |

### Formation placement

After choosing **Formation**:

1. Aim the center crosshair at the desired ground position.
2. Check the formation preview.
3. Press `E`, Left Mouse Button, or Middle Mouse Button to confirm.
4. Press `Q` to cancel and return to the command menu.

Blocked or invalid positions cannot be confirmed.

## ☠️ Battle & Progress Notes

- In **Custom Battle**, player death switches you to spectator mode while the remaining armies keep fighting.
- Use **REMATCH** to replay the same Custom Battle setup.
- Custom Battle unit presets currently use **T1 / T2 / T3** equipment tiers.
- Battlefield camps provide equipment, ammunition, and spare horses that the player can use.
- Defense Campaign progress is saved separately for Roman and Viking.
- Career keeps its own faction, rank, merit, equipment, mounts, combat skills, and Personal Squad progress.

Bows and javelins cannot be equipped together with a shield; wheel selection stows the conflicting item. The same equipment-wheel behavior is used in Career towns and missions.
