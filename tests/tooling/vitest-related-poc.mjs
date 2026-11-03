import { existsSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { createVitest } from 'vitest/node'

// Inspection only: selection belongs entirely to Vitest, never to the required planner.
const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2)
const changed = args[0] === '--changed'
if (!args.length || (changed && args.length !== 2) || (!changed && args.some(arg => arg.startsWith('-')))) {
  throw new Error('Usage: node tests/tooling/vitest-related-poc.mjs <related files...> | --changed <base SHA>')
}
if (process.env.LOGIC_TEST_FILES || process.env.LOGIC_TEST_CASES) {
  throw new Error('Unset LOGIC_TEST_FILES and LOGIC_TEST_CASES for repository-wide PoC inspection')
}
const cacheDir = resolve(root, 'output/vitest-cache')
function recordFiles(dir) {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name)
    return entry.isDirectory() ? recordFiles(path) : entry.name === 'dependencies.json' ? [path] : []
  }) : []
}
const records = recordFiles(cacheDir)
const started = performance.now()
const ctx = await createVitest('test', {
  root, watch: false, reporters: [],
  ...(changed ? { changed: args[1] } : { related: args.map(file => resolve(root, file)) }),
})
try {
  const specs = await ctx.getRelevantTestSpecifications()
  const selectionMs = performance.now() - started
  // Public collection executes registration, including each/dynamic cases, but no bodies.
  const { testModules, unhandledErrors } = await ctx.collectTests(specs)
  const errors = [...unhandledErrors, ...testModules.flatMap(module => [
    ...module.errors(), ...[...module.children.allSuites()].flatMap(suite => suite.errors()),
  ])]
  if (errors.length) throw new Error(errors.map(error => error.message).join('\n'))
  if (testModules.length !== specs.length) throw new Error('Incomplete Vitest collection')
  const files = testModules.map(module => ({
    file: relative(root, module.moduleId).replaceAll('\\', '/'),
    leaves: [...module.children.allTests()].length,
  })).sort((a, b) => a.file.localeCompare(b.file))
  console.log(JSON.stringify({
    mode: changed ? 'changed' : 'related', inputs: changed ? args[1] : args,
    cacheDir: relative(root, cacheDir),
    // Existence is not proof of complete coverage or a per-file cache hit.
    cacheState: records.length ? 'records-present; coverage not inspected' : 'cold; missing records conservatively select tests',
    selectedFiles: files.length, selectedLeaves: files.reduce((sum, file) => sum + file.leaves, 0),
    selectionMs, wallMs: performance.now() - started, files,
  }, null, 2))
} finally {
  await ctx.close()
}
