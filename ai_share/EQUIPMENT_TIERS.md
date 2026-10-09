# 裝備盤點與外觀規格

T1–T3 共有 **18 件武器、6 面盾牌**；另有以下共用 T4 裝備及 Maki 專屬弓。人物胸甲、頭盔與衣物屬於 humanoid GLB，不是獨立防具物品。

## 物品與數值

| 類別 | T1 | T2 | T3 | 既有數值（T1 / T2 / T3） |
| --- | --- | --- | --- | --- |
| 長劍 | 風化長劍 `rusty_dagger` | 鋼鐵長劍 `steel_sword` | 符文長劍 `runic_greatsword` | 傷害 12 / 25 / 45；range 1.8；速度參數 0.35 |
| 長斧 | 維京長斧 `viking_axe_t1` | 精鋼維京長斧 `viking_axe_t2` | 符文維京長斧 `viking_axe_t3` | 傷害 12 / 25 / 45；range 1.8；速度參數 0.35 |
| 長槍 | 獵用長矛 `hunting_spear` | 騎兵長槍 `steel_lance` | 重裝騎士長槍 `heavy_lance` | 傷害 30 / 45 / 60；range 3.9；速度參數 0.42 |
| 羅馬短劍 | 破舊短劍 `gladius_rusty` | 標準短劍 `gladius_standard` | 精鋼百夫長劍 `centurion_blade` | 傷害 12 / 25 / 45；range 1.8；速度參數 0.35 |
| 弓 | 木製短弓 `wooden_shortbow` | 反曲長弓 `recurve_longbow` | 符文精靈弓 `elven_runebow` | 傷害 8–22 / 15–42 / 28–75；蓄力 0.8 / 1.2 / 1.8；箭速 12–45 / 18–55 / 25–65 |
| 標槍 | 簡易標槍 `pilum_basic` | 標準標槍 `pilum_standard` | 強化軍團標槍 `legionary_pilum` | 傷害 8–22 / 15–42 / 28–75；速度參數 0.8 / 1.2 / 1.8；彈速 12–18 / 14–24 / 16–30 |
| 圓盾 | 簡陋圓盾 `round_shield_t1` | 鐵環圓盾 `round_shield_t2` | 狂戰士圓盾 `round_shield_t3` | 減傷 10% / 15% / 20% |
| 方盾 | 簡陋方盾 `scutum_t1` | 軍團方盾 `scutum_t2` | 百夫長方盾 `scutum_t3` | 減傷 10% / 15% / 20% |

數值列記錄 WeaponDatabase / ArmorDatabase 的原始設定，並非所有動畫或兵種系統最終時長。舊物品 ID 保留相容性：`rusty_dagger` 現在是單手長劍，`runic_greatsword` 現在也是單手長劍。

## 共用 T4 裝備

Roman／Viking 英雄可共用，保留各自英雄倍率。Career 沿用 Captain 解鎖與軍功購買，Custom Battle 限 T4 Player，Training Ground 沿用全部目錄物品。Maki 固定裝備不變。

Career 商店的 Sword／Mace／Ranger Bow 各售 1600 軍功，Shield 售 1440；Captain／Commander 的 Roman／Viking 玩家皆可購買、裝備及分配給 RESERVE 私兵。`maki-ranger-bow-ranged` 是可交易的遠程弓；`maki-ranger-bow` 仍是不可交易的 Maki 近戰動作武器，招募或出售 Maki 不會產生可交易弓。HR T4 Captain 初始維持 T3 劍／斧與盾，升級須使用購入庫存。

一般 Career T4 NPC 在 Town、Duel 與 Siege 由業務層使用 `resolveT4UnitLoadout`：劍／斧升級為 T4 Sword／Mace，原本配盾者使用 T4 Shield；長槍與既有備用武器維持 T3。HR 私兵使用玩家分配的裝備，NPC 建構子不依 tier 強制覆寫。

| ID | 來源外觀 | 基礎傷害 | 基礎完整攻擊週期 | 盾牌衝擊／耐久 |
| --- | --- | --- | --- | --- |
| `paladin_sword_t4` | DJMaesen Paladin 原始長劍 | 60 | 0.48 秒／Sword | 衝擊 1 |
| `paladin_mace_t4` | Efarys Paladin Mace | 55 | 0.54 秒／Axe 1H 或 2H | 衝擊 12 |
| `paladin_shield_t4` | Efarys Paladin Shield＋既有中央握把 | — | — | 耐久 48 |

不含護甲穿透或被動減傷。`meleeCycleSeconds` 同步縮放動畫、接觸事件與收招；T1–T3 未設定此欄位，時序維持原狀。物理命中盾面才消耗固定衝擊，不乘英雄傷害倍率；不足耐久沿用 `ShieldState.absorb` 比例溢出。

`PaladinEquipment` 預載並共用幾何、材質與貼圖；每個持有者只複製物件變換。來源、授權及可重建流程見 `public/models/weapons/paladin/ATTRIBUTION.md`。Paladin 身體不含常駐武器。

## 三階視覺

沿用現有模型語言，T1 粗陋、T2 標準、T3 精緻；不以整件模型縮放製造差異。

| 類別 | T1 粗陋 | T2 標準 | T3 精緻 |
| --- | --- | --- | --- |
| 長劍 | 窄刃、短護手、小柄頭、粗糙鏽鐵 | 原有制式刃形與鋼鐵材質 | 稍寬劍刃、延展護手、藍色劍槽、雙面金色鑲紋 |
| 長斧 | 斧刃寬度 78%、暗鏽鐵 | 原有單刃丹麥斧 | 斧刃寬度 114%、雙面金色鑲紋 |
| 長槍 | 窄葉形鏽鐵槍頭、皮綁帶 | 原有錐形鋼槍頭，改用共用 PBR 材質 | 寬葉形槍頭、深色木桿、金箍與雙面鑲紋 |
| 羅馬短劍 | 窄刃、小護手、鏽鐵 | 原有制式短劍 | 加寬葉形刃、金色護手與雙面鑲紋 |
| 弓 | 灰褐木材、粗皮補強綁帶 | 原有木製反曲弓 | 深藍灰弓身、多處金色箍環 |
| 標槍 | 粗糙木材與鏽鐵短尖頭 | 原有軍團鐵頸標槍 | 深色木桿、拋光鐵頸、四道金色箍環 |
| 圓盾 | 原木板面、略不齊板縫、皮邊、鏽鐵盾臍 | 原有綠色板面與鐵邊 | 藍色盾面、加厚金邊、金色盾臍、放射鑲紋與鉚釘 |
| 方盾 | 原木盾面、皮製補強條與皮邊 | 原有紅色軍團盾 | 深紅盾面、加厚金邊、金色盾臍與貼合曲面的上下鑲紋 |

## 動畫與效能界線

- 握持中心、握把尺寸、socket、支撐點、武器尖端判定、動畫選擇與事件時間均維持原設定；本次不改傷害、速度、攻擊範圍或減傷。
- 長劍判定尖端 Y = 1.51；羅馬短劍 Y = 0.88；長槍 Y = 2.6。長斧保留既有 1.44m 斧柄、視覺轉角與長劍命中參考。
- 弓沿用原有跨度 1.24 / 1.70 / 2.04m，以及原有弦端、握把、箭托與拉弦軌跡。標槍也保留原有三階長度；飛行中的箭／標槍仍使用既有共用投射物外觀。
- 劍與盾的近距 mesh 數保持原上限。弓與長槍的 T1/T3、長斧 T3 各增加一個合併細節 mesh，NPC 在 LOD1/2 隱藏這些額外細節。
- NPC 無明確物品 ID 的長槍建模依 tier 選擇；標槍掉落物使用對應標槍模型。

實作入口：`src/world/WeaponMeshFactory.ts`。Player 與正式 Viking 弓兵共用 `CharacterBowVisual`，包含所有三階弓飾。
