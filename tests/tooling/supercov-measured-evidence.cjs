'use strict'
// Supercov coverage completeness is NOT the same as safe, complete test
// attribution. Full code/branch coverage is not a prerequisite for a seed.
const fail = m => { throw new Error('Supercov measured evidence unsafe: ' + m) }
const RUN = /^run_[a-z0-9]+$/i
const SHA = /^[a-f0-9]{40}$/
const VERSION = '4.24.2'
const SEED_SCHEMA = 3

function validateRunSummary(result, expectedTests) {
  if (!Number.isSafeInteger(expectedTests) || expectedTests < 1 ||
    result?.schemaVersion !== 1 || result.ok !== true ||
    result.command !== 'coverage.summary') fail('Invalid CLI envelope or expected Vitest inventory')
  const d = result.data
  if (!RUN.test(d?.run || '') || d.valid !== true || d.testExitCode !== 0 ||
      d.stale !== false || (d.staleReasons?.length ?? -1) !== 0) {
    fail('Run invalid, failed, stale or missing exact identity')
  }
  // measurement.complete means all measurable source obligations were
  // accounted for. Top-level complete/structurallyComplete/coverageComplete
  // describe full *coverage* of every program branch and are not required.
  if (d.measurement?.complete !== true || d.measurement.limitations !== 0 ||
      d.measurement.evidenceCorruptions !== 0 || d.measurement.blocking !== 0 ||
      d.measurement.declared !== 0 ||
      d.filesWithMeasurementLimitations !== 0 ||
      d.transport?.corruptFiles !== 0 || d.transport?.corruptRecords !== 0) {
    fail('Incomplete measured denominator or corrupt/unmeasured evidence')
  }
  const t = d.testOutcomes
  if (!Number.isSafeInteger(d.setups) || d.setups < 0 ||
      d.tests !== expectedTests || t?.passed !== expectedTests ||
      ['failed', 'flaky', 'skipped', 'timedOut', 'interrupted', 'unknown',
        'unstarted', 'todo'].some(field => t[field] !== 0)) {
    fail('Incomplete/failed instrumented test roster; expected ' + expectedTests)
  }
  if (d.testAttribution?.exact !== expectedTests ||
      d.testAttribution.byTime !== 0 || d.testAttribution.partial !== 0 ||
      d.testAttribution.runWide !== 0) {
    fail('Inexact or unbound individual test attribution')
  }
  if (d.sourceScope?.mode !== 'explicit' ||
      !Array.isArray(d.sourceScope?.roots) ||
      !['src', 'tests/helpers'].every(root => d.sourceScope.roots.includes(root)) ||
      d.sourceScope.ambiguous !== 0) {
    fail('Missing exact source scope, new ambiguous source, or changed measurement roots')
  }
  if (d.coverage?.coverageComplete !== true && d.coverage?.coverageComplete !== false) {
    fail('Missing true coverage-completeness marker')
  }
  return { runId: d.run, tests: expectedTests, setups: d.setups,
    coverageComplete: d.coverage.coverageComplete }
}

// A seed may only follow a verified normal Full run of this exact commit.
function requireVerifiedFullPlan(plan, aggregate, sha) {
  const inventory = plan.inventory.filter(item => item.runner === 'vitest')
  const fullCount = plan.inventory.reduce((count, item) => count + item.names.length, 0)
  if (plan.mode !== 'full' || plan.checkoutSha !== sha || plan.headSha !== sha) {
    fail('Only an exact-SHA verified Full plan can bootstrap evidence')
  }
  if (aggregate?.planId !== plan.planId || aggregate.mode !== 'full' ||
      aggregate.result !== 'passed' || aggregate.count !== fullCount || !inventory.length) {
    fail('A complete, passing, normal-Vitest Full aggregate must exist before instrumentation')
  }
  return inventory
}

// Vitest's own JSON roster of the instrumented run must list exactly the planned
// (file, test) identities, every one passed. Supercov only exposes their counts.
function validateRoster(report, inventory) {
  const local = file => file.slice(file.lastIndexOf('/tests/') + 1)
  const measured = (report?.testResults ?? []).flatMap(result =>
    (result.assertionResults ?? []).map(test => ({ id: JSON.stringify([local(result.name),
      [...test.ancestorTitles, test.title].join(' ')]), status: test.status })))
  const planned = inventory.flatMap(item => (item.nativeNames ?? item.names).map(name =>
    JSON.stringify([item.file, name])))
  if (report?.success !== true || !measured.length ||
      measured.some(test => test.status !== 'passed')) {
    fail('Instrumented roster has failed, skipped or missing tests')
  }
  const sorted = list => JSON.stringify([...list].sort())
  if (sorted(measured.map(test => test.id)) !== sorted(planned)) {
    fail('Instrumented test identities differ from the Vitest inventory')
  }
  return measured.length
}

function buildSeed({ sha, runId, tests, setups, coverageComplete }) {
  if (!SHA.test(sha || '') || !RUN.test(runId || '') ||
      !Number.isSafeInteger(tests) || tests < 1 ||
      !Number.isSafeInteger(setups) || setups < 0 ||
      typeof coverageComplete !== 'boolean') fail('Invalid seed provenance')
  return { schemaVersion: SEED_SCHEMA, version: VERSION, sha, runId,
    tests, setups, valid: true, measurementComplete: true, executionComplete: true,
    attributionComplete: true, coverageComplete }
}

function validSeedMetadata(s) {
  return s?.schemaVersion === SEED_SCHEMA && s.version === VERSION &&
    SHA.test(s.sha || '') && RUN.test(s.runId || '') &&
    s.valid === true && s.measurementComplete === true &&
    s.executionComplete === true && s.attributionComplete === true &&
    typeof s.coverageComplete === 'boolean' &&
    Number.isSafeInteger(s.tests) && s.tests > 0 &&
    Number.isSafeInteger(s.setups) && s.setups >= 0 &&
    !Object.hasOwn(s, 'generation')
}


// Supercov's tests affected summary counts suite setup lifecycle records as
// well as executed test leaves. Unaffected identities are intentionally
// count-only (truncated) in the public --json response, even on a pristine
// checkout. Never require all unaffected objects to be materialized.
const UNAFFECTED_TRUNCATION = 'unaffected tests are counted, not listed'
const REASONS_TRUNCATION = 'each test keeps its first three reasons'
const LISTS_TRUNCATION = 'the lists keep their first, highest-ranked tests; `--names` lists every one'

function validateAffectedQuery(result, runId, { tests, setups, pristine = false } = {}) {
  if (result?.schemaVersion !== 1 || result.ok !== true ||
      result.command !== 'runs.tests.affected' || result.data?.run !== runId) {
    fail('Affected query CLI envelope or source run does not match')
  }
  const d = result.data
  const counts = d.summary
  if (!counts || !['tests', 'affected', 'undetermined', 'unaffected']
      .every(k => Number.isSafeInteger(counts[k]) && counts[k] >= 0) ||
      counts.tests !== counts.affected + counts.undetermined + counts.unaffected ||
      !counts.tests) fail('Invalid or partial affected inventory counts')
  if (tests !== undefined || setups !== undefined) {
    if (!Number.isSafeInteger(tests) || tests < 1 ||
        !Number.isSafeInteger(setups) || setups < 0 ||
        counts.tests !== tests + setups) {
      fail('Affected inventory count must equal exact Vitest leaves plus setup records')
    }
  }
  // Supercov may emit affectedCount/undeterminedCount alongside complete
  // identity arrays. These are *redundant counters*, not truncation markers:
  // exact identity arrays and the summary must independently agree.
  if (d.affectedCount !== undefined &&
      (!Number.isSafeInteger(d.affectedCount) ||
       d.affectedCount !== counts.affected)) {
    fail('Affected count does not agree with complete affected identities')
  }
  if (d.undeterminedCount !== undefined &&
      (!Number.isSafeInteger(d.undeterminedCount) ||
       d.undeterminedCount !== counts.undetermined)) {
    fail('Undetermined count does not agree with complete undetermined identities')
  }
  if (!Array.isArray(d.affected) || !Array.isArray(d.undetermined) ||
      !Array.isArray(d.unaffected) ||
      d.affected.length !== counts.affected ||
      d.undetermined.length !== counts.undetermined ||
      !Array.isArray(d.truncated ?? []) ||
      (d.truncated ?? []).some(reason => ![
        UNAFFECTED_TRUNCATION, REASONS_TRUNCATION, LISTS_TRUNCATION,
      ].includes(reason))) {
    // Public CLI versions may use different list-summary conventions. Log
    // shape only (never silently select an incomplete list) so the exact
    // rejected condition is visible in the GitHub Actions job.
    fail('Affected/undetermined test identities truncated or unavailable: ' +
      JSON.stringify({
        affected: Array.isArray(d.affected) ? d.affected.length : typeof d.affected,
        undetermined: Array.isArray(d.undetermined) ? d.undetermined.length : typeof d.undetermined,
        unaffected: Array.isArray(d.unaffected) ? d.unaffected.length : typeof d.unaffected,
        affectedCount: d.affectedCount, undeterminedCount: d.undeterminedCount,
        unaffectedCount: d.unaffectedCount,
        summary: counts,
        truncated: d.truncated,
      }))
  }
  const truncated = (d.truncated ?? []).includes(UNAFFECTED_TRUNCATION)
  if (truncated) {
    if (d.unaffected.length !== 0 || d.unaffectedCount !== counts.unaffected) {
      fail('Count-only unaffected identities are incomplete or inconsistent')
    }
  } else if (d.unaffected.length !== counts.unaffected ||
      (d.unaffectedCount !== undefined && d.unaffectedCount !== counts.unaffected)) {
    fail('Untruncated unaffected identities incomplete')
  }
  const w = d.workingTree
  if (!w || !Array.isArray(w.reasons) || !Array.isArray(w.runWide) ||
      typeof w.sourceSetChanged !== 'boolean' || typeof w.stale !== 'boolean') {
    fail('Missing Supercov working-tree integrity metadata')
  }
  if (pristine && (w.stale || w.sourceSetChanged || w.reasons.length ||
      w.runWide.length || counts.affected !== 0 ||
      counts.undetermined !== 0 || counts.changedFiles !== 0 ||
      !Array.isArray(d.changedFiles) || d.changedFiles.length !== 0)) {
    fail('Full baseline is not pristine against its own measured SHA')
  }
  return { counts, workingTree: w, affected: d.affected,
    undetermined: d.undetermined, unaffected: d.unaffected,
    truncatedUnaffected: truncated }
}


/**
 * Rebuild complete structured identities using Supercov's own documented
 * --test-file <file-or-directory> --json API. Never infer a file from a test
 * title. The filters only need to span the files with affected tests, so their
 * affected and undetermined totals must equal the global unfiltered counts: any
 * identity outside them shows up as a difference and fails rather than
 * under-selecting.
 */
function reconcileAffectedFiles(global, fileResults, filters, runId, baseline = {}) {
  const d = global?.data
  const counts = d?.summary
  if (global?.schemaVersion !== 1 || global.ok !== true ||
      global.command !== 'runs.tests.affected' || d?.run !== runId ||
      !counts || !['tests', 'affected', 'undetermined', 'unaffected']
        .every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0) ||
      counts.tests !== counts.affected + counts.undetermined + counts.unaffected) {
    fail('Cannot expand unsafe global native affected summary')
  }
  if (!Array.isArray(filters) || !filters.length ||
      !Array.isArray(fileResults) || fileResults.length !== filters.length ||
      new Set(filters).size !== filters.length ||
      filters.some(filter => typeof filter !== 'string' || !/^tests(\/[^/]+)+$/.test(filter))) {
    fail('Missing or duplicate Vitest filters for exact Supercov expansion')
  }
  const added = { tests: 0, affected: 0, undetermined: 0, unaffected: 0 }
  const affected = [], undetermined = [], seen = new Set()
  for (let index = 0; index < filters.length; index++) {
    const filter = filters[index]
    const part = fileResults[index]
    const p = part?.data
    const c = p?.summary
    if (part?.schemaVersion !== 1 || part.ok !== true ||
        part.command !== 'runs.tests.affected' || p?.run !== runId ||
        p.filter !== '--test-file ' + filter ||
        !c || !['tests', 'affected', 'undetermined', 'unaffected']
          .every(k => Number.isSafeInteger(c[k]) && c[k] >= 0) ||
        c.tests !== c.affected + c.undetermined + c.unaffected ||
        !Array.isArray(p.affected) || !Array.isArray(p.undetermined) ||
        !Array.isArray(p.unaffected) ||
        p.affected.length !== c.affected ||
        p.undetermined.length !== c.undetermined ||
        !Array.isArray(p.truncated ?? []) ||
        (p.truncated ?? []).some(reason => ![
          UNAFFECTED_TRUNCATION, REASONS_TRUNCATION, LISTS_TRUNCATION,
        ].includes(reason)) ||
        p.workingTree?.sourceSetChanged !== d.workingTree?.sourceSetChanged ||
        p.workingTree?.stale !== d.workingTree?.stale ||
        JSON.stringify(p.workingTree?.runWide) !== JSON.stringify(d.workingTree?.runWide)) {
      fail('Filtered Supercov identities incomplete, truncated or foreign: ' + filter)
    }
    if (p.affectedCount !== undefined && p.affectedCount !== c.affected ||
        p.undeterminedCount !== undefined && p.undeterminedCount !== c.undetermined) {
      fail('Filtered Supercov affected counts disagree: ' + filter)
    }
    const unaffectedTruncated = (p.truncated ?? []).includes(UNAFFECTED_TRUNCATION)
    if (unaffectedTruncated
      ? p.unaffected.length !== 0 || p.unaffectedCount !== c.unaffected
      : p.unaffected.length !== c.unaffected ||
        p.unaffectedCount !== undefined && p.unaffectedCount !== c.unaffected) {
      fail('Filtered unaffected denominator missing: ' + filter)
    }
    for (const bucket of ['affected','undetermined','unaffected']) {
      for (const row of p[bucket]) {
        if (!row || (row.file !== filter && !row.file?.startsWith(filter + '/')) ||
            typeof row.name !== 'string' || !row.name) {
          fail('Filtered identity attributed to unknown test file: ' + filter)
        }
        const id = JSON.stringify([row.file, row.name])
        if (seen.has(id)) fail('Duplicate Supercov identity across file filters: ' + id)
        seen.add(id)
        if (bucket === 'affected') affected.push(row)
        if (bucket === 'undetermined') undetermined.push(row)
      }
    }
    for (const key of Object.keys(added)) added[key] += c[key]
  }
  for (const key of ['affected', 'undetermined']) {
    if (added[key] !== counts[key]) {
      fail('Filtered Supercov ' + key + ' does not reconcile with global count: ' +
        added[key] + ' vs ' + counts[key])
    }
  }
  if (added.tests > counts.tests || added.unaffected > counts.unaffected) {
    fail('Filtered Supercov totals exceed the global inventory')
  }
  const expanded = { ...global, data: { ...d, affected, undetermined } }
  // Reuse the exact same fail-closed full-inventory validation as the
  // direct response. A reason-only truncation is allowed, names are not.
  validateAffectedQuery(expanded, runId, baseline)
  return expanded
}

// Supercov keeps a ranked preview for large answers; such a part needs narrower filters.
function isPreviewed(part) {
  const p = part?.data
  return (p?.truncated ?? []).includes(LISTS_TRUNCATION) &&
    (p.affected?.length < p.summary?.affected || p.undetermined?.length < p.summary?.undetermined)
}

module.exports = { validateRunSummary, buildSeed, validSeedMetadata,
  validateAffectedQuery, reconcileAffectedFiles, isPreviewed,
  validateRoster, requireVerifiedFullPlan }
