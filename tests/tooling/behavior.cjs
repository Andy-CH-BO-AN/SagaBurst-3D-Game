const ts = require('typescript')
const { posix } = require('node:path')
const { declarationSnapshot, changedDeclarations, runtimeImports, inertValue } = require('./behavior-changes.cjs')

const callable = n => n && ts.isFunctionLike(n) && n.body
const typeOnly = n => ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)
const member = n => n.name && (ts.isMethodDeclaration(n) || ts.isPropertyDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n))
const registration = n => ts.isCallExpression(n) && /^(?:it|test|describe|suite)(?:\.|\(|$)/.test(n.expression.getText())
const hook = n => ts.isCallExpression(n) && /^(?:beforeEach|afterEach|beforeAll|afterAll|before|after)$/.test(n.expression.getText())

// A runtime reference graph, not an import graph. Class references do not imply
// invocation of every method. Constructor/field initializers and module effects
// have their own nodes. Unknown structural dispatch is conservatively linked to
// finite member keys of the actual receiver; unresolved dispatch fails closed.
function behaviorGraph(sources, importGraph, compilerOptions = {}, repositoryRoot = process.cwd(), inputEdges = [], inputRisks = [], runtimeImportRisks = [], inputPatterns = []) {
  sources = new Map([...sources].map(([file, source]) => [posix.resolve(repositoryRoot, file), source]))
  const local = file => posix.relative(repositoryRoot, file)
  const options = { allowJs: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, ...compilerOptions }
  const host = ts.createCompilerHost(options)
  const originalSource = host.getSourceFile.bind(host), originalExists = host.fileExists.bind(host), originalRead = host.readFile.bind(host)
  host.getSourceFile = (file, language) => sources.has(file) ? ts.createSourceFile(file, sources.get(file), language, true) : originalSource(file, language)
  host.fileExists = file => sources.has(file) || originalExists(file)
  host.readFile = file => sources.get(file) ?? originalRead(file)
  host.resolveModuleNames = (names, from) => names.map(name => {
    // Dependency declaration files must resolve their own relative imports.
    // Only project-source imports are constrained to the immutable snapshot.
    if (!name.startsWith('.') || !sources.has(posix.resolve(from))) return ts.resolveModuleName(name, posix.resolve(from), options, ts.sys).resolvedModule
    const stem = posix.normalize(posix.join(posix.dirname(from), name))
    const file = [stem, ...['.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.js'].map(ext => stem + ext)].find(f => sources.has(f))
    return file ? { resolvedFileName: file, extension: file.endsWith('.ts') ? ts.Extension.Ts : ts.Extension.Js } : undefined
  })
  const program = ts.createProgram([...sources.keys()], options, host)
  const checker = program.getTypeChecker()
  const nodes = new Map(), byAst = new Map(), shapes = new Map(), files = new Map(), commonjs = new Map(), runtimeModules = new Map(), commonjsTargets = new Set(), mockCandidates = [], invokedSymbols = new Set(), parameterInputs = new Map(), mutatedReceivers = new Set(), delegatingMocks = new Set(), mutatedBindings = new Set(), escapedBindings = new Set(), mutatedObjectBindings = new Set(), bindingAliases = new Map(), mutatedImplicitRequireFiles = new Set()
  function connect(entry, id, guard = null) {
    entry.edges.add(id)
    entry.edgeGuards ??= new Map()
    if (!entry.edgeGuards.has(id)) entry.edgeGuards.set(id, new Set())
    entry.edgeGuards.get(id).add(guard)
  }
  function bindingDeclaration(expression) {
    const symbol = ts.isShorthandPropertyAssignment(expression.parent) ? checker.getShorthandAssignmentValueSymbol(expression.parent) : checker.getSymbolAtLocation(expression)
    return symbol?.valueDeclaration ?? symbol?.declarations?.find(declaration => ts.isVariableDeclaration(declaration) || ts.isParameter(declaration) || ts.isBindingElement(declaration) || ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration) || ts.isImportClause(declaration))
  }
  function baseBinding(expression) {
    while (expression && (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isSpreadElement(expression) || ts.isSpreadAssignment(expression) || ts.isAwaitExpression(expression) || ts.isYieldExpression(expression))) expression = expression.expression
    return expression && bindingDeclaration(expression)
  }
  function stableBinding(expression, seen = new Set()) {
    const declaration = baseBinding(expression)
    if (!declaration) return true
    if (seen.has(declaration)) return false
    seen.add(declaration)
    if (mutatedBindings.has(declaration) || mutatedObjectBindings.has(declaration) || escapedBindings.has(declaration)) return false
    return !bindingAliases.has(declaration) || stableBinding(bindingAliases.get(declaration), seen)
  }
  function nativeTarget(expression, seen = new Set()) {
    if (!stableBinding(expression)) return false
    if (providerRequire(expression)) return true
    if (!ts.isIdentifier(expression)) return false
    const declaration = bindingDeclaration(expression)
    if (!declaration || seen.has(declaration)) return false
    seen.add(declaration)
    if (ts.isNamespaceImport(declaration) || ts.isImportClause(declaration)) return true
    return ts.isVariableDeclaration(declaration) && declaration.initializer && nativeTarget(declaration.initializer, seen)
  }
  function controlledCall(expression) {
    while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression
    if (!ts.isCallExpression(expression)) return false
    if (expression.expression.getText() === 'vi.spyOn' && vitestReceiver(expression.expression.expression) && stableBinding(expression.expression.expression)) return true
    if (ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === 'method' && nativeTracker(expression.expression.expression)) return true
    const provider = providerOf(expression.expression)
    return provider?.module === 'node:test' && stableBinding(expression.expression) && ['test', 'it', 'describe', 'before', 'after', 'beforeEach', 'afterEach'].includes(provider.export)
  }
  function invalidateAssignment(target) {
    if (ts.isIdentifier(target)) {
      const declaration = bindingDeclaration(target)
      if (declaration) mutatedBindings.add(declaration)
      else if (target.text === 'require') mutatedImplicitRequireFiles.add(target.getSourceFile().fileName)
    } else if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      const declaration = baseBinding(target.expression); if (declaration) mutatedObjectBindings.add(declaration)
    } else ts.forEachChild(target, invalidateAssignment)
  }
  function optionalReceiver(expression) {
    for (let node = expression; node && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)); node = node.expression) {
      if (node.questionDotToken) return node.expression
    }
    return null
  }
  function invocationReference(node) {
    if ((ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) && node.parent.name === node) node = node.parent
    while (node.parent && (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent) || ts.isNonNullExpression(node.parent))) node = node.parent
    if (functionAdapter(node.parent)) node = node.parent
    return ts.isCallExpression(node.parent) && node.parent.expression === node
  }
  function invocation(entry, target, call) {
    connect(entry, target, optionalReceiver(call))
    let args = [...(call.arguments ?? [])]
    if (functionAdapter(call.expression)) {
      const adapter = call.expression.name.text
      args = adapter === 'call' ? args.slice(1) : adapter === 'apply' && args[1] && ts.isArrayLiteralExpression(args[1]) ? [...args[1].elements] : null
    }
    entry.callContexts ??= new Map()
    if (!entry.callContexts.has(target)) entry.callContexts.set(target, [])
    const contexts = entry.callContexts.get(target)
    if (!contexts.some(context => context.call === call)) contexts.push({ call, args })
    entry.edgeEvidence.set(target, { evidence: 'callable provenance', callsite: { file: entry.file, start: call.getStart() } })
  }
  function add(ast, label) {
    if (byAst.has(ast)) return byAst.get(ast)
    const file = local(ast.getSourceFile().fileName)
    const id = `${file}:${ast.pos}:${label}`
    const entry = { id, ast, file, label, edges: new Set(), conservativeEdges: new Set(), edgeEvidence: new Map() }
    nodes.set(id, entry); byAst.set(ast, id)
    return id
  }
  for (const fullPath of sources.keys()) {
    const file = local(fullPath)
    const sf = program.getSourceFile(fullPath)
    const top = add(sf, '<module>')
    files.set(file, { sf, top, registrations: [], hooks: [], blocked: new Set(), blockedProviders: new Set(), uncertainMocks: new Map(), uncertainProviders: new Map(), replacementMocks: new Map() })
    const imports = runtimeImports(sf)
    const importBindings = imports.bindings
    runtimeModules.set(file, new Set())
    const runtimeModule = name => {
      const stem = posix.normalize(posix.join(posix.dirname(file), name))
      const target = (importGraph.get(file) ?? []).find(dep => dep === stem || ['.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.js'].some(ext => dep === stem + ext))
      if (target) runtimeModules.get(file).add(target)
      return target
    }
    function index(n) {
      if (typeOnly(n)) return
      if (ts.isImportDeclaration(n) && imports.modules.some(specifier => specifier.startsWith(n.moduleSpecifier.getText()))) runtimeModule(n.moduleSpecifier.text)
      if (ts.isExportDeclaration(n) && !n.isTypeOnly && n.moduleSpecifier && (!n.exportClause || !ts.isNamedExports(n.exportClause) || n.exportClause.elements.some(element => !element.isTypeOnly))) runtimeModule(n.moduleSpecifier.text)
      if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || n.expression.getText() === 'require') && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
        const target = runtimeModule(n.arguments[0].text)
        if (target && providerRequire(n)) commonjsTargets.add(target)
      }
      if ((ts.isImportSpecifier(n) || ts.isNamespaceImport(n) || ts.isImportClause(n)) && n.name && importBindings.has(n.name.text)) add(n, `<import:${n.name.text}>`)
      if (callable(n) || ts.isClassStaticBlockDeclaration(n) || ts.isVariableDeclaration(n) || member(n) || ts.isClassLike(n) || ts.isEnumDeclaration(n)) {
        const owner = n.parent?.name?.getText?.()
        add(n, `${owner ? owner + '.' : ''}${n.name?.getText() ?? (ts.isConstructorDeclaration(n) ? 'constructor' : ts.isClassStaticBlockDeclaration(n) ? '<static initialization>' : '<callback>')}`)
      }
      if (ts.isCallExpression(n) && n.expression.getText() === 'vi.mock' && ts.isStringLiteralLike(n.arguments[0]) && vitestReceiver(n.expression.expression)) {
        const stem = posix.normalize(posix.join(posix.dirname(file), n.arguments[0].text))
        const target = (importGraph.get(file) ?? []).find(dep => dep === stem || ['.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.js', '/index.cjs'].some(extension => dep === stem + extension))
        mockCandidates.push({ file, target, provider: n.arguments[0].text, factory: n.arguments[1], ast: n })
      }
      if ((ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
        || ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(n.operator))) {
        invalidateAssignment(n.left ?? n.operand)
      }
      if (ts.isForOfStatement(n) || ts.isForInStatement(n)) invalidateAssignment(n.initializer)
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && baseBinding(n.initializer)) bindingAliases.set(n, n.initializer)
      if (ts.isBindingElement(n)) {
        let owner = n.parent
        while (owner && !ts.isVariableDeclaration(owner)) owner = owner.parent
        if (owner?.initializer) bindingAliases.set(n, owner.initializer)
      }
      const escape = expression => {
        const visit = node => {
          if (typeOnly(node)) return
          if (ts.isIdentifier(node)) {
            const declaration = bindingDeclaration(node)
            // Unknown expressions may capture outer references, but their own
            // callback parameters/locals are not escaped caller bindings.
            if (declaration && !(declaration.getSourceFile() === expression.getSourceFile() && expression.pos <= declaration.pos && declaration.end <= expression.end)) escapedBindings.add(declaration)
          }
          ts.forEachChild(node, visit)
        }
        visit(expression)
      }
      if (ts.isVariableDeclaration(n) && n.initializer && !bindingAliases.has(n) && !controlledCall(n.initializer)) escape(n.initializer)
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) escape(n.right)
      if (ts.isArrowFunction(n) && !ts.isBlock(n.body)) escape(n.body)
      if (ts.isPropertyDeclaration(n) && n.initializer) escape(n.initializer)
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const controlled = ts.isCallExpression(n) && controlledCall(n)
        if (!controlled) for (const argument of n.arguments ?? []) escape(argument)
      }
      if (ts.isReturnStatement(n) && n.expression) escape(n.expression)
      if (ts.isPropertyAssignment(n)) escape(n.initializer)
      if (ts.isShorthandPropertyAssignment(n)) escape(n.name)
      if (ts.isArrayLiteralExpression(n)) for (const element of n.elements) escape(element)
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && (ts.isPropertyAccessExpression(n.left) || ts.isElementAccessExpression(n.left))) {
        const symbol = receiverSymbol(origin(n.left.expression))
        if (symbol) mutatedReceivers.add(symbol)
        const declaration = baseBinding(n.left.expression); if (declaration) mutatedObjectBindings.add(declaration)
      }
      if (ts.isCallExpression(n) && /^(?:Object\.(?:assign|defineProperty|defineProperties)|Reflect\.set)$/.test(n.expression.getText()) && n.arguments[0]) {
        const symbol = receiverSymbol(origin(n.arguments[0]))
        if (symbol) mutatedReceivers.add(symbol)
      }
      if (ts.isCallExpression(n)) {
        if (ts.isPropertyAccessExpression(n.expression) && /^(?:mockImplementation|mockReset|mockRestore)/.test(n.expression.name.text)) delegatingMocks.add(origin(n.expression.expression))
        const callee = functionAdapter(n.expression) ? n.expression.expression : n.expression
        if (ts.isIdentifier(callee)) { const symbol = checker.getSymbolAtLocation(callee); if (symbol) invokedSymbols.add(symbol) }
        const signature = checker.getResolvedSignature(n)
        n.arguments.forEach((argument, index) => {
          const parameter = signature?.parameters[index]
          if (!parameter || !(parameter.declarations ?? []).some(decl => sources.has(decl.getSourceFile().fileName))) return
          if (!parameterInputs.has(parameter)) parameterInputs.set(parameter, new Set())
          parameterInputs.get(parameter).add(argument)
        })
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
    const exports = new Map()
    for (const statement of sf.statements) if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)) {
      const assignment = statement.expression, left = assignment.left.getText()
      if (left === 'module.exports' && ts.isObjectLiteralExpression(assignment.right)) {
        for (const property of assignment.right.properties) if (property.name && !ts.isComputedPropertyName(property.name)) exports.set(property.name.text, add(property, `<export:${property.name.text}>`))
      } else if (left === 'module.exports') exports.set('<default>', add(assignment, '<export:default>'))
      else if (/^(?:module\.exports|exports)\.[\w$]+$/.test(left)) exports.set(left.split('.').pop(), add(assignment, `<export:${left.split('.').pop()}>`))
    }
    commonjs.set(file, exports)
    for (const entry of [...nodes.values()]) if (entry.file === file && ts.isClassLike(entry.ast)) {
      const domains = {}
      for (const domain of ['instance', 'prototype', 'static']) {
        const id = `${entry.id}:<${domain} shape>`
        nodes.set(id, { id, ast: entry.ast, file, label: `${entry.label}.<${domain} shape>`, edges: new Set(), conservativeEdges: new Set(), edgeEvidence: new Map(), shape: true })
        domains[domain] = id
      }
      shapes.set(entry.ast, domains)
    }
  }
  let changedBindings = true
  while (changedBindings) {
    changedBindings = false
    for (const [alias, expression] of bindingAliases) if (mutatedObjectBindings.has(alias) || escapedBindings.has(alias)) {
      const original = baseBinding(expression)
      if (original && !escapedBindings.has(original)) { escapedBindings.add(original); changedBindings = true }
    }
  }
  // Data-reader candidate expansion is not executable module provenance.
  // Keep this graph distinct from importGraph, which also contains input edges.
  for (const input of inputEdges ?? []) if (['import', 'execute'].includes(input.kind)) {
    if (!runtimeModules.has(input.from)) runtimeModules.set(input.from, new Set())
    runtimeModules.get(input.from).add(input.to)
  }
  const runtimeClosures = new Map()
  function runtimeReaches(file, target) {
    if (!runtimeClosures.has(file)) {
      const seen = new Set(), queue = [file]
      for (let index = 0; index < queue.length; index++) {
        const next = queue[index]
        if (seen.has(next)) continue
        seen.add(next); queue.push(...(runtimeModules.get(next) ?? []))
      }
      runtimeClosures.set(file, seen)
    }
    return runtimeClosures.get(file).has(target)
  }
  function requiredModule(n) {
    n = origin(n)
    if (!ts.isCallExpression(n) || n.expression.getText() !== 'require' || !n.arguments[0] || !ts.isStringLiteralLike(n.arguments[0])) return null
    const file = local(n.getSourceFile().fileName)
    const stem = posix.normalize(posix.join(posix.dirname(file), n.arguments[0].text))
    return (importGraph.get(file) ?? []).find(dep => dep === stem || ['.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.js'].some(ext => dep === stem + ext))
  }
  function linkSymbol(symbol, entry, seen = new Set(), guard = null) {
    if (!symbol || seen.has(symbol)) return symbol
    seen.add(symbol)
    for (const decl of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(decl) && decl.initializer && ts.isIdentifier(decl.name)) {
        const id = commonjs.get(requiredModule(decl.initializer))?.get('<default>')
        if (id) connect(entry, id, guard)
      }
      if (ts.isBindingElement(decl) && ts.isVariableDeclaration(decl.parent.parent) && decl.parent.parent.initializer) {
        const module = requiredModule(decl.parent.parent.initializer)
        const id = commonjs.get(module)?.get((decl.propertyName ?? decl.name).getText())
        if (id) { connect(entry, id, guard); entry.edgeEvidence.set(id, { receiver: module, key: (decl.propertyName ?? decl.name).getText(), evidence: 'CommonJS export binding' }) }
      }
      let owner = decl
      while (ts.isBindingElement(owner) || ts.isObjectBindingPattern(owner) || ts.isArrayBindingPattern(owner)) owner = owner.parent
      const id = byAst.get(owner)
      if (id && id !== entry.id) { connect(entry, id, guard); if (!entry.typeReceiverEdges?.has(id)) entry.conservativeEdges.delete(id) }
    }
    // Preserve intermediate import/re-export bindings instead of flattening
    // directly to the final declaration: an unchanged caller can be retargeted.
    return symbol.flags & ts.SymbolFlags.Alias
      ? linkSymbol(checker.getImmediateAliasedSymbol(symbol), entry, seen, guard) : symbol
  }
  function symbolEdges(n, entry, original = checker.getSymbolAtLocation(n)) {
    const access = (ts.isPropertyAccessExpression(n.parent) || ts.isElementAccessExpression(n.parent)) && n.parent.name === n ? n.parent : n
    const symbol = linkSymbol(original, entry, new Set(), optionalReceiver(access))
    if (!invocationReference(n)) for (const declaration of symbol?.declarations ?? []) if (callable(declaration) && byAst.has(declaration)) {
      entry.opaqueTargets ??= new Set(); entry.opaqueTargets.add(byAst.get(declaration))
    }
    const namespace = symbol && symbol.flags & (ts.SymbolFlags.ValueModule | ts.SymbolFlags.NamespaceModule)
    const namedAccess = (ts.isPropertyAccessExpression(n.parent) || ts.isElementAccessExpression(n.parent)) && n.parent.expression === n
      && (ts.isPropertyAccessExpression(n.parent) || literalKeys(n.parent.argumentExpression))
    // Namespace escape, dynamic access and enumeration may read any export.
    if (namespace && !namedAccess) for (const exported of checker.getExportsOfModule(symbol)) linkSymbol(exported, entry)
    // A CommonJS/destructured class binding can have a BindingElement symbol
    // while its runtime type still identifies the actual class declaration.
    const valueType = checker.getTypeAtLocation(n)
    for (const decl of valueType.getConstructSignatures().length ? valueType.symbol?.declarations ?? [] : []) {
      if (ts.isClassLike(decl) && byAst.has(decl)) connect(entry, byAst.get(decl))
    }
    return symbol
  }
  function origin(n, seen = new Set()) {
    if (seen.has(n)) return n
    seen.add(n)
    if (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isTypeAssertionExpression(n)) return origin(n.expression, seen)
    if (ts.isCallExpression(n) && n.expression.getText() === 'Object.create' && n.arguments.length === 1) return origin(n.arguments[0], seen)
    if (ts.isIdentifier(n)) {
      const symbol = checker.getSymbolAtLocation(n)
      const declaration = symbol?.valueDeclaration
      if (declaration && ts.isBindingElement(declaration) && ts.isVariableDeclaration(declaration.parent.parent) && declaration.parent.parent.initializer) {
        const module = requiredModule(declaration.parent.parent.initializer)
        const exported = nodes.get(commonjs.get(module)?.get((declaration.propertyName ?? declaration.name).getText()))?.ast
        if (exported && ts.isPropertyAssignment(exported)) return origin(exported.initializer, seen)
        if (exported && ts.isShorthandPropertyAssignment(exported)) return exported.name
        if (exported && ts.isBinaryExpression(exported)) return origin(exported.right, seen)
      }
      const inputs = parameterInputs.get(symbol)
      if (inputs?.size === 1) return origin([...inputs][0], seen)
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return origin(declaration.initializer, seen)
    }
    return n
  }
  function receiverSymbol(receiver) {
    let symbol = checker.getSymbolAtLocation(receiver)
    const seen = new Set()
    while (symbol?.flags & ts.SymbolFlags.Alias && !seen.has(symbol)) {
      seen.add(symbol); symbol = checker.getImmediateAliasedSymbol(symbol)
    }
    return symbol
  }
  function externalReceiver(receiver) {
    const symbol = receiverSymbol(receiver)
    // Prove the value binding itself is external (not merely an instance cast
    // to a library interface). Local extension writes invalidate this boundary.
    return !!symbol?.declarations?.length && !mutatedReceivers.has(symbol)
      && symbol.declarations.every(decl => !sources.has(decl.getSourceFile().fileName))
  }
  const providerName = provider => provider?.module ? provider.module.replace(/^node:/, '') : provider?.global ? `global:${provider.global}` : null
  function providerRequire(expression) {
    return ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'require'
      && ts.isStringLiteralLike(expression.arguments[0]) && stableBinding(expression.expression)
      && !mutatedImplicitRequireFiles.has(expression.getSourceFile().fileName)
      && !(checker.getSymbolAtLocation(expression.expression)?.declarations ?? []).some(declaration => sources.has(declaration.getSourceFile().fileName))
  }
  function providerOf(expression) {
    expression = origin(expression)
    if (providerRequire(expression)) return { module: expression.arguments[0].text, export: '*' }
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === 'method') {
      const handle = nativeReplacement(expression)
      if (handle) return { ...handle.provider, export: handle.method ?? '*' }
    }
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      const provider = providerOf(expression.expression)
      const keys = ts.isPropertyAccessExpression(expression) ? [expression.name.text] : literalKeys(expression.argumentExpression)
      return provider && keys?.[0] !== 'prototype' ? { ...provider, export: keys?.length === 1 ? keys[0] : '*' } : provider
    }
    const symbol = checker.getSymbolAtLocation(expression)
    for (const declaration of symbol?.declarations ?? []) {
      for (let node = declaration; node; node = node.parent) if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        return { module: node.moduleSpecifier.text, export: ts.isNamespaceImport(declaration) ? '*' : declaration.propertyName?.text ?? declaration.name?.text ?? '*' }
      }
      const variable = ts.isBindingElement(declaration) ? declaration.parent.parent : declaration
      const initializer = variable.initializer
      if (initializer && providerRequire(initializer)) return { module: initializer.arguments[0].text, export: ts.isBindingElement(declaration) ? (declaration.propertyName ?? declaration.name).getText() : '*' }
    }
    return null
  }
  function spy(expression, seen = new Set()) {
    expression = origin(expression)
    if (seen.has(expression)) return null
    seen.add(expression)
    if (!ts.isCallExpression(expression)) return null
    if (expression.expression.getText() === 'vi.spyOn' && expression.arguments.length >= 2) {
      const keys = literalKeys(expression.arguments[1]), provider = providerOf(expression.arguments[0])
      return provider && keys?.length === 1 ? { provider, method: keys[0] } : null
    }
    return ts.isPropertyAccessExpression(expression.expression) ? spy(expression.expression.expression, seen) : null
  }
  function vitestReceiver(expression) {
    const provider = providerOf(expression)
    if (provider?.module === 'vitest' && provider.export === 'vi') return true
    return ts.isIdentifier(expression) && expression.text === 'vi'
      && !(checker.getSymbolAtLocation(expression)?.declarations ?? []).some(declaration => sources.has(declaration.getSourceFile().fileName))
  }
  function mockFactoryMode(factory) {
    const plainParameters = fn => fn.parameters.every(parameter => ts.isIdentifier(parameter.name) && !parameter.initializer && !parameter.dotDotDotToken)
    if (!factory || !callable(factory) || !plainParameters(factory)) return 'uncertain'
    const unwrap = value => value && (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isAwaitExpression(value)) ? unwrap(value.expression) : value
    const returned = fn => ts.isBlock(fn.body) ? fn.body.statements.length === 1 && ts.isReturnStatement(fn.body.statements[0]) ? fn.body.statements[0].expression : undefined : fn.body
    const value = unwrap(returned(factory))
    const original = expression => {
      expression = unwrap(expression)
      return !!factory.parameters[0] && expression && ts.isCallExpression(expression) && expression.arguments.length === 0 && ts.isIdentifier(expression.expression)
        && checker.getSymbolAtLocation(expression.expression)?.valueDeclaration === factory.parameters[0] && !mutatedBindings.has(factory.parameters[0])
    }
    if (original(value) || value && ts.isObjectLiteralExpression(value) && value.properties.length === 1 && ts.isSpreadAssignment(value.properties[0]) && original(value.properties[0].expression)) return 'original'
    const closed = expression => {
      expression = unwrap(expression)
      if (!expression) return false
      if (ts.isLiteralExpression(expression) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(expression.kind)) return true
      if (ts.isArrayLiteralExpression(expression)) return expression.elements.every(closed)
      if (ts.isObjectLiteralExpression(expression)) return expression.properties.every(property => !property.name || !ts.isComputedPropertyName(property.name))
        && expression.properties.every(property => ts.isPropertyAssignment(property) ? closed(property.initializer) : (ts.isMethodDeclaration(property) || ts.isGetAccessor(property)) && closed(property))
      if (callable(expression)) return plainParameters(expression) && (ts.isBlock(expression.body) && expression.body.statements.length === 0 || closed(returned(expression)))
      return false
    }
    return value && ts.isObjectLiteralExpression(value) && closed(value) ? 'replacement' : 'uncertain'
  }
  function nativeTracker(expression) {
    if (!stableBinding(expression)) return false
    const provider = providerOf(expression)
    if (provider?.module === 'node:test' && provider.export === 'mock') return true
    if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== 'mock') return false
    const declaration = checker.getSymbolAtLocation(expression.expression)?.valueDeclaration
    if (!declaration || !ts.isParameter(declaration) || !callable(declaration.parent) || declaration.parent.parameters[0] !== declaration) return false
    const callback = declaration.parent, registration = callback.parent
    const registrationProvider = ts.isCallExpression(registration) && registration.arguments.includes(callback) && providerOf(registration.expression)
    return registrationProvider?.module === 'node:test' && stableBinding(registration.expression) && ['test', 'it', 'default', '*'].includes(registrationProvider.export)
  }
  function nativeReplacement(call) {
    if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'method' || call.arguments.length < 2) return null
    const provider = providerOf(call.arguments[0])
    if (!provider) return null
    const keys = literalKeys(call.arguments[1]), trackerProven = nativeTracker(call.expression.expression)
    const callback = call.arguments[2]
    const statement = callback && callable(callback) && ts.isBlock(callback.body) && callback.body.statements.length === 1 ? callback.body.statements[0] : null
    const literalThrow = statement && ts.isThrowStatement(statement) && (ts.isStringLiteralLike(statement.expression) || ts.isNumericLiteral(statement.expression)
      || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(statement.expression.kind))
    const known = trackerProven && nativeTarget(call.arguments[0]) && call.arguments.length === 3 && ts.isStringLiteralLike(call.arguments[1]) && literalThrow
      && callback.parameters.every(parameter => ts.isIdentifier(parameter.name) && !parameter.initializer && !parameter.dotDotDotToken)
    // inputStatus still requires a live property lookup: captured CJS function
    // values do not change when this provider object's method is replaced.
    return { provider, method: keys?.length === 1 ? keys[0] : null, trackerProven, action: known ? 'replace' : 'uncertain' }
  }
  function replacementEvent(call, entry) {
    const name = call.expression.getText()
    let event = nativeReplacement(call)
    if (event) { (entry.providerEvents ??= []).push({ ...event, ast: call }); return }
    if (name === 'vi.stubGlobal' && ts.isStringLiteralLike(call.arguments[0]) && call.arguments[1]) {
      const replacement = origin(call.arguments[1])
      let base = replacement
      const constant = ts.isCallExpression(base) && ts.isPropertyAccessExpression(base.expression) && /^mock(?:ReturnValue|ResolvedValue|RejectedValue)$/.test(base.expression.name.text)
      while (ts.isCallExpression(base) && ts.isPropertyAccessExpression(base.expression) && /^mock/.test(base.expression.name.text)) base = origin(base.expression.expression)
      const known = ts.isCallExpression(base) && base.expression.getText() === 'vi.fn' && (constant || base.arguments.length === 0) && !delegatingMocks.has(replacement)
      event = { provider: { global: call.arguments[0].text }, action: known ? 'replace' : 'uncertain' }
    } else if (['vi.restoreAllMocks', 'vi.unstubAllGlobals'].includes(name)) event = { action: 'restore', all: true, boundary: name === 'vi.unstubAllGlobals' ? 'global' : 'module' }
    else if (ts.isPropertyAccessExpression(call.expression)) {
      const method = call.expression.name.text, target = spy(call.expression.expression)
      const receiver = origin(call.expression.expression)
      if (/^(?:mockImplementation|restore)/.test(method) && ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'mock') {
        const value = origin(receiver.expression), handle = ts.isCallExpression(value) ? nativeReplacement(value) : null
        const provider = handle?.provider ?? providerOf(value)
        if (provider) event = { provider, method: handle?.method ?? provider.export, action: 'uncertain', reason: 'Native mock implementation or restoration changed' }
      }
      if (['restoreAll', 'reset'].includes(method) && nativeTracker(receiver)) event = { all: true, boundary: 'module', action: 'uncertain' }
      if (target && /^mock(?:ReturnValue|ResolvedValue|RejectedValue)$/.test(method)) event = { ...target, action: 'replace' }
      else if (target && method === 'mockRestore') event = { ...target, action: 'restore' }
      else if (target && /^mock(?:Implementation|ReturnValueOnce|ResolvedValueOnce|RejectedValueOnce)/.test(method)) event = { ...target, action: 'uncertain' }
    }
    if (event) (entry.providerEvents ??= []).push({ ...event, ast: call })
  }
  function providerEscape(expression, entry, ast) {
    const provider = providerOf(expression)
    if (!provider) return
    ;(entry.providerEvents ??= []).push({ provider, action: 'uncertain', ast, reason: 'Provider value escapes its proven replacement boundary' })
  }
  function providerTarget(provider, ast) {
    if (!provider?.module?.startsWith('.')) return null
    const file = local(ast.getSourceFile().fileName), stem = posix.normalize(posix.join(posix.dirname(file), provider.module))
    return (importGraph.get(file) ?? []).find(target => target === stem || ['.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.js', '/index.cjs'].some(extension => target === stem + extension))
  }
  function functionAdapter(expression) {
    if (!expression || !ts.isPropertyAccessExpression(expression) || !['call', 'apply', 'bind'].includes(expression.name.text)) return false
    const type = checker.getTypeAtLocation(origin(expression.expression))
    return !!type.getCallSignatures().length || !!(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
  }
  function callableValues(expression, seen = new Set()) {
    const value = origin(expression)
    if (seen.has(value)) return []
    seen.add(value)
    if (callable(value)) return byAst.has(value) ? [byAst.get(value)] : []
    if (ts.isCallExpression(value)) {
      const declaration = checker.getResolvedSignature(value)?.declaration
      if (!declaration?.body || seen.has(declaration)) return []
      seen.add(declaration)
      const result = []
      const returns = node => {
        if (node !== declaration.body && callable(node)) return
        if (ts.isReturnStatement(node) && node.expression) result.push(...callableValues(node.expression, seen))
        else ts.forEachChild(node, returns)
      }
      returns(declaration.body)
      return result
    }
    const declaration = receiverSymbol(value)?.valueDeclaration
    return declaration && callable(declaration) && byAst.has(declaration) ? [byAst.get(declaration)] : []
  }
  function literalKeys(n) {
    n = origin(n)
    if (ts.isStringLiteralLike(n) || ts.isNumericLiteral(n)) return [n.text]
    if (ts.isConditionalExpression(n)) {
      const a = literalKeys(n.whenTrue), b = literalKeys(n.whenFalse)
      return a && b ? [...new Set([...a, ...b])] : null
    }
    const type = checker.getTypeAtLocation(n)
    const types = type.isUnion() ? type.types : [type]
    return types.every(t => t.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral)) ? types.map(t => String(t.value)) : null
  }
  function receiverClasses(receiver, inherited = false) {
    const result = new Set()
    const inspectType = type => {
      for (const part of type.isUnion() ? type.types : [type]) for (const decl of part.symbol?.declarations ?? []) if (ts.isClassLike(decl) && !result.has(decl)) {
        result.add(decl)
        if (inherited) for (const clause of decl.heritageClauses ?? []) for (const base of clause.types) inspectType(checker.getTypeAtLocation(base.expression))
      }
    }
    inspectType(checker.getTypeAtLocation(receiver))
    if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'prototype') inspectType(checker.getTypeAtLocation(origin(receiver.expression)))
    return result
  }
  function resolveMember(receiver, keys, entry, access, reflective = false, invoked = false) {
    receiver = origin(receiver)
    const type = checker.getTypeAtLocation(receiver)
    const classes = receiverClasses(receiver, true)
    const concreteReceiver = receiver.kind === ts.SyntaxKind.ThisKeyword || ts.isNewExpression(receiver) || ts.isObjectLiteralExpression(receiver)
      || !!type.getConstructSignatures().length || ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'prototype' && !!checker.getTypeAtLocation(receiver.expression).getConstructSignatures().length
    let resolved = false
    for (const key of keys ?? []) {
      const references = { ...entry, edges: new Set(), edgeGuards: new Map(), conservativeEdges: new Set(), edgeEvidence: new Map() }
      const exported = commonjs.get(requiredModule(receiver))?.get(key)
      if (exported) { connect(references, exported); resolved = true }
      const symbol = checker.getPropertyOfType(type, key)
      linkSymbol(symbol, references, new Set(), optionalReceiver(access))
      if (symbol?.declarations?.some(decl => decl.getSourceFile().isDeclarationFile || !ts.isMethodSignature(decl) && !ts.isPropertySignature(decl))) resolved = true
      for (const id of references.edges) {
        connect(entry, id, optionalReceiver(access))
        const typeDerived = !concreteReceiver && (callable(nodes.get(id)?.ast) || callable(nodes.get(id)?.ast.initializer))
        if (typeDerived) { entry.typeReceiverEdges ??= new Set(); entry.typeReceiverEdges.add(id) }
        if (keys.length > 1 || typeDerived) entry.conservativeEdges.add(id)
        entry.edgeEvidence.set(id, { receiver: receiver.getText(), key, ...(keys.length > 1 ? { keyCandidates: keys } : {}), evidence: typeDerived ? 'receiver type; runtime allocation unproven' : 'receiver symbol', ...(reflective ? { observation: 'reflection' } : {}) })
      }
    }
    // Unknown dispatch is not permission to connect unrelated classes. Only
    // executable member access needs dispatch evidence; dynamic data reads keep
    // their actual object/value owner through ordinary symbol references.
    const parent = access.parent
    const executed = invoked || ts.isCallExpression(parent) && parent.expression === access
      || functionAdapter(parent)

    if (executed && (!keys || !resolved) && !externalReceiver(receiver)) {
      const position = access.getSourceFile().getLineAndCharacterOfPosition(access.getStart())
      ;(entry.dispatchRisks ??= []).push({
        owners: [...classes].map(decl => byAst.get(decl)).filter(Boolean), keys,
        reason: `${entry.file}:${position.line + 1}:${position.character + 1}: receiver ${receiver.getText()}; missing ${keys ? 'runtime receiver symbol' : 'finite property keys'} for ${access.getText()}`,
      })
    }
    return resolved
  }
  function resolveAccess(n, entry) {
    const keys = ts.isPropertyAccessExpression(n) ? [n.name.text] : literalKeys(n.argumentExpression)
    // Use the member symbol only, not the computed key variable's symbol.
    if (ts.isPropertyAccessExpression(n)) symbolEdges(n.name, entry)
    resolveMember(n.expression, keys, entry, n)
  }
  function inspect(n, entry, root = false) {
    if (ts.isWithStatement(n)) entry.unsafe = 'with dynamic scope'
    if (typeOnly(n) || ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isImportSpecifier(n) || ts.isNamespaceImport(n) || ts.isImportClause(n)) return
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
    // Defining an unused closure is not executing it. References and actual
    // argument/callee positions still enter the separately indexed callable.
    if (!root && ts.isReturnStatement(n) && n.expression && callable(n.expression)) return
    if (!root && ts.isFunctionDeclaration(n)) return
    if (!root && ts.isVariableDeclaration(n) && inertValue(n.initializer)) return
    if (!root && byAst.has(n)) {
      connect(entry, byAst.get(n))
      if (callable(n) && !invocationReference(n)) { entry.opaqueTargets ??= new Set(); entry.opaqueTargets.add(byAst.get(n)) }
      return
    }
    if (ts.isClassLike(n)) {
      for (const clause of n.heritageClauses ?? []) for (const type of clause.types) inspect(type.expression, entry)
      for (const decorator of ts.getDecorators(n) ?? []) inspect(decorator.expression, entry)
      for (const child of n.members) {
        for (const decorator of ts.canHaveDecorators(child) ? ts.getDecorators(child) ?? [] : []) inspect(decorator.expression, entry)
        if (child.name && ts.isComputedPropertyName(child.name)) inspect(child.name.expression, entry)
        if (ts.isClassStaticBlockDeclaration(child)) inspect(child, entry)
        if (child.modifiers?.some(mod => mod.kind === ts.SyntaxKind.StaticKeyword) && ts.isPropertyDeclaration(child)) {
          const id = byAst.get(child); if (id) connect(entry, id)
        }
      }
      return
    }
    if (ts.isNewExpression(n)) {
      for (const argument of n.arguments ?? []) providerEscape(argument, entry, n)
      const construct = (declaration, seen = new Set(), direct = true) => {
        if (seen.has(declaration)) return
        seen.add(declaration)
        for (const child of declaration.members) if (ts.isConstructorDeclaration(child) || ts.isPropertyDeclaration(child) && !child.modifiers?.some(mod => mod.kind === ts.SyntaxKind.StaticKeyword)) {
          if (byAst.has(child)) { if (ts.isConstructorDeclaration(child) && direct) invocation(entry, byAst.get(child), n); else connect(entry, byAst.get(child)) }
        }
        for (const clause of declaration.heritageClauses ?? []) for (const type of clause.types) {
          for (const base of checker.getTypeAtLocation(type.expression).symbol?.declarations ?? []) if (ts.isClassLike(base)) construct(base, seen, false)
        }
      }
      for (const declaration of checker.getTypeAtLocation(n.expression).symbol?.declarations ?? []) if (ts.isClassLike(declaration)) construct(declaration)
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      if (ts.isPropertyAccessExpression(n.left) || ts.isElementAccessExpression(n.left)) {
        const provider = providerOf(n.left.expression), keys = ts.isPropertyAccessExpression(n.left) ? [n.left.name.text] : literalKeys(n.left.argumentExpression)
        if (provider) (entry.providerEvents ??= []).push({ provider, method: keys?.length === 1 ? keys[0] : null, action: 'uncertain', ast: n, reason: 'Provider export mutation' })
      }
      providerEscape(n.right, entry, n)
    }
    if (ts.isReturnStatement(n) && n.expression) providerEscape(n.expression, entry, n)
    if (ts.isPropertyAssignment(n)) providerEscape(n.initializer, entry, n)
    if (ts.isShorthandPropertyAssignment(n)) providerEscape(n.name, entry, n)
    if (ts.isArrayLiteralExpression(n)) for (const element of n.elements) providerEscape(element, entry, n)
    if (ts.isCallExpression(n)) {
      replacementEvent(n, entry)
      if (!nativeReplacement(n) && !spy(n)) for (const argument of n.arguments) providerEscape(argument, entry, n)
      if (n.expression.getText() === 'eval') entry.unsafe = 'eval runtime dispatch'
      let callee = n.expression
      if (functionAdapter(callee)) callee = callee.expression
      for (const id of callableValues(callee)) invocation(entry, id, n)
      const signature = checker.getResolvedSignature(n)
      n.arguments.forEach((argument, index) => {
        const parameter = signature?.parameters[index]
        const parameterType = parameter && checker.getTypeOfSymbolAtLocation(parameter, n)
        if (!parameterType?.getCallSignatures().length && !invokedSymbols.has(parameter) && !checker.getTypeAtLocation(argument).getCallSignatures().length) return
        for (const id of callableValues(argument)) {
          connect(entry, id)
          entry.opaqueTargets ??= new Set(); entry.opaqueTargets.add(id)
        }
        const callback = origin(argument)
        if (ts.isElementAccessExpression(callback)) resolveMember(callback.expression, literalKeys(callback.argumentExpression), entry, callback, false, true)
      })
      const value = origin(callee)
      if (ts.isElementAccessExpression(value) && value !== callee) resolveMember(value.expression, literalKeys(value.argumentExpression), entry, value, false, true)
    }
    if (ts.isShorthandPropertyAssignment(n)) symbolEdges(n.name, entry, checker.getShorthandAssignmentValueSymbol(n))
    if (ts.isIdentifier(n) && n !== n.parent?.name) symbolEdges(n, entry)
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      resolveAccess(n, entry)
    }
    // Reflection is tied to the observed receiver, never a repository name scan.
    if (ts.isCallExpression(n) && /\.(?:getOwnPropertyDescriptor|spyOn|getOwnPropertyNames|getOwnPropertyDescriptors|ownKeys|keys|entries|values)$/.test(n.expression.getText()) && n.arguments[0]) {
      const receiver = origin(n.arguments[0])
      const key = n.arguments[1]
      if (key) resolveMember(receiver, literalKeys(key), entry, n, true)
      else {
        const domain = ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'prototype' ? 'prototype'
          : checker.getTypeAtLocation(receiver).getConstructSignatures().length ? 'static' : 'instance'
        for (const declaration of receiverClasses(receiver, domain === 'instance')) {
          const shape = shapes.get(declaration)?.[domain]
          if (shape) { connect(entry, shape); entry.edgeEvidence.set(shape, { receiver: receiver.getText(), observation: 'reflection', shape: domain }) }
        }
      }
    }
    ts.forEachChild(n, child => inspect(child, entry))
  }
  for (const entry of nodes.values()) {
    if (entry.shape) continue
    if (ts.isSourceFile(entry.ast) || entry.label === '<suite setup>') {
      function eager(n) {
        if (typeOnly(n) || registration(n) || ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || callable(n)) return
        if (ts.isEnumDeclaration(n)) {
          for (const m of n.members) if (m.initializer && !inertValue(m.initializer)) inspect(m.initializer, entry)
          return
        }
        if (ts.isClassLike(n)) {
          for (const decorator of ts.getDecorators(n) ?? []) inspect(decorator.expression, entry)
          for (const clause of n.heritageClauses ?? []) for (const type of clause.types) inspect(type.expression, entry)
          for (const m of n.members) {
            for (const decorator of ts.canHaveDecorators(m) ? ts.getDecorators(m) ?? [] : []) inspect(decorator.expression, entry)
            if (ts.isClassStaticBlockDeclaration(m)) inspect(m, entry)
            else if (m.modifiers?.some(mod => mod.kind === ts.SyntaxKind.StaticKeyword) && m.initializer
              && !inertValue(m.initializer)) inspect(m.initializer, entry)
            if (m.name && ts.isComputedPropertyName(m.name)) inspect(m.name.expression, entry)
          }
          return
        }
        if (ts.isVariableStatement(n)) { n.declarationList.declarations.forEach(eager); return }
        if (ts.isVariableDeclaration(n)) { if (n.initializer && !inertValue(n.initializer)) inspect(n, entry); return }
        if (ts.isStatement(n) || ts.isCallExpression(n) || ts.isNewExpression(n)) { inspect(n, entry); return }
        ts.forEachChild(n, eager)
      }
      eager(entry.ast)
    } else inspect(entry.ast, entry, true)
  }
  function readerBinding(input) {
    const file = input.readerFile ?? input.from, info = files.get(file)
    const offset = input.readerStart ?? input.start
    if (!info || offset === undefined) return { live: false }
    let call
    const locate = node => {
      if (node.getStart() <= offset && offset < node.end) {
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) call = node
        ts.forEachChild(node, locate)
      }
    }
    locate(info.sf)
    if (!call) return { live: false }
    const unwrap = expression => ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) ? unwrap(expression.expression) : expression
    const imported = expression => {
      const declaration = checker.getSymbolAtLocation(expression)?.declarations?.find(declaration => ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration) || ts.isImportClause(declaration))
      return !!declaration
    }
    const moduleKind = (expression, seen = new Set()) => {
      expression = unwrap(expression)
      if (seen.has(expression)) return null
      seen.add(expression)
      if (imported(expression)) return 'esm'
      if (providerRequire(expression)) return 'cjs'
      if (ts.isNewExpression(expression)) return moduleKind(expression.expression, seen)
      const declaration = bindingDeclaration(expression)
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && !mutatedBindings.has(declaration)) return moduleKind(declaration.initializer, seen)
      return null
    }
    const callee = unwrap(call.expression)
    if (ts.isIdentifier(callee)) {
      if (imported(callee)) return { live: true, moduleKind: 'esm' }
      if (input.provider?.global === callee.text && !(checker.getSymbolAtLocation(callee)?.declarations ?? []).some(declaration => sources.has(declaration.getSourceFile().fileName))) return { live: true, moduleKind: 'global' }
      // Destructuring or assigning a function captures its current value; a
      // later provider-object spy does not necessarily replace this call.
      return { live: false }
    }
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
      const kind = moduleKind(callee.expression)
      return { live: !!kind, moduleKind: kind }
    }
    return { live: false }
  }
  const inputs = new Map()
  for (const input of inputEdges ?? []) {
    const crossModule = input.readerFile && input.readerFile !== input.from
    const readerFile = crossModule ? input.readerFile : input.from
    const info = files.get(readerFile)
    if (!info) continue
    const offset = (crossModule ? input.readerStart : input.start) ?? info.sf.getPositionOfLineAndCharacter(input.line - 1, input.column - 1)
    let ast = info.sf
    function locate(node) {
      if (node.getStart() <= offset && offset < node.end) {
        ast = node
        ts.forEachChild(node, locate)
      }
    }
    locate(info.sf)
    let owner = ast
    while (owner && !byAst.has(owner)) owner = owner.parent
    const ownerId = byAst.get(owner) ?? info.top
    const id = `${readerFile}:${offset}:<input:${input.to}>`
    nodes.set(id, { id, ast, file: readerFile, provider: input.provider, readerBinding: readerBinding(input), changeKinds: input.changeKinds, inputSet: input.inputSet, readerMethod: input.kind === 'load' ? 'loadAsync' : input.provider?.export, label: `<input:${input.to}>`, edges: new Set(), conservativeEdges: new Set(), edgeEvidence: new Map() })
    connect(nodes.get(ownerId), id)
    if (crossModule || input.conservative || input.inputSet && input.kind !== 'directory-membership') nodes.get(ownerId).conservativeEdges.add(id)
    nodes.get(ownerId).edgeEvidence.set(id, { input: input.to, expression: input.expression, evidence: input.kind, ...(input.inputSet ? { inputSet: input.inputSet, ...(input.resolution || input.kind !== 'directory-membership' ? { resolution: input.resolution ?? 'possible bounded directory input' } : {}) } : {}), ...(crossModule ? { callerContext: { file: input.from, line: input.line, column: input.column }, resolution: 'finite factory context' } : {}) })
    if (!inputs.has(input.to)) inputs.set(input.to, new Set())
    inputs.get(input.to).add(id)
  }
  // Listing operations remain observable even when their proven snapshot set is empty.
  // These are operation nodes, not invented file targets.
  for (const pattern of inputPatterns ?? []) for (const listing of pattern.directoryInputs ?? []) {
    const info = files.get(listing.listingFile), offset = listing.listingStart
    if (!info || offset === undefined) continue
    let ast = info.sf, owner = info.sf
    const locate = node => {
      if (node.getStart() <= offset && offset < node.end) {
        ast = node; if (byAst.has(node)) owner = node
        ts.forEachChild(node, locate)
      }
    }
    locate(info.sf)
    const id = `${listing.listingFile}:${offset}:<directory-listing>`
    if (nodes.has(id)) continue
    nodes.set(id, { id, ast, file: listing.listingFile, label: '<directory-listing>', directoryInput: listing, readerBinding: readerBinding({ readerFile: listing.listingFile, readerStart: listing.listingStart, provider: listing.listingProvider }),
      edges: new Set(), conservativeEdges: new Set(), edgeEvidence: new Map() })
    const entry = nodes.get(byAst.get(owner))
    connect(entry, id)
    entry.edgeEvidence.set(id, { evidence: 'snapshot directory listing', expression: listing.listingExpression, directory: listing.directory, predicate: listing.predicate })
  }
  for (const risk of [...(inputRisks ?? []), ...(runtimeImportRisks ?? []).map(risk => ({ ...risk, moduleImport: true }))]) {
    const info = files.get(risk.from)
    if (!info) continue
    const offset = risk.start ?? info.sf.getPositionOfLineAndCharacter(risk.line - 1, risk.column - 1)
    let owner = info.sf
    function locate(node) {
      if (node.getStart() <= offset && offset < node.end) {
        if (byAst.has(node)) owner = node
        ts.forEachChild(node, locate)
      }
    }
    locate(info.sf)
    ;(nodes.get(byAst.get(owner)).inputRisks ??= []).push({ ...risk, start: offset })
  }
  // CJS require calls retain original bindings; a Vitest module replacement
  // cannot establish a file-wide boundary for those consumers.
  for (const input of inputEdges ?? []) if (input.kind === 'import' && /^require\s*\(/.test(input.inputExpression ?? input.expression)) commonjsTargets.add(input.to)
  const mockModes = new Map()
  for (const candidate of mockCandidates) {
    candidate.mode = mockFactoryMode(candidate.factory)
    candidate.boundaryKey = `${candidate.file}:${candidate.target ?? providerName({ module: candidate.provider })}`
    if (!mockModes.has(candidate.boundaryKey)) mockModes.set(candidate.boundaryKey, new Set())
    mockModes.get(candidate.boundaryKey).add(candidate.mode)
  }
  for (const { file, target, provider, ast, mode: ownMode, boundaryKey } of mockCandidates) {
    const mode = mockModes.get(boundaryKey).size === 1 ? ownMode : 'uncertain', info = files.get(file)
    if (mode === 'original') continue
    const uncertain = { provider, target, expression: ast.getText(), reason: mode === 'replacement' ? 'CommonJS consumer is not replaced by an ESM module mock' : 'Mock factory delegation or returned exports are unresolved' }
    if (mode === 'replacement' && (!target || !commonjsTargets.has(target))) {
      if (target) { info.blocked.add(target); info.replacementMocks.set(target, { provider, target, expression: ast.getText() }) }
      info.blockedProviders.add(providerName({ module: provider }))
    } else {
      if (target) info.uncertainMocks.set(target, uncertain)
      info.uncertainProviders.set(providerName({ module: provider }), uncertain)
    }
  }
  function mockUncertainty(path, testFile, reached) {
    for (const step of path) if (reached?.mockUncertainties?.has(step.file)) return reached.mockUncertainties.get(step.file)
    for (const step of path) if (files.get(testFile)?.uncertainMocks.has(step.file)) return files.get(testFile).uncertainMocks.get(step.file)
    return null
  }
  function nullishValue(expression, environment, visited = new Set()) {
    if (!expression) return 'undefined'
    if (visited.has(expression)) return 'unknown'
    visited.add(expression)
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) return nullishValue(expression.expression, environment, visited)
    if (expression.kind === ts.SyntaxKind.NullKeyword) return 'null'
    if (ts.isVoidExpression(expression) || ts.isOmittedExpression(expression)) return 'undefined'
    if (ts.isIdentifier(expression)) {
      const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration
      if (declaration && mutatedBindings.has(declaration)) return 'unknown'
      if (declaration && environment.has(declaration)) return environment.get(declaration)
      if (expression.text === 'undefined' && (!declaration || !sources.has(declaration.getSourceFile().fileName))) return 'undefined'
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return nullishValue(declaration.initializer, environment, visited)
      return 'unknown'
    }
    if (ts.isLiteralExpression(expression) || ts.isObjectLiteralExpression(expression) || ts.isArrayLiteralExpression(expression) || ts.isNewExpression(expression) || callable(expression)
      || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(expression.kind)) return 'present'
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      const left = nullishValue(expression.left, environment, visited)
      return left === 'null' || left === 'undefined' ? nullishValue(expression.right, environment, visited) : left
    }
    return 'unknown'
  }
  const contextIds = new WeakMap()
  let contextOrdinal = 0
  function contextKey(environment) {
    return [...environment].map(([parameter, value]) => {
      if (!contextIds.has(parameter)) contextIds.set(parameter, contextOrdinal++)
      return `${contextIds.get(parameter)}:${value}`
    }).sort().join(',')
  }
  function callEnvironment(target, context, parent) {
    if (!callable(target.ast)) return parent
    const environment = new Map()
    for (let ancestor = target.ast.parent; ancestor; ancestor = ancestor.parent) if (callable(ancestor)) {
      for (const parameter of ancestor.parameters) if (parent.has(parameter)) environment.set(parameter, parent.get(parameter))
    }
    if (!context?.args) return environment
    let spread = false
    target.ast.parameters.forEach((parameter, index) => {
      const argument = context.args[index]
      spread ||= !!argument && ts.isSpreadElement(argument)
      let value = parameter.dotDotDotToken ? 'present' : spread ? 'unknown' : nullishValue(argument, parent)
      if (value === 'undefined' && parameter.initializer) value = nullishValue(parameter.initializer, environment)
      if (value !== 'unknown' && !mutatedBindings.has(parameter)) environment.set(parameter, value)
    })
    return environment
  }
  function reachable(roots, testFile) {
    const blocked = new Set(files.get(testFile)?.blocked ?? []), pending = [], mockUncertainties = new Map()
    const seen = new Set(), states = new Map(), first = new Map(), queue = []
    const enqueue = (id, environment, parent, evidence, conservative = false) => {
      if (!nodes.has(id)) return
      if (blocked.has(nodes.get(id).file)) { pending.push([id, environment, parent, evidence, conservative]); return }
      const key = `${id}\0${contextKey(environment)}`
      if (states.has(key)) return
      const state = { id, environment, parent, evidence, conservative }
      states.set(key, state); queue.push([key, state])
    }
    roots.forEach(id => enqueue(id, new Map(), null, null))
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const [key, state] = queue[cursor], entry = nodes.get(state.id)
      seen.add(state.id); if (!first.has(state.id)) first.set(state.id, key)
      for (const event of entry.providerEvents ?? []) if (event.action === 'uncertain') {
        const target = providerTarget(event.provider, event.ast), replacement = files.get(testFile)?.replacementMocks.get(target)
        if (replacement && blocked.delete(target)) {
          mockUncertainties.set(target, { ...replacement, reason: 'Replacement exports are reconfigured or escape on this case path', reconfiguration: event.ast.getText() })
          for (const attempt of pending) if (nodes.get(attempt[0]).file === target) enqueue(...attempt)
        }
      }
      for (const next of entry.edges) {
        const guards = entry.edgeGuards?.get(next)
        const guarded = guards?.size && !guards.has(null)
        const facts = guarded ? [...guards].map(expression => ({ receiver: expression.getText(), value: nullishValue(expression, state.environment) })) : []
        if (guarded && facts.every(fact => fact.value === 'null' || fact.value === 'undefined')) continue
        const target = nodes.get(next)
        if (!target) continue
        const contexts = [...(entry.callContexts?.get(next) ?? [null])]
        if (entry.callContexts?.has(next) && entry.opaqueTargets?.has(next)) contexts.push(null)
        for (const context of contexts) {
          const environment = callEnvironment(target, context, state.environment)
          const parameters = context && callable(target.ast) ? target.ast.parameters.filter(parameter => environment.has(parameter)).map(parameter => ({ name: parameter.name.getText(), value: environment.get(parameter) })) : []
          const evidence = { ...entry.edgeEvidence.get(next), ...(context ? { callsite: { file: entry.file, start: context.call.getStart() } } : {}),
            ...(parameters.length ? { parameters } : {}), ...(facts.length ? { optionalGuard: facts } : {}) }
          enqueue(next, environment, key, evidence, entry.conservativeEdges.has(next) || facts.some(fact => fact.value === 'unknown'))
        }
      }
    }
    seen.trace = { states, first }
    seen.mockUncertainties = mockUncertainties
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
  const declarations = new Map()
  function snapshot(file) {
    const info = files.get(file)
    if (!info) throw new Error(`Missing behavior source: ${file}`)
    if (!declarations.has(file)) declarations.set(file, declarationSnapshot(info.sf, byAst, shapes))
    return declarations.get(file)
  }
  function changedNodes(file, previous, status = 'M') {
    const inputTargets = [...(inputs.get(file) ?? [])].filter(id => !nodes.get(id).changeKinds || nodes.get(id).changeKinds.includes(status[0]))
    if (!files.has(file)) return new Set(inputTargets)
    const before = previous.hasFile(file) ? previous.snapshot(file) : { entries: new Map(), initializationOrder: [], modules: [], sideEffectModules: [] }
    const { ids, moduleEffect } = changedDeclarations(snapshot(file), before)
    // An independently changed opaque initialization effect cannot be hidden
    // by a different covered callable/value in the same patch.
    if (moduleEffect) ids.add(files.get(file).top)
    // Source files may also be consumed as bytes, independently of executed declarations.
    for (const id of inputTargets) ids.add(id)
    return ids
  }
  const explanations = new WeakMap()
  function explain(roots, reached, target) {
    if (reached.trace) {
      const { states, first } = reached.trace
      if (!first.has(target)) return []
      const path = []
      for (let key = first.get(target); key; key = states.get(key).parent) path.unshift(states.get(key))
      const result = path.map((state, index) => {
        const node = nodes.get(state.id)
        return { file: node.file, behavior: node.label, line: node.ast.getSourceFile().getLineAndCharacterOfPosition(node.ast.getStart()).line + 1, ...(index ? state.evidence : { root: true }) }
      })
      result.rootId = path[0]?.id
      result.initialization = path.some(state => nodes.get(state.id).label === '<module>')
      result.conservative = path.some(state => state.conservative)
      return result
    }
    // Shared-module edits can match many targets in one leaf. Reuse that leaf's
    // shortest-path tree instead of traversing the same graph for every target.
    // Expand lazily, preserving the original BFS order and conservative edges.
    let search = explanations.get(roots)
    if (!search || search.reached !== reached) {
      search = { reached, previous: new Map(roots.map(id => [id, null])), queue: [...roots], cursor: 0 }
      explanations.set(roots, search)
    }
    const { previous, queue } = search
    while (!previous.has(target) && search.cursor < queue.length) {
      const id = queue[search.cursor++]
      for (const next of nodes.get(id)?.edges ?? []) if (reached.has(next) && !previous.has(next)) { previous.set(next, id); queue.push(next) }
    }
    if (!previous.has(target)) return []
    const path = []
    for (let next = target; next; next = previous.get(next)) path.unshift(nodes.get(next))
    const behaviors = path.map((n, index) => ({ file: n.file, behavior: n.label, line: n.ast.getSourceFile().getLineAndCharacterOfPosition(n.ast.getStart()).line + 1, ...(index ? path[index - 1].edgeEvidence.get(n.id) : { root: true }) }))
    behaviors.rootId = path[0]?.id
    behaviors.initialization = path.some(n => n.label === '<module>')
    behaviors.conservative = path.some((n, index) => n.conservativeEdges.has(path[index + 1]?.id))
    return behaviors
  }
  function inputStatus(provider, method, roots, reached, target, testFile, inputProof) {
    if (!provider) return 'real'
    const key = providerName(provider)
    if (files.get(testFile)?.uncertainProviders.has(key)) return 'uncertain'
    const binding = inputProof ? readerBinding(inputProof) : nodes.get(target)?.readerBinding ?? { live: false }
    const initial = files.get(testFile)?.blockedProviders.has(key) ? binding.live && binding.moduleKind === 'esm' ? 'replaced' : 'uncertain' : 'real'
    const inputPath = explain(roots, reached, target)
    const rootAst = nodes.get(inputPath.rootId)?.ast
    if (!rootAst) return 'uncertain'
    const invocation = inputPath.find(step => step.callsite?.file === testFile && rootAst.getStart() <= step.callsite.start && step.callsite.start < rootAst.end)?.callsite.start
      ?? (nodes.get(target)?.file === testFile ? nodes.get(target).ast.getStart() : null)
    const events = []
    for (const id of reached) for (const event of nodes.get(id)?.providerEvents ?? []) {
      if (event.all && (event.boundary === 'global') !== !!provider.global) continue
      if (!event.all && (providerName(event.provider) !== key || event.provider.export && event.provider.export !== '*' && provider.export && event.provider.export !== provider.export || event.method && method && event.method !== method)) continue
      let scope = 'helper', conditional = false
      for (let node = event.ast; node; node = node.parent) {
        if (ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isIterationStatement(node, false)) conditional = true
        if (ts.isCallExpression(node) && /^(?:afterEach|afterAll|after|onTestFinished)$/.test(node.expression.getText())) { scope = 'after'; break }
        if (ts.isCallExpression(node) && /^(?:beforeEach|beforeAll|before)$/.test(node.expression.getText())) { scope = 'before'; break }
        if (node === rootAst) { scope = 'body'; break }
        if (ts.isSourceFile(node)) scope = 'helper'
      }
      if (scope === 'after') continue
      if (scope === 'body' && invocation !== null && event.ast.getStart() > invocation) {
        // The same reader may be invoked again after this restore. Without a
        // distinct invocation identity, never claim every read was replaced.
        if (event.action === 'restore' || event.action === 'uncertain') return 'uncertain'
        continue
      }
      if (scope === 'helper') {
        const eventPath = explain(roots, reached, id)
        const callsite = eventPath.find(step => step.callsite?.file === testFile && rootAst.getStart() <= step.callsite.start && step.callsite.start < rootAst.end)?.callsite.start
        if (callsite === undefined || invocation === null) { events.push({ action: 'uncertain', order: Infinity }); continue }
        if (callsite > invocation) continue
        events.push({ action: conditional ? 'uncertain' : event.action, order: callsite })
      } else events.push({ action: conditional || scope === 'body' && invocation === null ? 'uncertain' : event.action, order: scope === 'before' ? -1 : event.ast.getStart() })
    }
    events.sort((a,b) => a.order - b.order)
    const action = events.at(-1)?.action
    return action === 'replace' ? binding.live ? 'replaced' : 'uncertain' : action === 'uncertain' ? 'uncertain' : initial
  }
  return { nodes, reachable, caseRoots, wholeFileRoots, changedNodes, snapshot, explain, inputStatus, mockUncertainty, runtimeReaches, hasFile: file => files.has(file) }
}

function selectBehaviors(inventory, changed, consumers, evidence) {
  const { sources, previousSources, ranges, compilerOptions } = evidence
  const head = behaviorGraph(sources, consumers.graph, compilerOptions, evidence.repositoryRoot, consumers.inputEdges, consumers.inputRisks, consumers.runtimeImportRisks, consumers.inputPatterns)
  const previous = evidence.previousConsumers ?? (previousSources === sources ? consumers : require('./dependencies.cjs').dependencyConsumers(inventory, previousSources))
  const graphs = [head, previousSources === sources ? head : behaviorGraph(previousSources, previous.graph, compilerOptions, evidence.repositoryRoot, previous.inputEdges, previous.inputRisks, previous.runtimeImportRisks, previous.inputPatterns)]
  const testRenames = evidence.testRenames ?? new Map()
  const oldTestPaths = new Map([...testRenames].map(([before, after]) => [after, before]))
  const selectedCases = {}, reasons = {}, details = {}, changedBehaviors = new Set(), candidates = new Set(), uncovered = new Set(), unobservedInputCandidates = [], unobservedEquivalentSources = []
  for (const change of changed) {
    const targets = graphs.map((g, i) => change.status === 'A' && i === 1 ? new Set() : g.changedNodes(change.file, graphs[1 - i], change.status))
    for (let i=0; i<2; i++) for (const id of targets[i]) changedBehaviors.add(`${change.file}#${graphs[i].nodes.get(id).label}`)
    const covered = [new Set(), new Set()]
    const riskConsumers = graph => [...(graph.runtimeImportRisks ?? []), ...(graph.inputPatterns ?? []), ...(graph.inputRisks ?? []).filter(risk => risk.pattern ? new RegExp(risk.pattern).test(change.file) : !risk.candidates?.length || risk.candidates.includes(change.file))]
      .flatMap(risk => [...(graph[risk.from] ?? []), ...(inventory.some(suite => suite.file === risk.from) ? [risk.from] : [])])
    for (const file of new Set([...(consumers[change.file] ?? []), ...riskConsumers(consumers), ...[...(previous[change.file] ?? []), ...riskConsumers(previous)].map(file => testRenames.get(file) ?? file)])) {
      candidates.add(file)
      const suite = inventory.find(item => item.file === file)
      if (!suite) continue
      const fallback = !suite.locations || suite.locations.length !== suite.names.length
        || suite.names.some((name, i) => suite.names.indexOf(name) !== i)
        || suite.nativeNames && new Set(suite.nativeNames).size !== suite.nativeNames.length
      const caseEvidence = [], matched = [], owners = new Set(), conservativeCases = new Set(), initializationCases = new Set()
      let runtimeHit = false
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
          const actualRoots = roots || graphs[i].wholeFileRoots(graphFile)
          const reached = graphs[i].reachable(actualRoots, graphFile)
          for (const id of reached) {
            const unresolved = graphs[i].nodes.get(id)
            const failRisk = (message, risk) => {
              const error = new Error(`${message}; case ${file}#${suite.names[index]}; changed ${change.file}`)
              error.diagnostics = { executable: false, result: 'blocked', changed: change.file, test: file, caseIndex: index, case: suite.names[index], path: [...graphs[i].explain(actualRoots, reached, id)], unresolved: risk }
              throw error
            }
            if (unresolved?.unsafe) failRisk(`Unsafe runtime dispatch: ${file}: ${unresolved.unsafe}`, { reason: unresolved.unsafe })
            if (unresolved?.directoryInput) {
              const listing = unresolved.directoryInput
              const status = graphs[i].inputStatus(listing.listingProvider, listing.listingProvider?.export, actualRoots, reached, id, graphFile)
              if (status !== 'real') failRisk('Unsafe runtime directory membership: listing provider is replaced or its delegation is unresolved', { ...listing, providerStatus: status })
            }
            for (const risk of unresolved?.inputRisks ?? []) {
              const candidateInput = risk.moduleImport || ['import', 'execute', 'glob'].includes(risk.kind)
                || (risk.pattern ? new RegExp(risk.pattern).test(change.file) : !risk.candidates?.length || risk.candidates.includes(change.file))
              // A changed caller is not evidence that a bounded output read can
              // consume this changed input. Source bytes are inputs too.
              if (!candidateInput) continue
              const providerStatus = graphs[i].inputStatus(risk.provider, risk.kind === 'load' ? 'loadAsync' : risk.provider?.export, actualRoots, reached, id, graphFile, risk)
              if (providerStatus === 'replaced') continue
              if (candidateInput && providerStatus === 'uncertain') failRisk('Unsafe runtime input: ambiguous replacement/restore ordering', risk)
              if (candidateInput) failRisk(`Unsafe runtime ${risk.moduleImport ? 'import' : 'input'}: ${risk.from}:${risk.line}:${risk.column}: ${risk.expression}; ${risk.reason}; missing ${risk.missingEvidence ?? 'resolvable input provenance'}`, risk)
            }
            for (const risk of unresolved?.dispatchRisks ?? []) {
              const affectsChange = [...targets[i]].some(target => {
                const node = graphs[i].nodes.get(target)
                if (risk.owners.length) return risk.owners.some(owner => graphs[i].nodes.get(owner).ast === node.ast || graphs[i].nodes.get(owner).ast === node.ast.parent)
                if (!graphs[i].runtimeReaches(graphFile, node.file)) return false
                return !risk.keys || !!node.ast.name && (member(node.ast) || callable(node.ast) || ts.isVariableDeclaration(node.ast) && callable(node.ast.initializer) || ts.isPropertyAssignment(node.ast) || ts.isShorthandPropertyAssignment(node.ast)) && risk.keys.includes(node.ast.name.getText().replace(/^['"]|['"]$/g, ''))
              })
              if (affectsChange) failRisk(`Unsafe runtime dispatch: ${file}: ${risk.reason}`, risk)
            }
          }
          for (const id of targets[i]) if (reached.has(id)) {
            const target = graphs[i].nodes.get(id)
            const dependencyPath = graphs[i].explain(actualRoots, reached, id)
            const mock = graphs[i].mockUncertainty(dependencyPath, graphFile, reached)
            if (mock) {
              const error = new Error(`Unsafe mock boundary: ${file}#${suite.names[index]}; ${mock.reason}; ${mock.expression}`)
              error.diagnostics = { executable: false, changed: change.file, test: file, caseIndex: index, path: [...dependencyPath], unresolved: mock }
              throw error
            }
            const providerStatus = graphs[i].inputStatus(target.provider, target.readerMethod, actualRoots, reached, id, graphFile)
            if (providerStatus === 'replaced') continue
            if (providerStatus === 'uncertain') { const error = new Error(`Unsafe runtime input: ${file}#${suite.names[index]}; ambiguous replacement/restore ordering for ${target.label}`); error.diagnostics = { executable: false, changed: change.file, test: file, caseIndex: index, path: [...graphs[i].explain(actualRoots, reached, id)] }; throw error }
            hit = true; covered[i].add(id)
            const path = graphs[i].explain(actualRoots, reached, id)
            caseEvidence.push({ index, name: suite.names[index], snapshot: i === 0 ? 'after' : 'before', reason: uncertain ? 'necessary whole-owner fallback' : path.conservative ? 'finite receiver dependency' : 'exact symbol dependency', path: [...path] })
            if (path.initialization) initializationCases.add(index)
            else runtimeHit = true
            if (path.conservative) { conservativeCases.add(index); caller = true }
            for (const step of path) if (step.file !== file && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(step.file) && !step.root) { owners.add(step.behavior); if (step.file !== change.file) caller = true }
          }
        }
        if (hit) matched.push(index)
        if (uncertain && hit) whole = true
      }
      if (whole) {
        matched.splice(0, matched.length, ...suite.names.map((_, i) => i))
        for (const index of matched) if (!caseEvidence.some(item => item.index === index)) caseEvidence.push({ index, name: suite.names[index], reason: 'necessary whole-owner fallback', missingEvidence: 'ambiguous registration identity or changed base callback coordinates', path: caseEvidence[0]?.path ?? [] })
      }
      if (matched.length) {
        selectedCases[file] = [...new Set([...(selectedCases[file] ?? []), ...matched])].sort((a,b)=>a-b)
        ;(reasons[file] ??= []).push(`Runtime behavior reference: ${change.file}`)
        ;(details[file] ??= []).push({ changed: change.file, source: !runtimeHit ? 'Module Initialization' : caller ? 'Caller Contract' : 'Direct Owner', owners: [...owners].sort(), conservativeCases: [...conservativeCases], initializationCases: [...initializationCases], caseEvidence })
      }
    }
    for (let i=0; i<2; i++) for (const id of targets[i]) {
      if (covered[i].has(id)) continue
      const label = graphs[i].nodes.get(id).label
      if (graphs[i].nodes.get(id).shape) continue
      if (!covered[i].has(id)) uncovered.add(`Unsafe/unmapped behavior: ${change.file}#${label}; no proven owner cases`)
    }
    if (!Object.values(details).some(list=>list.some(d=>d.changed===change.file))) {
      const exactInput = [...(consumers.inputEdges ?? []), ...(previous.inputEdges ?? [])].some(edge => edge.to === change.file && (!edge.changeKinds || edge.changeKinds.includes(change.status[0])))
      if (!exactInput && targets.every(ids => ids.size === 0)) {
        if (!graphs.some(graph => graph.hasFile(change.file))) unobservedInputCandidates.push(change.file)
        else if (sources.has(change.file) && previousSources.has(change.file)
          && require('./dependencies.cjs').runtimeEquivalent(previousSources.get(change.file), sources.get(change.file), change.file)) unobservedEquivalentSources.push(change.file)
        else uncovered.add(`Unsafe/unmapped behavior: ${change.file}; no proven owner cases`)
      } else uncovered.add(`Unsafe/unmapped behavior: ${change.file}; no proven owner cases`)
    }
  }
  const result = { selected: Object.keys(selectedCases).sort(), selectedCases, reasons, details,
    unobservedInputCandidates: unobservedInputCandidates.sort(), unobservedEquivalentSources: unobservedEquivalentSources.sort(), changedBehaviors: [...changedBehaviors].sort(), excludedCandidates: [...candidates].filter(f=>!selectedCases[f]).sort(), unsafe: [...uncovered] }
  if (uncovered.size) {
    const error = new Error([...uncovered].join('\n'))
    error.diagnostics = result // Incomplete evidence only; never an executable plan.
    throw error
  }
  return result
}
module.exports = { behaviorGraph, selectBehaviors }
