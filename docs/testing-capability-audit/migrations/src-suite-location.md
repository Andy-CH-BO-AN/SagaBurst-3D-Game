# 剩餘 src suites：能力目錄搬檔與 runner 收斂

基準為最新 integration head `8ca21820df39348095bf68acfd3f8d0b2ba5c5a1`。依使用者擴大 test-only PR scope 的指示，一次移動剩餘 16 套 suite、228 個展開案例。只校正 107 個相對 import；名稱、參數、hooks、case body、assertions、driver、時間與 frame budgets 完整保留。

| 搬檔前 | 搬檔後 | 展開 cases |
| --- | --- | ---: |
| `src/campaign/CampaignConfig.test.ts` | `tests/missions/CampaignConfig.test.ts` | 10 |
| `src/campaign/CampaignGate.test.ts` | `tests/missions/CampaignGate.test.ts` | 6 |
| `src/campaign/CampaignOutpost.test.ts` | `tests/missions/CampaignOutpost.test.ts` | 15 |
| `src/campaign/CampaignProgress.test.ts` | `tests/progression/CampaignProgress.test.ts` | 5 |
| `src/campaign/DefenseCampaignLaunch.test.ts` | `tests/missions/DefenseCampaignLaunch.test.ts` | 47 |
| `src/campaign/DefenseCampaignRuntime.test.ts` | `tests/missions/DefenseCampaignRuntime.test.ts` | 14 |
| `src/career/CareerOutpostMission.test.ts` | `tests/missions/CareerOutpostMission.test.ts` | 30 |
| `src/career/CareerOutpostRelief.test.ts` | `tests/missions/CareerOutpostRelief.test.ts` | 19 |
| `src/career/CareerOutpostStructureStats.test.ts` | `tests/integration/CareerOutpostStructureStats.test.ts` | 3 |
| `src/career/CareerVeteranOutpost.test.ts` | `tests/missions/CareerVeteranOutpost.test.ts` | 4 |
| `src/career/CareerVeteranOutpostGame.test.ts` | `tests/integration/CareerVeteranOutpostGame.test.ts` | 20 |
| `src/career/VeteranMission.test.ts` | `tests/missions/VeteranMission.test.ts` | 14 |
| `src/town/TownOutskirtsWarfareController.test.ts` | `tests/town/TownOutskirtsWarfareController.test.ts` | 29 |
| `src/ui/DefenseCampaignHUD.test.ts` | `tests/ui/DefenseCampaignHUD.test.ts` | 4 |
| `src/world/DamageableObstacle.test.ts` | `tests/combat/DamageableObstacle.test.ts` | 5 |
| `src/world/TemporaryCombatTier.test.ts` | `tests/equipment/TemporaryCombatTier.test.ts` | 3 |

責任位置按主要能力：戰役／任務政策放 missions，關卡 unlock 放 progression，真實傷害事件→任務統計與 Game 接線放 integration，Town warfare 放 town，HP/damage core 放 combat，臨時裝備放 equipment，HUD wording 放 ui。CampaignProgress 依 body 改採 progression owner，不沿用原盤點 missions 暫定位置。原 inventory 的來源 ID 與暫定拆分仍保留歷史語境。

這是完整 suite 的機械搬移，不是整輪語意去重完成。CampaignGate/Outpost、DefenseLaunch、CareerOutpost/Relief/Veteran、Town warfare 與 TemporaryCombatTier 中混合的 core/policy/integration/parser/placement cases 全部保留；後續按能力整理時另附逐 assertion 的 owner/replacement。資料表僅記錄本批實際位置，不宣稱所有 caller 已受保護。

src suites 由 16 降至 0 後，同一批才將 Vitest include 設為既有 default include patterns 加上 tests/ 前綴；完整保留預設排除、output/Node release 排除與原 timeout。tests 根目錄既有 150 套仍被收集，不提前排除尚未分類的檔案。Node release 仍只由 Node runner 執行。

正式 production、資產、helpers、TypeScript test include、CI 與 baseline（443）不改。原 16 檔沒有 baseline entries，新位置仍由 typecheck:test 覆蓋；production build 不再代替這些測試的型別檢查。

逐案 collection/actual full 執行 identity/location mapping、正規化相對 import 後完整來源 bytes、runner 最小差異與 scope proof；affected 228、full 196 檔／2,948 cases、typecheck、build、Node release 17 與 smoke 的實際結果記於本批 PR。未跑檢查不以本文件代作執行證據。
