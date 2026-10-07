# tests/ 目錄與 runner 遷移計畫

本文件保留盤點基準的遷移設計。已實作的第一批為 [Navigation core](migrations/navigation-core.md)：四個 suite 移至 `tests/movement/`，其餘仍是後續規劃；package scripts、Vitest、TypeScript 與 CI 未在本批修改。

## 目標責任

```text
tests/
  combat/          # formula、contact、routing、HP
  commands/        # input ownership、formation、NPC order
  equipment/       # equip/input 與 inventory policy
  actors/          # sourcing、spawn、placement、lifecycle
  movement/        # targeting、locomotion、navigation、collision
  camera/          # camera movement、spectator/input core
  missions/        # definition、outcome、assembly/march/return policy
  persistence/     # checkpoint、format、migration、settlement
  progression/     # skill、HP growth、merit、statistics
  town/            # population、services、crime 等 Town policy
  assets/          # rig、animation、socket、LOD、render contracts
  integration/     # 依接線能力命名；各 mode/phase adapter 都執行
    browser/       # 可維護的現有 standalone browser QA
  audio/           # SoundManager lifecycle
  ui/              # DOM/pointer-lock/presentation
  observability/   # profiler、census、diagnostic controls
  release/         # Node tests 與 web/desktop smoke entry
  helpers/         # typed fixture、environment、resource/clock driver
  contracts/       # 對多個 adapter 執行的命名行為 contract
  fixtures/        # 独立 expected/asset regression fixtures
  AGENTS.md
```

全部197個runner檔的case去向見 [files.csv](inventory/files.csv) 與逐case `target_suite`。目標是設計責任位置，尚未逐body覆核的去向是待確認提案；先機械搬入能力目錄，後續獨立PR拆case/整理fixtures，避免一次數千行搬檔與去重混在一起。`integration/` 也按接線命名，不能變成另一個巨大雜物區。

## 現況 → 後續變更

| 設定／入口 | dev 現況 | 遷移要求 |
| --- | --- | --- |
| `package.json:test` | `vitest run` | script名稱保留；以collection查194檔/2930cases的原名稱與參數mapping |
| `vitest.config.ts` | Vite merge；預設 discovery，exclude 加 `output/**`、`tools/release/**`；local5s/CI20s | 遷移期間保留src discovery；全部30檔移完才收斂include到tests。先加入 `tests/release/**` exclude，再移Node檔，不准跨runner重複收集 |
| Vitest include | 未自訂；包含符合預設命名的src/tests檔 | 最終可用 `tests/**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}`，保留configDefaults.exclude、output、兩個release路徑exclude直到舊路徑清空；依實際extension再精簡 |
| `test:release` | `node --test tools/release/*.test.cjs`，3檔17cases | 改 `node --test tests/release/*.test.cjs`；production `publish.cjs`、`validate-tag.cjs` 留tools/release |
| Node imports | asset-path用`../../electron/asset-path.cjs`；另兩檔require同目錄工具 | 前者深度不變仍核對；後兩者改`../../tools/release/...`。`__dirname`、temp目錄與fixture也逐項驗證 |
| `smoke:web/desktop` | 同一個`tools/release/smoke.mjs`，desktop加旗標 | 入口搬`tests/release/smoke.mjs`並改scripts；Web base與desktop protocol/security/codesign分支照留；不由Vitest收進來 |
| Playwright | 沒有@playwright/test/config專案；smoke直接呼叫Playwright，其他tools QA可手動跑 | 不發明browser runner數字。promotion QA前先建立可重現server/asset前置條件、bounded等待、nonzero失敗與cleanup |
| `tsconfig.json` | strict/noUnused/noEmit，include `src`；build目前也typecheck src測試 | 搬走後production build不再替這些case檢查型別；`typecheck:test`必须持續覆蓋tests，不能靠build代替 |
| `tsconfig.test.json` | extends production；ES2022/DOM/Node/Vitest types；include `src/**/*.ts`、`tests/**/*.ts` | 新位置仍被涵蓋；不關strict、不改skipLibCheck理由、不加排除。Node `.cjs`目前沒有TS checking，不要宣稱有 |
| `tools/typecheck-tests.cjs` | fingerprint v2 = file/code/message/snippet + count；baseline465 | 原樣維持ratchet。優先修歷史錯；不能直接update整份或改演算法繞過路徑變化 |
| Assets/fixtures | `new URL('../public/...',import.meta.url)`、cwd-relative `public/...`、fixtures JSON及tools loaders並存 | 按新深度修改URL或使用明確repo-root path helper；保持Node/瀏覽器base不同。不能用strip-material loader替代material/KTX2測試 |
| Filtering/reporting | 沒有repo coverage provider/report設定；CLI filename/name filters | 更新文件與命令中的舊路徑；JSON report使用relative path mapping。若日後加coverage，要排除tests/helpers/fixtures但保留各production入口 |
| Import direction | src的**測試**有引用tests/helpers；production code未因此獲准引用tests | 搬檔後AST/搜尋檢查非test production不可反向import tests。工具被測程式仍在tools，可由tests引用 |

## package.json 全部 scripts

13 個 scripts 已逐項核對；只把真正的 runner case 計入 inventory。

| Script | 命令／責任 | 本輪狀態 |
| --- | --- | --- |
| `dev`, `preview` | `vite`, `vite preview`；啟動開發／預覽 server | 非 test runner，未另啟動 |
| `build`, `build:web` | `tsc && vite build`；後者是 build alias | build 已執行；alias 不另計一次 |
| `build:desktop` | `tsc && vite build --mode desktop` | 未執行 |
| `desktop` | desktop build 後 `electron .` | 手動啟動入口，未執行 |
| `package:desktop` | desktop build 後 electron-builder `--publish never` | 包裝入口，未執行 |
| `test` | `vitest run` | 最終 SHA full run 2,936 pass；舊 SHA 曾有 1 fail，另列紀錄 |
| `test:release` | `node --test tools/release/*.test.cjs` | 同集合三檔以 TAP 執行，17 pass |
| `smoke:web`, `smoke:desktop` | `node tools/release/smoke.mjs`，desktop 加旗標 | 已讀入口與平台分支，未執行 |
| `validate:release` | `node tools/release/validate-tag.cjs` | 正式 tag validation CLI 未執行；其單元測試已執行 |
| `typecheck:test` | `node tools/typecheck-tests.cjs` | 已執行，465 歷史 diagnostics 符合 baseline |

## CI 指令盤點

| Workflow/job | 現有驗證命令（略去安裝／上傳） | 遷移影響 |
| --- | --- | --- |
| `.github/workflows/ci.yml` web | typecheck:test → test → test:release → build → smoke:web | 保留入口名稱可避免無謂workflow diff；runner變更PR仍須證明實際檔案有被發現 |
| ci desktop（PR，Windows x64 / macOS arm64） | test:release → package:desktop → smoke:desktop --packaged | package含desktop build；各平台smoke各驗，macOS有codesign，不能只以本機Vitest代替 |
| `deploy-pages.yml` build | test → test:release → build → smoke:web | **目前没有typecheck:test**；如要補上，另列CI工作，不隱藏在搬檔PR |
| `release.yml` validate | validate-tag → test → test:release → build → smoke:web | validate-tag仍留tools；目前也沒有typecheck:test |
| release desktop | package:desktop → smoke:desktop --packaged（兩平台） | Node test在validate job；保留dependency與平台驗證 |
| release inspect/publish | publish.cjs --check、main/tag recheck、publish.cjs | 這些是正式release actions，不是可以在盤點中直接執行的tests；只有其Node injected-client tests於本輪執行 |

## 全部 src 與 Node release 檔的去向

下表以盤點基準的原檔為索引；同檔混合責任以逐 case map 分拆。四個 navigation 目標已建立，其餘目標仍待後續批次；目前位置以對應遷移紀錄為準。

| 原檔 | 宣告 / 展開 | 規劃責任位置（依 case 分拆） |
| --- | ---: | --- |
| `src/assets/publicAssetUrl.test.ts` | 1 / 3 | `tests/assets/publicAssetUrl.test.ts` |
| `src/campaign/CampaignConfig.test.ts` | 10 / 10 | `tests/missions/CampaignConfig.test.ts` |
| `src/campaign/CampaignGate.test.ts` | 6 / 6 | `tests/missions/CampaignGate.test.ts` |
| `src/campaign/CampaignOutpost.test.ts` | 11 / 15 | `tests/missions/CampaignOutpost.test.ts` |
| `src/campaign/CampaignProgress.test.ts` | 5 / 5 | `tests/missions/CampaignProgress.test.ts` |
| `src/campaign/DefenseCampaignLaunch.test.ts` | 32 / 47 | `tests/actors/CampaignSpawnPlacement.test.ts`<br>`tests/missions/DefenseCampaignLaunch.test.ts` |
| `src/campaign/DefenseCampaignRuntime.test.ts` | 14 / 14 | `tests/missions/DefenseCampaignRuntime.test.ts` |
| `src/career/CareerMissionCheckpoint.test.ts` | 7 / 8 | `tests/persistence/CareerMissionCheckpoint.test.ts` |
| `src/career/CareerOutpostMission.test.ts` | 15 / 30 | `tests/missions/CareerOutpostMission.test.ts`<br>`tests/persistence/CareerOutpostSchema.test.ts`<br>`tests/progression/OutpostSettlementPolicy.test.ts` |
| `src/career/CareerOutpostRelief.test.ts` | 11 / 19 | `tests/integration/ReliefCommandPermissions.test.ts`<br>`tests/integration/ReliefPersistence.test.ts`<br>`tests/missions/CareerOutpostRelief.test.ts`<br>`tests/missions/MountedMissionMarch.test.ts`<br>`tests/movement/MountedOrderMovement.test.ts` |
| `src/career/CareerOutpostStructureStats.test.ts` | 2 / 3 | `tests/integration/CareerOutpostStructureStats.test.ts` |
| `src/career/CareerVeteranOutpost.test.ts` | 4 / 4 | `tests/missions/CareerVeteranOutpost.test.ts` |
| `src/career/CareerVeteranOutpostGame.test.ts` | 14 / 20 | `tests/integration/CareerVeteranOutpostGame.test.ts` |
| `src/career/MissionTravelEncounter.test.ts` | 9 / 9 | `tests/missions/MissionTravelEncounter.test.ts` |
| `src/career/MissionTravelEncounterFlow.test.ts` | 6 / 7 | `tests/integration/MissionTravelEncounterFlow.test.ts` |
| `src/career/MountedMissionMarch.test.ts` | 5 / 5 | `tests/missions/MountedMissionMarch.test.ts` |
| `src/career/VeteranMission.test.ts` | 12 / 14 | `tests/missions/VeteranMission.test.ts`<br>`tests/persistence/VeteranRosterSchema.test.ts` |
| `src/navigation/ChaseTargetCoordinator.test.ts` | 3 / 3 | `tests/movement/ChaseTargetCoordinator.test.ts` |
| `src/navigation/NavigationGrid.test.ts` | 11 / 11 | `tests/movement/NavigationGrid.test.ts` |
| `src/navigation/NavigationPathFollower.test.ts` | 5 / 5 | `tests/movement/NavigationPathFollower.test.ts` |
| `src/navigation/NavigationWorld.test.ts` | 7 / 7 | `tests/movement/NavigationWorld.test.ts` |
| `src/town/TownOutskirtsWarfareController.test.ts` | 23 / 29 | `tests/actors/OutskirtsActorLifecycle.test.ts`<br>`tests/movement/OutskirtsTravelPolicy.test.ts`<br>`tests/town/TownOutskirtsWarfareController.test.ts` |
| `src/ui/DefenseCampaignHUD.test.ts` | 4 / 4 | `tests/ui/DefenseCampaignHUD.test.ts` |
| `src/world/DamageableObstacle.test.ts` | 5 / 5 | `tests/combat/DamageableObstacle.test.ts` |
| `src/world/DeathFade.test.ts` | 2 / 2 | `tests/actors/DeathFade.test.ts` |
| `src/world/EntityCollisionBroadPhase.test.ts` | 4 / 4 | `tests/movement/EntityCollisionBroadPhase.test.ts` |
| `src/world/NpcSpawnScheduler.test.ts` | 11 / 11 | `tests/actors/NpcSpawnScheduler.test.ts` |
| `src/world/ObstacleCollisionSpatialIndex.test.ts` | 4 / 4 | `tests/movement/ObstacleCollisionSpatialIndex.test.ts` |
| `src/world/TemporaryCombatTier.test.ts` | 3 / 3 | `tests/equipment/TemporaryCombatTier.test.ts` |
| `src/world/Terrain.test.ts` | 3 / 3 | `tests/movement/Terrain.test.ts` |
| `tools/release/asset-path.test.cjs` | 2 / 2 | `tests/release/asset-path.test.cjs` |
| `tools/release/publish.test.cjs` | 12 / 12 | `tests/release/publish.test.cjs` |
| `tools/release/validate-tag.test.cjs` | 3 / 3 | `tests/release/validate-tag.test.cjs` |


## Typecheck fingerprint 一對一遷移

目前30個src測試沒有歷史baseline項目；465筆分布於70個tests/helper檔、349個fingerprints。之後整理現有tests路徑仍會遇到ratchet問題。

1. 搬檔前保存 affected file 的diagnostics：`old file/code/message/snippet/count`。只列本PR會搬的項目，不整份重建baseline。
2. 優先修該diagnostic；baseline刪除相應key/count，證明新位置不再有該錯。
3. 無法同PR修時，附 `old key → new key` 表。除了檔案路徑（以及TypeScript訊息中真正由相同import相對路徑造成的字串），code/snippet/錯誤原因與count必須一致；變動逐條人工review。
4. 手動只更換映射的keys；其他keys bytes/數量不動。不得呼叫全量regenerate、改fingerprint演算法、把新錯誤當舊錯誤。
5. 同檔拆到多處須逐diagnostic分配，總量不得增加；找不到唯一對應就修錯或先不搬該case。
6. 再跑 `rtk npm run typecheck:test`，確認完整baseline精確一致或經明確刪項後下降。資料表附assertion/source位置供review。

## 每個機械搬檔批次的驗收

- 記錄前後SHA、affected cases的 `(runner,原declaration,expanded name)` 與新路徑mapping；總數相同仍要查漏跑／跑兩次。
- 檢查 imports、vi.mock/spy paths、`new URL`、`process.cwd()`、Python/tool invocation、fixture快取及dispose。
- affected suites通過，再full suite、typecheck、build、release；runner/smoke改動還需web及對應desktop jobs。
- 如果baseline有失敗，明列相同失敗與新失敗；不skip、不放寬timeout。只跑單檔不能取代full suite結果。
- 完成後更新路徑引用：README、ai_share文件、tools/axe-attacks.md、tests/veteran-field-test-inventory.md，以及任何列出命令的skill/docs。歷史盤點應保留其SHA與舊路徑語境，不偽造歷史。
