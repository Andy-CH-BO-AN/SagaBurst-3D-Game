const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const configPath = path.join(root, 'tsconfig.test.json')
const baselinePath = path.join(root, 'tests/typecheck-baseline.json')
const baselineVersion = 2
const config = ts.readConfigFile(configPath, ts.sys.readFile)
if (config.error) {
  console.error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  process.exit(1)
}
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath)
const program = ts.createProgram(parsed.fileNames, parsed.options)
const diagnostics = ts.getPreEmitDiagnostics(program)
const counts = new Map()
const locations = new Map()

function normalizedMessage(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    .replaceAll(root, '<root>')
    .replaceAll(root.replace(/\\/g, '/'), '<root>')
    .replace(/\s+/g, ' ')
    .trim()
}

function diagnosticDetails(diagnostic) {
  const file = diagnostic.file
    ? path.relative(root, diagnostic.file.fileName).split(path.sep).join('/')
    : '<config>'
  const position = diagnostic.file && diagnostic.start !== undefined
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    : undefined
  const source = diagnostic.file?.getFullText()
  const lineStart = position && diagnostic.start !== undefined
    ? source.lastIndexOf('\n', diagnostic.start - 1) + 1
    : -1
  const nextLineBreak = position && diagnostic.start !== undefined
    ? source.indexOf('\n', diagnostic.start)
    : -1
  const lineEnd = nextLineBreak < 0 ? source?.length ?? 0 : nextLineBreak
  const snippet = source && lineStart >= 0
    ? source.slice(lineStart, lineEnd).replace(/\s+/g, ' ').trim()
    : '<no-source>'
  return {
    file,
    code: `TS${diagnostic.code}`,
    message: normalizedMessage(diagnostic),
    snippet,
    line: position ? position.line + 1 : null,
    column: position ? position.character + 1 : null,
  }
}

for (const diagnostic of diagnostics) {
  const details = diagnosticDetails(diagnostic)
  const key = JSON.stringify({
    file: details.file,
    code: details.code,
    message: details.message,
    snippet: details.snippet,
  })
  counts.set(key, (counts.get(key) ?? 0) + 1)
  if (!locations.has(key)) locations.set(key, details)
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return undefined
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
}

function parseKey(key) {
  try { return JSON.parse(key) } catch { return undefined }
}

function groupCountsByStableFields(entries) {
  const groups = new Map()
  for (const [key, count] of entries) {
    const diagnostic = parseKey(key)
    if (!diagnostic) continue
    const groupKey = JSON.stringify({ file: diagnostic.file, code: diagnostic.code, message: diagnostic.message })
    groups.set(groupKey, (groups.get(groupKey) ?? 0) + count)
  }
  return groups
}

function reportDifferences(expected, actual, mode) {
  const keys = new Set([...expected.keys(), ...actual.keys()])
  const differences = [...keys]
    .map(key => ({ key, expected: expected.get(key) ?? 0, actual: actual.get(key) ?? 0 }))
    .filter(item => mode === 'increase' ? item.actual > item.expected : item.actual !== item.expected)
  if (differences.length === 0) return false

  for (const { key, expected: oldCount, actual: currentCount } of differences) {
    const diagnostic = locations.get(key) ?? parseKey(key) ?? { file: '<unknown>', code: 'diagnostic', message: key, line: null, column: null }
    console.error(`  ${diagnostic.file}:${diagnostic.line ?? '?'}:${diagnostic.column ?? '?'} ${diagnostic.code}: ${diagnostic.message} [source: ${diagnostic.snippet ?? '<unknown>'}] (${currentCount}, baseline ${oldCount})`)
  }
  return true
}

if (process.argv.includes('--update-baseline')) {
  const previous = readBaseline()
  const current = new Map(counts)

  if (previous?.version === baselineVersion) {
    const oldCounts = new Map(Object.entries(previous.diagnostics))
    if (reportDifferences(oldCounts, current, 'increase')) {
      console.error('Baseline update refused: the diagnostic baseline may only stay level or decrease.')
      process.exit(1)
    }
  } else if (previous && previous.version === undefined) {
    // One-time migration: compare legacy line/column fingerprints by file, code and message.
    const oldGroups = groupCountsByStableFields(Object.entries(previous))
    const newGroups = groupCountsByStableFields(current)
    if (reportDifferences(oldGroups, newGroups, 'increase')) {
      console.error('Baseline migration refused: diagnostics increased within an existing file/code/message group.')
      process.exit(1)
    }
  }

  const baseline = {
    version: baselineVersion,
    diagnostics: Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b))),
  }
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
  console.log(`Recorded ${diagnostics.length} diagnostics across ${counts.size} stable diagnostic identities.`)
  process.exit(0)
}

const baseline = readBaseline()
if (!baseline) {
  console.error(`Missing historical diagnostic baseline: ${path.relative(root, baselinePath)}`)
  process.exit(1)
}
if (baseline.version !== baselineVersion || !baseline.diagnostics) {
  console.error('Diagnostic baseline format is outdated; run npm run typecheck:test -- --update-baseline to migrate it.')
  process.exit(1)
}

if (reportDifferences(new Map(Object.entries(baseline.diagnostics)), counts, 'all')) {
  console.error('Test type-check diagnostics differ from the baseline. Fix diagnostics or deliberately update the baseline.')
  process.exit(1)
}

console.log(`Test type-check passed with ${diagnostics.length} diagnostics matching the downward baseline.`)
