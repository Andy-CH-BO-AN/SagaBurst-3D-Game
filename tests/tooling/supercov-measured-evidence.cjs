'use strict'
// Supercov coverage completeness is NOT the same as safe, complete test
// attribution. Full code/branch coverage is not a prerequisite for a seed.
const fail = m => { throw new Error('Supercov measured evidence unsafe: ' + m) }
const RUN = /^run_[a-z0-9]+$/i
const SHA = /^[a-f0-9]{40}$/
const VERSION = '4.24.2'
const SEED_SCHEMA = 2

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
  if (d.tests !== expectedTests || t?.passed !== expectedTests ||
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
  return { runId: d.run, tests: expectedTests, coverageComplete: d.coverage.coverageComplete }
}

function buildSeed({ sha, runId, tests, coverageComplete }, generation = 0) {
  if (!SHA.test(sha || '') || !RUN.test(runId || '') ||
      !Number.isSafeInteger(tests) || tests < 1 ||
      !Number.isSafeInteger(generation) || generation < 0 ||
      typeof coverageComplete !== 'boolean') fail('Invalid seed provenance')
  return { schemaVersion: SEED_SCHEMA, version: VERSION, sha, runId, generation,
    tests, valid: true, measurementComplete: true, executionComplete: true,
    attributionComplete: true, coverageComplete }
}

function validSeedMetadata(s) {
  return s?.schemaVersion === SEED_SCHEMA && s.version === VERSION &&
    SHA.test(s.sha || '') && RUN.test(s.runId || '') &&
    s.valid === true && s.measurementComplete === true &&
    s.executionComplete === true && s.attributionComplete === true &&
    typeof s.coverageComplete === 'boolean' &&
    Number.isSafeInteger(s.tests) && s.tests > 0 &&
    Number.isSafeInteger(s.generation) && s.generation >= 0 &&
    s.generation <= 16
}

module.exports = { validateRunSummary, buildSeed, validSeedMetadata }
