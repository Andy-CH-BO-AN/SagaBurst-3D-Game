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

module.exports = { validateRunSummary, buildSeed, validSeedMetadata,
  validateAffectedQuery }
