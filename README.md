# SagaBurst 3D Game

**English** | [繁體中文](./README.zh-TW.md)

**SagaBurst** is a browser-based 3D action game about fighting alongside and commanding large Viking and Roman armies.

The README focuses on what players need to know: **how to start, available game modes, controls, and army commands**.

## 🚀 Quick Start

SagaBurst currently targets **desktop browsers with keyboard + mouse**.

```bash
git clone https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game.git
cd SagaBurst-3D-Game
npm ci
npm run dev
```

Open the local URL printed by Vite.

When a battle starts, click the game view to capture the mouse. Press `Esc` to release the cursor, then click the game again to resume camera control.

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

Start a persistent career as a Roman or Viking.

- Choose a faction and starter weapon.
- Explore your faction town.
- Talk to service NPCs with `E`.
- Manage owned equipment through the character/inventory UI.
- Talk to the Sergeant Major (士官長) for Recruit clearance, patrol, and Town Defense missions, arrow resupply, and deployment guidance. The Sergeant Major fights on foot as a T3 defender in Town Defense. Promoted ranks retain access to unlocked Recruit missions.
- Assemble with the captain, follow the guide arrow, fight with the patrol, and return to town after victory.
- Bandits patrol their camps until they notice an approaching threat or are attacked.
- Contribute damage and kills to earn mission merit.
- Buy T1–T3 horses in sequence, then press `Tab` and use the Mount section to ride, switch, or dismiss an owned mount.
- Earn promotion eligibility through missions and ask the captain to appoint the next rank. An appointed Captain or Commander uses the faction's T4 hero.

### 🐈 Hero Mount Free Ride

Choose the hero-mount ride option from the main menu to test special mounts such as the **Black Cat** or **Corgi** in an open riding area.

Free ride uses the normal movement, sprint, jump, and mount controls.

## 🕹️ Controls

| Control | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Look / control camera |
| `Shift` | Sprint |
| `Space` | Jump |
| Left Mouse Button | Melee attack when not aiming |
| Hold Right Mouse + hold/release Left Mouse | Aim / draw / fire Bow |
| Hold Right Mouse + click Left Mouse | Aim / throw Pilum |
| `E` | Interact / pick up equipment / mount / dismount |
| `Tab` or `I` | Character and inventory |
| Mouse wheel | Switch owned melee weapons; in command mode, select targets or orders |
| `Q` | Enter command-wheel mode / go back one command level |
| Middle Mouse Button | Confirm the highlighted command target or order |
| `Esc` | Close UI / release mouse lock |

### Ranged combat

- **Bow:** hold Right Mouse to aim, hold Left Mouse to draw, then release Left Mouse to fire.
- **Pilum:** hold Right Mouse to aim, then click Left Mouse to throw.
- Right Mouse enters first-person ranged aiming. Bow aiming stays active while Right Mouse remains held; Pilum returns to third person after the throw.

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
- Career keeps its own faction, rank, merit, and owned equipment progress.
