import { writeFileSync } from 'node:fs'
import { hrtime } from 'node:process'
import budget from './budget.cjs'

// Vitest 4.1 runner's duration starts before beforeEach/aroundEach and ends
// after afterEach, fixture teardown and onTestFinished/onTestFailed. Its bound
// performance.now is captured before fake timers. Do not replace it with the
// test body timeout or reporter event arrival times.
export default class BudgetReporter {
  onTestRunStart() { this.start = hrtime.bigint() }

  onTestRunEnd(modules, unhandledErrors, reason) {
    const cases = []
    const files = []
    const errors = unhandledErrors.map(error => error.message)
    for (const module of modules) {
      errors.push(...module.errors().map(error => `${module.relativeModuleId}: ${error.message}`))
      for (const suite of module.children.allSuites()) {
        errors.push(...suite.errors().map(error => `${suite.fullName}: ${error.message}`))
      }
      let caseMs = 0
      for (const test of module.children.allTests()) {
        // A requested name filter may leave unrelated collected cases skipped.
        // Full npm test has no filter and checks every retained case instead.
        if (process.env.LOGIC_TEST_TARGETED === '1' && test.result().state === 'skipped') continue
        const diagnostic = test.diagnostic()
        cases.push({
          id: test.id, file: module.relativeModuleId, name: test.fullName,
          state: test.result().state, ms: diagnostic?.duration,
          retry: diagnostic?.retryCount || test.options.retry,
          repeats: diagnostic?.repeatCount || test.options.repeats,
          mode: test.options.mode,
        })
        caseMs += diagnostic?.duration ?? 0
      }
      const diagnostic = module.diagnostic()
      files.push({
        file: module.relativeModuleId,
        count: [...module.children.allTests()].length,
        collectMs: diagnostic.collectDuration, setupMs: diagnostic.setupDuration,
        prepareMs: diagnostic.prepareDuration, environmentMs: diagnostic.environmentSetupDuration,
        executionMs: diagnostic.duration,
        // Serial cases: residual includes beforeAll/afterAll and runner overhead.
        sharedHooksAndRunnerMs: Math.max(0, diagnostic.duration - caseMs),
      })
    }
    const report = {
      runner: 'vitest', runId: process.env.LOGIC_TEST_RUN_ID,
      complete: reason === 'passed', errors, cases, files,
      wallMs: Number(hrtime.bigint() - this.start) / 1e6,
    }
    if (process.env.LOGIC_TEST_VITEST_REPORT) writeFileSync(process.env.LOGIC_TEST_VITEST_REPORT, JSON.stringify(report, null, 2))
    const result = budget.validateReports([report], { runners: ['vitest'] })
    console.log(`Vitest logic budget: ${result.count} cases; max ${result.maxMs.toFixed(3)}ms including hooks/cleanup`)
  }
}
