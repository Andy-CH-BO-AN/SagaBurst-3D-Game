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
function behaviorGraph(sources, importGraph, compilerOptions = {}, repositoryRoot = process.cwd(), inputEdges = [], inputRisks = [], runtimeImportRisks = []) {
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
  const nodes = new Map(), byAst = new Map(), shapes = new Map(), files = new Map(), commonjs = new Map(), mockCandidates = [], invokedSymbols = new Set(), parameterInputs = new Map(), mutatedReceivers = new Set(), delegatingMocks = new Set()
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
    files.set(file, { sf, top, registrations: [], hooks: [], blocked: new Set(), blockedProviders: new Set() })
    const importBindings = runtimeImports(sf).bindings
    function index(n) {
      if (typeOnly(n)) return
      if ((ts.isImportSpecifier(n) || ts.isNamespaceImport(n) || ts.isImportClause(n)) && n.name && importBindings.has(n.name.text)) add(n, `<import:${n.name.text}>`)
      if (callable(n) || ts.isClassStaticBlockDeclaration(n) || ts.isVariableDeclaration(n) || member(n) || ts.isClassLike(n) || ts.isEnumDeclaration(n)) {
        const owner = n.parent?.name?.getText?.()
        add(n, `${owner ? owner + '.' : ''}${n.name?.getText() ?? (ts.isConstructorDeclaration(n) ? 'constructor' : ts.isClassStaticBlockDeclaration(n) ? '<static initialization>' : '<callback>')}`)
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
          mockCandidates.push({ file, target, provider: n.arguments[0].text, factory })
        }
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && (ts.isPropertyAccessExpression(n.left) || ts.isElementAccessExpression(n.left))) {
        const symbol = receiverSymbol(origin(n.left.expression))
        if (symbol) mutatedReceivers.add(symbol)
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
  function requiredModule(n) {
    n = origin(n)
    if (!ts.isCallExpression(n) || n.expression.getText() !== 'require' || !n.arguments[0] || !ts.isStringLiteralLike(n.arguments[0])) return null
    const file = local(n.getSourceFile().fileName)
    const stem = posix.normalize(posix.join(posix.dirname(file), n.arguments[0].text))
    return (importGraph.get(file) ?? []).find(dep => dep === stem || ['.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.js'].some(ext => dep === stem + ext))
  }
  function linkSymbol(symbol, entry, seen = new Set()) {
    if (!symbol || seen.has(symbol)) return symbol
    seen.add(symbol)
    for (const decl of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(decl) && decl.initializer && ts.isIdentifier(decl.name)) {
        const id = commonjs.get(requiredModule(decl.initializer))?.get('<default>')
        if (id) entry.edges.add(id)
      }
      if (ts.isBindingElement(decl) && ts.isVariableDeclaration(decl.parent.parent) && decl.parent.parent.initializer) {
        const module = requiredModule(decl.parent.parent.initializer)
        const id = commonjs.get(module)?.get((decl.propertyName ?? decl.name).getText())
        if (id) { entry.edges.add(id); entry.edgeEvidence.set(id, { receiver: module, key: (decl.propertyName ?? decl.name).getText(), evidence: 'CommonJS export binding' }) }
      }
      let owner = decl
      while (ts.isBindingElement(owner) || ts.isObjectBindingPattern(owner) || ts.isArrayBindingPattern(owner)) owner = owner.parent
      const id = byAst.get(owner)
      if (id && id !== entry.id) { entry.edges.add(id); entry.conservativeEdges.delete(id) }
    }
    // Preserve intermediate import/re-export bindings instead of flattening
    // directly to the final declaration: an unchanged caller can be retargeted.
    return symbol.flags & ts.SymbolFlags.Alias
      ? linkSymbol(checker.getImmediateAliasedSymbol(symbol), entry, seen) : symbol
  }
  function symbolEdges(n, entry, original = checker.getSymbolAtLocation(n)) {
    const symbol = linkSymbol(original, entry)
    const namespace = symbol && symbol.flags & (ts.SymbolFlags.ValueModule | ts.SymbolFlags.NamespaceModule)
    const namedAccess = (ts.isPropertyAccessExpression(n.parent) || ts.isElementAccessExpression(n.parent)) && n.parent.expression === n
      && (ts.isPropertyAccessExpression(n.parent) || literalKeys(n.parent.argumentExpression))
    // Namespace escape, dynamic access and enumeration may read any export.
    if (namespace && !namedAccess) for (const exported of checker.getExportsOfModule(symbol)) linkSymbol(exported, entry)
    // A CommonJS/destructured class binding can have a BindingElement symbol
    // while its runtime type still identifies the actual class declaration.
    const valueType = checker.getTypeAtLocation(n)
    for (const decl of valueType.getConstructSignatures().length ? valueType.symbol?.declarations ?? [] : []) {
      if (ts.isClassLike(decl) && byAst.has(decl)) entry.edges.add(byAst.get(decl))
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
  function providerOf(expression) {
    expression = origin(expression)
    if (ts.isPropertyAccessExpression(expression)) {
      const provider = providerOf(expression.expression)
      return provider && expression.name.text !== 'prototype' ? { ...provider, export: expression.name.text } : provider
    }
    const symbol = checker.getSymbolAtLocation(expression)
    for (const declaration of symbol?.declarations ?? []) {
      for (let node = declaration; node; node = node.parent) if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        return { module: node.moduleSpecifier.text, export: ts.isNamespaceImport(declaration) ? '*' : declaration.propertyName?.text ?? declaration.name?.text ?? '*' }
      }
      const variable = ts.isBindingElement(declaration) ? declaration.parent.parent : declaration
      const initializer = variable.initializer
      if (initializer && ts.isCallExpression(initializer) && initializer.expression.getText() === 'require' && ts.isStringLiteralLike(initializer.arguments[0])) return { module: initializer.arguments[0].text, export: ts.isBindingElement(declaration) ? (declaration.propertyName ?? declaration.name).getText() : '*' }
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
  function replacementEvent(call, entry) {
    const name = call.expression.getText()
    let event
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
      if (target && /^mock(?:ReturnValue|ResolvedValue|RejectedValue)$/.test(method)) event = { ...target, action: 'replace' }
      else if (target && method === 'mockRestore') event = { ...target, action: 'restore' }
      else if (target && /^mock(?:Implementation|ReturnValueOnce|ResolvedValueOnce|RejectedValueOnce)/.test(method)) event = { ...target, action: 'uncertain' }
    }
    if (event) (entry.providerEvents ??= []).push({ ...event, ast: call })
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
    let resolved = false
    for (const key of keys ?? []) {
      const references = { ...entry, edges: new Set(), conservativeEdges: new Set(), edgeEvidence: new Map() }
      const exported = commonjs.get(requiredModule(receiver))?.get(key)
      if (exported) { references.edges.add(exported); resolved = true }
      const symbol = checker.getPropertyOfType(type, key)
      linkSymbol(symbol, references)
      if (symbol?.declarations?.some(decl => decl.getSourceFile().isDeclarationFile || !ts.isMethodSignature(decl) && !ts.isPropertySignature(decl))) resolved = true
      for (const id of references.edges) {
        entry.edges.add(id)
        if (keys.length > 1) entry.conservativeEdges.add(id)
        entry.edgeEvidence.set(id, { receiver: receiver.getText(), key, ...(keys.length > 1 ? { keyCandidates: keys } : {}), evidence: 'receiver symbol', ...(reflective ? { observation: 'reflection' } : {}) })
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
    if (!root && byAst.has(n)) { entry.edges.add(byAst.get(n)); return }
    if (ts.isClassLike(n)) {
      for (const clause of n.heritageClauses ?? []) for (const type of clause.types) inspect(type.expression, entry)
      for (const decorator of ts.getDecorators(n) ?? []) inspect(decorator.expression, entry)
      for (const child of n.members) {
        for (const decorator of ts.canHaveDecorators(child) ? ts.getDecorators(child) ?? [] : []) inspect(decorator.expression, entry)
        if (child.name && ts.isComputedPropertyName(child.name)) inspect(child.name.expression, entry)
        if (ts.isClassStaticBlockDeclaration(child)) inspect(child, entry)
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
        for (const child of declaration.members) if (ts.isConstructorDeclaration(child) || ts.isPropertyDeclaration(child) && !child.modifiers?.some(mod => mod.kind === ts.SyntaxKind.StaticKeyword)) {
          if (byAst.has(child)) entry.edges.add(byAst.get(child))
        }
        for (const clause of declaration.heritageClauses ?? []) for (const type of clause.types) {
          for (const base of checker.getTypeAtLocation(type.expression).symbol?.declarations ?? []) if (ts.isClassLike(base)) construct(base, seen)
        }
      }
      for (const declaration of checker.getTypeAtLocation(n.expression).symbol?.declarations ?? []) if (ts.isClassLike(declaration)) construct(declaration)
    }
    if (ts.isCallExpression(n)) {
      replacementEvent(n, entry)
      if (n.expression.getText() === 'eval') entry.unsafe = 'eval runtime dispatch'
      let callee = n.expression
      if (functionAdapter(callee)) callee = callee.expression
      for (const id of callableValues(callee)) { entry.edges.add(id); entry.edgeEvidence.set(id, { evidence: 'callable provenance', callsite: { file: entry.file, start: n.getStart() } }) }
      const signature = checker.getResolvedSignature(n)
      n.arguments.forEach((argument, index) => {
        const parameter = signature?.parameters[index]
        const parameterType = parameter && checker.getTypeOfSymbolAtLocation(parameter, n)
        if (!parameterType?.getCallSignatures().length && !invokedSymbols.has(parameter) && !checker.getTypeAtLocation(argument).getCallSignatures().length) return
        for (const id of callableValues(argument)) entry.edges.add(id)
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
          if (shape) { entry.edges.add(shape); entry.edgeEvidence.set(shape, { receiver: receiver.getText(), observation: 'reflection', shape: domain }) }
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
    nodes.set(id, { id, ast, file: readerFile, provider: input.provider, readerMethod: input.kind === 'load' ? 'loadAsync' : input.provider?.export, label: `<input:${input.to}>`, edges: new Set(), conservativeEdges: new Set(), edgeEvidence: new Map() })
    nodes.get(ownerId).edges.add(id)
    if (crossModule) nodes.get(ownerId).conservativeEdges.add(id)
    nodes.get(ownerId).edgeEvidence.set(id, { input: input.to, expression: input.expression, evidence: input.kind, ...(crossModule ? { callerContext: { file: input.from, line: input.line, column: input.column }, resolution: 'finite factory context' } : {}) })
    if (!inputs.has(input.to)) inputs.set(input.to, new Set())
    inputs.get(input.to).add(id)
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
  // Related/dev uses imports for symbol resolution and candidate discovery, not
  // module-to-module execution edges. A leaf's own setup/hooks and actual value
  // references remain roots; importing a module alone does not select its cases.
  for (const { file, target, provider, factory } of mockCandidates) {
    const seen = new Set(), queue = [byAst.get(factory)]
    for (let i=0; i<queue.length; i++) {
      const id = queue[i]
      if (seen.has(id)) continue
      seen.add(id)
      queue.push(...(nodes.get(id)?.edges ?? []))
    }
    if (target && ![...seen].some(id => nodes.get(id)?.file === target)) files.get(file).blocked.add(target)
    const original = [...seen].some(id => { const name = nodes.get(id)?.ast.name; return name && providerName(providerOf(name)) === providerName({ module: provider }) })
    if (!original) files.get(file).blockedProviders.add(providerName({ module: provider }))
  }
  function reachable(roots, testFile) {
    const blocked = files.get(testFile)?.blocked ?? new Set()
    const seen = new Set()
    const visit = id => {
      if (seen.has(id) || blocked.has(nodes.get(id)?.file)) return
      seen.add(id)
      for (const next of nodes.get(id)?.edges ?? []) visit(next)
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
  const declarations = new Map()
  function snapshot(file) {
    const info = files.get(file)
    if (!info) throw new Error(`Missing behavior source: ${file}`)
    if (!declarations.has(file)) declarations.set(file, declarationSnapshot(info.sf, byAst, shapes))
    return declarations.get(file)
  }
  function changedNodes(file, previous) {
    if (!files.has(file)) return inputs.get(file) ?? new Set()
    const before = previous.hasFile(file) ? previous.snapshot(file) : { entries: new Map(), initializationOrder: [], modules: [], sideEffectModules: [] }
    const { ids, moduleEffect } = changedDeclarations(snapshot(file), before)
    // An independently changed opaque initialization effect cannot be hidden
    // by a different covered callable/value in the same patch.
    if (moduleEffect) ids.add(files.get(file).top)
    return ids
  }
  const explanations = new WeakMap()
  function explain(roots, reached, target) {
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
  function inputStatus(provider, method, roots, reached, target, testFile) {
    if (!provider) return 'real'
    const key = providerName(provider)
    if (files.get(testFile)?.blockedProviders.has(key)) return 'replaced'
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
        if (event.action === 'restore') return 'uncertain'
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
    return action === 'replace' ? 'replaced' : action === 'uncertain' ? 'uncertain' : 'real'
  }
  return { nodes, reachable, caseRoots, wholeFileRoots, changedNodes, snapshot, explain, inputStatus, hasFile: file => files.has(file) }
}

function selectBehaviors(inventory, changed, consumers, evidence) {
  const { sources, previousSources, ranges, compilerOptions } = evidence
  const head = behaviorGraph(sources, consumers.graph, compilerOptions, evidence.repositoryRoot, consumers.inputEdges, consumers.inputRisks, consumers.runtimeImportRisks)
  const previous = evidence.previousConsumers ?? (previousSources === sources ? consumers : require('./dependencies.cjs').dependencyConsumers(inventory, previousSources))
  const graphs = [head, previousSources === sources ? head : behaviorGraph(previousSources, previous.graph, compilerOptions, evidence.repositoryRoot, previous.inputEdges, previous.inputRisks, previous.runtimeImportRisks)]
  const testRenames = evidence.testRenames ?? new Map()
  const oldTestPaths = new Map([...testRenames].map(([before, after]) => [after, before]))
  const selectedCases = {}, reasons = {}, details = {}, changedBehaviors = new Set(), candidates = new Set(), uncovered = new Set()
  for (const change of changed) {
    const targets = graphs.map((g, i) => change.status === 'A' && i === 1 ? new Set() : g.changedNodes(change.file, graphs[1 - i]))
    for (let i=0; i<2; i++) for (const id of targets[i]) changedBehaviors.add(`${change.file}#${graphs[i].nodes.get(id).label}`)
    const covered = [new Set(), new Set()]
    const riskConsumers = graph => [...(graph.runtimeImportRisks ?? []), ...(graph.inputRisks ?? []).filter(risk => risk.pattern ? new RegExp(risk.pattern).test(change.file) : !risk.candidates?.length || risk.candidates.includes(change.file))]
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
            for (const risk of unresolved?.inputRisks ?? []) {
              const candidateInput = risk.moduleImport || !graphs.some(graph => graph.hasFile(change.file)) && (risk.pattern ? new RegExp(risk.pattern).test(change.file) : !risk.candidates?.length || risk.candidates.includes(change.file))
              const changedReader = [...targets[i]].some(target => {
                const node = graphs[i].nodes.get(target)
                return node.file === risk.from && node.ast.getStart() <= risk.start && risk.start < node.ast.end
              })
              const providerStatus = graphs[i].inputStatus(risk.provider, risk.kind === 'load' ? 'loadAsync' : risk.provider?.export, actualRoots, reached, id, graphFile)
              if (providerStatus === 'replaced') continue
              if ((candidateInput || changedReader) && providerStatus === 'uncertain') failRisk('Unsafe runtime input: ambiguous replacement/restore ordering', risk)
              if (candidateInput || changedReader) failRisk(`Unsafe runtime ${risk.moduleImport ? 'import' : 'input'}: ${risk.from}:${risk.line}:${risk.column}: ${risk.expression}; ${risk.reason}; missing ${risk.missingEvidence ?? 'resolvable input provenance'}`, risk)
            }
            for (const risk of unresolved?.dispatchRisks ?? []) {
              const affectsChange = [...targets[i]].some(target => {
                const node = graphs[i].nodes.get(target)
                if (risk.owners.length) return risk.owners.some(owner => graphs[i].nodes.get(owner).ast === node.ast || graphs[i].nodes.get(owner).ast === node.ast.parent)
                return !risk.keys || !!node.ast.name && (member(node.ast) || callable(node.ast) || ts.isVariableDeclaration(node.ast) && callable(node.ast.initializer) || ts.isPropertyAssignment(node.ast) || ts.isShorthandPropertyAssignment(node.ast)) && risk.keys.includes(node.ast.name.getText().replace(/^['"]|['"]$/g, ''))
              })
              if (affectsChange) failRisk(`Unsafe runtime dispatch: ${file}: ${risk.reason}`, risk)
            }
          }
          for (const id of targets[i]) if (reached.has(id)) {
            const target = graphs[i].nodes.get(id)
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
    if (!Object.values(details).some(list=>list.some(d=>d.changed===change.file))) uncovered.add(`Unsafe/unmapped behavior: ${change.file}; no proven owner cases`)
  }
  const result = { selected: Object.keys(selectedCases).sort(), selectedCases, reasons, details,
    changedBehaviors: [...changedBehaviors].sort(), excludedCandidates: [...candidates].filter(f=>!selectedCases[f]).sort(), unsafe: [...uncovered] }
  if (uncovered.size) {
    const error = new Error([...uncovered].join('\n'))
    error.diagnostics = result // Incomplete evidence only; never an executable plan.
    throw error
  }
  return result
}
module.exports = { behaviorGraph, selectBehaviors }
