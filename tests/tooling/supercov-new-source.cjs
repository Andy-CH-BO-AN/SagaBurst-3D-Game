'use strict'
// Static proof for runtime modules a PR adds. The exact-base Full seed has no
// record of them, so Supercov cannot attribute them; this module only answers
// "which test files really load this module at PR head?" from TypeScript's own
// parser and module resolver. It never guesses from names and never produces
// coverage evidence.
const { dirname, relative, resolve } = require('node:path')
const { existsSync, readFileSync, readdirSync } = require('node:fs')
const ts = require('typescript')

const CODE = /\.[cm]?[jt]sx?$/
const isTestFile = file => /^tests\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) && !/\.cjs$/.test(file)
// Calls whose callback the test runner itself invokes.
const RUNS_CALLBACK = new Set(['it', 'test', 'describe', 'suite', 'beforeAll', 'beforeEach', 'afterAll', 'afterEach'])

function diskHost(root) {
  const walk = dir => readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? walk(dir + '/' + item.name) : [dir + '/' + item.name])
  const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile)
  if (config.error) throw new Error('tsconfig.json is unreadable')
  return {
    root,
    options: ts.parseJsonConfigFileContent(config.config, ts.sys, root).options,
    files: () => [...walk('src'), ...walk('tests')].filter(file => CODE.test(file)),
    readFile: file => readFileSync(resolve(root, file), 'utf8'),
    moduleHost: ts.sys,
    assetExists: file => existsSync(file),
  }
}

function literal(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null
}
// TypeScript's own emit decides which imports survive. Types, and imports nothing
// uses as a value (shadowed names included), are gone from it, as they are at run time.
function emittedSource(file, text) {
  if (/\.d\.[cm]?ts$/.test(file)) return ts.createSourceFile(file, '', ts.ScriptTarget.Latest, true)
  const { outputText } = ts.transpileModule(text, { fileName: file, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, isolatedModules: true, jsx: ts.JsxEmit.Preserve } })
  return ts.createSourceFile(file, outputText, ts.ScriptTarget.Latest, true)
}
function emitsNothing(source) {
  return source.statements.every(statement => ts.isExportDeclaration(statement) && !statement.moduleSpecifier &&
    statement.exportClause && ts.isNamedExports(statement.exportClause) && !statement.exportClause.elements.length)
}
function calleeRoot(node) {
  while (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node)) node = node.expression
  return ts.isIdentifier(node) ? node.text : null
}
// Whether running the file certainly reaches this node: no branch or loop may guard
// it, and every enclosing function must be a callback the test runner invokes. Unused
// helpers, skipped branches and vi.mock factories therefore prove nothing. This reads
// syntax only, so a statement after an early return can still pass.
function runsUnconditionally(node) {
  for (let parent = node.parent, child = node; parent; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent) || ts.isIterationStatement(parent, false) ||
        ts.isSwitchStatement(parent) || ts.isCatchClause(parent)) return false
    if (ts.isBinaryExpression(parent) && parent.right === child && [ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind)) return false
    if (ts.isFunctionLike(parent) && !(ts.isCallExpression(parent.parent) && parent.parent.arguments.includes(parent) &&
        RUNS_CALLBACK.has(calleeRoot(parent.parent.expression)))) return false
  }
  return true
}

function scanModule(file, text) {
  const source = emittedSource(file, text)
  const found = { imports: [], dynamicImports: [], certainImports: [], mocks: [], opaque: [], typeOnly: emitsNothing(source) }
  const opaque = (node, why) => found.opaque.push(file + ': ' + why + ': ' + node.getText())
  const dynamic = (node, specifier) => {
    found.dynamicImports.push(specifier)
    if (runsUnconditionally(node)) found.certainImports.push(specifier)
  }
  const visit = node => {
    if (ts.isImportDeclaration(node)) {
      found.imports.push(literal(node.moduleSpecifier))
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) found.imports.push(literal(node.moduleSpecifier))
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) found.imports.push(literal(node.moduleReference.expression))
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      const first = literal(node.arguments[0])
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        if (first === null) opaque(node, 'dynamic import with a computed path')
        else dynamic(node, first)
      } else if (ts.isIdentifier(callee) && callee.text === 'require' && node.arguments.length) {
        if (first === null) opaque(node, 'require with a computed path')
        else dynamic(node, first)
      } else if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text
        if (ts.isMetaProperty(callee.expression) && (method === 'glob' || method === 'globEager')) {
          opaque(node, 'import.meta.' + method)
        } else if (ts.isIdentifier(callee.expression) && callee.expression.text === 'vi' &&
            (method === 'mock' || method === 'doMock')) {
          found.mocks.push(first)
        }
      }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL') {
      // new URL('./worker.ts', import.meta.url) is how bundlers load a module by path.
      const base = node.arguments?.[1]
      if (base && ts.isPropertyAccessExpression(base) && ts.isMetaProperty(base.expression)) {
        const target = literal(node.arguments[0])
        if (target === null) opaque(node, 'new URL with a computed path')
        else if (CODE.test(target)) dynamic(node, target)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function buildGraph(host) {
  const local = file => relative(host.root, file).replaceAll('\\', '/')
  const absolute = file => resolve(host.root, file)
  const resolver = (specifier, from) => {
    const clean = specifier.replace(/[?#].*$/, '')
    const hit = ts.resolveModuleName(clean, absolute(from), host.options, host.moduleHost).resolvedModule
    if (hit) return hit.isExternalLibraryImport ? { external: true } : { file: local(hit.resolvedFileName) }
    if (clean.startsWith('.') || clean.startsWith('/')) {
      // Assets are not modules. Only an existing non-code file may stand in.
      const asset = resolve(dirname(absolute(from)), clean)
      return !CODE.test(clean) && host.assetExists(asset) ? { external: true } : { unresolved: true }
    }
    const pkg = clean.startsWith('@') ? clean.split('/').slice(0, 2).join('/') : clean.split('/')[0]
    return host.assetExists(resolve(host.root, 'node_modules', pkg)) || clean.startsWith('node:')
      ? { external: true } : { unresolved: true }
  }
  const graph = new Map()
  for (const file of host.files()) {
    const scan = scanModule(file, host.readFile(file))
    const node = { edges: new Set(), dynamicEdges: new Set(), certainEdges: new Set(), mocks: new Set(), opaqueMock: false,
      opaque: scan.opaque, unresolved: [], typeOnly: scan.typeOnly }
    for (const [specifiers, edges] of [[scan.imports, node.edges], [scan.dynamicImports, node.dynamicEdges], [scan.certainImports, node.certainEdges]]) {
      for (const specifier of specifiers) {
        const target = resolver(specifier, file)
        if (target.unresolved && edges !== node.certainEdges) node.unresolved.push(file + ' -> ' + specifier)
        else if (target.file) edges.add(target.file)
      }
    }
    for (const specifier of scan.mocks) {
      if (specifier === null) { node.opaqueMock = true; continue }
      const target = resolver(specifier, file)
      if (target.file) node.mocks.add(target.file)
    }
    graph.set(file, node)
  }
  return graph
}

// What a test file certainly executes: its static imports, the dynamic imports it
// reaches unconditionally, and every static import beneath them. A dynamic import
// inside production code may never run, and a module the test replaces with vi.mock
// does not run, so neither they nor anything reachable only through them counts.
function loadedBy(graph, testFile) {
  const start = graph.get(testFile)
  const seen = new Set([testFile])
  const queue = [...start.edges, ...start.certainEdges]
  while (queue.length) {
    const next = queue.pop()
    if (seen.has(next) || start.mocks.has(next) || !graph.has(next)) continue
    seen.add(next)
    queue.push(...graph.get(next).edges)
  }
  return seen
}

/**
 * For each added source: its importers and every test file that loads it, plus
 * the test files behind each importer. Facts only; the checks below judge them.
 */
function analyzeNewSources(newSources, host) {
  const graph = buildGraph(host)
  const added = new Set(newSources)
  const importers = new Map(newSources.map(file => [file, [...graph].flatMap(([from, node]) =>
    !isTestFile(from) && (node.edges.has(file) || node.dynamicEdges.has(file)) ? [from] : [])]))
  const tracked = new Set([...newSources, ...[...importers.values()].flat()])
  const loaders = new Map([...tracked].map(file => [file, []]))
  for (const testFile of graph.keys()) {
    if (!isTestFile(testFile) || graph.get(testFile).opaqueMock) continue
    const loaded = loadedBy(graph, testFile)
    for (const file of tracked) if (loaded.has(file)) loaders.get(file).push(testFile)
  }
  // A computed loader anywhere in production could reach an added module, and
  // a broken specifier means the graph itself cannot be trusted.
  const blocking = [...graph].flatMap(([file, node]) => file.startsWith('src/')
    ? [...node.opaque, ...node.unresolved] : [])
  return {
    blocking,
    sources: newSources.map(file => {
      const node = graph.get(file)
      if (!node) throw new Error('Added runtime source is not part of the module graph: ' + file)
      return { file, typeOnly: node.typeOnly, testFiles: loaders.get(file).sort(),
        importers: importers.get(file).map(from => ({ file: from, added: added.has(from),
          testFiles: loaders.get(from).sort() })) }
    }),
  }
}

// Problems that hold whatever gets selected, so they fail before any Supercov query.
function structuralProblems(analysis) {
  return [
    ...analysis.blocking.map(item => 'module graph cannot be proven complete: ' + item),
    ...analysis.sources.filter(source => !source.typeOnly && !source.testFiles.length).map(source =>
      source.file + ': no test file loads it' + (source.importers.length
        ? ' (imported by ' + source.importers.map(item => item.file).join(', ') + ')' : ' (nothing imports it)')),
  ]
}

/**
 * The final verdict, once the selection is known. An added module is allowed only
 * when: the test files that load it are all selected, and each existing module that
 * imports it has real test evidence of its own, measured at the base or from an
 * added/modified test that loads it now. Static reach shows a test loads the module,
 * not that it asserts anything; that remains the reviewer's call.
 */
function requireNewSourceProof(analysis, { selectedFiles, directTests, baselineTests }) {
  const selected = new Set(selectedFiles)
  const problems = structuralProblems(analysis)
  const sources = []
  for (const source of analysis.sources) {
    if (source.typeOnly) {
      sources.push({ file: source.file, verdict: 'declares only types, nothing to execute' })
      continue
    }
    const unselected = source.testFiles.filter(file => !selected.has(file))
    if (unselected.length) {
      problems.push(source.file + ': Supercov did not select test files that load it: ' + unselected.join(', '))
    }
    for (const importer of source.importers.filter(item => !item.added)) {
      const measured = importer.testFiles.some(file => directTests.includes(file)) || baselineTests(importer.file) > 0
      if (!measured) problems.push(source.file + ': existing importer ' + importer.file + ' has no baseline test attribution')
    }
    sources.push({ file: source.file, verdict: 'loaded by ' + source.testFiles.length + ' selected test files (' +
      source.testFiles.filter(file => directTests.includes(file)).length + ' added/modified), ' +
      source.importers.length + ' importers' })
  }
  return { problems, sources }
}

module.exports = { analyzeNewSources, buildGraph, diskHost, loadedBy, requireNewSourceProof, scanModule, structuralProblems }
