const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const configPath = path.join(root, 'tsconfig.test.json')
const baselinePath = path.join(root, 'tests/typecheck-baseline.json')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
if (config.error) {
  console.error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  process.exit(1)
}
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath)
const program = ts.createProgram(parsed.fileNames, parsed.options)
const diagnostics = ts.getPreEmitDiagnostics(program)
const counts = new Map()

for (const diagnostic of diagnostics) {
  const file = diagnostic.file
    ? path.relative(root, diagnostic.file.fileName).split(path.sep).join('/')
    : '<config>'
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').replace(/\s+/g, ' ').trim()
  const position = diagnostic.file && diagnostic.start !== undefined
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    : undefined
  const key = JSON.stringify({
    file,
    code: `TS${diagnostic.code}`,
    message,
    line: position ? position.line + 1 : null,
    column: position ? position.character + 1 : null,
  })
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

if (process.argv.includes('--update-baseline')) {
  const baseline = Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)))
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
  console.log(`Recorded ${diagnostics.length} existing diagnostics across ${counts.size} diagnostic identities.`)
  process.exit(0)
}

if (!fs.existsSync(baselinePath)) {
  console.error(`Missing historical diagnostic baseline: ${path.relative(root, baselinePath)}`)
  process.exit(1)
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const newDiagnostics = [...counts].filter(([key, count]) => count > (baseline[key] ?? 0))
if (newDiagnostics.length > 0) {
  console.error('Test type-check found new diagnostics:')
  for (const [key, count] of newDiagnostics) {
    const diagnostic = JSON.parse(key)
    console.error(`  ${diagnostic.file}:${diagnostic.line ?? '?'}:${diagnostic.column ?? '?'} ${diagnostic.code}: ${diagnostic.message} (${count}, baseline ${baseline[key] ?? 0})`)
  }
  process.exit(1)
}

console.log(`Test type-check passed; ${diagnostics.length} existing diagnostics remain within the checked baseline.`)
