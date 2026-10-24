const ts = require('typescript')
const { posix } = require('node:path')
const { isDeepStrictEqual: same } = require('node:util')

// Sources and existence checks form the filesystem boundary. The planner supplies
// repository sources; unit tests can exercise the same parser on tiny source maps.
function dependencyConsumers(inventory, sources, exists = file => sources.has(file)) {
  const graph = new Map()
  const runtimeAmbiguities = []
  const unresolvedImports = []
  for (const [file, source] of sources) {
    // Match Vite's runtime graph; type-only contracts are checked by typecheck.
    const runtime = /\.d\.[cm]?ts$/.test(file) ? '' : /\.tsx?$/.test(file) ? ts.transpileModule(source, {
      fileName: file, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    }).outputText : source
    if (/^(src\/|tests\/|electron\/|\.github\/scripts\/release\/)/.test(file)) {
      const parsed = ts.createSourceFile(file, runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      function inspect(node) {
        if (ts.isCallExpression(node)) {
          const callee = node.expression
          if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
            // The registration-only Node collector intentionally loads the exact
            // discovered file list. Its explicit tooling owner is ci-plan/budget;
            // this is the only computed-load boundary, not a tests/ exemption.
            const arg = node.arguments[0]
            const collectorLoad = file === 'tests/tooling/node-collect.cjs'
              && ts.isIdentifier(callee) && callee.text === 'require' && node.arguments.length === 1
              && ts.isCallExpression(arg) && ts.isIdentifier(arg.expression) && arg.expression.text === 'resolve'
              && arg.arguments.length === 1 && ts.isIdentifier(arg.arguments[0]) && arg.arguments[0].text === 'file'
            if (!collectorLoad && (node.arguments.length !== 1 || !ts.isStringLiteralLike(arg))) runtimeAmbiguities.push(file)
          }
        }
        // Inspect syntax instead of text so fixture strings do not create false
        // ambiguities. Catch glob references as well as direct calls.
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
          const owner = node.expression
          const property = ts.isPropertyAccessExpression(node) ? node.name.text
            : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null
          if (ts.isMetaProperty(owner) && owner.keywordToken === ts.SyntaxKind.ImportKeyword
            && owner.name.text === 'meta' && ['glob', 'globEager'].includes(property)) runtimeAmbiguities.push(file)
        }
        ts.forEachChild(node, inspect)
      }
      inspect(parsed)
    }
    const deps = []
    for (const { fileName } of ts.preProcessFile(runtime, true, true).importedFiles) {
      if (!fileName.startsWith('.')) continue
      const stem = posix.normalize(posix.join(posix.dirname(file), fileName.replace(/[?#].*$/, '')))
      const target = [stem, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '/index.ts', '/index.js'].map(ext => stem + ext)].find(exists)
      if (target) deps.push(target)
      else unresolvedImports.push(`${file} -> ${fileName}`)
    }
    graph.set(file, deps)
  }
  const consumers = {}
  for (const test of inventory) {
    const visited = new Set()
    function visit(file) {
      if (visited.has(file)) return
      visited.add(file)
      ;(consumers[file] ??= []).push(test.file)
      for (const dep of graph.get(file) ?? []) visit(dep)
    }
    visit(test.file)
  }
  consumers.runtimeAmbiguities = [...new Set(runtimeAmbiguities)]
  consumers.unresolvedImports = [...new Set(unresolvedImports)]
  // Exposed so the planner can explain a selection with a verifiable import chain.
  consumers.sources = sources
  consumers.graph = graph
  return consumers
}
// Shortest runtime import chain `from → ... → to`, or null when there is none.
function dependencyChain(graph, from, to) {
  if (from === to) return [from]
  const previous = new Map([[from, null]])
  const queue = [from]
  for (let i = 0; i < queue.length; i++) {
    for (const dep of graph.get(queue[i]) ?? []) {
      if (previous.has(dep)) continue
      previous.set(dep, queue[i])
      if (dep === to) {
        const chain = []
        for (let node = to; node !== null; node = previous.get(node)) chain.unshift(node)
        return chain
      }
      queue.push(dep)
    }
  }
  return null
}
function runtimeEquivalent(before, after, fileName = 'owner.ts') {
  if (/\.d\.[cm]?ts$/.test(fileName)) return true
  const fingerprint = source => {
    const runtime = ts.transpileModule(source, { fileName, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, removeComments: true } }).outputText
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, runtime)
    const tokens = []
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) tokens.push([kind, scanner.getTokenText()])
    return JSON.stringify(tokens)
  }
  return fingerprint(before) === fingerprint(after)
}
// A production-to-dev move changes packaging, not npm ci's test-installed graph.
// Prove the complete manifest/lock pair; publication/CI owner selection stays intact.
function dependencyPlacementOnly(beforePackage, afterPackage, beforeLock, afterLock) {
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  const placement = value => {
    if (!record(value)) throw new Error('Missing package metadata')
    const { dependencies = {}, devDependencies = {}, ...other } = value
    if (!record(dependencies) || !record(devDependencies)
      || Object.keys(dependencies).some(name => Object.hasOwn(devDependencies, name))
      || !Object.values({ ...dependencies, ...devDependencies }).every(version => typeof version === 'string')) throw new Error('Ambiguous dependency placement')
    return { dependencies, devDependencies, other }
  }
  try {
    const before = placement(JSON.parse(beforePackage)), after = placement(JSON.parse(afterPackage))
    const moved = Object.keys(before.dependencies).filter(name => !Object.hasOwn(after.dependencies, name))
    if (!moved.length || !same(before.other, after.other)
      || !same({ ...before.dependencies, ...before.devDependencies }, { ...after.dependencies, ...after.devDependencies })
      || Object.entries(after.dependencies).some(([name, version]) => before.dependencies[name] !== version)) return false
    const locks = [JSON.parse(beforeLock), JSON.parse(afterLock)]
    if (!locks.every(lock => record(lock) && lock.lockfileVersion === 3 && record(lock.packages))) return false
    for (const [index, manifest] of [before, after].entries()) {
      const root = placement(locks[index].packages[''])
      if (!same(root.dependencies, manifest.dependencies) || !same(root.devDependencies, manifest.devDependencies)) return false
    }
    const [{ packages: previous, ...oldFields }, { packages: current, ...newFields }] = locks
    if (!same(oldFields, newFields) || !same(Object.keys(previous).sort(), Object.keys(current).sort())) return false
    for (const name of Object.keys(previous)) {
      if (name === '') {
        if (!same(placement(previous[name]).other, placement(current[name]).other)) return false
        continue
      }
      if (!record(previous[name]) || !record(current[name])) return false
      const { dev: oldDev, ...oldMetadata } = previous[name], { dev: newDev, ...newMetadata } = current[name]
      if (!same(oldMetadata, newMetadata)
        || (!same(oldDev, newDev) && !((oldDev === undefined || oldDev === false) && newDev === true))) return false
    }
    return true
  } catch { return false }
}
// Prove relocation-only edits from Git lineage, never from a migration list.
// Directory/glob rewrites qualify only for a complete, one-to-one tree move.
function relocationOnly(before, after, changes, baseFiles, headFiles, input) {
  if (typeof before !== 'string' || typeof after !== 'string' || before === after) return false
  const renames = new Map(changes.filter(item => /^R\d+$/.test(item.status)).map(item => [item.oldFile, item.file]))
  const paths = new Map(renames)
  for (const [oldFile, file] of renames) {
    for (let oldDir = posix.dirname(oldFile), dir = posix.dirname(file); oldDir !== '.' && dir !== '.'; oldDir = posix.dirname(oldDir), dir = posix.dirname(dir)) {
      const descendants = [...baseFiles].filter(path => path.startsWith(oldDir + '/'))
      const moved = descendants.map(path => dir + path.slice(oldDir.length))
      if (descendants.length && ![...headFiles].some(path => path.startsWith(oldDir + '/')) && descendants.every((path, index) => renames.get(path) === moved[index])
        && [...headFiles].filter(path => path.startsWith(dir + '/')).every(path => moved.includes(path))) paths.set(oldDir, dir)
    }
  }
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!paths.size) return false
  const alternatives = [...paths.keys()].sort((a,b) => b.length - a.length).map(escape).join('|')
  const pattern = new RegExp(`(^|[\\s"'\x60=:(])([.]\\/)?(${alternatives})(?=$|[\\s"'\x60/,:;)])`, 'g')
  const replacePaths = text => text.replace(pattern, (_, prefix, dot, path) => prefix + (dot ?? '') + paths.get(path))
  if (input === 'package.json') {
    // npm scripts are shell programs, not arbitrary data strings. Recognize only
    // the Node entry operand; all flags, arguments, dependencies and other fields
    // must remain identical. Ambiguous shell programs keep native broad selection.
    try {
      const original = JSON.parse(before), current = JSON.parse(after)
      if (!original.scripts || typeof original.scripts !== 'object') return false
      for (const [name, command] of Object.entries(original.scripts)) {
        if (typeof command !== 'string') continue
        const match = /^(node[ \t]+)((?:[.]\/)?[\w./][\w./-]*)([ \t][^\r\n]*)?$/.exec(command)
        if (match) original.scripts[name] = match[1] + replacePaths(match[2]) + (match[3] ?? '')
      }
      return JSON.stringify(original) === JSON.stringify(current)
    } catch { return false }
  }
  if (!/^vitest[.]config[.][cm]?[jt]s$/.test(input ?? '')) return false
  const parsed = ts.createSourceFile(input, before, ts.ScriptTarget.Latest, true)
  const edits = []
  const key = node => node?.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) ? node.name.text : null
  function inspect(node) {
    if (ts.isStringLiteralLike(node)) {
      const property = ts.isArrayLiteralExpression(node.parent) ? node.parent.parent : node.parent
      const testObject = property.parent
      const testProperty = testObject?.parent
      const config = testProperty?.parent
      const call = config?.parent
      // Known path-bearing Vitest fields only, directly in the config object.
      // env/name/pattern values may happen to look like paths but are behavior.
      if (ts.isPropertyAssignment(property) && ['include', 'exclude', 'setupFiles', 'reporters'].includes(key(property))
        && ts.isObjectLiteralExpression(testObject) && ts.isPropertyAssignment(testProperty) && key(testProperty) === 'test'
        && ts.isObjectLiteralExpression(config) && ts.isCallExpression(call) && ['defineConfig', 'mergeConfig'].includes(call.expression.getText(parsed))) {
        const start = node.getStart(parsed), end = node.end
        edits.push([start, end, replacePaths(before.slice(start, end))])
      }
    }
    ts.forEachChild(node, inspect)
  }
  inspect(parsed)
  let projected = before
  for (const [start, end, text] of edits.sort((a,b) => b[0]-a[0])) projected = projected.slice(0,start) + text + projected.slice(end)
  return projected === after
}
module.exports = { dependencyConsumers, dependencyChain, runtimeEquivalent, dependencyPlacementOnly, relocationOnly }
