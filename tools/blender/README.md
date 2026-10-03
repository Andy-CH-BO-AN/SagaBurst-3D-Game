# Blender MCP 與可重現操作

SagaBurst 的坐騎 rig／動畫工作使用上游 [ahujasid/mcp-for-blender](https://github.com/ahujasid/mcp-for-blender)，不是專案自製伺服器。`mcp_client.py` 是標準 MCP SDK client：`initialize` → `tools/list` → `tools/call`，以 stdio 呼叫上游 server，再由上游 addon 控制 GUI Blender。它不直接連 Blender socket，也不以 background Blender 代替 MCP 驗證。

## 固定版本與來源

2026-10-02 在本機驗證：

| 項目 | 版本／來源 |
| --- | --- |
| Blender | 5.2.0 LTS，build `fbe6228777e7` |
| uv／uvx | 0.12.22，依上游 README 的 macOS `brew install uv` 安裝 |
| Server package | PyPI `mcp-for-blender==2.1.3`，2026-09-30 發布 |
| 官方 repo commit | `60d2a31b4632a7bc178f3dd636f7e68dfb5c8ae4`，2026-09-30 |
| Addon | 1.8，protocol 13；與上述 commit 的 `addon.py` 逐 byte 一致 |
| Addon SHA-256 | `eb0facf69781a30e69792532087d8d41c6a14fcd323353250abe7988ee297fa5` |
| Managed Python | 3.11.17 |
| MCP Python SDK | 1.30.0；client 的 PEP 723 metadata 固定此版本 |
| httpx | 0.28.1；server dependency |
| MCP protocol | `2025-11-25` |

上游 FastMCP 的 `initialize.serverInfo.version` 回報 SDK 版本 `1.30.0`；實際 server package 是上述固定的 `2.1.3`，不能用該欄位誤認 package 版本。

## 安裝與 Codex 設定

以[官方 README](https://github.com/ahujasid/mcp-for-blender/blob/60d2a31b4632a7bc178f3dd636f7e68dfb5c8ae4/README.md)的 manual setup 為依據。macOS：

```sh
rtk proxy brew install uv
rtk proxy env UV_PYTHON_PREFERENCE=only-managed DISABLE_TELEMETRY=true uvx --python 3.11 mcp-for-blender==2.1.3 install-addon
rtk proxy codex mcp add blender --env UV_PYTHON_PREFERENCE=only-managed --env DISABLE_TELEMETRY=true --env BLENDER_HOST=127.0.0.1 --env BLENDER_PORT=9876 -- uvx --python 3.11 mcp-for-blender==2.1.3
```

範例假設 `brew`、`uvx`、`codex` 與 `blender` 可由 PATH 找到。若桌面安裝未提供 CLI link，`blender` 可改用 `/Applications/Blender.app/Contents/MacOS/Blender`；`codex` 請使用本機 Codex／ChatGPT app bundle 內的 CLI executable。先以 `rtk proxy which codex`／`rtk proxy which blender` 確认入口，避免使用不同安裝版本。

`install-addon` 安裝 PyPI package 的 bundled addon；不另外下載相同資產。它會先保留被替換 addon 的 `.bak`。Blender 的 user addons 目錄在 macOS 通常是 `~/Library/Application Support/Blender/<major.minor>/scripts/addons/`，檔名為 `blender_mcp.py`。

Codex CLI、desktop 與 IDE 共用 `~/.codex/config.toml`。完整安全範例見 [mcp-config.example.toml](mcp-config.example.toml)，只附加 `blender` 區段，不覆蓋原設定。GUI app 不一定繼承 shell PATH，請以 `rtk proxy which uvx` 找到系統安裝路徑並填入 `command`。此環境以可讀設定驗證 `blender.enabled = true`。本次新增前保留 Codex config 與 Blender user preferences 備份；其他既有 Codex 設定保留原文。

[官方 OpenAI MCP 文件](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)說明同一設定、stdio transport、timeout 與 CLI 操作。不要為了載入新工具重啟正在工作的 Codex；此 client 可在目前 session 立即使用真正 MCP。Codex 重啟／新 session 後會自動提供 `blender` tools。

## 啟動 GUI addon

可以在 Blender Preferences → Add-ons 啟用 **Interface: MCP for Blender**，並在 sidebar 連線；或以本專案的安裝 bootstrap 啟動新的 GUI instance：

```sh
rtk proxy blender --python tools/blender/enable_mcp_addon.py
```

此 bootstrap 只啟用安裝好的上游 addon、儲存 addon 偏好與啟動 loopback 服務，不清空／修改場景物件。若已有 Blender instance 或服務，先確認哪一個是任務 instance；不要關掉或重設使用者原有場景。此實作預設 bind `localhost:9876`，client 使用 `127.0.0.1:9876`，不對外開 port。遙測完全停用，addon consent 為 false，未啟用外部資產 provider／upload。

## MCP client

在 repo root 執行；`uv run` 依 script metadata 安裝固定 MCP SDK。此處的 `uv`／`uvx` 若不在 PATH，使用本機的實際系統路徑。

```sh
rtk proxy uv run --python 3.11 tools/blender/mcp_client.py list
rtk proxy uv run --python 3.11 tools/blender/mcp_client.py scene --output output/blender-mcp/scene.json
rtk proxy uv run --python 3.11 tools/blender/mcp_client.py object Cube
rtk proxy uv run --python 3.11 tools/blender/mcp_client.py exec --code-file tools/blender/your_script.py --output output/blender-mcp/operation.json
rtk proxy uv run --python 3.11 tools/blender/mcp_client.py call get_viewport_screenshot --arguments-json '{"max_size":1400}' --image-output output/blender-mcp/viewport.png
```

`exec` 將檔案內容送至 `execute_blender_code`，腳本在真正的 GUI Blender 中執行。以全域 `--user-prompt` 傳入原使用者指示（放在 `exec`／`call` 前）。`--host`、`--port`、`--uvx`、`--timeout` 也須放在子命令前。`call` 可用 `--arguments-file` 讀 JSON，避免多行 shell escaping。圖片只寫本機檔案，JSON 不印 base64。

同一 scene 一次只能由一位操作代理接管；所有 scene mutations 依序執行，勿同時跑多個 retarget client。Client 每次結束會關閉自己建立的 upstream stdio process，GUI addon bridge 繼續運行。

上游 bridge 的每個 command 硬上限為 **180 秒**，Codex 的 `tool_timeout_sec = 600` 不會延長這個上限。大型 import、retarget、每個 Action 的 bake、export 分成多次 MCP 呼叫；避免一次腳本超過 180 秒。

## Phase 1 smoke

```sh
rtk proxy uv run --python 3.11 tools/blender/mcp_client.py smoke --output output/blender-mcp/smoke.json --image-output output/blender-mcp/smoke-viewport.png
```

實際通過的步驟：GUI `background=false` → 讀目前 scene → 建立唯一命名 temporary Cube（8 vertices／6 polygons）→ 修改 location `[1.25,-2.5,3.75]`、rotation `[0.1,0.2,0.3]` radians、scale `[0.5,1.5,2]` → 獨立 `get_object_info` 讀回（誤差 < `1e-6`）→ MCP viewport 截圖 → 刪除 owned Cube 與 mesh → 再讀 scene。原物件、transform、frame、selection、active object、mode 全部與測試前一致。

完整逐次 `tools/call` 證據與截圖放 ignored `output/blender-mcp/`，不需 commit 診斷產物。測試只清理自己以 owner marker 標記的暫時物件，失敗時亦嘗試清理。`passed = true` 才可開始動畫工作。


## Animal animation rebuild

The runtime assets are the current v2 packages, `public/models/mounts/v2/black-cat/black-cat.glb`
and `public/models/mounts/v2/corgi/corgi.glb`. The older v1 paths in the initial task are not
loader targets. Mount/save IDs, physical scale, +Z heading, saddle sockets and body LOD names
remain unchanged.

Animation donor files are the user-provided local downloads listed with hashes and licenses
in [animation-sources.json](animation-sources.json). Set `SAGABURST_ANIMATION_DONOR_DIR` if
that directory is not `~/Downloads`. No donor geometry, textures or rig enter the final package.

Start a fresh dedicated task Blender scene with MCP enabled. Do not rebuild on an unrelated
user scene or on an unreviewed experiment rig. The baseline asset is pinned to a Git revision
and its SHA-256, so regeneration never chains another bake from a previously modified package.

```sh
rtk proxy uv run --python 3.11 tools/blender/build_animations.py all
# Or pass black-cat / corgi to bake one animal after preparing both baseline targets.
```

The driver executes separate actual MCP calls for donor import, target preparation, donor
sampling, each Action bake, finalization, ground sampling and export. Each call must finish
inside the upstream 180-second command limit. Results remain under ignored
`output/mount-retarget/`; the command never overwrites a public GLB.

- `retarget_animals.py`: maps donor body rotations and foot trajectories into the target's
  reviewed rest basis, uses target limb lengths and joint bend directions, and samples each
  target Action at 60 Hz. Horizontal root travel is removed. Cat Run comes from Daily Lowpoly;
  Corgi Run comes from zinaida; both Idle/Walk use the Doginx quadruped. Death is authored.
  Corgi motion is adapted to its exposed short legs: walk stride 0.22 m, run front/rear stride
  0.30/0.34 m, lift 0.035 m for walk and 0.045/0.04 m for run, with no artificial crouch.
  The previous 0.08 m crouch plus 0.18 m lift folded the limb roots into the low belly.
- `animal_quaternion.py`: normalizes sampled rotations and aligns their quaternion hemispheres
  before Blender scalar interpolation and grounding. This prevents equivalent `q`/`-q` keys
  from creating a flipped half-frame and a false whole-body ground correction.
- `animal_trajectory.py`: preserves donor support order while adapting stance duration to
  stride / nominal speed. Contact feet travel at nominal ground speed in the opposite local
  direction to game movement. Run nominal speeds are cat 13.2 m/s and corgi 12 m/s; walk is 2 m/s.
- `corgi_rig.mjs`: applies only the reviewed wrist/hock rest correction from a small
  source landmark/transform file. It preserves bone names, hierarchy, scale, torso/head/tail
  and saddle sockets. Compensating inverse bind matrices retain the original bind shape.
- `corgi_rig.py`: transfers the original Jump/Land/Hit bone transforms into the corrected
  rest basis and bakes each Action separately, preserving the initial hold and full duration. `corgi-reference-bases.json` pins the original
  target reference pose, avoiding interpretation of an old-basis clip on the corrected rig.
- `corgi_skin.py` / `corgi_skin.mjs`: compute limb regions on the original mesh surface,
  using paw components as seeds so asymmetric paws are not split by the centerline.
  The JavaScript adapter invokes the same Python algorithm with exact baseline positions;
  paw and shaft cores follow one bone, and joint/attachment bands retain a bounded blend.
  Body seeds exclude limb motion; the axial remainder does not amplify residual head weights.
  A harmonic solve covers the whole attachment, including the previous zero-weight border,
  while paw/shaft anchors stay rigid. Geometry, normals, UVs, materials and textures stay exact.
- `cat_skin.mjs`: reproduces the selected paw/lumbar correction from immutable baseline
  positions and weights. Distal front palms follow their paw; a narrow wrist blend remains.
  The upper lumbar/rump and adjacent tack follow the torso instead of the rear legs/tail.
  Positions, normals, UVs, indices, rest bones and inverse bind matrices are unchanged.
- `finalize_animals.py`: closes Idle/Walk donor loop seams, then grounds the authored death
  using the evaluated mesh, including every Corgi body LOD and tack contact surface.
  Corgi death ends at a measured 70-degree roll, retaining body contact instead of
  lifting the corpse onto a rigid stirrup. The accepted cat Run pose is preserved.
- `ground_locomotion.py`: applies only the required nonnegative root-height correction to
  sampled contact penetration, retaining all relative limb poses and airborne phases.
  Corgi Jump/Land/Hit also receive contact correction without forcing their endpoints to loop.
- `animal_glb.mjs`: merges the four baked Actions into the original package, retaining the
  textures, materials and geometry. Cat retains its original rest skeleton and Jump/Land/Hit;
  Corgi requires all seven Actions baked into its corrected wrist/hock basis. Cat and Corgi
  weights must match the reviewed algorithms. Unapproved bone, hierarchy or skin edits fail.

The shipped clip contract is `idle`, `walk`, `run`, `death`, `jump`, `land`, `hit`.
Only the first four are required by the runtime. Old animal `trot/canter/gallop` aliases were
removed; horse animation contracts are unchanged. `build-black-cat.py` and `build-corgi.py`
remain source-rig builders with auxiliary Jump/Land/Hit; obsolete package scripts were removed
so they cannot silently replace donor-baked locomotion with procedural clips.

### Validate and promote

Re-import the generated `*-roundtrip.glb` through MCP. Review actual playback of Idle/Walk/Run/Death
from the front and side; the cat also requires a straight rear view across the complete run
cycle. Check paws, joint folds, back/tail continuity, ground contact and tack at the extreme
poses. Review the final compressed GLB in the browser, then the player/NPC mounted game flow,
LOD switching, death hold and a 12-mount performance sample. Tests cannot approve visible art.

Write the final donor/mapping/clip metadata to `output/mount-retarget/<animal>-animation-source.json`.
Its `validation` must contain `roundtripMcpPlayback: true`, the exact final `sha256`, and
an `evidence` array of local `output/` paths with SHA-256 hashes. Only record reviewed evidence
for the current final file; changing the asset invalidates prior playback evidence.

```sh
rtk proxy node tools/blender/animal_glb.mjs promote black-cat
rtk proxy node tools/blender/animal_glb.mjs promote corgi
rtk npm test
rtk npm run build
```

Ordinary slope travel uses locomotion continuously. `Mount` requests a quadruped landing
only after a successful jump, so intermittent terrain contact cannot repeatedly reset the
landing clip. Real jump landing still plays once; town restoration clears pending landing
state, and death remains latched.

Promotion verifies immutable source data, the allowed skin correction and evidence hashes,
then updates the GLB, manifest, audit and animation-source together. The original mesh source
credit remains in each package's `CREDITS.md`; donor-animation attribution is recorded separately.

## Reviewed release validation (2026-10-03)

Integration base: `284b6a5a18fb70d09e823d00c58ec0cc16be5a8e` (latest main at review).
The immutable mesh baseline remains the pinned `e44a5240` assets; its bytes match main.

| Final package | SHA-256 | Size |
| --- | --- | --- |
| Black cat | `0e5d7a40f1230d8b9d21a56512b8c37d038166573fd488a03aa7eb6c4f5a3986` | 9,409,176 bytes |
| Corgi | `601720262ab8ea55ce1c3a7bc684f6202618123d7282515ee9f6f0365cfd392f` | 5,052,604 bytes |

- GUI Blender MCP roundtrip: all four required clips from front/side; all seven Corgi
  Actions, plus rear/three-quarter whole-cycle browser review. The selected cat v6
  forequarters and corrected lumbar/tail-root shape remain unchanged by grounding.
- Corgi review includes 96 walk/run phase views, 15 MCP clip views, all body LODs,
  tack clearance and half-frame samples. Rigid paw/shaft cores have less than 1 micrometre
  local residual. Attachment bands still bend normally; visible collapse and long sheets
  from the earlier weight discontinuity are removed. Death finishes with body contact.
- Final public GLBs, no asset routing substitutes: 98/98 actual Game checks passed.
  Player/NPC walking, running, sprinting, jump → one landing → run, hit recovery,
  rider/armor, one visible body LOD, independent instances and terminal death were checked.
  Application errors and nonfinite transforms: zero. One unrelated favicon 404 was excluded.
- The pre-existing cat slide/frozen-legs bug reproduced on main: 41 landing requests,
  40 resets during ordinary four-second travel. The repair keeps locomotion active across
  terrain-contact jitter and consumes landing only after an actual jump.
- Full suite: `rtk npm test -- --maxWorkers=2`, 201 files / 2,460 tests passed.
  `rtk npm run build` and `rtk git diff --check` passed. A preceding test/build parallel
  run hit the existing EquipmentPose five-second timeout; the bounded full rerun passed
  without relaxing the timeout. Build retains existing chunk-size/import warnings.

Performance: actual headed Chrome on Apple M1 Pro / Metal, 1280 × 720, fixed seed,
6 cats + 6 corgis with 12 tier-3 NPC riders, normal production update/LOD/shadow paths.
Each version had three runs, each with 3 s warm-up and 20 s observation; snapshots
were generation-deduplicated. At least 10 mounts kept moving; no population, camera,
finite-transform or browser-error checks failed. Values are medians of run medians.

| Measurement | Main | Final |
| --- | ---: | ---: |
| FPS | 121.424 | 121.441 |
| Total CPU / frame (ms) | 3.374 | 3.411 |
| Mount Update (ms) | 0.243 | 0.252 |
| Combined animal visual update / frame (ms) | 0.173 | 0.197 |
| Renderer Submit (ms) | 2.380 | 2.401 |
| Draw calls | 283.000 | 283.000 |
| Triangles | 1085164.000 | 1099164.000 |

This scene shows no material FPS regression; synchronous CPU measurements do not measure
GPU duration. Natural LOD transitions can change sampled triangle counts. Baked tracks
increase package size from 6.36 to 9.41 MB (cat) and 2.56 to 5.05 MB (corgi), without adding
geometry or textures. Corgi trajectories remain compact to respect its original short-leg
clearance; joints retain local skin blending rather than whole-limb rigidity.

The package `animation-source.json` files record donor-to-target body/foot mappings,
clip provenance, per-species game results and SHA-linked local review evidence. Detailed
captures, failed attempts and the Corgi root-cause handoff remain in ignored `output/`.
