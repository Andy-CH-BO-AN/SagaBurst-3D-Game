# Logic CI — Full Test CI

Production CI runs the full logic test suite for all PRs and pushes:
**Vitest + Node test runner**.

Supercov and Related Test Selection were completely removed to restore a simple,
deterministic and maintainable test pipeline.

## Policy and Budgets

| Item | Limit / Rule | Notes |
| --- | --- | --- |
| **All PRs & Pushes** | **Full logic tests** | Every push to `dev`/`main` and every PR runs all logic tests. |
| **Suite Case Limit** | **≤ 1,000 unique cases** | Hard CI ceiling across all Vitest + Node logic tests. |
| **Optimization Target** | **500–600 cases** | Primary refactoring target without compromising core regression protection. |
| **Leaf Duration** | **≤ 100ms per case** | Strict budget including setup, execution, hooks and cleanup. |
| **Execution Integrity** | **Exact unique execution** | Every test must run exactly once; no retries, no repeats, no skips. |

## CI Workflow Structure

All logic tests execute inside a single GitHub Actions job: `logic / gate`:

```text
checkout → npm ci → probe inputs / assets → plan inventory → run tests → verify budget & unique execution → publish verified SHA
```

- **`tests/tooling/budget.cjs`**: Defines `MAX_LOGIC_CASES = 1000` and `MAX_CASE_MS = 100`, validates reports.
- **`tests/tooling/ci-plan.cjs`**: Discovers the complete inventory (Vitest and Node) and enforces the 1,000 cases hard limit.
- **`tests/tooling/ci-run.cjs`**: Executes the planned tests and enforces exact completeness, duration budget, and top 10 slow case diagnostics.
- **`tests/tooling/ci-inputs.cjs` & `ci-assets.cjs`**: Classify git changes and validate static GLB/asset integrity.
- **`tests/tooling/run.cjs`**: Local test runner (`npm test`) enforcing identical budget constraints.
