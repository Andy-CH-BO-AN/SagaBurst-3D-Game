# SagaBurst 3D Game

**English** | [繁體中文](./README.zh-TW.md)

Fight alongside Viking and Roman armies, command troops, build a persistent military career, and take to the skies on a giant eagle. **SagaBurst** is a 3D action game for desktop computers with a keyboard and mouse.

## Play

[**Play in your browser**](https://andy-ch-bo-an.github.io/SagaBurst-3D-Game/) · [**Download the desktop game**](https://github.com/Andy-CH-BO-AN/SagaBurst-3D-Game/releases/latest)

This guide describes the current repository version. The hosted game and desktop releases may have an earlier set of features.

- **Windows x64:** extract the whole ZIP and open `SagaBurst.exe`. Keep the extracted files together.
- **macOS Apple Silicon:** extract the ZIP, move `SagaBurst.app` to Applications, and follow the included [first-launch instructions](./MACOS-FIRST-LAUNCH.txt). The app is not Apple-notarized; you may need **System Settings → Privacy & Security → Open Anyway**.
- Windows builds are unsigned and may show SmartScreen. For the official download, choose **More info → Run anyway** if you trust it.

Desktop downloads include the game assets and work offline. No development tools are needed.

**First time playing?** Create a character in **Career** to start the recruit tutorial. Use **Training Ground** for free practice or **Custom Battle** to configure your own armies.

Click the game view to capture the mouse and control the camera. `Esc` releases the cursor; Career and Training Ground also offer a pause menu.

## Game modes

### Training Ground

Practice freely without spending merit or changing your Career progress.

- Try weapons, shields, and all four mounts: **Horse, Black Cat, Corgi, and xongkoro the giant eagle**.
- Test melee attacks and ranged shots on **0–100 m target dummies**, with a readout of your latest hit damage.
- Use the marked firing point and **125 m impact runway** to practice shooting and mounted charges.
- Open equipment with `Tab`; use **Refill** for supplies and **Reset Training** for a fresh setup.
- The `Esc` menu lets you switch between a normal warrior and the **T4 Shadow Warden Ranger**. Both can switch between ordinary melee weapons, ranged weapons, and shields; changing character returns you to the starting point.

Training does not award combat XP.

### Custom Battle

Create your own Viking vs Roman battle.

- Set **1–200 AI troops per side**, mixing infantry, archers, javelin troops, cavalry, and mounted archers.
- Choose **T1 / T2 / T3** regular troops and up to **three T4 heroes per side**. Heroes count toward the configured AI total.
- Choose **Formation Battle** or **Scattered Battle**, and group your commands by **Preset** (unit type) or **Squad**.
- Pick your faction, weapons, shield, character, and mount, or enable **Spectator** to watch the AI fight. Player characters include standard T1–T3 soldiers and T4 / T5 heroes; these choices are separate from the AI army's three-hero limit.
- In Squad grouping, organize up to **eight squads, with up to 30 troops each**, before starting.
- The player is an additional fighter outside the AI total. If you die, you can spectate the remaining battle; **REMATCH** replays the same setup.

### Defense Campaign

Choose **Roman Defense** or **Viking Defense** and defend your faction's outpost through **nine stages per faction**.

- Field up to **80–90 regular defenders**, depending on the stage, within its tier and cavalry limits. Add up to **one T4 hero** outside those limits; the player also takes no defender slot. Attackers field **100–200 regular troops plus two T4 heroes**.
- Organize defenders into squads before deployment. You have **60 seconds** to position them before the enemy assault begins.
- Defend the gate, walls, and ramparts against attackers and mobile siege ramps. **50 allied cavalry** deploy **120 seconds after the assault begins**, then ride into battle.
- Eliminate all attackers to win immediately. If the player and all original defenders fall before the reinforcement wave deploys, defeat is locked even though the battle can continue in spectator mode.
- Winning unlocks the next stage. Roman and Viking progress are saved separately.

### Career

Create a Roman or Viking character and rise through **Recruit → Soldier → Veteran → Captain → Commander**.

Choose your faction and starter weapon, then explore your fortified town and its surroundings. Press `E` near service NPCs to talk, including while mounted. Shops buy and sell weapons, shields, and mounts; `Tab` opens your character, inventory, and available squad equipment pages.

#### Progressive tutorials

New characters begin with movement, equipment, melee, shields, archery, and horse practice. Completing the practice awards **100 merit once**. Borrowed gear stays in the training scene. You can defer the tutorial and resume through the **Sergeant**.

The Sergeant then introduces buying a weapon (**20 merit once**) and sparring with the real Cavalry Captain (**500 for victory or 20 for a normal defeat**, once, without unlocking formal duel tiers). After two normally settled battle missions and enough available merit for a horse, the horse introduction awards **50 merit once** after purchase. Races remain optional: **Sergeant → 1v1 → Racing**.

Your first saved **Captain** appointment unlocks a **30 AI** command drill, followed by HR recruitment and **Personal Squad → Follow me**. Your first saved **Commander** appointment introduces the watchtower route, **ALL → Defend**, and an individual squad's Formation command on clear ground outside the tower.

Progress belongs to the current character. Tutorials can be resumed or replayed; replay does not repeat rewards. Existing characters retain their saves and can choose applicable tutorials through the Sergeant. Drills do not earn formal mission wins or permanent combat XP, or consume official troops and private squad resources.

#### Merit and appointments

Earn merit through Career combat contributions and race victories. Appointments use **merit earned during your current enlistment**, so spending available merit does not undo your eligibility or rank. Reaching a threshold makes you eligible; you must still speak to the appropriate NPC and accept the appointment.

| Rank | Merit required | Appointment |
| --- | --- | --- |
| Recruit | 0 | Starting rank |
| Soldier | 300 | Cavalry Captain |
| Veteran | 900 | Cavalry Captain |
| Captain | 5,000 | Cavalry Captain |
| Commander | 20,000 | Town Commander |

Commander unlocks T5 equipment and grants a faction-specific **T5 sword or axe** when appointed.

#### Missions and activities

- **Missions:** visit the **Sergeant** for bandit hunts, patrols, cavalry operations, Outpost defense and relief, town defense, Veteran battles, and a four-gate assault on the enemy town. Earlier mission tiers remain available after promotion. Complete the Soldier Outpost defense stages to unlock relief; winning relief unlocks the enemy-town assault.
- **Duels:** the Sergeant's **1v1** page lets you challenge a chosen unit type from **T1 through T5**. Each duel has five seconds of preparation and a 30-second fight limit; defeat a tier to unlock that unit type's next challenge. T5 challenges pit you against the town's Commander, with the Captain as referee.
- **Combat skills:** improve **One-Handed, Two-Handed, Ranged, Mounted Impact, and Blocking**, each up to level 50.
- **Living outskirts:** town patrols, bandits, and hostile ground and eagle patrols can encounter and fight each other outside formal missions.

The **Captain I–VI** mission page adds Patrol Command, Cavalry Command, Gate Defense, Frontline Commander, Siege Commander, and **Eagle Battle**. You command the troops assigned to you for each mission. Eagle Battle is **30 vs 30 giant eagles**, with your recruited Personal Squad joining as additional allies; it requires your own available xongkoro.

The **Commander I–V** page adds five missions after you formally accept Commander rank:

| Mission | Objective |
| --- | --- |
| I · Sky Raid | Lead **50 T4 Rangers on xongkoro** against the enemy town; defeat **100 different enemy-town residents**. |
| II · Operation Decapitation | Enter the enemy town with the former **T5 Commander and 29 T4 cavalry**; defeat the enemy's T5 Commander. |
| III · Outpost Last Stand | Deploy **120 infantry in four squads** during a **60-second** preparation window, then defeat **100 enemy cavalry**. |
| IV · Bridgehead Battle | Position **eight 25-person infantry squads (200 troops)** on the north bank during **180 seconds** of preparation; defend the bridge against **300 cavalry in 12 squads**. |
| V · Four-Gate Town Defense | Prepare for **180 seconds**, then face **200 ground attackers, eight siege ramps, and 30 eagle archers** at your town. Win by keeping at least one defender alive for **15 minutes after the assault begins**, or by defeating all **230 attackers**. |

#### Your troops

- **Captain:** command a **30-person official Town Command Squad** in town.
- **Commander:** command **eight official ground squads**, with an infantry squad and a cavalry squad for each of the north, south, east, and west gates. Native eagle patrols and watchtower archers defend autonomously.
- **Personal Squad:** at Captain or Commander, recruit up to **30 members** from the **HR Center**. Choose soldiers, T4 Captains, and T4 Rangers; Commander rank also unlocks **T5 Commander recruits**. Allocate weapons, shields, and mounts from your stock, use **Follow me** to deploy them, and **Dismiss** to send them back in town.
- **Civilian Squad:** as Commander in your own town, you can also order civilians and merchants when the group is available. Dismiss returns them to their normal duties.

Formal missions grant their own command authority and rosters. Check the command HUD for the troops assigned to you. Equipment changes can be locked during missions; in peacetime, ask HR to refit your Personal Squad or the Sergeant to refit eligible town squads.

#### Mounted circuit racing

Visit **Sergeant → 1v1 → Racing** for eight races against the town's Commander. Arrive riding a living, available **ground mount that you own**; xongkoro cannot enter. Racing and ground mounts have no rank requirement.

Follow the Captain to the north gate, stay inside the marked start area through the **10-second countdown**, then ride out through the north gate, around the **east → south → west** sides of the town, and back through the north gate. Follow all **five checkpoints**; cutting through the town or dismounting prevents a legal finish. The player can use `Shift` in every race.

| Race | Opponent's mount | Opponent's pace | Victory merit |
| --- | --- | --- | --- |
| I | Horse | Normal | 100 |
| II | Corgi | Normal | 400 |
| III | Snow Leopard | Normal | 900 |
| IV | Black Cat | Normal | 1,600 |
| V | Horse | Sprint | 2,500 |
| VI | Corgi | Sprint | 3,600 |
| VII | Snow Leopard | Sprint | 4,900 |
| VIII | Black Cat | Sprint | 6,400 |

Race results and your best legal finish times are saved. Races already accepted in an older save retain their original names and rewards; new entries use the eight-race schedule. Existing results and best times remain attached to the same mount and pace.

#### Mounts and flight

Visit the town's **Eagle Trainer** at Captain or Commander rank to buy **xongkoro** for **10,000 merit**. You can own up to three. Summon it in an open takeoff area, fly over the battlefield, attack with the eagle, or use ranged weapons from its back. Horse, Black Cat, and Corgi are also available from town shops as your rank unlocks them.

#### Retirement

After **10 Commander mission victories**, including at least one victory in **Four-Gate Town Defense**, speak to the town's **Commander** and choose **Apply for retirement (申請退休)**. Finish any mission or race first and apply while the town is peaceful. Read the in-game confirmation before accepting, then follow the on-screen guide.

### Units & Weapons

Open **Units & Weapons** from the main menu to compare unit traits, combat stats, weapons, and shields before choosing a loadout.

## Controls

| Control | Action |
| --- | --- |
| `W` `A` `S` `D` | Move; mounted steering depends on the mount |
| Mouse | Look / steer the eagle |
| `Shift` | Sprint / fly faster |
| `Space` | Jump on foot or on ground mounts |
| Left Mouse | Melee attack; eagle strike while riding xongkoro and not aiming |
| Hold Right Mouse | Raise an equipped shield, or aim a ranged weapon |
| Right Mouse + hold/release Left Mouse | Draw / fire a bow |
| Right Mouse + click Left Mouse | Throw a Pilum |
| `E` | Talk / interact / pick up equipment / mount / dismount |
| `Tab` | Character and inventory; equipment in Training Ground |
| `I` | Alternative inventory key in battles and Training Ground |
| Mouse wheel | Switch weapons / shields; select targets or orders in command mode |
| `Q` | Toggle the wheel between weapons and commands; close an order submenu / cancel formation placement; close Career panels |
| Middle Mouse | Confirm the highlighted command target or order |
| `G` | Open / close an outpost gate when gate control is available |
| `Esc` | Close UI / release the cursor; pause in Career and Training Ground |

**Spectator:** use movement keys and the mouse, `Space` / `Ctrl` to rise / descend, and `Shift` to move faster.

### Flying xongkoro

Press **`W` to take off**, steer with the **mouse**, use **`A` / `D` to turn**, and hold **`Shift` to accelerate**. The eagle keeps moving forward in flight. Hold **`S` to slow down**, approach open ground at low altitude, and land before dismounting safely. You can dismount in the air, but you will fall.

Left Mouse triggers an eagle strike when you are not aiming. Hold Right Mouse with a ranged weapon to aim from the rider's view, then fire normally. While aiming, you can look around within a limited arc; aiming toward its edge also turns the eagle.

### Combat tips

- **Bows:** hold Right Mouse to aim, hold Left Mouse to draw, then release Left Mouse to fire. Pilum uses a click while aiming.
- **Shields:** only attacks that physically hit the shield are blocked. Side and rear attacks can still hit your body, and shields have limited battle durability.
- Ranged weapons and shields cannot be equipped together; switching with the wheel stows the conflicting item.
- Battlefield camps provide equipment, ammunition, and spare horses.

## Army commands

Press **`Q`** to put the wheel in command mode, select a unit group or squad, and confirm with **Middle Mouse**. Select an order the same way. Press `Q` to close an order submenu or cancel placement; outside a submenu, it switches between command and weapon selection. The **backquote** key (<kbd>&#96;</kbd>) opens orders for **ALL** directly and also closes an open order submenu.

Keyboard shortcuts select targets directly. In **Preset grouping**:

| Key | Viking | Roman |
| --- | --- | --- |
| `1` | Veteran | Heavy Infantry |
| `2` | Spearman | Spearman |
| `3` | Archer | Archer |
| `4` | Sword Cavalry | Javelin Infantry |
| `5` | Lancer | Sword Cavalry |
| `6` | Mounted Archer | Lancer |
| `7` | — | Mounted Archer |
| <kbd>&#96;</kbd> | ALL | ALL |

In **Squad grouping**, `1`–`8` select the corresponding official squads. In the Commander's home town, `1` / `2` are north infantry / cavalry, `3` / `4` south, `5` / `6` east, and `7` / `8` west. Career uses `9` for your **Personal Squad** and `0` for the **Civilian Squad** when available. Mission squad assignments depend on the mission. Commands apply to troops under your authority; nearby allies do not automatically become yours to command.

After selecting a target:

| Key | Order | Effect |
| --- | --- | --- |
| `1` | Attack | Pursue and fight enemies |
| `2` | Charge | Pursue aggressively and sprint when possible |
| `3` | Defend | Hold position and fight enemies within range |
| `4` | Formation | Move into formation at a chosen ground position |
| `5` | Follow me | Follow the player, when offered for the selected troops |
| `6` | Dismiss | Return assigned troops, when offered for the selected troops |
| `Q` / <kbd>&#96;</kbd> | Back | Close the order submenu |

For **Formation**, aim the crosshair at the ground, check the preview, then press `E`, Left Mouse, or Middle Mouse to confirm. Invalid or blocked positions cannot be confirmed; `Q` cancels placement.

## Saves

Career automatically saves your faction, appointed rank, merit, equipment, mounts, combat skills, troops, duel progression, race results and best times, mission checkpoints, and tutorial progress. Enter Career again to resume your saved progress. Campaign saves each faction's stage progression. Free Training Ground and ordinary Custom Battle do not advance Career.

Saves stay on the device. **Browser and desktop saves are separate and do not sync.** Desktop saves persist when you replace the app with a newer version. Clearing browser site data or the app's user data removes the corresponding saves.

## Model credits

The Nordic Warrior, Roman Statesman and Shadow Warden models were generated with [Meshy](https://www.meshy.ai/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). SagaBurst adapts their rigs, skinning, cloth seams, animations, LODs and textures. Source hashes and modification details: [Nordic Warrior](public/models/characters/v2/viking-civilian/ATTRIBUTION.md), [Roman Statesman](public/models/characters/v2/roman-civilian/ATTRIBUTION.md), [Shadow Warden](public/models/characters/v2/maki-archer-t4/ATTRIBUTION.md). These credits apply to those model assets; animation-source licenses are recorded separately.
