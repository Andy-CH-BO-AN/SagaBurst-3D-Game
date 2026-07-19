# Project Rules & Agent Guidelines

Welcome to the **3D Web Action RPG (A Tribute to Skyrim)** project!
If you are an AI agent picking up this project, please read these guidelines carefully to quickly get up to speed.

## 1. Core Architecture & Design Philosophy
- **No External 3D Models**: The project strictly uses procedural Three.js geometries (e.g., `CapsuleGeometry`, `BoxGeometry`, `ConeGeometry`). We intentionally avoid `.gltf` or `.fbx` models due to animation complexities. Check `CharacterVisuals.ts` and `WeaponDatabase.ts`/`Player.ts` for how weapons and characters are built.
- **Vanilla Three.js**: No React Three Fiber. Everything is handled via direct DOM manipulation and vanilla Three.js scene graphs.
- **Custom Physics Engine**: We do not use Ammo.js, Cannon.js, or Rapier. All physics (gravity, collision, Raycasting, heightmap matching) are handled manually using pure Math and line-segment / sphere intersection tests. See `Terrain.ts` (`getTerrainHeight`, `resolveObstacleCollision`) and `Game.ts`.
- **Pure Web Audio API**: No external sound files. All audio (swords, bows, hit impacts, UI chimes) are procedurally synthesized using `AudioContext` oscillators and noise buffers. See `SoundManager.ts`.

## 2. Key Systems to Understand
- **Game.ts**: The master orchestrator. Handles the main game loop (`requestAnimationFrame`), entity updates, global collision detection, and UI integration.
- **NPC.ts**: Universal entity class for both enemies (Bandits, Romans) and allies (Vikings). Driven by a Finite State Machine (IDLE, ALERT, CHASE, ATTACK). They can generate as Cavalry.
- **Mount.ts**: Entities that provide high-speed movement and impact damage. Player and NPCs can both ride them. Damage is intelligently routed to the mount's HP pool while riding.
- **Player.ts & PlayerInput.ts**: Handles the capsule avatar, pointer lock camera rotation, jumping, attacking, and drawing bow strings.
- **RPG Systems**: Look at `WeaponDatabase.ts` for all weapon configurations, `InventoryManager.ts` for items owned, and `SkillManager.ts` for XP and level-ups.

## 3. Important Implementation Rules
- **Maintain Naming Conventions**: Keep consistent naming for HTML DOM IDs (kebab-case) and TypeScript classes/variables (PascalCase/camelCase).
- **Z-Axis is Forward (in some contexts)**: Pay close attention to `Math.atan2(dx, dz)`. Usually, Three.js defaults to -Z as forward, but ensure you match the existing trigonometric logic in `NPC.ts` or `Mount.ts`.
- **DOM Overlay over WebGL**: All UI (Health bars, Stamina bars, Inventory Grid) is purely HTML/CSS overlaid on top of the `<canvas>`. Do NOT try to build UI using `three-mesh-ui` or 3D text unless specifically requested. Update DOM elements inside `Game.ts` or dedicated UI classes.
- **Document Changes**: 每次做完事，都必須檢查並更新 `ARCHITECTURE.md` 和 `PROGRESS.md` 來反映最新的系統架構改動。

## 4. How to Start a New Task
1. Read `PLAN.md` to see the roadmap context.
2. Read `PROGRESS.md` to know what was recently implemented.
3. Use `grep_search` to find relevant methods (e.g., `takeDamage`, `rebuildWeapon`).
4. Apply surgical edits to existing files using the provided tools.
5. If the logic gets too complex, add debug logging (`console.log`) or use visual debug meshes (e.g., drawing a sphere at the collision point) to verify math.

*Dedicate your heart, and happy coding!*
