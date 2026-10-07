# 動物資產契約與 runtime asset path：機械搬檔

基準為最新 integration head `ae07cd8cc0ac4546f376be492a971f270cf82e17`。只把資產相關 suites 集中到 `tests/assets/`，改對應相對 import 字串；case bodies、參數、assertions、hooks、driver、時間／frame budgets、asset paths 完整保留。Gameplay visual fixture 整理与 art-only assertion 判定由各自 PR 處理，這批沒有語意變更。

| 搬檔前 | 搬檔後 | 展開 cases |
| --- | --- | ---: |
| `tests/CorgiMount.test.ts` | `tests/assets/CorgiMount.test.ts` | 6 |
| `tests/BlackCatMount.test.ts` | `tests/assets/BlackCatMount.test.ts` | 6 |
| `tests/QuadrupedMountAnimation.test.ts` | `tests/assets/QuadrupedMountAnimation.test.ts` | 26 |
| `tests/BlackCatMovementAnimation.test.ts` | `tests/assets/BlackCatMovementAnimation.test.ts` | 7 |
| `src/assets/publicAssetUrl.test.ts` | `tests/assets/publicAssetUrl.test.ts` | 3 |

48 個展開 cases 不增減；兩個獨立 Visual 實作、真 GLB／skin／socket／LOD、clip/mixer/physics/terrain 與 public base path 契約仍實際執行。動物 suite 中其他 mixed art assertions 尚待個案整理，不因搬入 assets 就標成已清完。

保持 Vitest 的 src discovery；目前仍有 16 個 src suites，不提前收斂 include。TypeScript tests include、Node release 邊界、baseline（443）、helpers、production／assets 與 CI 都不改。`loadTestGlbAsset` 的 cwd-relative shipped paths 不受 test 位置改動影響，仍明示省略 image/material payload。

搬檔前後逐案 file/name/line/column mapping，及正規化 import 後完整來源 bytes 對照；affected 48、完整 discovery／Vitest 194檔／2,927 cases、typecheck:test、build、Node release17與web smoke 的實際結果在能力 PR 記錄。未跑的檢查不以此計畫當執行證據。
