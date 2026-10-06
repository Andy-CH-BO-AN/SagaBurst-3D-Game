# Releasing SagaBurst

## Branches

`feature → dev → prod → vX.Y.Z`

- Open all feature and bugfix PRs against **dev**. Pushes and PRs run `npm ci`, `npm test`, and `npm run build` plus release and Pages smoke checks. PRs also package and smoke-test both desktop targets; preview artifacts are Actions downloads, never official releases.
- Promote a tested **dev** with a Release PR into **prod**. Only prod pushes deploy the production website. Do not develop features directly on prod.
- Keep **main** as the legacy/default branch during this transition. Always select dev as the feature PR base; changing the default can be handled separately.

The initial dev and prod branches were created from stable main commit `273ddee45c4e1e9a28d5d04a73157c439e7762bd` after confirming no open PRs. This preparation PR targets dev. Reviewing and merging it does not deploy the website or publish v1.0.0; a separate dev → prod PR is required.

## One-time GitHub setup

1. **Settings → Actions → General:** allow the official GitHub actions and workflow execution. The release workflow requests `contents: write`; ensure repository/organization policy permits that. No publishing token or signing secret is needed; jobs use `GITHUB_TOKEN`.
2. **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**. Do this before the first prod deployment.
3. **Settings → Environments → github-pages:** allow deployment from **prod only**. If required reviewers are enabled, approve the Pages deployment in Actions. The tag release jobs do not use this environment.
4. **Settings → Rules → Rulesets / branch protection:** protect dev and prod with PR review and required **CI / web** checks. Prevent force pushes and deletion. Keep prod for promotion PRs from dev. GitHub branch protection cannot restrict a PR's source branch by itself; reviewers must check it is dev.
5. Recommended: restrict creation/update/deletion of `v*` tags to release maintainers. Do not create v1.0.0 until production verification and all checks pass.

## Build and validation

Use Node.js 22 or later, and run `npm ci`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local development at `/` |
| `npm test` | Full existing Vitest suite |
| `npm run test:release` | Tag guard and desktop path confinement checks |
| `npm run build` / `npm run build:web` | TypeScript + Pages build in `dist/`, base `/SagaBurst-3D-Game/` |
| `npm run smoke:web` | Production preview, main menu, runtime assets and storage reload |
| `npm run build:desktop` | Same source in `dist-desktop/`, base `/` |
| `npm run desktop` | Build and open the local Electron app |
| `npm run package:desktop -- --win --x64` | Windows ZIP; run on Windows |
| `npm run package:desktop -- --mac --arm64` | Apple Silicon ZIP; run on macOS |
| `npm run smoke:desktop -- --packaged "path/to/executable"` | Verify the packaged app, secure preferences, assets and storage |

For local web smoke testing, install the browser with `npx playwright install chromium`, or set `SMOKE_BROWSER_PATH` to an installed Chrome executable. Desktop smoke uses the app's bundled Electron. CI installs Chromium automatically. Generated `dist/`, `dist-desktop/`, `release/` and diagnostic `output/` stay out of Git.

Electron uses the stable secure standard origin `sagaburst://game/` to serve packaged files without a local server or file:// module loading. Its window disables Node integration, enables context isolation and sandboxing, denies popups/external navigation and grants only pointer lock. There is no preload or renderer Node API. Career (`sagaburst_career_v1`), Campaign (`sagaburst_defense_campaign_progress_v1`) and existing save formats are unchanged. Browser and desktop storage are separate; desktop user data persists between app versions.

## Publishing v1.0.0

1. Review this preparation PR into dev and require its checks to pass before promotion.
2. Open and review **dev → prod**. Merge after its checks pass.
3. Wait for **Deploy production Pages**, then play-check [the production site](https://andy-ch-bo-an.github.io/SagaBurst-3D-Game/). Confirm models, mounts, audio and saves load.
4. Fetch prod, check out its exact HEAD, and only then create and push the release tag:

   ```bash
   git fetch origin
   git switch --detach origin/prod
   git tag -a v1.0.0 -m "SagaBurst v1.0.0"
   git push origin v1.0.0
   ```

5. The Release workflow rejects mismatched package/lock versions or a tag outside current prod HEAD, runs tests and Pages smoke, builds each desktop ZIP on its native OS, smoke-tests the packaged executables, then rechecks prod HEAD before publishing **SagaBurst v1.0.0** with both downloads.

Expected downloads:

- `SagaBurst-v1.0.0-Windows-x64.zip`
- `SagaBurst-v1.0.0-macOS-arm64.zip`

Keep prod at that commit until the Release workflow finishes; if prod advances, publishing fails safely. For a failed workflow, rerun the same tag workflow after resolving the cause. A rerun validates the same prod/tag boundary and uploads to that release without creating another release.

For later versions, update package.json and package-lock.json together on dev (e.g. `npm version patch --no-git-tag-version`), add player notes at `docs/releases/vX.Y.Z.md`, and repeat the promotion/deployment/tag process. A notes file is required for a new release.

## Baseline inventory

Before editing, latest main had package version 0.0.1, no Actions workflows, no dev/prod branches, no configured Pages site, and no desktop wrapper. Vite/TypeScript production build succeeded. The baseline had 164 tracked public files (about 212 MB), including all character/mount GLBs, KTX2 textures, decoder JS/WASM, manifests and provenance. Runtime sound/voice loading already used Vite-managed `new URL(..., import.meta.url)`; 25 WAVs are emitted. Six runtime/debug model loaders used root-absolute URLs and now share the Vite base helper. Gameplay source and save schemas are unchanged.

The unmodified main full suite reported **177 passed files / 1 failed file; 2887 passed tests / 1 failed test**. `tests/ShieldBlocking.test.ts` → `real NPC animation can hit a nearby player through the authoritative callback` fails its hit callback assertion, and the targeted rerun reproduces it. At the owner’s explicit request, this single long-broken animation assertion was removed from this preparation PR. All other ShieldBlocking tests remain, and combat behavior was not changed. The release pipeline continues to require the full remaining suite to pass.

Final local validation after that removal: `npm ci`, 179 Vitest files / 2890 tests, five release-boundary tests, Web and desktop TypeScript/Vite builds, Pages and Electron smoke (165 public files, 25 WAVs, 113 runtime URLs), and actionlint all passed. The macOS arm64 ZIP was built and then extracted before its executable passed the packaged-app smoke. Native Windows packaging is also required by the PR CI before release promotion.
