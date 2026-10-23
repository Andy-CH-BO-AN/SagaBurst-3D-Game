const ts = require('typescript')
const { posix } = require('node:path')

// Sources and existence checks form the filesystem boundary. The planner supplies
// repository sources; unit tests can exercise the same parser on tiny source maps.
function dependencyConsumers(inventory, sources, exists = file => sources.has(file)) {
  const graph = new Map()
  const runtimeAmbiguities = []
  for (const [file, source] of sources) {
    // Match Vite's runtime graph; type-only contracts are checked by typecheck.
    const runtime = /\.tsx?$/.test(file) ? ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    }).outputText : source
    if (/^(src\/|tests\/|electron\/|tools\/release\/)/.test(file)) {
      const parsed = ts.createSourceFile(file, runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      function inspect(node) {
        if (ts.isCallExpression(node)) {
          const callee = node.expression
          if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
            if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) runtimeAmbiguities.push(file)
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
      const stem = posix.normalize(posix.join(posix.dirname(file), fileName))
      const target = [stem, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '/index.ts', '/index.js'].map(ext => stem + ext)].find(exists)
      if (target) deps.push(target)
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
function runtimeEquivalent(before, after) {
  const fingerprint = source => {
    const runtime = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, removeComments: true } }).outputText
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, runtime)
    const tokens = []
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) tokens.push([kind, scanner.getTokenText()])
    return JSON.stringify(tokens)
  }
  return fingerprint(before) === fingerprint(after)
}
module.exports = { dependencyConsumers, dependencyChain, runtimeEquivalent }
