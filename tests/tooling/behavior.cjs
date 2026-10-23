const ts = require('typescript')
const { posix } = require('node:path')

const callable = n => n && ts.isFunctionLike(n) && n.body
const typeOnly = n => ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)
const member = n => n.name && (ts.isMethodDeclaration(n) || ts.isPropertyDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n))
const registration = n => ts.isCallExpression(n) && /^(?:it|test|describe|suite)(?:\.|\(|$)/.test(n.expression.getText())
const hook = n => ts.isCallExpression(n) && /^(?:beforeEach|afterEach|beforeAll|afterAll|before|after)$/.test(n.expression.getText())

// A runtime reference graph, not an import graph. Class references do not imply
// invocation of every method. Constructor/field initializers and module effects
// have their own nodes. Unknown structural dispatch is conservatively linked to
// compatible member names in the actual runtime dependency closure.
function behaviorGraph(sources, importGraph, compilerOptions = {}) {
  sources = new Map([...sources].map(([file, source]) => [posix.resolve(file), source]))
  const local = file => posix.relative(process.cwd(), file)
  const options = { allowJs: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, skipLibCheck: true, ...compilerOptions }
  const host = ts.createCompilerHost(options)
  const originalSource = host.getSourceFile.bind(host), originalExists = host.fileExists.bind(host), originalRead = host.readFile.bind(host)
  host.getSourceFile = (file, language) => sources.has(file) ? ts.createSourceFile(file, sources.get(file), language, true) : originalSource(file, language)
  host.fileExists = file => sources.has(file) || originalExists(file)
  host.readFile = file => sources.get(file) ?? originalRead(file)
  host.resolveModuleNames = (names, from) => names.map(name => {
    if (!name.startsWith('.')) return ts.resolveModuleName(name, posix.resolve(from), options, ts.sys).resolvedModule
    const stem = posix.normalize(posix.join(posix.dirname(from), name))
    const file = [stem, ...['.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.js'].map(ext => stem + ext)].find(f => sources.has(f))
    return file ? { resolvedFileName: file, extension: file.endsWith('.ts') ? ts.Extension.Ts : ts.Extension.Js } : undefined
  })
  const program = ts.createProgram([...sources.keys()], options, host)
  const checker = program.getTypeChecker()
  const nodes = new Map(), byAst = new Map(), byMember = new Map(), files = new Map(), mockCandidates = [], invokedSymbols = new Set()
  function add(ast, label) {
    if (byAst.has(ast)) return byAst.get(ast)
    const file = local(ast.getSourceFile().fileName)
    const id = `${file}:${ast.pos}:${label}`
    const entry = { id, ast, file, label, edges: new Set(), conservativeEdges: new Set() }
    nodes.set(id, entry); byAst.set(ast, id)
    if (member(ast)) {
      const name = ast.name.getText().replace(/^['"]|['"]$/g, '')
      if (!byMember.has(name)) byMember.set(name, [])
      byMember.get(name).push(id)
    }
    return id
  }
  for (const fullPath of sources.keys()) {
    const file = local(fullPath)
    const sf = program.getSourceFile(fullPath)
    const top = add(sf, '<module>')
    files.set(file, { sf, top, registrations: [], hooks: [], blocked: new Set() })
    function index(n) {
      if (typeOnly(n)) return
      if (callable(n) || ts.isVariableDeclaration(n) || member(n) || ts.isClassDeclaration(n) || ts.isEnumDeclaration(n)) {
        const owner = n.parent?.name?.getText?.()
        add(n, `${owner ? owner + '.' : ''}${n.name?.getText() ?? (ts.isConstructorDeclaration(n) ? 'constructor' : '<callback>')}`)
      }
      if (ts.isCallExpression(n) && n.expression.getText() === 'vi.mock' && ts.isStringLiteralLike(n.arguments[0]) && callable(n.arguments[1])) {
        const factory = n.arguments[1]
        let partial = false
        function check(child) {
          if (ts.isSpreadAssignment(child) || ts.isCallExpression(child) && (child.expression.kind === ts.SyntaxKind.ImportKeyword || child.expression.getText() === 'require') || /importOriginal|importActual/.test(child.getText()) && ts.isIdentifier(child)) partial = true
          ts.forEachChild(child, check)
        }
        check(factory)
        if (!partial) {
          const stem = posix.normalize(posix.join(posix.dirname(file), n.arguments[0].text))
          const target = (importGraph.get(file) ?? []).find(dep => dep === stem || dep === stem + '.ts' || dep === stem + '/index.ts')
          if (target) mockCandidates.push({ file, target, factory })
        }
      }
      if (ts.isCallExpression(n)) {
        const callee = ts.isPropertyAccessExpression(n.expression) && ['call', 'apply', 'bind'].includes(n.expression.name.text) ? n.expression.expression : n.expression
        if (ts.isIdentifier(callee)) invokedSymbols.add(checker.getSymbolAtLocation(callee))
      }
      if (registration(n)) {
        files.get(file).registrations.push(n); add(n, '<registration>')
        if (/^(?:describe|suite)(?:\.|\(|$)/.test(n.expression.getText())) for (const arg of n.arguments) {
          if (callable(arg)) add(arg.body, '<suite setup>')
        }
      }
      if (hook(n)) files.get(file).hooks.push(n)
      ts.forEachChild(n, index)
    }
    index(sf)
  }
  const closures = new Map()
  function closure(file) {
    if (!closures.has(file)) {
      const seen = new Set()
      const visit = f => { if (seen.has(f)) return; seen.add(f); for (const dep of importGraph.get(f) ?? []) visit(dep) }
      visit(file); closures.set(file, seen)
    }
    return closures.get(file)
  }
  function symbolEdges(n, entry) {
    let symbol = checker.getSymbolAtLocation(n)
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    for (const decl of symbol?.declarations ?? []) {
      const id = byAst.get(decl)
      if (id && id !== entry.id) { entry.edges.add(id); entry.conservativeEdges.delete(id) }
    }
    // A CommonJS/destructured class binding can have a BindingElement symbol
    // while its runtime type still identifies the actual class declaration.
    const valueType = checker.getTypeAtLocation(n)
    for (const decl of valueType.getConstructSignatures().length ? valueType.symbol?.declarations ?? [] : []) {
      if (ts.isClassDeclaration(decl) && byAst.has(decl)) entry.edges.add(byAst.get(decl))
    }
    return symbol
  }
  function origin(n, seen = new Set()) {
    if (seen.has(n)) return n
    seen.add(n)
    if (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isTypeAssertionExpression(n)) return origin(n.expression, seen)
    if (ts.isIdentifier(n)) {
      const declaration = checker.getSymbolAtLocation(n)?.valueDeclaration
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return origin(declaration.initializer, seen)
    }
    return n
  }
  function inspect(n, entry, root = false) {
    if (typeOnly(n) || ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return
    // Registration callbacks are separate roots. Suite hooks are applied below.
    if (registration(n)) {
      if (root) {
        // each/for providers may carry real function references or eager effects.
        // Keep their inputs separate from sibling leaf callback bodies.
        const inputs = expression => {
          if (ts.isCallExpression(expression)) {
            expression.arguments.forEach(arg => inspect(arg, entry))
            inputs(expression.expression)
          } else if (ts.isPropertyAccessExpression(expression)) inputs(expression.expression)
        }
        inputs(n.expression)
        for (const arg of n.arguments) if (!callable(arg)) inspect(arg, entry)
      }
      return
    }
    if (!root && byAst.has(n)) { entry.edges.add(byAst.get(n)); return }
    if (ts.isClassDeclaration(n)) {
      for (const clause of n.heritageClauses ?? []) for (const type of clause.types) inspect(type.expression, entry)
      for (const child of n.members) {
        if (child.modifiers?.some(mod => mod.kind === ts.SyntaxKind.StaticKeyword) && ts.isPropertyDeclaration(child)) {
          const id = byAst.get(child); if (id) entry.edges.add(id)
        }
      }
      return
    }
    if (ts.isNewExpression(n)) {
      const construct = (declaration, seen = new Set()) => {
        if (seen.has(declaration)) return
        seen.add(declaration)
        for (const child of declaration.members) if (ts.isConstructorDeclaration(child) || ts.isPropertyDeclaration(child)) {
          if (byAst.has(child)) entry.edges.add(byAst.get(child))
        }
        for (const clause of declaration.heritageClauses ?? []) for (const type of clause.types) {
          for (const base of checker.getTypeAtLocation(type.expression).symbol?.declarations ?? []) if (ts.isClassDeclaration(base)) construct(base, seen)
        }
      }
      for (const declaration of checker.getTypeAtLocation(n.expression).symbol?.declarations ?? []) if (ts.isClassDeclaration(declaration)) construct(declaration)
    }
    const unknownDispatch = expression => {
      const value = origin(expression)
      if (!ts.isElementAccessExpression(value)) return
      const type = checker.getTypeAtLocation(value.argumentExpression)
      if (ts.isStringLiteralLike(value.argumentExpression) || type.flags & ts.TypeFlags.StringLiteral) return
      for (const ids of byMember.values()) for (const id of ids) if (closure(entry.file).has(nodes.get(id).file)) {
        if (!entry.edges.has(id)) entry.conservativeEdges.add(id)
        entry.edges.add(id)
        const owner = nodes.get(id).ast.parent
        if (ts.isClassDeclaration(owner)) entry.edges.add(byAst.get(owner))
      }
    }
    if (ts.isCallExpression(n)) {
      unknownDispatch(n.expression)
      if (ts.isPropertyAccessExpression(n.expression) && ['call', 'apply', 'bind'].includes(n.expression.name.text)) unknownDispatch(n.expression.expression)
      // An opaque callback consumer may invoke an aliased computed method too.
      const signature = checker.getResolvedSignature(n)
      n.arguments.forEach((arg, index) => {
        const parameter = signature?.parameters[index]
        const type = parameter && checker.getTypeOfSymbolAtLocation(parameter, n)
        if (ts.isIdentifier(arg) && (type?.getCallSignatures().length || invokedSymbols.has(parameter))) unknownDispatch(arg)
      })
      if (n.expression.getText() === 'eval') entry.unsafe = 'eval runtime dispatch'
    }
    if (ts.isIdentifier(n) && n !== n.parent?.name) symbolEdges(n, entry)
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      const keyType = ts.isElementAccessExpression(n) ? checker.getTypeAtLocation(n.argumentExpression) : null
      const name = ts.isPropertyAccessExpression(n) ? n.name.text
        : ts.isStringLiteralLike(n.argumentExpression) ? n.argumentExpression.text
        : keyType?.flags & ts.TypeFlags.StringLiteral ? keyType.value : null
      const symbol = symbolEdges(ts.isPropertyAccessExpression(n) ? n.name : n.argumentExpression, entry)
      const original = origin(n.expression)
      if (name && original !== n.expression) {
        const actual = checker.getPropertyOfType(checker.getTypeAtLocation(original), name)
        for (const decl of actual?.declarations ?? []) if (byAst.has(decl)) { entry.edges.add(byAst.get(decl)); entry.conservativeEdges.delete(byAst.get(decl)) }
      }
      const concrete = symbol?.declarations?.some(d => byAst.has(d) || d.getSourceFile().isDeclarationFile)
      if (!concrete && name) for (const id of byMember.get(name) ?? []) {
        const candidate = nodes.get(id)
        const expected = symbol && checker.getTypeOfSymbolAtLocation(symbol, n)
        const actual = checker.getTypeAtLocation(candidate.ast)
        if (closure(entry.file).has(candidate.file) && (!expected || expected.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)
          || checker.isTypeAssignableTo(actual, expected))) { if (!entry.edges.has(id)) entry.conservativeEdges.add(id); entry.edges.add(id) }
      }
      // Dynamic property dispatch cannot prove an exclusion. Conservatively
      // retain every member in its dependency closure, including casts to any.
      if (!name && ts.isElementAccessExpression(n) && ts.isCallExpression(n.parent) && n.parent.expression === n) {
        for (const ids of byMember.values()) for (const id of ids) if (closure(entry.file).has(nodes.get(id).file)) {
          if (!entry.edges.has(id)) entry.conservativeEdges.add(id)
          entry.edges.add(id)
          const parent = nodes.get(id).ast.parent
          if (ts.isClassDeclaration(parent)) entry.edges.add(byAst.get(parent))
        }
      }
    }
    // Reflection contracts such as getOwnPropertyDescriptor(proto, 'getter').
    if (ts.isCallExpression(n) && /\.(?:getOwnPropertyDescriptor|spyOn)$/.test(n.expression.getText())) {
      for (const arg of n.arguments) if (ts.isStringLiteralLike(arg)) for (const id of byMember.get(arg.text) ?? []) {
        if (closure(entry.file).has(nodes.get(id).file)) entry.edges.add(id)
      }
    }
    ts.forEachChild(n, child => inspect(child, entry))
  }
  for (const entry of nodes.values()) {
    if (ts.isSourceFile(entry.ast) || entry.label === '<suite setup>') {
      function eager(n) {
        if (typeOnly(n) || registration(n) || ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || callable(n)) return
        if (ts.isClassDeclaration(n)) {
          for (const m of n.members) if (m.modifiers?.some(mod => mod.kind === ts.SyntaxKind.StaticKeyword) && m.initializer) inspect(m.initializer, entry)
          return
        }
        if (ts.isVariableDeclaration(n)) { if (n.initializer) eager(n.initializer); return }
        if (ts.isCallExpression(n) || ts.isNewExpression(n)) { inspect(n, entry); return }
        ts.forEachChild(n, eager)
      }
      eager(entry.ast)
    } else inspect(entry.ast, entry, true)
  }
  for (const [file, info] of files) for (const dep of importGraph.get(file) ?? []) {
    if (files.has(dep)) nodes.get(info.top).edges.add(files.get(dep).top)
  }
  for (const { file, target, factory } of mockCandidates) {
    const seen = new Set(), queue = [byAst.get(factory)]
    for (let i=0; i<queue.length; i++) {
      const id = queue[i]
      if (seen.has(id)) continue
      seen.add(id)
      queue.push(...(nodes.get(id)?.edges ?? []))
    }
    if (![...seen].some(id => nodes.get(id)?.file === target)) files.get(file).blocked.add(target)
  }
  function reachable(roots, testFile) {
    const blocked = files.get(testFile)?.blocked ?? new Set()
    const seen = new Set(), pending = new Map()
    const visit = id => {
      if (seen.has(id) || blocked.has(nodes.get(id)?.file)) return
      const ast = nodes.get(id)?.ast
      const owner = ast?.parent && ts.isClassDeclaration(ast.parent) ? byAst.get(ast.parent) : null
      if (owner && !seen.has(owner)) {
        if (!pending.has(owner)) pending.set(owner, new Set())
        pending.get(owner).add(id)
        return
      }
      seen.add(id)
      for (const next of nodes.get(id)?.edges ?? []) visit(next)
      for (const next of pending.get(id) ?? []) visit(next)
    }
    roots.forEach(visit)
    return seen
  }
  function caseRoots(file, location) {
    const info = files.get(file)
    if (!info) return null
    const calls = info.registrations.filter(n => {
      const start = info.sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
      return start === location?.line && n.arguments.some(callable)
    })
    // Dynamic wrappers/ambiguous locations fall back to the complete owner file.
    if (calls.length !== 1) return null
    const callback = calls[0].arguments.find(callable)
    const roots = [byAst.get(callback), byAst.get(calls[0]), info.top]
    const ancestors = new Set()
    for (let n = calls[0]; n; n = n.parent) {
      ancestors.add(n)
      if (n !== calls[0] && registration(n)) {
        roots.push(byAst.get(n))
        for (const arg of n.arguments) if (callable(arg)) roots.push(byAst.get(arg.body) ?? byAst.get(arg))
      }
    }
    for (const h of info.hooks) {
      let scope = h.parent
      while (scope && !registration(scope)) scope = scope.parent
      if (!scope || ancestors.has(scope)) for (const arg of h.arguments) if (byAst.has(arg)) roots.push(byAst.get(arg))
    }
    return roots.filter(Boolean)
  }
  function wholeFileRoots(file) {
    return [...nodes.values()].filter(n => n.file === file).map(n => n.id)
  }
  function changedNodes(file, ranges) {
    const info = files.get(file)
    if (!info) throw new Error(`Missing behavior source: ${file}`)
    const hits = new Set()
    for (const [start, count] of ranges) {
      if (!count) continue
      const end = start + count - 1
      const matches = [...nodes.values()].filter(n => n.file === file && callable(n.ast)
        && info.sf.getLineAndCharacterOfPosition(n.ast.getStart()).line + 1 <= start
        && info.sf.getLineAndCharacterOfPosition(n.ast.end).line + 1 >= end)
        .sort((a,b) => (a.ast.end-a.ast.pos)-(b.ast.end-b.ast.pos))
      if (matches.length) hits.add(matches[0].id)
      else {
        hits.shared = true
        // Shared state, public data shape, exports, or module effects: all runtime
        // behaviors in this module are affected. Never guess from feature words.
        for (const n of nodes.values()) if (n.file === file) hits.add(n.id)
      }
    }
    return hits
  }
  function explain(roots, reached, target) {
    const previous = new Map(roots.map(id => [id, null])), queue = [...roots]
    for (let i=0; i<queue.length; i++) {
      const id = queue[i]
      if (id === target) {
        const path = []
        for (let next = id; next; next = previous.get(next)) path.unshift(nodes.get(next))
        const behaviors = path.filter(n => n.file.startsWith('src/') && callable(n.ast)).map(n => ({ file: n.file, behavior: n.label }))
        behaviors.conservative = path.some((n, index) => n.conservativeEdges.has(path[index + 1]?.id))
        return behaviors
      }
      for (const next of nodes.get(id)?.edges ?? []) if (reached.has(next) && !previous.has(next)) { previous.set(next, id); queue.push(next) }
    }
    return []
  }
  return { nodes, reachable, caseRoots, wholeFileRoots, changedNodes, explain }
}

function selectBehaviors(inventory, changed, consumers, evidence) {
  const { sources, previousSources, ranges, compilerOptions } = evidence
  const head = behaviorGraph(sources, consumers.graph, compilerOptions)
  const previous = evidence.previousConsumers ?? (previousSources === sources ? consumers : require('./dependencies.cjs').dependencyConsumers(inventory, previousSources))
  if (previous.runtimeAmbiguities?.length) throw new Error(`Unresolved base runtime imports: ${previous.runtimeAmbiguities.join(', ')}`)
  const graphs = [head, previousSources === sources ? head : behaviorGraph(previousSources, previous.graph, compilerOptions)]
  const testRenames = evidence.testRenames ?? new Map()
  const oldTestPaths = new Map([...testRenames].map(([before, after]) => [after, before]))
  const selectedCases = {}, reasons = {}, details = {}, changedBehaviors = new Set(), candidates = new Set()
  for (const change of changed) {
    const targets = graphs.map((g, i) => g.changedNodes(change.file, ranges[change.file][i]))
    for (let i=0; i<2; i++) for (const id of targets[i]) changedBehaviors.add(`${change.file}#${graphs[i].nodes.get(id).label}`)
    const covered = [new Set(), new Set()]
    for (const file of new Set([...(consumers[change.file] ?? []), ...(previous[change.file] ?? []).map(file => testRenames.get(file) ?? file)])) {
      candidates.add(file)
      const suite = inventory.find(item => item.file === file)
      if (!suite) continue
      const fallback = !suite.locations || suite.locations.length !== suite.names.length
        || suite.names.some((name, i) => suite.names.indexOf(name) !== i)
        || suite.nativeNames && new Set(suite.nativeNames).size !== suite.nativeNames.length
      const matched = [], owners = new Set(), conservativeCases = new Set()
      let caller = false
      let whole = false
      for (let index=0; index<suite.names.length; index++) {
        let hit = false, uncertain = fallback
        for (let i=0; i<2; i++) {
          const graphFile = i === 1 ? oldTestPaths.get(file) ?? file : file
          // Current collection coordinates are not trustworthy for an edited
          // base test body. Follow its whole old owner, then execute head leaves.
          const sameBody = i === 0 || previousSources.get(graphFile) === sources.get(file)
          const roots = !fallback && sameBody && graphs[i].caseRoots(graphFile, suite.locations[index])
          if (!roots) uncertain = true
          const reached = graphs[i].reachable(roots || graphs[i].wholeFileRoots(graphFile), graphFile)
          for (const id of reached) if (graphs[i].nodes.get(id)?.unsafe) throw new Error(`Unsafe runtime dispatch: ${file}: ${graphs[i].nodes.get(id).unsafe}`)
          for (const id of targets[i]) if (reached.has(id)) {
            hit = true; covered[i].add(id)
            const path = graphs[i].explain(roots || graphs[i].wholeFileRoots(graphFile), reached, id)
            if (path.conservative) { conservativeCases.add(index); caller = true }
            for (const step of path) { owners.add(step.behavior); if (step.file !== change.file) caller = true }
          }
        }
        if (hit) matched.push(index)
        if (uncertain && hit) whole = true
      }
      if (whole) matched.splice(0, matched.length, ...suite.names.map((_, i) => i))
      if (matched.length) {
        selectedCases[file] = [...new Set([...(selectedCases[file] ?? []), ...matched])].sort((a,b)=>a-b)
        ;(reasons[file] ??= []).push(`Runtime behavior reference: ${change.file}`)
        ;(details[file] ??= []).push({ changed: change.file, source: caller ? 'Caller Contract' : 'Direct Owner', owners: [...owners].sort(), conservativeCases: [...conservativeCases] })
      }
    }
    for (let i=0; i<2; i++) if (!targets[i].shared) for (const id of targets[i]) {
      if (!covered[i].has(id)) throw new Error(`Unsafe/unmapped behavior: ${change.file}#${graphs[i].nodes.get(id).label}; no proven owner cases`)
    }
    if (!Object.values(details).some(list=>list.some(d=>d.changed===change.file))) throw new Error(`Unsafe/unmapped behavior: ${change.file}; no proven owner cases`)
  }
  return { selected: Object.keys(selectedCases).sort(), selectedCases, reasons, details,
    changedBehaviors: [...changedBehaviors].sort(), excludedCandidates: [...candidates].filter(f=>!selectedCases[f]).sort(), unsafe: [] }
}
module.exports = { behaviorGraph, selectBehaviors }
