# Logic CI — Supercov Native Related

Production Vitest Related selection has one source of truth: **Supercov 4.24.2**
public CLI: supercov runs RUN_ID tests affected --json. There is **no custom
dependency graph, AST/behavior selector, module initialization owner graph,
or gameplay source-to-test mapping**. The previous implementation and its
obsolete selector-only tests were removed in PR #430.

## Trigger semantics — exact PR-base Full evidence

| GitHub event | Logic mode | Evidence |
| --- | --- | --- |
| Pull request → dev | **Related** | Requires an immutable Full seed whose `seed.sha === PR base SHA` |
| Push → dev | **Full** | Normal Full PASS, then publish a NEW Full seed bound to this dev commit SHA |
| Pull request → main | **Full** | Complete logic suite |
| Push → main | **Full** | Complete logic suite + immutable same-SHA Full seed for Pages/Release |
| Release / explicit manual Full | **Full** | Complete logic suite; only canonical dev/main dispatch may publish a seed |

**No automatic Full fallback on PRs**, and no second execution to get around the
limit. Every PR→dev Related selection must be ≤500 unique cases, and 501+ fails.
Full is every test in the repository and has **no aggregate limit**. Each leaf of
normal Vitest/Node execution must be ≤100ms, including hooks and cleanup.

Both modes run in one `logic / gate` job: plan → run → verify complete, unique
execution → (canonical Full only) seed. There are no shards to plan, reassemble or
merge. The `web` and `desktop` jobs and their required checks are unchanged.

### Production flow

```text
push dev A → Full(normal 100ms gate) → one complete instrumented run → seed A
PR B (base=A) → restore verified exact seed A → native Related → normal Vitest
merge PR B
push dev B → Full(normal 100ms gate) → one complete instrumented run → seed B
PR C (base=B) → restore verified exact seed B → native Related → normal Vitest
```

If a new dev commit is present but its Full job has not successfully
published the **exact** matching seed yet, PR planning fails closed with
`exact dev baseline seed pending`. Re-run PR CI only after that Full
publication. An older canonical seed is NOT accepted, even when it is an
ancestor of PR base: accepting it would over-select A→B + B→C and
potentially produce an incorrect >500 result.

The restored seed must have complete normal Full execution evidence,
complete Supercov attribution, `valid=true`, no corruption, and immutable
recorded source SHA. Artifacts come from successful canonical dev/main
`CI` push/manual workflows with `workflow.head_sha === seed.sha`;
feature-branch seeds, stale branches and unverified caches are rejected.
Only repository-wide GitHub Actions artifacts are used for PR restore:
the filename, extracted metadata and commit are all checked. The seed's
SHA must equal the provided exact `TEST_BASE`; that base must also be in
the PR checkout's ancestry. Missing or mismatched evidence fails closed.

### Full publication and retention

The **normal** Full run first passes the same 100ms test gate and exact
verification. `supercov-seed.cjs` then instruments **one complete Vitest run** of
the verified inventory, without merging anything. Supercov exposes the run's counts;
Vitest's own JSON roster of that run must list exactly the planned (file, test)
identities, all passed (`validateRoster`).

Supercov top-level `complete` can be false when some source branches
remain uncovered. Actual Full-seed admission requires
`valid=true`, `testExitCode=0`, `stale=false`,
`measurement.complete=true` with no limitations or corrupt data,
`testAttribution.exact` equal to all collected Vitest leaves, and
all `testOutcomes` passed (no skips, failures or uncertain identities).
Seed schema v3 records `sha`, `runId`, `tests`, `setups`, three
execution/measurement/attribution completeness flags, and honest
`coverageComplete` separately. No generation counter is needed.

A successful canonical Full publishes
`supercov-seed-<dev-or-main-commit-SHA>` as an immutable repository-scoped
Actions artifact, retaining it for 45 days. Archive limits stay at
**500 MiB packed / 1 GiB unpacked** and fail before publication when
exceeded. Dev pushes use SHA-specific concurrency groups so a later push
does not cancel an in-flight Full seed job.

No `supercov-dev-refresh`, merge of any kind, incremental Related artifact publisher, generation 0..16 lineage, `--allow-changed`,
legacy selector, or automatic Full fallback is part of production.

## Test identity and governance

The thin adapter validates the public JSON envelope, run identity, full
(file, test name) identity, counts, uniqueness and truncation. Supercov
`coverage.summary` distinguishes **763 runnable Vitest leaves** from **110
setup lifecycle records** in the confirmed canonical baseline. Its native
`runs tests affected --json` inventory correctly counts **873 historical
records**. This is not 873 executable Vitest testcases. `unaffected` is
deliberately **count-only**, returned as `unaffectedCount: 873` with
`truncated: ["unaffected tests are counted, not listed"]` on an unchanged
checkout. The adapter accepts this *specific* unaffected-only truncation
while requiring untruncated exact `affected` and `undetermined` identities,
correct sums, and an inventory matching `seed.tests + seed.setups`.
Supercov's public `tests affected --json` may return a **ranked
preview** of affected identities, while summary counts remain authoritative.
The pinned Supercov 4.24.2 explicitly rejects combining `--names --json`
(`INVALID_ARGUMENT`); `--names` alone is text without reliable file
identity. A generic `--limit` was also rejected in real CI.

**Exact filtered expansion:** when the global `affected` / `undetermined` array
is shorter than its native summary and Supercov supplies its documented
ranked-preview marker, production asks `tests affected --files` which test files
have affected identities and queries only those with
`tests affected --test-file <path> --json`, by directory where a directory holds
several and has no nested test directories. A previewed directory is re-queried
file by file. Each public filtered response must identify its exact filter, run,
source scope and fully materialized file/name identities. The **affected and
undetermined totals across all filters must equal the original global counts**,
including setup lifecycle records, so an identity outside the list surfaces as a
difference rather than as less to test. Duplicate, truncated, mismatched-file or
foreign-run data fails closed. Only exact structured names are passed to normal
Vitest; no guessed test→file mapping, filename-less text parsing, or unverified
count-only selection is accepted. Everything decidable without Supercov (unsupported
paths, deletes/renames, module analysis of added sources) fails before the first query.

If `affected + undetermined - seed.setups >500`, reject immediately before
per-file expansion; Full fallback or partitioning a >500 Related set
remains forbidden. Unaffected-only count truncation and display-only
reason truncation are safe only under their independently verified counts.

Optional `affectedCount` and `undeterminedCount` are accepted only
when each equals its corresponding **complete** identity array length and
summary count; they never authorize count-only affected selection.

**Setup lifecycle records are not cases.** `<file> > module setup` is the loading of
that test file, which any of its leaves performs: a file with a selected leaf needs
nothing more, and a file with only that record runs its first leaf. A leaf that ran
code in a changed file is already reported in its own right, since Supercov counts
top-level changes against those leaves too. Limitation: a leaf that only observes a
changed module's top-level effect through shared state in an unchanged module is not
selected. Any other setup record (a suite hook, a name a changed test no longer has)
selects **every leaf in its file**; unknown source files or inconsistent counts fail
closed.

**Added and modified test files run every case they register now**, directly from
the PR's discovery. New files are never looked up in the seed.
A small fixed Node tooling/release suite runs all or none, without a second selector.
It exercises CI tooling, release scripts, workflows and Electron helpers and reads no
game code, so a PR changing only `src/**`, non-Node tests, `tests/helpers` and documents
skips it (release notes under `docs/releases/` do not count as documents here). Every
other input runs it, and Full always does.

    Related = native affected ∪ native undetermined ∪ all cases of added/modified
              test files ∪ fixed Node contracts when their inputs changed

The summary reports each category's runnable cases, the duplicates removed and the
final unique total; the first four minus duplicates equals the total. A selection over
the limit prints this too before failing, so it shows what to split. When the native
summary alone already proves more than 500, identity expansion is skipped and only a
section labelled as an incomplete lower bound is printed.

Related counts are validated in the manifest:
- 0–100: Excellent
- 101–200: Normal
- 201–300: Broad
- 301–500: Very broad
- 501+: FAIL; split or reduce coupling, never auto Full/shard bypass

The ordinary Vitest 100ms cap includes hooks and cleanup and applies to both
modes. Reports must exactly match selected leaf identities. Missing/extra/duplicate
leaves, skips, retries, timeouts and failures block the gate. Partially selected
files share one Vitest process unless a selected name would also match an unselected
leaf in another file.

## Added runtime sources

Supercov 4.24.2 does not see a source added since the run: `workingTree.sourceSetChanged`
stays `false` and no test's record mentions it (its docs say to run the suite in full).
So that flag still fails closed, and an added `src/**` module is admitted only by
`supercov-new-source.cjs`, a static proof from TypeScript's parser and module resolver:

1. Git says `A`; renames and deletions fail in preflight.
2. No production module has a computed `import()`/`require()`, `import.meta.glob`,
   computed `new URL(…, import.meta.url)` or unresolved specifier. Any of those could
   reach the module or means the graph is incomplete.
3. Unless it emits no JavaScript, a test file must load it: through the test's static
   imports and the `import()` calls it reaches unconditionally, then static imports
   beneath them (barrels and tsconfig `paths` included). Which imports exist is read from
   TypeScript's own emit, so type-only imports and imports nothing uses as a value, shadowed
   names included, do not count. A guarded or uncalled `import()`, a production `import()`
   and a module under `vi.mock` may never run, so none of them is a path.
4. Once selected, **every** test file that loads it must be in the selection. Adding the
   import changes the importer's top level, so Supercov should already select them; a
   difference is reported rather than patched over.
5. Each existing importer must have real test evidence: non-zero `totalTests` from
   `runs <id> file <path> --json` at the base, or an added/modified test loading it.

Failures name the file and the missing relation. Limitations: "unconditionally" is read
from syntax, so an `import()` after an early `return` still counts, and this proves a test
*loads* the module, not that it asserts its behavior, and it is no substitute for coverage;
that stays a review question. No coverage evidence is produced or implied for the module.

Changing `tests/tooling`, config or dependencies makes Supercov report every test as
affected, so such a PR exceeds 500 and fails closed by design. It needs independent
validation and an Owner decision.

The plan reports total suite leaves, selected leaves, percentage, health tier,
run ID and native affected/undetermined counts.

## Scripts

- tests/tooling/ci-plan.cjs: discovery, manifest and the Related 500 limit
- tests/tooling/supercov-related.cjs: native public JSON adapter and selection
- tests/tooling/supercov-new-source.cjs: static proof for added runtime sources
- tests/tooling/supercov-affected-expand.cjs: bounded public --test-file JSON worker
- tests/tooling/supercov-measured-evidence.cjs: full identity and filtered-count reconciliation
- tests/tooling/ci-run.cjs: normal Vitest / Node execution and exact verification
- tests/tooling/supercov-seed.cjs: Full-only authoritative seed validation
- tests/tooling/supercov-evidence.cjs: cross-ref Actions artifact restore
- tests/tooling/supercov-evidence-policy.cjs: exact baseline trust and immutable Full artifact size caps
- .github/workflows/logic-tests.yml: reusable workflow

Run normal Related locally with:

    node tests/tooling/ci-plan.cjs --mode related --base BASE --head HEAD --event pull_request --out output/test-plan.json
    node tests/tooling/ci-run.cjs --manifest output/test-plan.json --out output/aggregate.json

Plain npm test still runs Full with normal Vitest. Supercov version is
strictly pinned to 4.24.2; the migration does not upgrade Vitest/Vite/Node.

## Unsupported inputs and rollout acceptance

Deleted, renamed or moved runtime sources, added sources without the proof above,
unknown asset families, unknown global inputs and corrupted evidence fail Related.
Known asset families use the independent validation policy below. Config/dependency
changes may select all leaves and therefore correctly fail the 500 Related limit.

### Post-merge confirmation

After Owner's reviewed merge, the **push→dev runs Full** and publishes its own
same-SHA seed (no separate feature bootstrap).
Check actual Full test outcomes, the single instrumented run, seed SHA,
artifact provenance, and presence of that exact artifact.
A PR targeting that dev base should then restore the **exact** seed,
run native Related and pass ≤500 cases using normal Vitest.
When dev advances, PR CI for the new base must **fail closed until**
the next Full seed is published. Validate the cycle on two consecutive
dev pushes; report any failure instead of using a previous seed or
automatic Full fallback.

## Main publication

The main push gate emits a verified Full SHA for the same checkout, shared
with Pages/Release. Failed, stale or missing SHA cannot publish. Manual
release tags without matching evidence run Full. Dev PRs skip Desktop and
browser smoke, while regular build/typecheck remain.

## Non-runtime inputs and Git/job integrity

`ci-inputs.cjs` classifies every effective input before seed restore. Only
regular tracked additions/modifications are admitted. Unknown inputs, symlinks,
renames and deletions fail closed. A narrow `index.html` proof permits changes
only inside its existing head style block, with byte-identical DOM/scripts and
resource references. HTML semantic changes still fail closed.

Known character-v2 families and registered equipment use an independent
`ci-asset-run.cjs` step, before the native query. This checks GLB chunks, embedded
buffers, views/accessors, compression, manifest/LOD hashes, audit, bone mappings,
licenses and the actual pure loader contract. Equipment additionally checks its
registered path and generated shield collision metadata. Reviewed offline
builders get syntax/consumer checks and validate their associated output families;
they are never executed. Unknown producers/families remain unsupported. External
glTF resources and sparse accessors require an explicit future policy.

Asset-only plans may select zero logic cases without a seed, but require a
passed asset report tied to base/head/checkout and file digests. Mixed runtime
changes retain exact seed/native selection and whole changed-test-file execution.
Existing manifest animation timing/event changes are not static exemptions and
fail closed pending an explicit runtime evidence policy. Static validation does
not establish visual, animation, riding or GPU quality.

`ci-git-evidence.cjs` keeps merge-base diagnostics and binds the actual checkout
to the requested PR base/head and event payload. Native Supercov sees the checkout,
so the effective diff is exact base → validated checkout, including merge
resolutions. A local head must already include base. A truly empty diff gets an
explicit empty-diff plan; absent history and SHA mismatches cannot use this policy.
Full/Related trigger rules, the exact seed, 500/100ms caps and discovery stay intact.

Web reports the logic result with run/head/ref details and still rejects skipped
or failed logic. A GitHub failure before job creation cannot be fixed by an
in-workflow guard. Inspect the current PR externally with:

    node tests/tooling/ci-check-jobs.cjs OWNER/REPO PR_NUMBER RUN_ID output/jobs.json

This read-only command checks the latest PR head/merge revision and the run's
current attempt, paginates jobs, and rejects missing, skipped, cancelled, failed,
stale or duplicate required jobs. It does not change branch protection. Configure
required checks `logic / gate` and `web` in Settings → Rules → Rulesets → dev;
require up-to-date checks as appropriate. Rulesets alone treat some skipped checks
as acceptable, so preserve the Web job's explicit successful-logic requirement.
An externally reported workflow failure/missing job remains unverified even if no
summary was produced. Do not substitute an old attempt, force push or empty commit
for a permanent fix.
