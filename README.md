# SagaBurst 3D Game

**English** | [繁體中文](./README.zh-TW.md)

A browser-based 3D action RPG prototype built with **Three.js**, **TypeScript**, and **Vite**.

The current in-game title is **Warriors: Dedicate Your Heart!**. Explore the battlefield, fight enemies with melee weapons or a bow, collect equipment, ride horses, and build your character through combat.

## 🎮 How to Play

### 1. Install and run

You need **Node.js** and **npm** installed.

```bash
git clone https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game.git
cd SagaBurst-3D-Game
npm ci
npm run dev
```

Open the local URL printed by Vite in your browser, then click **CLICK TO START** to lock the mouse and enter the game.

> The game is designed for desktop keyboard + mouse controls.

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
| `Esc` | Close menu / inventory or release pointer lock |

## ⚔️ Gameplay

- **Melee combat** — fight enemies using swords and other melee weapons.
- **Archery** — hold right mouse to aim, then use the left mouse button to draw and fire.
- **Equipment pickups** — explore the world and press `E` near dropped equipment to collect it.
- **Weapon progression** — different melee weapons, bows, and shields are available across multiple tiers.
- **Arrow supplies** — collect arrow supply pickups when your quiver runs low.
- **Mounts** — approach a horse and press `E` to ride it. Press `E` again to dismount.
- **Mounted movement** — horses use the same movement controls, including sprinting and jumping.
- **Character progression** — combat feeds the RPG skill/progression systems shown in the character screen.
- **Save / Load** — press `0` or use the top-left menu to save or restore your progress.

## 🏹 Getting Started In-Game

1. Click the screen to start and capture the mouse.
2. Move around with `WASD` and use the mouse to look around.
3. Find enemies and attack with the left mouse button.
4. For ranged combat, hold the right mouse button to aim and use the left mouse button to fire.
5. Look for weapons, shields, bows, and arrow supplies around the map; press `E` to collect them.
6. Approach a horse and press `E` to mount it.
7. Open `Tab` / `I` to inspect your character, skills, inventory, and equipment.
8. Use the `0` menu to save your progress before leaving.

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

This project is actively evolving as a 3D action RPG prototype. Character models, combat animations, mounted gameplay, AI, equipment, and other gameplay systems may continue to change as development progresses.
