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

Click the game view to capture the mouse and control the camera. `Esc` releases the cursor; Career and Training Ground also offer a pause menu.

## Quick start

We recommend starting with **Career** from the main menu:

1. **Pick a faction and create a character.** You begin in the recruit training ground; follow the on-screen hints to practice movement, `Tab` equipment, melee, shields, archery, and riding. Finishing awards 100 merit and returns you to town.
2. **Buy your first weapon.** Visit the weapon shop in town, then press `Tab` to open your inventory and equip it. Press `E` near an NPC to talk.
3. **Take a mission from the Sergeant.** Start with a Recruit mission such as a bandit hunt, follow the arrow near the bottom of the screen, and stay with your squad leader.
4. **Earn merit and get promoted.** Battles and races award merit; once you reach a rank's threshold, speak to the matching NPC to accept the promotion.
5. **Grow stronger.** Buy a mount, recruit a personal squad, and try higher-rank missions.

To learn the controls first, try **Training Ground**. To set up your own armies, use **Custom Battle**.

## Basic controls

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

### Combat tips

- **Bows:** hold Right Mouse to aim, hold Left Mouse to draw, then release Left Mouse to fire. Pilum uses a click while aiming.
- **Shields:** only attacks that physically hit the shield are blocked. Side and rear attacks can still hit your body, and shields have limited battle durability.
- Ranged weapons and shields cannot be equipped together; switching with the wheel stows the conflicting item.
- Battlefield camps provide equipment, ammunition, and spare horses.

### Flying xongkoro

Press **`W` to take off**, steer with the **mouse**, use **`A` / `D` to turn**, and hold **`Shift` to accelerate**. The eagle keeps moving forward in flight. Hold **`S` to slow down**, approach open ground at low altitude, and land before dismounting safely. You can dismount in the air, but you will fall.

Left Mouse triggers an eagle strike when you are not aiming. Hold Right Mouse with a ranged weapon to aim from the rider's view, then fire normally. While aiming, you can look around within a limited arc; aiming toward its edge also turns the eagle.

## Game modes

### Career

Create a Roman or Viking character and rise through **Recruit → Soldier → Veteran → Captain → Commander**.

Press `E` near service NPCs to talk, including while mounted. Shops buy and sell weapons, shields, and mounts; `Tab` opens your character, inventory, and available squad equipment pages.

#### Tutorials

New characters begin with movement, equipment, melee, shields, archery, and horse practice. Instructions appear below the compass. Press `Esc` to use the tutorial's reset, retry, and defer buttons while paused. Completing the practice saves **100 merit once** and returns you to town; borrowed gear stays in the training scene. You can defer the tutorial and resume through the **Sergeant**.

Back in town, follow the marker to the Sergeant. Buying your first weapon awards **20 merit once**, and you can spar with the Cavalry Captain (**500 merit for a win, 20 for a normal defeat**, without affecting formal duel unlocks). After two normally settled battle missions and enough merit for a horse, the Sergeant introduces the horse shop; your first horse purchase awards **50 merit once**.

Your first formal **Captain** appointment unlocks a 30-soldier command drill, followed by HR recruitment and giving orders to your personal squad. Your first formal **Commander** appointment introduces the watchtower and the ALL → Defend order.

Tutorial progress belongs to the current character. Tutorials can be resumed or replayed; replay does not repeat rewards. Existing characters keep their saves. Drills do not count as formal mission wins and do not consume official troops or private squad resources.

#### Merit and appointments

Earn merit through Career combat contributions and race victories. Appointments use **merit earned during your current enlistment**, so spending available merit does not undo your eligibility or rank. Reaching a threshold makes you eligible; you must still **speak to the appropriate NPC and accept the appointment**.

| Rank | Merit required | Appointment |
| --- | --- | --- |
| Recruit | 0 | Starting rank |
| Soldier | 300 | Cavalry Captain |
| Veteran | 900 | Cavalry Captain |
| Captain | 5,000 | Cavalry Captain |
| Commander | 20,000 | Town Commander |

Commander unlocks T5 equipment and grants a faction-specific **T5 sword or axe** when appointed.

#### Missions

Visit the **Sergeant** for missions. They are grouped by rank, and earlier tiers stay available after promotion. Each mission card shows both sides' troop counts, the objective, and what you still need to do if you cannot accept it yet.

| Tab | Contents |
| --- | --- |
| Recruit / Soldier | Bandit hunts, patrols, cavalry sweeps, Outpost defense, cavalry relief, enemy-town assault, and Iron Encounter. Completing Outpost defense I–III unlocks relief; winning relief unlocks the enemy-town assault. |
| Veteran | A chain of field and Outpost missions that unlock in order, a home-defense mission, and Iron Tide. |
| Captain | **Captain I–VI**: Patrol Command, Cavalry Command, Gate Defense, Frontline Commander, Siege Commander, and Eagle Battle, plus Steel Avalanche. |
| Commander | **Commander I–VII** (see below). |
| 1v1 Duel | Pick a unit type and challenge it from **T1 through T5**. Each duel has five seconds of preparation and a 30-second fight limit; defeat a tier to unlock the next. T5 challenges pit you against the town's Commander, with the Captain as referee. |

| Commander mission | Objective |
| --- | --- |
| I · Sky Raid | Lead T4 Rangers on xongkoro against the enemy town and defeat 100 enemy-town personnel. |
| II · Operation Decapitation | Enter the enemy town with the former Commander and T4 cavalry; defeat the enemy's T5 Commander. |
| III · Outpost Last Stand | Deploy four infantry squads to hold the Outpost and defeat 100 enemy cavalry. |
| IV · Bridgehead Battle | Position eight infantry squads on the north bank, hold the stone bridge, and repel 300 enemy cavalry. |
| V · Four-Gate Town Defense | Defend your town against 280 attackers and eight siege ramps. Win by holding out for 15 minutes or by defeating every attacker first. |
| VI · Six Feline Cavalry | Lead 200 mounted Rangers on feline mounts against 300 horse cavalry. |
| VII · Iron Legion | Lead the same feline legion against 300 heavy cavalry. |

A results screen after every mission lists your kills, damage, and each part of the merit you earned.

**Combat skills and the outskirts:** improve **One-Handed, Two-Handed, Ranged, Mounted Impact, and Blocking**, each up to level 50. Outside formal missions, town patrols, bandits, and hostile ground and eagle patrols can still meet and fight outside the walls.

#### Shops and mounts

Shops buy and sell weapons, shields, and mounts. Each item shows its price, how many you own, and how many are not yet assigned, and a disabled button says why you cannot buy it. Items equipped or assigned to soldiers cannot be sold; unequip them first. After buying, press `Tab` to equip or summon.

Ground mounts have no rank requirement: any rank can buy and ride them.

| Mount | Price (merit) |
| --- | --- |
| Military Horse | 200 |
| Black / White / Orange Cat, Corgi hero mounts | 4,000 |
| Serval / Caracal hero mounts | 6,000 |
| Armored Horse | 8,000 |
| Armored Snow Leopard | 9,000 |
| xongkoro giant eagle (Captain / Commander only, up to three) | 10,000 |

At Captain or Commander rank, visit the town's **Eagle Trainer** to buy xongkoro. Summon it in an open takeoff area, fly over the battlefield, attack with the eagle, or use ranged weapons from its back.

#### Your troops

- **Captain:** command a **30-person Town Command Squad** in town.
- **Commander:** command **eight official ground squads**, with an infantry squad and a cavalry squad for each of the north, south, east, and west gates. Native eagle patrols and watchtower archers defend autonomously.
- **Personal Squad:** at Captain or Commander, recruit up to **30 members** from the **HR Center**. Choose soldiers, T4 Captains, and T4 Rangers; Commander rank also unlocks **T5 Commander recruits**. Allocate weapons, shields, and mounts from your stock. Press `Q`, select the personal squad (hotkey `9`), and order **Follow me** to deploy them; after returning to town, order **Dismiss** before you can refit, re-equip, or release them. **Releasing a member sends their current equipment away with them; it does not return to your inventory**, so unequip anything you want to keep first.
- **Civilian Squad:** as Commander in your own town, you can also order civilians and merchants when the group is available. Dismiss returns them to their normal duties.

Formal missions grant their own command authority and rosters. Check the command HUD for the troops assigned to you. Equipment changes can be locked during missions; in peacetime, ask the HR officer to refit your Personal Squad or the Sergeant to refit eligible town squads.

#### Mounted circuit racing

Visit **Sergeant → 1v1 → Racing** for eight races against the town's Commander. Arrive riding a living, available **ground mount that you own**; xongkoro cannot enter. Racing has no rank requirement.

Follow the Captain to the north gate, stay inside the marked start area through the **10-second countdown**, then head out through the north gate, around the **east → south → west** sides of the town, and back through the north gate. Follow all **five checkpoints**; cutting through the town prevents a legal finish. After entering a race, either racer can dismount, switch to another available ground mount, or continue on foot after their mount dies. The first legal finisher wins, including on foot. You can use `Shift` in every race.

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

Race results and your best legal finish times are saved. Races already accepted in an older save retain their original names and rewards.

#### Retirement

After **10 Commander mission victories**, including at least one victory in **Four-Gate Town Defense**, speak to the town's **Commander** and choose **Apply for retirement (申請退休)**. Finish any mission or race first and apply while the town is peaceful. Read the in-game confirmation before accepting, then follow the on-screen guide.

### Training Ground

Practice freely without spending merit, changing your Career progress, or earning combat XP.

- Try every weapon, shield, and mount (Horse, Armored Horse, the feline mounts, Corgi, and the xongkoro giant eagle).
- Test melee attacks and ranged shots on **0–100 m target dummies**, with a readout of your latest hit damage.
- Use the marked firing point and **125 m impact runway** to practice shooting and mounted charges.
- Open equipment with `Tab`; use **Refill** for supplies and **Reset Training** for a fresh setup.
- The `Esc` menu lets you switch between a normal warrior and the **T4 Shadow Warden Ranger**; changing character returns you to the starting point.

### Custom Battle

Create your own Viking vs Roman battle.

- In a ground battle, set **1–300 AI troops per side**, mixing infantry, archers, javelin troops, cavalry, and mounted archers. An aerial mode allows up to **50 archers per side**.
- Configure each unit type from **T1 to T5**; every tier counts toward that side's AI total.
- Choose **Formation Battle** or **Scattered Battle**, and group your commands by **Preset** (unit type) or **Squad**.
- Pick your faction, weapons, shield, character, and mount, or enable **Spectator** to watch the AI fight. Player characters include standard T1–T3 soldiers and T4 / T5 heroes.
- In Squad grouping, organize up to **ten squads, with up to 50 troops each**, before starting.
- The player is an additional fighter outside the AI total. If you die, you can spectate the remaining battle; **REMATCH** replays the same setup.

### Defense Campaign

Choose **Roman Defense** or **Viking Defense** and defend your faction's outpost through **nine stages per faction**.

- Organize defenders into squads before deployment (you may add up to one T4 hero outside the normal limit; the player takes no defender slot). You have **60 seconds** to position them before the enemy assault begins.
- Defend the gate, walls, and ramparts against attackers and mobile siege ramps. **50 allied cavalry** arrive to reinforce you **120 seconds after the assault begins**.
- Eliminate all attackers to win immediately. If the player and all original defenders fall before the reinforcements arrive, defeat is locked even though the battle can continue in spectator mode.
- Winning unlocks the next stage. Roman and Viking progress are saved separately.

### Units & Weapons

Open **Units & Weapons** from the main menu to compare unit traits, combat stats, weapons, and shields before choosing a loadout.

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
