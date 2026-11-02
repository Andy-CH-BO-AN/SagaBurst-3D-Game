const ts = require('typescript')
const { posix } = require('node:path')
const { isBuiltin } = require('node:module')
const { declarationSnapshot, changedDeclarations, runtimeImports, inertValue } = require('./behavior-changes.cjs')

const callable = n => n && ts.isFunctionLike(n) && n.body
const runtimeParameters = node => node.parameters.filter(parameter => !(ts.isIdentifier(parameter.name) && parameter.name.text === 'this'))
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
  // Compiler bindings are immutable for this snapshot. Runtime receiver/mock
  // facts remain in their scoped heaps; only source-symbol lookup is memoized.
  const locationSymbols = new WeakMap()
  const symbolAtLocation = node => {
    if (!locationSymbols.has(node)) locationSymbols.set(node, checker.getSymbolAtLocation(node))
    return locationSymbols.get(node)
  }
  const nodes = new Map(), byAst = new Map(), shapes = new Map(), files = new Map(), commonjs = new Map(), runtimeModules = new Map(), commonjsTargets = new Set(), mockCandidates = [], invokedSymbols = new Set(), parameterInputs = new Map(), mutatedReceivers = new Set(), delegatingMocks = new Set(), mutatedBindings = new Set(), escapedBindings = new Set(), mutatedObjectBindings = new Set(), bindingAliases = new Map(), mutatedImplicitRequireFiles = new Set(), escapedImplicitRequireFiles = new Set(), mutatedImplicitModuleFiles = new Set(), mutatedRequireMainFiles = new Set(), escapedExportFiles = new Set(), reconfiguredExportFiles = new Set()
  const sourceGetterKeys = new Set()
  const activeProviders = new Set(), cyclicProviders = new Set()
  const bindingInvalidations = new Map(), loaderAcquisitions = new WeakMap(), loaderScopeContexts = new WeakMap(), initializationModules = new Map()
  const initializationSites = new Map()
  let valueFactsRevision = 0, valueCacheRevision = -1, valueQuery = null
  let valueCache = new WeakMap()
  let heapReadObserver = null
  function reportHeapReads(root) {
    if (!heapReadObserver) return
    const pending = [root], visited = new Set()
    for (const cell of pending) {
      if (visited.has(cell)) continue
      visited.add(cell)
      for (const read of cell.heapReads ?? []) heapReadObserver(read)
      pending.push(...cell.dependencies)
    }
  }
  const valueAssignments = new Map(), unsupportedBindingWrites = new Set(), unsupportedBindingWriteSites = new Map()
  const propertyAssignments = new Map()
  let factsComplete = false
  const arrayExposureSites = new WeakSet(), objectExposureSites = new WeakSet()
  const trackedIntrinsics = ['Array', 'Object', 'Function', 'JSON', 'Buffer', 'Map', 'Set', 'String', 'Number', 'Boolean', 'Math', 'RegExp', 'console']
  const intrinsicExposureSites = new WeakMap()
  function markIntrinsicExposure(node, name) {
    if (!intrinsicExposureSites.has(node)) intrinsicExposureSites.set(node, new Set())
    intrinsicExposureSites.get(node).add(name)
  }
  function ambientIntrinsicReference(expression, name, seen = new Set()) {
    if (!expression || seen.has(expression)) return false
    seen.add(expression)
    while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) expression = expression.expression
    const keys = []
    while (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      keys.unshift(ts.isPropertyAccessExpression(expression) ? expression.name.text : ts.isStringLiteralLike(expression.argumentExpression) ? expression.argumentExpression.text : null)
      expression = expression.expression
    }
    if (implicitCommonJS(expression, name) || implicitCommonJS(expression, 'globalThis') && keys.length && (keys[0] === name || keys[0] === null)) return true
    const declaration = ts.isIdentifier(expression) && bindingDeclaration(expression)
    return !!declaration?.initializer && ambientIntrinsicReference(declaration.initializer, name, seen)
  }
  const ambientArrayReference = expression => ambientIntrinsicReference(expression, 'Array')
  function invalidateObjectBinding(set, declaration, ast) {
    set.add(declaration)
    if (!bindingInvalidations.has(declaration)) bindingInvalidations.set(declaration, new Set())
    bindingInvalidations.get(declaration).add(ast)
  }
  function connect(entry, id, guard = null) {
    entry.edges.add(id)
    entry.edgeGuards ??= new Map()
    if (!entry.edgeGuards.has(id)) entry.edgeGuards.set(id, new Set())
    entry.edgeGuards.get(id).add(guard)
  }
  const bindingDeclarations = new WeakMap()
  function bindingDeclaration(expression) {
    if (bindingDeclarations.has(expression)) return bindingDeclarations.get(expression)
    const symbol = ts.isShorthandPropertyAssignment(expression.parent) ? checker.getShorthandAssignmentValueSymbol(expression.parent) : symbolAtLocation(expression)
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.find(declaration => ts.isVariableDeclaration(declaration) || ts.isParameter(declaration) || ts.isBindingElement(declaration) || ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration) || ts.isImportClause(declaration))
    // Compiler bindings belong to this immutable source snapshot. Runtime
    // replacement/heap facts remain separate and are never cached here.
    bindingDeclarations.set(expression, declaration)
    return declaration
  }
  function baseBinding(expression) {
    while (expression && (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isSpreadElement(expression) || ts.isSpreadAssignment(expression) || ts.isAwaitExpression(expression) || ts.isYieldExpression(expression))) expression = expression.expression
    if (expression && [ts.SyntaxKind.ThisKeyword, ts.SyntaxKind.SuperKeyword].includes(expression.kind)) {
      // TypeScript associates instance `this` with the class symbol. Writing an
      // instance field does not replace the constructor/prototype binding.
      // Static receiver writes still invalidate the actual class binding.
      for (let owner = expression.parent; owner; owner = owner.parent) {
        if (ts.isArrowFunction(owner)) continue
        if (ts.isClassStaticBlockDeclaration(owner)) return bindingDeclaration(expression)
        if (ts.isFunctionLike(owner) || ts.isPropertyDeclaration(owner)) {
          return owner.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword) ? bindingDeclaration(expression) : undefined
        }
      }
      return undefined
    }
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
  function closedArrayStorageBinding(expression) {
    if (stableBinding(expression)) return true
    const declaration = baseBinding(expression)
    if (declaration && ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent)
      && (declaration.parent.flags & ts.NodeFlags.Const) && ts.isForOfStatement(declaration.parent.parent)
      && !mutatedObjectBindings.has(declaration) && !valueAssignments.has(declaration)) return true
    if (!declaration || mutatedBindings.has(declaration) || mutatedObjectBindings.has(declaration) || bindingAliases.has(declaration)) return false
    const facts = bindingInvalidations.get(declaration)
    // Invoking an indexed element can return its result without publishing the
    // containing array. The general escape scan intentionally remains broad;
    // this storage contract admits only that concrete nonescaping use.
    return !!facts?.size && [...facts].every(node => ts.isIdentifier(node)
      && ts.isElementAccessExpression(node.parent) && node.parent.expression === node
      && ts.isNumericLiteral(node.parent.argumentExpression)
      && ts.isCallExpression(node.parent.parent) && node.parent.parent.expression === node.parent)
  }
  function nativeTarget(expression, seen = new Set()) {
    if (!stableBinding(expression)) return false
    if (providerRequire(expression)) return true
    if (!ts.isIdentifier(expression)) return false
    const declaration = bindingDeclaration(expression)
    if (!declaration || seen.has(declaration)) return false
    seen.add(declaration)
    if (ts.isNamespaceImport(declaration)) return false
    if (ts.isImportClause(declaration)) return ts.isImportDeclaration(declaration.parent) && isBuiltin(declaration.parent.moduleSpecifier.text)
    return ts.isVariableDeclaration(declaration) && declaration.initializer && nativeTarget(declaration.initializer, seen)
  }
  function controlledCall(expression) {
    while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression
    if (!ts.isCallExpression(expression)) return false
    if (expression.expression.getText() === 'vi.spyOn' && vitestReceiver(expression.expression.expression) && stableBinding(expression.expression.expression)) return true
    if (ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === 'method' && nativeTracker(expression.expression.expression)) return true
    const provider = providerOf(expression.expression)
    return ['node:test', 'vitest'].includes(provider?.module) && stableBinding(expression.expression) && ['test', 'it', 'describe', 'suite', 'before', 'after', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll'].includes(provider.export)
  }
  function implicitCommonJS(identifier, name) {
    return ts.isIdentifier(identifier) && identifier.text === name
      && !(ts.isPropertyAccessExpression(identifier.parent) && identifier.parent.name === identifier)
      && !(ts.isPropertyAssignment(identifier.parent) && identifier.parent.name === identifier)
      && !(symbolAtLocation(identifier)?.declarations ?? []).some(declaration => sources.has(declaration.getSourceFile().fileName)
        && !declaration.getSourceFile().isDeclarationFile && (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration) || ts.isBindingElement(declaration)
          || ts.isFunctionDeclaration(declaration) || ts.isFunctionExpression(declaration) || ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration) || ts.isEnumDeclaration(declaration) || ts.isModuleDeclaration(declaration)
          || ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration) || ts.isImportClause(declaration) || ts.isImportEqualsDeclaration(declaration)))
  }
  function inlineSetConsumer(expression) {
    let current = expression
    while (current.parent && (ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent)
      || ts.isTypeAssertionExpression(current.parent) || ts.isNonNullExpression(current.parent) || ts.isSatisfiesExpression(current.parent))) current = current.parent
    const parent = current.parent
    return parent && (ts.isSpreadElement(parent) || ts.isForOfStatement(parent) && parent.expression === current) ? parent : null
  }
  const implicitRequire = identifier => implicitCommonJS(identifier, 'require')
  function requireProperty(target) {
    if (!ts.isPropertyAccessExpression(target) && !ts.isElementAccessExpression(target)) return null
    let member = target
    while (ts.isPropertyAccessExpression(member.expression) || ts.isElementAccessExpression(member.expression)) member = member.expression
    if (!implicitRequire(member.expression)) return null
    return { key: ts.isPropertyAccessExpression(member) ? member.name.text : ts.isStringLiteralLike(member.argumentExpression) ? member.argumentExpression.text : null }
  }
  function invalidateAssignment(target) {
    if (ts.isVariableDeclaration(target) || ts.isBindingElement(target)) return invalidateAssignment(target.name)
    if (ts.isIdentifier(target)) {
      const declaration = bindingDeclaration(target)
      if (implicitRequire(target)) mutatedImplicitRequireFiles.add(target.getSourceFile().fileName)
      else if (implicitCommonJS(target, 'module')) mutatedImplicitModuleFiles.add(target.getSourceFile().fileName)
      else if (declaration) {
        mutatedBindings.add(declaration)
        if (!ts.isBinaryExpression(target.parent) || target.parent.left !== target || target.parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
          unsupportedBindingWrites.add(declaration)
          if (!unsupportedBindingWriteSites.has(declaration)) unsupportedBindingWriteSites.set(declaration, new Set())
          unsupportedBindingWriteSites.get(declaration).add(target.parent)
        }
      }
    } else if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      const property = requireProperty(target)
      if (property && (property.key === null || property.key === 'main')) mutatedRequireMainFiles.add(target.getSourceFile().fileName)
      if (property?.key !== 'main') { const declaration = baseBinding(target.expression); if (declaration) invalidateObjectBinding(mutatedObjectBindings, declaration, target) }
    } else ts.forEachChild(target, invalidateAssignment)
  }
  function optionalReceiver(expression) {
    for (let node = expression; node && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)); node = node.expression) {
      if (node.questionDotToken) return node.expression
    }
    return null
  }
  function invocationReference(node) {
    if ((ts.isJsxOpeningElement(node.parent) || ts.isJsxSelfClosingElement(node.parent)) && node.parent.tagName === node) return true
    if ((ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) && node.parent.name === node) node = node.parent
    while (node.parent && (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent) || ts.isNonNullExpression(node.parent))) node = node.parent
    if (functionAdapter(node.parent)) node = node.parent
    return ts.isCallExpression(node.parent) && node.parent.expression === node
  }
  function invocation(entry, target, call) {
    if (functionAdapter(call.expression) && call.expression.name.text === 'bind') return
    connect(entry, target, optionalReceiver(call))
    let args = [...(call.arguments ?? [])], receiverArgument
    if (functionAdapter(call.expression)) {
      const adapter = call.expression.name.text
      receiverArgument = args[0]
      args = adapter === 'call' ? args.slice(1) : adapter === 'apply' && args[1] && ts.isArrayLiteralExpression(args[1]) ? [...args[1].elements] : null
    }
    entry.callContexts ??= new Map()
    if (!entry.callContexts.has(target)) entry.callContexts.set(target, [])
    const contexts = entry.callContexts.get(target)
    if (!contexts.some(context => context.call === call)) contexts.push({ call, args, receiverArgument })
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
  // Forwarded native test contexts need complete call-argument identity before
  // the mutation/escape pass visits a helper defined ahead of its callers.
  for (const fullPath of sources.keys()) {
    const scan = node => {
      if (typeOnly(node)) return
      if (ts.isGetAccessor(node) && ts.isObjectLiteralExpression(node.parent) && !ts.isComputedPropertyName(node.name)) sourceGetterKeys.add(node.name.text)
      if (ts.isCallExpression(node)) {
        const signature = checker.getResolvedSignature(node)
        node.arguments.forEach((argument, index) => {
          const parameter = signature?.parameters[index]
          if (!parameter || !(parameter.declarations ?? []).some(declaration => sources.has(declaration.getSourceFile().fileName))) return
          if (!parameterInputs.has(parameter)) parameterInputs.set(parameter, new Set())
          parameterInputs.get(parameter).add(argument)
        })
      }
      ts.forEachChild(node, scan)
    }
    scan(program.getSourceFile(fullPath))
  }
  for (const fullPath of sources.keys()) {
    const file = local(fullPath)
    const sf = program.getSourceFile(fullPath)
    const top = add(sf, '<module>')
    files.set(file, { sf, top, registrations: [], hooks: [], blocked: new Set(), blockedProviders: new Set(), uncertainMocks: new Map(), uncertainProviders: new Map(), replacementMocks: new Map() })
    const imports = runtimeImports(sf)
    const importBindings = imports.bindings
    runtimeModules.set(file, new Set())
    initializationModules.set(file, new Set())
    const runtimeModule = (name, ast) => {
      const stem = posix.normalize(posix.join(posix.dirname(file), name))
      const target = (importGraph.get(file) ?? []).find(dep => dep === stem || ['.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.js'].some(ext => dep === stem + ext))
      if (target) {
        runtimeModules.get(file).add(target)
        let deferred = false
        for (let parent = ast?.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) if (callable(parent)) deferred = true
        if (!deferred) initializationModules.get(file).add(target)
        if (!deferred && ast) {
          if (!initializationSites.has(file)) initializationSites.set(file, [])
          initializationSites.get(file).push({ target, ast })
        }
      }
      return target
    }
    function index(n) {
      if (typeOnly(n)) return
      if (!n.getSourceFile().isDeclarationFile && ts.isIdentifier(n) && implicitRequire(n)) {
        const parent = n.parent
        const benign = ts.isCallExpression(parent) && parent.expression === n
          || (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === n
          || ts.isBinaryExpression(parent) && parent.left === n && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        if (!benign) escapedImplicitRequireFiles.add(n.getSourceFile().fileName)
      }
      if (ts.isImportDeclaration(n) && imports.modules.some(specifier => specifier.startsWith(n.moduleSpecifier.getText()))) runtimeModule(n.moduleSpecifier.text, n)
      if (ts.isExportDeclaration(n) && !n.isTypeOnly && n.moduleSpecifier && (!n.exportClause || !ts.isNamedExports(n.exportClause) || n.exportClause.elements.some(element => !element.isTypeOnly))) runtimeModule(n.moduleSpecifier.text, n)
      if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || n.expression.getText() === 'require') && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
        const target = runtimeModule(n.arguments[0].text, n)
        if (target && providerRequire(n)) commonjsTargets.add(target)
      }
      if (ts.isCallExpression(n)) for (const name of trackedIntrinsics) {
        if (n.arguments.some(argument => ambientIntrinsicReference(argument, name))) markIntrinsicExposure(n, name)
      }
      if (ts.isDeleteExpression(n)) for (const name of trackedIntrinsics) if (ambientIntrinsicReference(n.expression, name)) markIntrinsicExposure(n, name)
      if (ts.isCallExpression(n) && (n.arguments.some(argument => ambientArrayReference(argument))
        || ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'getPrototypeOf'
          && ['Object', 'Reflect'].some(name => implicitCommonJS(n.expression.expression, name)))) arrayExposureSites.add(n)
      if (ts.isCallExpression(n) && (n.arguments.some(argument => ambientIntrinsicReference(argument, 'Object'))
        || ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'getPrototypeOf'
          && ['Object', 'Reflect'].some(name => implicitCommonJS(n.expression.expression, name)))) objectExposureSites.add(n)
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
        const written = n.left ?? n.operand
        for (const name of trackedIntrinsics) if (ambientIntrinsicReference(written, name)) markIntrinsicExposure(n, name)
        if (ambientArrayReference(written)) arrayExposureSites.add(n)
        if (ambientIntrinsicReference(written, 'Object')) objectExposureSites.add(n)
        if ((ts.isPropertyAccessExpression(written) || ts.isElementAccessExpression(written))
          && implicitCommonJS(written.expression, 'globalThis')
          && (ts.isElementAccessExpression(written) && !ts.isStringLiteralLike(written.argumentExpression)
            || (ts.isPropertyAccessExpression(written) ? written.name.text : written.argumentExpression.text) === 'Array')) arrayExposureSites.add(n)
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) {
          const declaration = bindingDeclaration(n.left)
          if (declaration) { if (!valueAssignments.has(declaration)) valueAssignments.set(declaration, []); valueAssignments.get(declaration).push(n.right) }
        }
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && (ts.isPropertyAccessExpression(n.left) || ts.isElementAccessExpression(n.left))) {
          const declaration = baseBinding(n.left.expression)
          if (declaration) {
            if (!propertyAssignments.has(declaration)) propertyAssignments.set(declaration, [])
            propertyAssignments.get(declaration).push({ key: ts.isPropertyAccessExpression(n.left) ? n.left.name.text : ts.isStringLiteralLike(n.left.argumentExpression) ? n.left.argumentExpression.text : null, expression: n.right })
          }
        }
      }
      if (ts.isForOfStatement(n) || ts.isForInStatement(n)) invalidateAssignment(n.initializer)
      if (ts.isDeleteExpression(n)) invalidateAssignment(n.expression)
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
            if (implicitRequire(node)) return
            if (implicitCommonJS(node, 'exports') && !((ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) && node.parent.expression === node)) escapedExportFiles.add(node.getSourceFile().fileName)
            if (implicitCommonJS(node, 'module')) {
              const namespace = ts.isPropertyAccessExpression(node.parent) && node.parent.name.text === 'exports' ? node.parent : node
              if (!((ts.isPropertyAccessExpression(namespace.parent) || ts.isElementAccessExpression(namespace.parent)) && namespace.parent.expression === namespace)) escapedExportFiles.add(node.getSourceFile().fileName)
            }
            const declaration = bindingDeclaration(node)
            // Unknown expressions may capture outer references, but their own
            // callback parameters/locals are not escaped caller bindings.
            if (declaration && !(declaration.getSourceFile() === expression.getSourceFile() && expression.pos <= declaration.pos && declaration.end <= expression.end)) invalidateObjectBinding(escapedBindings, declaration, node)
          }
          ts.forEachChild(node, visit)
        }
        visit(expression)
      }
      if (ts.isVariableDeclaration(n) && n.initializer && !bindingAliases.has(n) && !controlledCall(n.initializer)) escape(n.initializer)
      if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) escape(n.right)
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && n.left.name.text === 'exports' && implicitCommonJS(n.left.expression, 'module')
        && (!ts.isObjectLiteralExpression(n.right) || n.right.properties.some(property => ts.isGetAccessor(property) || ts.isSetAccessor(property) || ts.isSpreadAssignment(property)))) reconfiguredExportFiles.add(n.getSourceFile().fileName)
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
        const declaration = baseBinding(n.left.expression); if (declaration && requireProperty(n.left)?.key !== 'main') invalidateObjectBinding(mutatedObjectBindings, declaration, n.left)
      }
      if (ts.isCallExpression(n) && /^(?:Object\.(?:assign|defineProperty|defineProperties)|Reflect\.set)$/.test(n.expression.getText()) && n.arguments[0]) {
        const symbol = receiverSymbol(origin(n.arguments[0]))
        if (symbol) mutatedReceivers.add(symbol)
      }
      if (ts.isCallExpression(n)) {
        if (ts.isPropertyAccessExpression(n.expression) && /^(?:mockImplementation|mockReset|mockRestore)/.test(n.expression.name.text)) delegatingMocks.add(origin(n.expression.expression))
        const callee = functionAdapter(n.expression) ? n.expression.expression : n.expression
        if (ts.isIdentifier(callee)) { const symbol = symbolAtLocation(callee); if (symbol) invokedSymbols.add(symbol) }
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
      if (original) {
        if (!escapedBindings.has(original)) { escapedBindings.add(original); changedBindings = true }
        if (!bindingInvalidations.has(original)) bindingInvalidations.set(original, new Set())
        for (const fact of bindingInvalidations.get(alias) ?? []) if (!bindingInvalidations.get(original).has(fact)) {
          bindingInvalidations.get(original).add(fact); changedBindings = true
        }
      }
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
  const initializationClosures = new Map()
  function initializesFrom(processEntry, file) {
    if (!initializationClosures.has(processEntry)) {
      const visited = new Set(), queue = [processEntry]
      for (const next of queue) if (!visited.has(next)) { visited.add(next); queue.push(...(initializationModules.get(next) ?? [])) }
      initializationClosures.set(processEntry, visited)
    }
    return initializationClosures.get(processEntry).has(file)
  }
  function requiredModule(n) {
    n = origin(n)
    if (!ts.isCallExpression(n) || n.expression.getText() !== 'require' || !n.arguments[0] || !ts.isStringLiteralLike(n.arguments[0])) return null
    const file = local(n.getSourceFile().fileName)
    const stem = posix.normalize(posix.join(posix.dirname(file), n.arguments[0].text))
    return (importGraph.get(file) ?? []).find(dep => dep === stem || ['.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.js'].some(ext => dep === stem + ext))
  }
  function linkSymbol(symbol, entry, seen = new Set(), guard = null, invoked = true) {
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
      const id = callable(owner) && !ts.isGetAccessor(owner) && !invoked ? null : byAst.get(owner)
      if (id && id !== entry.id) { connect(entry, id, guard); if (!entry.typeReceiverEdges?.has(id)) entry.conservativeEdges.delete(id) }
    }
    // Preserve intermediate import/re-export bindings instead of flattening
    // directly to the final declaration: an unchanged caller can be retargeted.
    return symbol.flags & ts.SymbolFlags.Alias
      ? linkSymbol(checker.getImmediateAliasedSymbol(symbol), entry, seen, guard, invoked) : symbol
  }
  function symbolEdges(n, entry, original = symbolAtLocation(n)) {
    const access = (ts.isPropertyAccessExpression(n.parent) || ts.isElementAccessExpression(n.parent)) && n.parent.name === n ? n.parent : n
    const symbol = linkSymbol(original, entry, new Set(), optionalReceiver(access), invocationReference(n))
    // A callable reference is a value. Opaque invocations are recorded at the
    // callback-taking boundary below; a receiver read or property assignment
    // must not add an argument-free invocation beside an actual call context.
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
      const symbol = symbolAtLocation(n)
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
    let symbol = symbolAtLocation(receiver)
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
      && ts.isStringLiteralLike(expression.arguments[0])
      // node: builtins bypass require.cache. Mutating the function object's
      // cache/properties does not replace its direct [[Call]] identity.
      && (expression.arguments[0].text.startsWith('node:') || stableBinding(expression.expression))
      && !mutatedImplicitRequireFiles.has(expression.getSourceFile().fileName) && !escapedImplicitRequireFiles.has(expression.getSourceFile().fileName)
      && implicitRequire(expression.expression)
  }
  function providerOf(expression) {
    const value = origin(expression)
    if (activeProviders.has(value)) {
      for (const active of activeProviders) cyclicProviders.add(active)
      cyclicProviders.add(value)
      return null
    }
    activeProviders.add(value)
    try { return providerValue(value) } finally { activeProviders.delete(value) }
  }
  function providerValue(expression) {
    if (providerRequire(expression)) return { module: expression.arguments[0].text, export: '*' }
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === 'method') {
      const handle = nativeReplacement(expression)
      if (handle?.provider) return { ...handle.provider, export: handle.method ?? '*' }
    }
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      const provider = providerOf(expression.expression)
      const keys = ts.isPropertyAccessExpression(expression) ? [expression.name.text] : literalKeys(expression.argumentExpression)
      return provider && keys?.[0] !== 'prototype' ? { ...provider, export: keys?.length === 1 ? keys[0] : '*' } : provider
    }
    const symbol = symbolAtLocation(expression)
    for (const declaration of symbol?.declarations ?? []) {
      for (let node = declaration; node; node = node.parent) if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        return { module: node.moduleSpecifier.text, export: ts.isNamespaceImport(declaration) ? '*' : ts.isImportClause(declaration) ? isBuiltin(node.moduleSpecifier.text) ? '*' : 'default' : declaration.propertyName?.text ?? declaration.name?.text ?? '*' }
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
    if (expression.expression.getText() === 'vi.spyOn' && expression.arguments.length >= 2
      && vitestReceiver(expression.expression.expression) && stableBinding(expression.expression.expression)) {
      const keys = literalKeys(expression.arguments[1]), provider = providerOf(expression.arguments[0])
      return provider && keys?.length === 1 ? { provider, method: keys[0] } : null
    }
    return ts.isPropertyAccessExpression(expression.expression) ? spy(expression.expression.expression, seen) : null
  }
  function vitestReceiver(expression) {
    const provider = providerOf(expression)
    if (provider?.module === 'vitest' && provider.export === 'vi') return true
    return ts.isIdentifier(expression) && expression.text === 'vi'
      && !(symbolAtLocation(expression)?.declarations ?? []).some(declaration => sources.has(declaration.getSourceFile().fileName))
  }
  function emptyMockReceiver(expression) {
    if (!vitestReceiver(expression)) return false
    if (stableBinding(expression)) return true
    const declaration = baseBinding(expression)
    if (!declaration || mutatedBindings.has(declaration) || mutatedObjectBindings.has(declaration) || bindingAliases.has(declaration)) return false
    const facts = bindingInvalidations.get(declaration)
    return !!facts?.size && [...facts].every(fact => ts.isIdentifier(fact) && ts.isPropertyAccessExpression(fact.parent)
      && fact.parent.expression === fact && ['fn', 'mock', 'mocked', 'stubGlobal', 'unstubAllGlobals', 'clearAllMocks', 'resetAllMocks', 'restoreAllMocks'].includes(fact.parent.name.text)
      && ts.isCallExpression(fact.parent.parent) && fact.parent.parent.expression === fact.parent)
  }
  const emptyMockExports = new WeakMap()
  function mockFactoryMode(factory) {
    const plainParameters = fn => fn.parameters.every(parameter => ts.isIdentifier(parameter.name) && !parameter.initializer && !parameter.dotDotDotToken)
    if (!factory || !callable(factory) || !plainParameters(factory)) return 'uncertain'
    const unwrap = value => value && (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isAwaitExpression(value)) ? unwrap(value.expression) : value
    const returned = fn => ts.isBlock(fn.body) ? fn.body.statements.length === 1 && ts.isReturnStatement(fn.body.statements[0]) ? fn.body.statements[0].expression : undefined : fn.body
    const value = unwrap(returned(factory))
    const original = expression => {
      expression = unwrap(expression)
      return !!factory.parameters[0] && expression && ts.isCallExpression(expression) && expression.arguments.length === 0 && ts.isIdentifier(expression.expression)
        && symbolAtLocation(expression.expression)?.valueDeclaration === factory.parameters[0] && !mutatedBindings.has(factory.parameters[0])
    }
    if (original(value) || value && ts.isObjectLiteralExpression(value) && value.properties.length === 1 && ts.isSpreadAssignment(value.properties[0]) && original(value.properties[0].expression)) return 'original'
    const emptyPaths = []
    const closed = (expression, path = [], allowEmpty = true) => {
      expression = unwrap(expression)
      if (!expression) return false
      if (ts.isLiteralExpression(expression) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(expression.kind)) return true
      if (allowEmpty && ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === 'fn'
        && expression.arguments.length === 0 && emptyMockReceiver(expression.expression.expression)) {
        emptyPaths.push(path); return true
      }
      if (ts.isArrayLiteralExpression(expression)) return expression.elements.every((element, index) => closed(element, [...path, String(index)], allowEmpty))
      if (ts.isObjectLiteralExpression(expression)) return expression.properties.every(property => !property.name || !ts.isComputedPropertyName(property.name))
        && expression.properties.every(property => ts.isPropertyAssignment(property) ? closed(property.initializer, [...path, property.name.text ?? property.name.getText()], allowEmpty) : (ts.isMethodDeclaration(property) || ts.isGetAccessor(property)) && closed(property))
      if (callable(expression)) return plainParameters(expression) && (ts.isBlock(expression.body) && expression.body.statements.length === 0 || closed(returned(expression), path, false))
      return false
    }
    const replacement = value && ts.isObjectLiteralExpression(value) && closed(value)
    if (replacement && emptyPaths.length) emptyMockExports.set(factory, emptyPaths)
    return replacement ? 'replacement' : 'uncertain'
  }
  const deferredMockConfigurations = new WeakMap(), mockInvocationCandidates = new WeakMap(), nativeCallbackRegistrations = new WeakSet(), nativeCallbackProviders = new Set(), persistentNativeCandidates = []
  const operationKey = node => `${local(node.getSourceFile().fileName)}:${node.getStart()}`
  const mockRuntimeOperations = new Set([...inputEdges, ...inputRisks].filter(input => !['import', 'glob'].includes(input.kind))
    .map(input => `${input.readerFile ?? input.from}:${input.readerStart ?? input.start}`))
  const mockDataOperations = new Set([...inputEdges, ...inputRisks].filter(input => !['import', 'execute', 'glob'].includes(input.kind))
    .map(input => `${input.readerFile ?? input.from}:${input.readerStart ?? input.start}`))
  function numericInduction(declaration) {
    if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)
      || !ts.isVariableDeclarationList(declaration.parent) || !(declaration.parent.flags & ts.NodeFlags.Let)) return null
    const loop = declaration.parent.parent, condition = loop?.condition, increment = loop?.incrementor
    const initial = declaration.initializer
    const numericInitial = ts.isNumericLiteral(initial ?? {}) || ts.isBinaryExpression(initial ?? {})
      && [ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
        ts.SyntaxKind.LessThanLessThanToken, ts.SyntaxKind.GreaterThanGreaterThanToken, ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken].includes(initial.operatorToken.kind)
      && (ts.isNumericLiteral(initial.left) || ts.isNumericLiteral(initial.right))
    if (!ts.isForStatement(loop) || !numericInitial || !condition || !ts.isBinaryExpression(condition)
      || !ts.isIdentifier(condition.left)
      || bindingDeclaration(condition.left) !== declaration
      || !(ts.isPostfixUnaryExpression(increment ?? {}) || ts.isPrefixUnaryExpression(increment ?? {}))
      || !([ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken].includes(condition.operatorToken.kind) && increment.operator === ts.SyntaxKind.PlusPlusToken
        || [ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(condition.operatorToken.kind) && increment.operator === ts.SyntaxKind.MinusMinusToken)
      || !ts.isIdentifier(increment.operand)
      || bindingDeclaration(increment.operand) !== declaration || valueAssignments.has(declaration)) return null
    const sites = unsupportedBindingWriteSites.get(declaration)
    return !!sites && sites.size === 1 && sites.has(increment)
      && (!ts.isNumericLiteral(initial) || Number.isFinite(Number(initial.text)))
  }
  const supportedCompoundOperators = new Set([
    ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken,
    ts.SyntaxKind.AsteriskAsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.PercentEqualsToken,
    ts.SyntaxKind.LessThanLessThanEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
    ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ts.SyntaxKind.AmpersandEqualsToken,
    ts.SyntaxKind.BarEqualsToken, ts.SyntaxKind.CaretEqualsToken,
  ])
  const numericBinaryOperators = new Set([
    ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken,
    ts.SyntaxKind.AsteriskAsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
    ts.SyntaxKind.LessThanLessThanToken, ts.SyntaxKind.GreaterThanGreaterThanToken,
    ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken, ts.SyntaxKind.AmpersandToken,
    ts.SyntaxKind.BarToken, ts.SyntaxKind.CaretToken,
  ])
  const numberValue = value => value.primitiveType === 'number'
    || Object.hasOwn(value, 'literalValue') && typeof value.literalValue === 'number'
  function supportedCompoundBindings(declaration) {
    const sites = unsupportedBindingWriteSites.get(declaration)
    return !!sites?.size && [...sites].every(site => ts.isBinaryExpression(site) && ts.isIdentifier(site.left)
      && bindingDeclaration(site.left) === declaration && supportedCompoundOperators.has(site.operatorToken.kind)
      || (ts.isPrefixUnaryExpression(site) || ts.isPostfixUnaryExpression(site)) && ts.isIdentifier(site.operand)
        && bindingDeclaration(site.operand) === declaration && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(site.operator))
  }
  function finiteNumericLoopValues(declaration) {
    if (!numericInduction(declaration)) return null
    const condition = declaration.parent.parent.condition
    if (!ts.isNumericLiteral(declaration.initializer) || condition.operatorToken.kind !== ts.SyntaxKind.LessThanToken || !ts.isNumericLiteral(condition.right)) return null
    const start = Number(declaration.initializer.text), end = Number(condition.right.text)
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end - start > 256) return null
    return Array.from({ length: end - start }, (_, index) => start + index)
  }
  function bindingWriteAnchor(declaration, scope, invocationScope) {
    if (!invocationScope || !ts.isVariableDeclaration(declaration) || !declaration.initializer
      || !ts.isVariableStatement(declaration.parent.parent)) return null
    const block = declaration.parent.parent.parent
    if (!ts.isBlock(block) || recursiveEnvironments.has(declarationScope(declaration, scope))) return null
    const frameOf = node => { while (node && !callable(node) && !ts.isSourceFile(node)) node = node.parent; return node }
    const frame = frameOf(declaration), visited = new Set()
    for (let current = invocationScope; current && !visited.has(current); current = current.caller) {
      visited.add(current)
      const call = current.callsite
      if (!call || call.getSourceFile() !== declaration.getSourceFile() || frameOf(call) !== frame
        || call.getStart() < declaration.end || call.end > block.end) continue
      // A binding initialized outside a repeated region can retain the previous
      // iteration's later write. A block-local initializer inside every such
      // region starts a fresh value before this synchronous invocation.
      for (let ancestor = call.parent; ancestor && ancestor !== frame; ancestor = ancestor.parent) {
        if (ts.isIterationStatement(ancestor, false)
          && !(ancestor.pos <= declaration.pos && declaration.end <= ancestor.end)) return null
      }
      return { call, frame, frameOf }
    }
    return null
  }
  const summarizeCallback = require('./callback-effects.cjs').callbackEffects({ checker, declarationOf: bindingDeclaration, providerOf,
    operation: node => mockRuntimeOperations.has(operationKey(node)), local, sources, assignments: valueAssignments, propertyAssignments,
    scopeForDeclaration: declarationScope,
    contextMayReenter: scope => recursiveEnvironments.has(scope),
    intrinsicStable: (name, scope) => !!scope?.heap && !scope?.globalBindings?.has(name) && !scope.heap.intrinsicExposed?.has(name)
      && (name !== 'Array' || !scope?.heap?.arrayIntrinsicExposed) && (name !== 'Object' || !scope?.heap?.objectIntrinsicExposed),
    invocationScopes: (call, scope) => [...(scope?.heap?.callScopes.get(call) ?? [])],
    bindingMayHaveUnmodeledWrites: declaration => unsupportedBindingWrites.has(declaration) && !numericInduction(declaration) && !supportedCompoundBindings(declaration),
    hasCompoundBindingWrites: supportedCompoundBindings,
    finiteNumericLoopValues, numericInduction,
    bindingEscaped: (declaration, scope) => {
      if (!scope?.heap?.instanceEscapes) return true
      const owner = declarationScope(declaration, scope)
      return !owner || (scope.heap.instanceEscapes.get(declaration) ?? []).some(event => declarationScope(declaration, event.scope) === owner)
    },
    providerStable: (module, scope) => !!scope?.heap && !scope.heap.exposedProviders?.has(module)
      && !files.get(scope.testFile)?.blockedProviders.has(module) && !files.get(scope.testFile)?.uncertainProviders.has(module)
      && !mockCandidates.some(candidate => candidate.file === scope.testFile && candidate.provider === module && candidate.mode !== 'original'),
    reachedBindingWrites: (declaration, scope, invocationScope) => {
      if (!scope?.heap?.bindingWrites || unsupportedBindingWrites.has(declaration) && !supportedCompoundBindings(declaration)) return null
      const owner = declarationScope(declaration, scope)
      if (!owner) return null
      scope.heap.bindingReaders.add(declaration)
      const anchor = bindingWriteAnchor(declaration, scope, invocationScope)
      return (scope.heap.bindingWrites.get(declaration) ?? []).filter(write => declarationScope(declaration, write.scope) === owner
        && (!anchor || anchor.frameOf(write.expression) !== anchor.frame || write.expression.getStart() < anchor.call.end))
    },
    allocationFacts: (node, scope) => heapCell(ts.isArrayLiteralExpression(node) ? { allocation: node, scope } : { record: node, scope }, ts.isArrayLiteralExpression(node) ? 'arrays' : 'records'),
    bindingScalar: binding => {
      if (!ts.isBinaryExpression(binding.expression) || !supportedCompoundOperators.has(binding.expression.operatorToken.kind)) return null
      const values = scopedValues(binding.expression, binding.scope)
      return values.length && values.every(numberValue) ? 'number' : null
    },
    observedScalar: (expression, scope) => {
      const values = scopedValues(expression, scope)
      const types = values.map(value => value.primitiveType ?? (Object.hasOwn(value, 'literalValue') ? typeof value.literalValue : null))
      return types.length && ['number', 'string', 'boolean', 'bigint', 'symbol'].includes(types[0])
        && types.every(type => type === types[0]) ? types[0] : null
    } })
  const finiteMockSyntax = new Set([
    'Block', 'ExpressionStatement', 'ReturnStatement', 'VariableStatement', 'VariableDeclarationList', 'VariableDeclaration',
    'CallExpression', 'NewExpression', 'PropertyAccessExpression', 'ElementAccessExpression', 'Identifier', 'Parameter',
    'ParenthesizedExpression', 'AsExpression', 'TypeAssertionExpression', 'NonNullExpression', 'SatisfiesExpression',
    'StringLiteral', 'NumericLiteral', 'NoSubstitutionTemplateLiteral', 'TrueKeyword', 'FalseKeyword', 'NullKeyword',
    'ObjectLiteralExpression', 'PropertyAssignment', 'ArrayLiteralExpression', 'PrefixUnaryExpression',
    'IfStatement', 'EmptyStatement', 'ThrowStatement', 'TryStatement', 'CatchClause',
    'AsyncKeyword', 'ExportKeyword', 'DefaultKeyword', 'EqualsGreaterThanToken', 'QuestionToken',
  ].map(kind => ts.SyntaxKind[kind]))
  function mockLexicalValue(declaration) {
    if (!sources.has(declaration.getSourceFile().fileName) || declaration.getSourceFile().isDeclarationFile
      || ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Ambient) return false
    if (![ts.isVariableDeclaration, ts.isParameter, ts.isBindingElement, ts.isFunctionDeclaration, ts.isFunctionExpression,
      ts.isClassDeclaration, ts.isEnumDeclaration, ts.isImportSpecifier, ts.isNamespaceImport, ts.isImportClause, ts.isImportEqualsDeclaration].some(isKind => isKind(declaration))) return false
    for (let owner = declaration; owner && !ts.isSourceFile(owner); owner = owner.parent) if (owner.isTypeOnly || ts.getCombinedModifierFlags(owner) & ts.ModifierFlags.Ambient) return false
    return true
  }
  function finiteMockCallback(callback, seen = new Set(), diagnostic) {
    const reject = (node, reason) => {
      if (diagnostic && !diagnostic.unsupported) {
        const source = node.getSourceFile(), start = node.getStart(), position = source.getLineAndCharacterOfPosition(start)
        diagnostic.unsupported = { reason, file: local(source.fileName), start, line: position.line + 1, column: position.character + 1,
          syntax: ts.SyntaxKind[node.kind], expression: node.getText().slice(0, 400) }
      }
      return false
    }
    if (!callable(callback) || seen.has(callback) || !callback.parameters.every(parameter => ts.isIdentifier(parameter.name) && !parameter.initializer && !parameter.dotDotDotToken)) return reject(callback, 'Callable identity, acyclic helper path, or plain callback parameters are unproven')
    const visiting = new Set(seen); visiting.add(callback)
    const returnedValue = expression => {
      const value = origin(expression)
      if (inertValue(value)) return true
      if (!ts.isCallExpression(value)) return reject(value, 'Returned value lacks closed-value evidence')
      if (mockDataOperations.has(operationKey(value))) return true
      const declaration = checker.getResolvedSignature(value)?.declaration
      return !!declaration?.body && finiteMockCallback(declaration, visiting, diagnostic) || reject(value, 'Returned call lacks a recorded data-operation or finite source-helper proof')
    }
    let known = ts.isBlock(callback.body) || returnedValue(callback.body)
    const visit = node => {
      if (!known || typeOnly(node)) return
      if (node !== callback && !finiteMockSyntax.has(node.kind)) { known = reject(node, 'AST construct is outside the supported finite callback effect grammar'); return }
      if (ts.isReturnStatement(node) && node.expression && !returnedValue(node.expression)) { known = reject(node, 'Returned value lacks closed-value evidence'); return }
      if (node !== callback && callable(node)) { known = reject(node, 'Nested callable effects lack finite callback proof'); return }
      if (ts.isVariableDeclaration(node) && !ts.isIdentifier(node.name) || ts.isAwaitExpression(node)) { known = reject(node, 'Destructuring or asynchronous effects lack finite callback proof'); return }
      if (ts.isIdentifier(node) && ['globalThis', 'window', 'eval'].includes(node.text)) { known = reject(node, 'Ambient dynamic effects lack finite callback proof'); return }
      if (ts.isIdentifier(node) && node.text !== 'undefined'
        && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
        && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) {
        const declarations = symbolAtLocation(node)?.declarations ?? []
        const operationCallee = ts.isCallExpression(node.parent) && node.parent.expression === node && mockRuntimeOperations.has(operationKey(node.parent))
        if (!operationCallee && !declarations.some(mockLexicalValue)) { known = reject(node, 'Identifier lacks a proven lexical value or recorded runtime operation'); return }
      }
      const provenCall = call => {
        if (mockRuntimeOperations.has(operationKey(call))) return true
        const declaration = checker.getResolvedSignature(call)?.declaration
        return !!declaration?.body && sources.has(declaration.getSourceFile().fileName) && finiteMockCallback(declaration, visiting, diagnostic)
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        if (!provenCall(node)) { known = reject(node, 'Call effects lack a recorded runtime operation or finite source-helper proof'); return }
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        let access = node
        while ((ts.isPropertyAccessExpression(access.parent) || ts.isElementAccessExpression(access.parent)) && access.parent.expression === access) access = access.parent
        if (!(ts.isCallExpression(access.parent) || ts.isNewExpression(access.parent)) || access.parent.expression !== access || !provenCall(access.parent)) { known = reject(node, 'Property access lacks a proven operation boundary; accessor or receiver effects are unresolved'); return }
      }
      if (ts.isPrefixUnaryExpression(node) && !inertValue(node)) { known = reject(node, 'Unary operation lacks inert-value proof'); return }
      ts.forEachChild(node, visit)
    }
    visit(callback)
    return known
  }
  function stableEmptyMockExports(candidate) {
    const paths = emptyMockExports.get(candidate.factory)
    if (!paths) return true
    candidate.configurations = new Map(paths.map(path => [JSON.stringify(path), []]))
    candidate.configurationCalls = new Set()
    candidate.returnConfigurations = new Map(paths.map(path => [JSON.stringify(path), []]))
    candidate.configurationRecords = new Map(paths.map(path => [JSON.stringify(path), []]))
    candidate.invocations = []
    // Mock implementations survive clearAllMocks and can be shared by sibling
    // cases. Only direct calls of the initially empty exports are benign; all
    // other uses require substitution/escape proof that this boundary lacks.
    for (const [file, info] of files) {
      if (file !== candidate.file && !runtimeReaches(candidate.file, file)) continue
      let stable = true
      const visit = node => {
        if (!stable || ts.isTypeNode(node) || ts.isImportDeclaration(node)) return
        if (ts.isExportDeclaration(node)) {
          const target = node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && importedModule(file, node.moduleSpecifier.text)
          if (target === candidate.target || !node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)
            && node.exportClause.elements.some(element => providerTarget(providerOf(element.propertyName ?? element.name), node) === candidate.target)) { stable = false; return }
          return
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && ['resetAllMocks', 'restoreAllMocks'].includes(node.expression.name.text) && vitestReceiver(node.expression.expression)) { stable = false; return }
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || ts.isPropertyAccessExpression(node.expression) && ['importMock', 'importActual'].includes(node.expression.name.text) && vitestReceiver(node.expression.expression))) {
          const specifiers = node.arguments[0] && literalKeys(node.arguments[0])
          if (!specifiers || specifiers.some(specifier => candidate.target
            ? importedModule(file, specifier) === candidate.target
            : providerName({ module: specifier }) === providerName({ module: candidate.provider }))) { stable = false; return }
        }
        if (ts.isIdentifier(node) && !((ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
          || (ts.isPropertyAssignment(node.parent) && node.parent.name === node))) {
          const provider = providerOf(node)
          const matches = candidate.target ? providerTarget(provider, node) === candidate.target : providerName(provider) === providerName({ module: candidate.provider })
          if (matches) {
            let access = node, path = provider.export === '*' ? [] : [provider.export]
            while ((ts.isPropertyAccessExpression(access.parent) || ts.isElementAccessExpression(access.parent)) && access.parent.expression === access) {
              access = access.parent
              const keys = ts.isPropertyAccessExpression(access) ? [access.name.text] : literalKeys(access.argumentExpression)
              if (keys?.length !== 1) { stable = false; return }
              path.push(keys[0])
            }
            let wrapper = access.parent
            if (ts.isCallExpression(wrapper) && wrapper.arguments.length === 1 && wrapper.arguments[0] === access
              && ts.isPropertyAccessExpression(wrapper.expression) && wrapper.expression.name.text === 'mocked' && emptyMockReceiver(wrapper.expression.expression)) access = wrapper
            const method = ts.isPropertyAccessExpression(access.parent) && access.parent.expression === access ? access.parent : null
            const configuration = method && ts.isCallExpression(method.parent) && method.parent.expression === method ? method.parent : null
            const key = JSON.stringify(path)
            const metadata = ts.isPropertyAccessExpression(access.parent) && access.parent.name.text === 'mock'
              && ts.isPropertyAccessExpression(access.parent.parent) && access.parent.parent.name.text === 'calls'
              && candidate.configurations.has(key)
            if (metadata) {
              // Only the call log is observed; no implementation/restore handle escapes.
            } else if (configuration && ['mockImplementation', 'mockImplementationOnce'].includes(method.name.text)
              && candidate.configurations.has(key) && configuration.arguments.length === 1 && callable(origin(configuration.arguments[0]))) {
              candidate.configurations.get(key).push(origin(configuration.arguments[0])); candidate.configurationCalls.add(configuration)
              candidate.configurationRecords.get(key).push({ call: configuration, callback: origin(configuration.arguments[0]), once: method.name.text.endsWith('Once') })
            } else if (configuration && ['mockReturnValue', 'mockResolvedValue', 'mockRejectedValue'].includes(method.name.text)
              && candidate.configurations.has(key) && configuration.arguments.length === 1) {
              const record = { call: configuration, expression: configuration.arguments[0], promise: method.name.text !== 'mockReturnValue', rejected: method.name.text === 'mockRejectedValue' }
              candidate.returnConfigurations.get(key).push(record); candidate.configurationRecords.get(key).push(record)
              candidate.configurationCalls.add(configuration)
            } else if (ts.isCallExpression(access.parent) && access.parent.arguments.includes(access)
              && providerOf(access.parent.expression)?.module === 'vitest' && providerOf(access.parent.expression)?.export === 'expect') {
              // The observer receives this precise mock value; it cannot restore the original export.
            } else if (path.some((part, index) => part === 'mock' && path[index + 1] === 'calls' && candidate.configurations.has(JSON.stringify(path.slice(0, index))))) {
              // Indexed call arguments keep their actual invocation provenance below.
            } else if (ts.isCallExpression(access.parent) && access.parent.expression === access && candidate.configurations.has(key)) {
              candidate.invocations.push({ call: access.parent, key })
            } else { stable = false; return }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(info.sf)
      if (!stable) return false
    }
    return true
  }
  function stableContextBinding(expression) {
    if (stableBinding(expression)) return true
    const declaration = baseBinding(expression)
    if (!declaration || mutatedBindings.has(declaration) || mutatedObjectBindings.has(declaration) || bindingAliases.has(declaration)) return false
    const facts = bindingInvalidations.get(declaration)
    return !!facts?.size && [...facts].every(fact => {
      const call = fact.parent
      if (!ts.isCallExpression(call) || !call.arguments.includes(fact)) return false
      const signature = checker.getResolvedSignature(call), target = signature?.parameters[call.arguments.indexOf(fact)]?.valueDeclaration
      return target && ts.isParameter(target) && sources.has(target.getSourceFile().fileName) && stableBinding(target.name)
    })
  }
  function nativeContext(expression, visiting = new Set()) {
    if (!ts.isIdentifier(expression) || !stableContextBinding(expression)) return false
    const declaration = bindingDeclaration(expression)
    if (!declaration || visiting.has(declaration)) return false
    const next = new Set(visiting).add(declaration)
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) return nativeContext(declaration.initializer, next)
    if (!ts.isParameter(declaration) || !callable(declaration.parent)) return false
    const callback = declaration.parent, registration = callback.parent
    const provider = ts.isCallExpression(registration) && registration.arguments.includes(callback) && providerOf(registration.expression)
    if (callback.parameters[0] === declaration && provider?.module === 'node:test' && stableBinding(registration.expression)
      && ['test', 'it', 'default', '*'].includes(provider.export)) return true
    const inputs = parameterInputs.get(symbolAtLocation(expression))
    return !!inputs?.size && [...inputs].every(input => nativeContext(input, next))
  }
  function nativeTracker(expression) {
    const provider = providerOf(expression)
    if (provider?.module === 'node:test' && provider.export === 'mock') return stableBinding(expression)
    if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== 'mock') return false
    return nativeContext(expression.expression)
  }
  function nativeReplacement(call) {
    if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'method' || call.arguments.length < 2) return null
    const provider = providerOf(call.arguments[0])
    if (!provider) {
      if (cyclicProviders.has(origin(call.arguments[0])) && nativeTracker(call.expression.expression)) return { cyclicProvider: call.arguments[0].getText() }
      return null
    }
    const keys = literalKeys(call.arguments[1]), trackerProven = nativeTracker(call.expression.expression)
    const callback = call.arguments[2]
    const statement = callback && callable(callback) && ts.isBlock(callback.body) && callback.body.statements.length === 1 ? callback.body.statements[0] : null
    const literalThrow = statement && ts.isThrowStatement(statement) && (ts.isStringLiteralLike(statement.expression) || ts.isNumericLiteral(statement.expression)
      || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(statement.expression.kind))
    const known = trackerProven && nativeTarget(call.arguments[0]) && call.arguments.length === 3 && ts.isStringLiteralLike(call.arguments[1]) && literalThrow
      && callback.parameters.every(parameter => ts.isIdentifier(parameter.name) && !parameter.initializer && !parameter.dotDotDotToken)
    // inputStatus still requires a live property lookup: captured CJS function
    // values do not change when this provider object's method is replaced.
    return { provider, method: keys?.length === 1 ? keys[0] : null, trackerProven, native: true, persistent: providerOf(call.expression.expression)?.module === 'node:test' && providerOf(call.expression.expression)?.export === 'mock', action: known ? 'replace' : 'uncertain',
      callback: trackerProven && nativeTarget(call.arguments[0]) && call.arguments.length === 3 && ts.isStringLiteralLike(call.arguments[1]) && callable(callback) ? callback : null }
  }
  function replacementEvent(call, entry) {
    const name = call.expression.getText()
    let event = nativeReplacement(call)
    if (event?.cyclicProvider) { entry.unsafe = `cyclic native mock provider provenance: ${event.cyclicProvider}`; return }
    if (event) {
      // Index-time native provenance must not depend on the later operation
      // inventory. Qualify callback bodies only during complete graph inspection.
      const effectDiagnostic = {}, registrationProven = !!event.callback
      const effectsProven = event.callback && finiteMockCallback(event.callback, new Set(), effectDiagnostic)
      event.boundaryDiagnostic = { registrationIdentity: registrationProven ? 'proven' : 'unproven',
        effectCompleteness: registrationProven ? effectsProven ? 'proven' : 'unproven' : 'not-evaluated',
        registration: { file: entry.file, start: call.getStart(), expression: call.getText().slice(0, 400) },
        ...(effectDiagnostic.unsupported ? { unsupported: effectDiagnostic.unsupported } : {}),
        ...(!registrationProven ? { missingEvidence: 'Native tracker/target, literal method, exact callback identity, or registration arity is unproven' } : {}) }
      if (registrationProven) {
        nativeCallbackRegistrations.add(event.callback)
        // The existing literal-throw boundary has no runtime callback effects.
        if (event.action === 'replace') event.callback = null
        else nativeCallbackProviders.add(providerName(event.provider))
        event.action = 'replace'
      } else event.callback = null
      if (event.persistent) { persistentNativeCandidates.push({ ...event, file: entry.file, ast: call }); nativeCallbackProviders.add(providerName(event.provider)) }
      ;(entry.providerEvents ??= []).push({ ...event, ast: call }); return
    }
    if (name === 'vi.spyOn' && call.arguments[0] && vitestReceiver(call.expression.expression)) {
      providerOf(call.arguments[0])
      if (cyclicProviders.has(origin(call.arguments[0]))) { entry.unsafe = `cyclic mock provider provenance: ${call.arguments[0].getText()}`; return }
    }
    if (name === 'vi.stubGlobal' && emptyMockReceiver(call.expression.expression) && ts.isStringLiteralLike(call.arguments[0]) && call.arguments[1]) {
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
  function mockObservationCall(call) {
    const provider = providerOf(call.expression)
    if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'mocked'
      && emptyMockReceiver(call.expression.expression) && call.arguments.length === 1) return true
    if (provider?.module !== 'vitest' || provider.export !== 'expect' || call.arguments.length !== 1) return false
    const declaration = baseBinding(call.expression)
    if (declaration && (mutatedBindings.has(declaration) || mutatedObjectBindings.has(declaration))) return false
    let member = call.parent
    if (ts.isPropertyAccessExpression(member) && member.name.text === 'not') member = member.parent
    return ts.isPropertyAccessExpression(member) && ['toHaveBeenCalled', 'toHaveBeenCalledOnce', 'toHaveBeenCalledTimes', 'toBe'].includes(member.name.text)
      && ts.isCallExpression(member.parent) && member.parent.expression === member
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
    const declaration = (ts.isIdentifier(value) && ts.isShorthandPropertyAssignment(value.parent)
      ? checker.getShorthandAssignmentValueSymbol(value.parent) : receiverSymbol(value))?.valueDeclaration
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
      linkSymbol(symbol, references, new Set(), optionalReceiver(access), reflective || invoked || invocationReference(access))
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
    const writeOnly = ts.isBinaryExpression(n.parent) && n.parent.left === n && n.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
      || ts.isDeleteExpression(n.parent)
    if (!writeOnly && (!keys || keys.some(key => sourceGetterKeys.has(key)))) (entry.recordReads ??= []).push(n)
    // Use the member symbol only, not the computed key variable's symbol.
    if (ts.isPropertyAccessExpression(n)) symbolEdges(n.name, entry)
    resolveMember(n.expression, keys, entry, n)
  }
  function importedModule(file, specifier) {
    if (!specifier.startsWith('.')) return null
    const stem = posix.normalize(posix.join(posix.dirname(file), specifier))
    return [...(runtimeModules.get(file) ?? [])].find(target => target === stem || ['.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.js'].some(extension => target === stem + extension))
  }
  function mainCondition(expression) {
    while (ts.isParenthesizedExpression(expression)) expression = expression.expression
    if (!ts.isBinaryExpression(expression) || ![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(expression.operatorToken.kind)) return null
    let left = expression.left, right = expression.right
    if (ts.isIdentifier(left) && left.text === 'module') [left, right] = [right, left]
    if (!ts.isPropertyAccessExpression(left) || left.name.text !== 'main' || !ts.isIdentifier(left.expression) || left.expression.text !== 'require' || !ts.isIdentifier(right) || right.text !== 'module') return null
    const file = expression.getSourceFile().fileName
    if (mutatedImplicitRequireFiles.has(file) || escapedImplicitRequireFiles.has(file) || mutatedRequireMainFiles.has(file) || mutatedImplicitModuleFiles.has(file)) return null
    if (!implicitRequire(left.expression) || !implicitCommonJS(right, 'module')) return null
    return { file: local(file), isMain: expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken, expression: expression.getText() }
  }
  function inertLocalCall(expression) {
    if (!stableBinding(expression)) return false
    const targets = [...callableValues(expression)].map(id => nodes.get(id)?.ast)
    return targets.length > 0 && targets.every(fn => callable(fn) && fn.parameters.every(parameter => ts.isIdentifier(parameter.name) && !parameter.initializer && !parameter.dotDotDotToken)
      && (ts.isBlock(fn.body) ? fn.body.statements.length === 1 && ts.isReturnStatement(fn.body.statements[0]) && inertValue(fn.body.statements[0].expression) : inertValue(fn.body)))
  }
  function inspect(n, entry, root = false) {
    if (ts.isSpreadAssignment(n)) (entry.objectSpreads ??= []).push(n)
    for (const name of intrinsicExposureSites.get(n) ?? []) {
      entry.intrinsicExposure ??= new Map()
      if (!entry.intrinsicExposure.has(name)) entry.intrinsicExposure.set(name, new Set())
      entry.intrinsicExposure.get(name).add(n)
    }
    if (arrayExposureSites.has(n)) entry.arrayIntrinsicExposure = true
    if (objectExposureSites.has(n)) entry.objectIntrinsicExposure = true
    if (ts.isIfStatement(n)) {
      const condition = mainCondition(n.expression)
      if (condition && !callable(n.thenStatement) && !callable(n.elseStatement)) {
        for (const [branch, truth] of [[n.thenStatement, true], [n.elseStatement, false]]) if (branch) {
          const id = add(branch, '<main entry guard>'), gate = nodes.get(id)
          gate.mainGuard = { ...condition, isMain: truth ? condition.isMain : !condition.isMain }
          connect(entry, id)
          entry.edgeEvidence.set(id, { evidence: 'canonical CommonJS entry guard', ...gate.mainGuard })
        }
        return
      }
      inspect(n.expression, entry)
      for (const [body, expected] of [[n.thenStatement, true], [n.elseStatement, false]]) if (body) flowBranch(entry, n.expression, expected, body)
      return
    }
    if (ts.isConditionalExpression(n)) {
      inspect(n.condition, entry)
      flowBranch(entry, n.condition, true, n.whenTrue)
      flowBranch(entry, n.condition, false, n.whenFalse)
      return
    }
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(n.operatorToken.kind)) {
      inspect(n.left, entry)
      flowBranch(entry, n.left, n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken, n.right)
      return
    }
    if (ts.isBlock(n)) { inspectStatements([...n.statements], entry); return }
    if (ts.isForOfStatement(n)) {
      inspect(n.expression, entry)
      inspect(n.initializer, entry)
      const id = `${entry.id}:iteration:${n.statement.pos}`
      if (!nodes.has(id)) {
        const loop = { id, ast: n.statement, file: entry.file, label: '<iteration body>', flowBranch: true,
          iterationGuard: n, prepared: true, edges: new Set(), conservativeEdges: new Set(), edgeEvidence: new Map() }
        nodes.set(id, loop)
        inspect(n.statement, loop)
      }
      connect(entry, id)
      entry.edgeEvidence.set(id, { evidence: 'iterable execution', iterable: n.expression.getText() })
      return
    }
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
    if (!root && callable(n)) return
    if (!root && ts.isVariableDeclaration(n) && inertValue(n.initializer)) return
    if (!root && nativeCallbackRegistrations.has(n)) return
    if (!root && byAst.has(n)) {
      connect(entry, byAst.get(n))
      if (callable(n) && !invocationReference(n)) {
        entry.opaqueTargets ??= new Set(); entry.opaqueTargets.add(byAst.get(n))
        entry.opaqueNonArgumentTargets ??= new Set(); entry.opaqueNonArgumentTargets.add(byAst.get(n))
      }
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
      if (implicitCommonJS(n.expression, 'Map')) (entry.mapCreations ??= []).push(n)
      if (implicitCommonJS(n.expression, 'Set') && inlineSetConsumer(n)) (entry.inlineSetIterations ??= []).push(n)
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
      if (ts.isIdentifier(n.left) && (n.operatorToken.kind === ts.SyntaxKind.EqualsToken || supportedCompoundOperators.has(n.operatorToken.kind))) (entry.bindingWrites ??= []).push(n)
      if (ts.isPropertyAccessExpression(n.left) || ts.isElementAccessExpression(n.left)) {
        ;(entry.runtimeWrites ??= []).push(n)
        if (ts.isElementAccessExpression(n.left) && !literalKeys(n.left.argumentExpression)) (entry.arrayIndexWrites ??= []).push(n)
        const provider = providerOf(n.left.expression), keys = ts.isPropertyAccessExpression(n.left) ? [n.left.name.text] : literalKeys(n.left.argumentExpression)
        if (provider) (entry.providerEvents ??= []).push({ provider, method: keys?.length === 1 ? keys[0] : null, action: 'uncertain', ast: n, reason: 'Provider export mutation' })
      }
      providerEscape(n.right, entry, n)
    }
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && ts.isIdentifier(n.operand)
      && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(n.operator)) (entry.bindingWrites ??= []).push(n)
    if (ts.isReturnStatement(n) && n.expression) providerEscape(n.expression, entry, n)
    if (ts.isPropertyAssignment(n)) providerEscape(n.initializer, entry, n)
    if (ts.isShorthandPropertyAssignment(n)) providerEscape(n.name, entry, n)
    if (ts.isArrayLiteralExpression(n)) for (const element of n.elements) providerEscape(element, entry, n)
    if (ts.isCallExpression(n)) {
      ;(entry.runtimeCalls ??= []).push(n)
      if (functionAdapter(n.expression)) (entry.functionAdapters ??= []).push(n)
      if (ts.isPropertyAccessExpression(n.expression) && ['assign', 'freeze', 'values'].includes(n.expression.name.text) && ambientIntrinsicReference(n.expression.expression, 'Object')) (entry.nativeDataCalls ??= []).push(n)
      if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'stringify' && ambientIntrinsicReference(n.expression.expression, 'JSON')) (entry.jsonStringifications ??= []).push(n)
      if (ts.isPropertyAccessExpression(n.expression)) {
        const declaration = checker.getResolvedSignature(n)?.declaration, owner = declaration?.parent
        const nativeMap = !!declaration && program.isSourceFileDefaultLibrary(declaration.getSourceFile())
          && ts.isInterfaceDeclaration(owner) && ['Map', 'ReadonlyMap'].includes(owner.name.text)
        if (nativeMap || ['get', 'set', 'has', 'clear', 'delete'].includes(n.expression.name.text))
          (entry.mapOperations ??= []).push({ call: n, receiver: n.expression.expression, nativeMap })
      }
      if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'sort' && n.arguments.length === 1
        && (ts.isArrowFunction(n.arguments[0]) || ts.isFunctionExpression(n.arguments[0]))) {
        const declaration = checker.getResolvedSignature(n)?.declaration, owner = declaration?.parent
        const nativeArray = !!declaration && program.isSourceFileDefaultLibrary(declaration.getSourceFile())
          && ts.isInterfaceDeclaration(owner) && ['Array', 'ReadonlyArray'].includes(owner.name.text)
        ;(entry.collectionSorts ??= []).push({ call: n, receiver: n.expression.expression, argument: n.arguments[0], nativeArray })
      }
      if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'from'
        && implicitCommonJS(n.expression.expression, 'Array') && n.arguments.length === 2
        && (ts.isArrowFunction(n.arguments[1]) || ts.isFunctionExpression(n.arguments[1]))) {
        ;(entry.collectionFroms ??= []).push({ call: n, argument: n.arguments[1] })
      }
      if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'slice') {
        const declaration = checker.getResolvedSignature(n)?.declaration, owner = declaration?.parent
        const nativeArray = !!declaration && program.isSourceFileDefaultLibrary(declaration.getSourceFile())
          && ts.isInterfaceDeclaration(owner) && ['Array', 'ReadonlyArray'].includes(owner.name.text)
        ;(entry.collectionSlices ??= []).push({ call: n, receiver: n.expression.expression, nativeArray })
      }
      if (ts.isPropertyAccessExpression(n.expression) && ['push', 'unshift', 'pop', 'shift', 'splice', 'fill', 'copyWithin'].includes(n.expression.name.text)) {
        const declaration = checker.getResolvedSignature(n)?.declaration, owner = declaration?.parent
        const nativeArray = !!declaration && program.isSourceFileDefaultLibrary(declaration.getSourceFile())
          && ts.isInterfaceDeclaration(owner) && owner.name.text === 'Array'
        ;(entry.arrayMutations ??= []).push({ call: n, receiver: n.expression.expression, method: n.expression.name.text, nativeArray })
      }
      if (ts.isPropertyAccessExpression(n.expression) && ['filter', 'map', 'flatMap', 'find', 'forEach', 'reduce', 'reduceRight'].includes(n.expression.name.text)) {
        const declaration = checker.getResolvedSignature(n)?.declaration, owner = declaration?.parent
        const nativeArray = !!declaration && program.isSourceFileDefaultLibrary(declaration.getSourceFile())
          && ts.isInterfaceDeclaration(owner) && ['Array', 'ReadonlyArray'].includes(owner.name.text)
        ;(entry.collectionIterations ??= []).push({ call: n, receiver: n.expression.expression, argument: n.arguments[0], nativeArray, method: n.expression.name.text })
      }
      if (deferredMockConfigurations.has(n) && entry.mockConfigurationCall !== n) {
        const id = `${entry.file}:${n.getStart()}:<mock configuration>`
        if (!nodes.has(id)) {
          const operation = { id, ast: n, file: entry.file, label: '<mock configuration>', mockConfigurationCall: n,
            mockConfigurationFor: deferredMockConfigurations.get(n), prepared: true, edges: new Set(), conservativeEdges: new Set(), edgeEvidence: new Map() }
          nodes.set(id, operation); inspect(n, operation)
        }
        connect(entry, id)
        return
      }
      if (mockInvocationCandidates.has(n)) (entry.mockInvocations ??= []).push({ call: n, alternatives: mockInvocationCandidates.get(n) })
      if ((ts.isIdentifier(n.expression) && n.expression.text === 'require' || n.expression.kind === ts.SyntaxKind.ImportKeyword) && ts.isStringLiteralLike(n.arguments[0])) {
        const target = importedModule(entry.file, n.arguments[0].text)
        if (files.has(target)) {
          if (providerRequire(n) || n.expression.kind === ts.SyntaxKind.ImportKeyword) {
            connect(entry, files.get(target).top); entry.conservativeEdges.add(files.get(target).top)
            entry.edgeEvidence.set(files.get(target).top, { evidence: 'actual module initialization', expression: n.getText() })
          } else if (!inertLocalCall(n.expression)) {
            const risk = { target, expression: n.getText(), reason: 'CommonJS loader identity or cache provenance is unresolved' }
            ;(entry.moduleEntryRisks ??= []).push(risk)
            if (implicitRequire(n.expression) && !mutatedImplicitRequireFiles.has(n.getSourceFile().fileName)
              && !escapedImplicitRequireFiles.has(n.getSourceFile().fileName)) {
              loaderAcquisitions.set(risk, n)
              commonjsTargets.add(target)
              // This edge is provisional. Every affected case must qualify the
              // loader against its complete process/scope trace before selection.
              connect(entry, files.get(target).top); entry.conservativeEdges.add(files.get(target).top)
              entry.edgeEvidence.set(files.get(target).top, { evidence: 'module initialization with per-case loader scope guard', expression: n.getText() })
            }
          }
        }
      }
      replacementEvent(n, entry)
      if (!nativeReplacement(n) && !spy(n) && !mockObservationCall(n)) for (const argument of n.arguments) providerEscape(argument, entry, n)
      if (n.expression.getText() === 'eval') entry.unsafe = 'eval runtime dispatch'
      let callee = n.expression
      if (functionAdapter(callee)) callee = callee.expression
      for (const id of callableValues(callee)) invocation(entry, id, n)
      const signature = checker.getResolvedSignature(n)
      n.arguments.forEach((argument, index) => {
        if (nativeCallbackRegistrations.has(argument) || mockObservationCall(n)) return
        if (index === 0 && ts.isPropertyAccessExpression(n.expression)
          && ['mockImplementation', 'mockImplementationOnce', 'mockReturnValue', 'mockReturnValueOnce', 'mockResolvedValue', 'mockResolvedValueOnce', 'mockRejectedValue', 'mockRejectedValueOnce'].includes(n.expression.name.text)) {
          const receiver = n.expression.expression, initial = origin(receiver), binding = baseBinding(receiver)
          if ((!binding || !mutatedBindings.has(binding) && !mutatedObjectBindings.has(binding)) && ts.isCallExpression(initial)
            && ts.isPropertyAccessExpression(initial.expression) && initial.expression.name.text === 'fn' && emptyMockReceiver(initial.expression.expression)) {
            // A proven local mock receives its implementation as data. Check
            // actual invocation and effects after the configuration is reached.
            ;(entry.deferredMockArguments ??= []).push({ call: n, argument })
            return
          }
        }
        if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'fn' && emptyMockReceiver(n.expression.expression)) return
        if (signature?.declaration?.body && sources.has(signature.declaration.getSourceFile().fileName)) return
        if (index === 0 && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'sort'
          && (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) return
        if (index === 1 && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'from'
          && implicitCommonJS(n.expression.expression, 'Array') && (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) return
        if (index === 0 && ts.isPropertyAccessExpression(n.expression) && ['filter', 'map', 'flatMap', 'forEach'].includes(n.expression.name.text)
          && (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) {
          return
        }
        const parameter = signature?.parameters[index]
        const parameterType = parameter && checker.getTypeOfSymbolAtLocation(parameter, n)
        if (!parameterType?.getCallSignatures().length && !invokedSymbols.has(parameter) && !checker.getTypeAtLocation(argument).getCallSignatures().length) return
        if (ts.isPropertyAccessExpression(n.expression) && (['push', 'unshift'].includes(n.expression.name.text)
          || n.expression.name.text === 'splice' && index >= 2 || n.expression.name.text === 'fill' && index === 0)) {
          const declaration = signature?.declaration, owner = declaration?.parent
          const nativeArray = !!declaration && program.isSourceFileDefaultLibrary(declaration.getSourceFile())
            && ts.isInterfaceDeclaration(owner) && owner.name.text === 'Array'
          ;(entry.collectionStores ??= []).push({ call: n, receiver: n.expression.expression, argument, nativeArray })
          return
        }
        for (const id of callableValues(argument)) {
          connect(entry, id)
          entry.opaqueTargets ??= new Set(); entry.opaqueTargets.add(id)
          entry.callbackArgumentSites ??= new Map()
          if (!entry.callbackArgumentSites.has(id)) entry.callbackArgumentSites.set(id, new Set())
          entry.callbackArgumentSites.get(id).add(argument)
          // An inline function passed to a mock is an argument value. Its
          // effects are reached through the mock's actual implementation or
          // through a later call-log read, not by passing it to the mock.
          if ((ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) && nodes.get(id)?.ast === argument) {
            entry.inlineCallbackArguments ??= new Map()
            entry.inlineCallbackArguments.set(id, n)
          }
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
      const descriptorRead = ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'getOwnPropertyDescriptor'
        && ambientIntrinsicReference(n.expression.expression, 'Object')
      if (key && !descriptorRead) resolveMember(receiver, literalKeys(key), entry, n, true)
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
  function alwaysExits(node) {
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) return true
    if (ts.isBlock(node)) return node.statements.some(alwaysExits)
    return ts.isIfStatement(node) && node.elseStatement && alwaysExits(node.thenStatement) && alwaysExits(node.elseStatement)
  }
  function inspectStatements(statements, entry) {
    for (let index = 0; index < statements.length; index++) {
      const statement = statements[index]
      inspect(statement, entry)
      if (alwaysExits(statement)) return
      if (!ts.isIfStatement(statement) || index === statements.length - 1) continue
      const thenExits = alwaysExits(statement.thenStatement), elseExits = statement.elseStatement && alwaysExits(statement.elseStatement)
      if (!thenExits && !elseExits) continue
      const remainder = statements.slice(index + 1), id = `${entry.id}:continuation:${statement.end}`
      if (!nodes.has(id)) {
        const continuation = { id, ast: remainder[0], file: entry.file, label: '<conditional continuation>', flowBranch: true,
          truthGuard: { expression: statement.expression, expected: !thenExits }, prepared: true,
          edges: new Set(), conservativeEdges: new Set(), edgeEvidence: new Map() }
        nodes.set(id, continuation)
        inspectStatements(remainder, continuation)
      }
      connect(entry, id)
      entry.edgeEvidence.set(id, { evidence: 'continuation after conditional exit', condition: statement.expression.getText(), expected: !thenExits })
      return
    }
  }
  function flowBranch(entry, expression, expected, body) {
    const id = `${entry.id}:branch:${body.pos}:${expected}`
    if (!nodes.has(id)) {
      const branch = { id, ast: body, file: entry.file, label: '<conditional branch>', flowBranch: true,
        truthGuard: { expression, expected }, prepared: true, edges: new Set(), conservativeEdges: new Set(), edgeEvidence: new Map() }
      nodes.set(id, branch)
      inspect(body, branch)
    }
    connect(entry, id)
    entry.edgeEvidence.set(id, { evidence: 'conditional execution', condition: expression.getText(), expected })
  }
  function inertExportBinding(expression) {
    if (inertValue(expression)) return true
    if (ts.isIdentifier(expression)) return (symbolAtLocation(expression)?.declarations ?? []).some(declaration => sources.has(declaration.getSourceFile().fileName))
    if (ts.isObjectLiteralExpression(expression)) return expression.properties.every(property => ts.isShorthandPropertyAssignment(property)
      ? inertExportBinding(property.name) : ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name) && inertExportBinding(property.initializer))
    return false
  }
  function inertCommonJSExport(statement) {
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression) || statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false
    const assignment = statement.expression, left = assignment.left
    if (!ts.isPropertyAccessExpression(left)) return false
    let root = left
    while (ts.isPropertyAccessExpression(root)) root = root.expression
    const direct = implicitCommonJS(root, 'exports') ? /^exports\.[\w$]+$/.test(left.getText())
      : implicitCommonJS(root, 'module') && /^module\.exports(?:\.[\w$]+)?$/.test(left.getText())
    if (!direct || escapedExportFiles.has(statement.getSourceFile().fileName)) return false
    if (left.getText() !== 'module.exports' && left.getText().startsWith('module.exports.') && reconfiguredExportFiles.has(statement.getSourceFile().fileName)) return false
    return inertExportBinding(assignment.right)
  }
  const mockModes = new Map()
  for (const candidate of mockCandidates) {
    candidate.mode = mockFactoryMode(candidate.factory)
    if (candidate.mode === 'replacement' && !stableEmptyMockExports(candidate)) candidate.mode = 'uncertain'
    candidate.boundaryKey = `${candidate.file}:${candidate.target ?? providerName({ module: candidate.provider })}`
    if (!mockModes.has(candidate.boundaryKey)) mockModes.set(candidate.boundaryKey, new Set())
    mockModes.get(candidate.boundaryKey).add(candidate.mode)
  }
  for (const candidate of mockCandidates) if (candidate.mode === 'replacement' && mockModes.get(candidate.boundaryKey).size === 1) {
    for (const call of candidate.configurationCalls ?? []) {
      if (!deferredMockConfigurations.has(call)) deferredMockConfigurations.set(call, [])
      deferredMockConfigurations.get(call).push(candidate)
    }
    for (const invocation of candidate.invocations ?? []) {
      if (!mockInvocationCandidates.has(invocation.call)) mockInvocationCandidates.set(invocation.call, [])
      mockInvocationCandidates.get(invocation.call).push({ candidate, key: invocation.key })
    }
  }
  for (const entry of nodes.values()) {
    if (entry.shape || entry.prepared) continue
    // Publishing a CommonJS callable binding does not invoke its body. Actual
    // call/callback positions resolve the callable independently below; retain
    // this export node so retargeting the published binding is still observable.
    if (entry.label.startsWith('<export:') && (ts.isShorthandPropertyAssignment(entry.ast) || ts.isPropertyAssignment(entry.ast))
      && callableValues(ts.isShorthandPropertyAssignment(entry.ast) ? entry.ast.name : entry.ast.initializer).length) continue
    if (ts.isSourceFile(entry.ast) || entry.label === '<suite setup>') {
      function eager(n) {
        if (typeOnly(n) || registration(n) || ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || callable(n) || inertCommonJSExport(n)) return
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
  for (const [file, info] of files) for (const statement of info.sf.statements) {
    if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || statement.isTypeOnly || !statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue
    if (ts.isImportDeclaration(statement) && (statement.importClause?.isTypeOnly || !statement.importClause?.name && ts.isNamedImports(statement.importClause?.namedBindings ?? {}) && statement.importClause.namedBindings.elements.length > 0 && statement.importClause.namedBindings.elements.every(element => element.isTypeOnly))) continue
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.length > 0 && statement.exportClause.elements.every(element => element.isTypeOnly)) continue
    const target = importedModule(file, statement.moduleSpecifier.text)
    if (files.has(target)) {
      connect(nodes.get(info.top), files.get(target).top)
      nodes.get(info.top).conservativeEdges.add(files.get(target).top)
      nodes.get(info.top).edgeEvidence.set(files.get(target).top, { evidence: 'actual module initialization', expression: statement.getText() })
    }
  }
  function actualReaderCall(input) {
    const file = input.readerFile ?? input.from, info = files.get(file)
    const offset = input.readerStart ?? input.start
    if (!info || offset === undefined) return null
    let call
    const locate = node => {
      if (node.getStart() <= offset && offset < node.end) {
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) call = node
        ts.forEachChild(node, locate)
      }
    }
    locate(info.sf)
    return call?.getStart() === offset ? call : null
  }
  function readerBinding(input) {
    const call = actualReaderCall(input)
    if (!call) return { live: false }
    const unwrap = expression => ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) ? unwrap(expression.expression) : expression
    const imported = expression => {
      const declaration = symbolAtLocation(expression)?.declarations?.find(declaration => ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration) || ts.isImportClause(declaration))
      return declaration
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
    const nativeSnapshot = (expression, seen = new Set()) => {
      expression = unwrap(expression)
      if (seen.has(expression)) return true
      seen.add(expression)
      const binding = imported(expression)
      if (binding) {
        let statement = binding
        while (statement && !ts.isImportDeclaration(statement)) statement = statement.parent
        return (ts.isImportSpecifier(binding) || ts.isNamespaceImport(binding)) && !!statement?.moduleSpecifier?.text && isBuiltin(statement.moduleSpecifier.text)
      }
      const declaration = bindingDeclaration(expression)
      return !!(declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && nativeSnapshot(declaration.initializer, seen))
    }
    const callee = unwrap(call.expression)
    if (ts.isIdentifier(callee)) {
      const binding = imported(callee)
      if (binding) return { live: true, moduleKind: 'esm', methodLive: !nativeSnapshot(callee) }
      if (input.provider?.global === callee.text && !(symbolAtLocation(callee)?.declarations ?? []).some(declaration => sources.has(declaration.getSourceFile().fileName))) return { live: true, moduleKind: 'global' }
      // Destructuring or assigning a function captures its current value; a
      // later provider-object spy does not necessarily replace this call.
      const captured = bindingDeclaration(callee)
      return { live: false, ...(captured && ts.isBindingElement(captured) && captured.parent.parent.initializer
        && providerRequire(captured.parent.parent.initializer) ? { capture: { file: local(call.getSourceFile().fileName), declaration: captured } } : {}) }
    }
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
      const kind = moduleKind(callee.expression)
      return { live: !!kind, moduleKind: kind, methodLive: !nativeSnapshot(callee.expression) }
    }
    return { live: false }
  }
  const inputs = new Map()
  for (const input of inputEdges ?? []) {
    const crossModule = input.readerFile && (input.readerFile !== input.from || input.deferredCallable)
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
    nodes.set(id, { id, ast, file: readerFile, inputFile: input.to, provider: input.provider, readerBinding: readerBinding(input), readerCall: actualReaderCall(input), changeKinds: input.changeKinds, inputSet: input.inputSet, readerMethod: input.kind === 'load' ? 'loadAsync' : input.provider?.export, label: `<input:${input.to}>`, edges: new Set(), conservativeEdges: new Set(), edgeEvidence: new Map() })
    connect(nodes.get(ownerId), id)
    if (input.kind === 'import' && files.has(input.to)) { connect(nodes.get(id), files.get(input.to).top); nodes.get(id).conservativeEdges.add(files.get(input.to).top) }
    if (input.kind === 'execute' && input.executionKind === 'node-entry' && files.has(input.to)) nodes.get(id).nodeEntry = { file: input.to, target: files.get(input.to).top }
    if (crossModule || input.conservative || input.inputSet && input.kind !== 'directory-membership') nodes.get(ownerId).conservativeEdges.add(id)
    nodes.get(ownerId).edgeEvidence.set(id, { input: input.to, expression: input.expression, evidence: input.kind, ...(input.inputSet ? { inputSet: input.inputSet, ...(input.resolution || input.kind !== 'directory-membership' ? { resolution: input.resolution ?? 'possible bounded directory input' } : {}) } : {}), ...(crossModule ? { callerContext: { file: input.from, line: input.line, column: input.column }, resolution: 'finite factory context' } : {}) })
    if (!(files.has(input.to) && (input.kind === 'import' || input.executionKind === 'node-entry'))) {
      if (!inputs.has(input.to)) inputs.set(input.to, new Set())
      inputs.get(input.to).add(id)
    }
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
    const placementFile = risk.deferredCallable ? risk.readerFile ?? risk.from : risk.from
    const info = files.get(placementFile)
    if (!info) continue
    const offset = (risk.deferredCallable ? risk.readerStart : risk.start) ?? info.sf.getPositionOfLineAndCharacter(risk.line - 1, risk.column - 1)
    let owner = info.sf
    function locate(node) {
      if (node.getStart() <= offset && offset < node.end) {
        if (byAst.has(node)) owner = node
        ts.forEachChild(node, locate)
      }
    }
    locate(info.sf)
    const ast = actualReaderCall({ from: placementFile, start: offset }) ?? owner
    const id = `${placementFile}:${offset}:<input-risk:${nodes.size}>`
    nodes.set(id, { id, ast, file: placementFile, label: '<input risk>', inputRisks: [{ ...risk, start: offset }],
      provider: risk.provider, readerMethod: risk.kind === 'load' ? 'loadAsync' : risk.provider?.export,
      readerBinding: readerBinding(risk), readerCall: actualReaderCall(risk), edges: new Set(), conservativeEdges: new Set(), edgeEvidence: new Map() })
    const entry = nodes.get(byAst.get(owner))
    connect(entry, id)
    entry.edgeEvidence.set(id, { evidence: 'runtime input frontier', expression: risk.expression })
  }
  // CJS require calls retain original bindings; a Vitest module replacement
  // cannot establish a file-wide boundary for those consumers.
  for (const input of inputEdges ?? []) if (input.kind === 'import' && /^require\s*\(/.test(input.inputExpression ?? input.expression)) commonjsTargets.add(input.to)
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
    for (const step of path) if (step.processContext === 'test' && reached?.mockUncertainties?.has(step.file)) return reached.mockUncertainties.get(step.file)
    for (const step of path) if (step.processContext === 'test' && files.get(testFile)?.uncertainMocks.has(step.file)) return files.get(testFile).uncertainMocks.get(step.file)
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
      const declaration = symbolAtLocation(expression)?.valueDeclaration
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
  function memberGuardValue(expression, environment) {
    const basic = nullishValue(expression, environment)
    if (basic !== 'unknown') return basic
    if (!valueQuery && environment?.heap) {
      const values = scopedValues(expression, environment)
      const facts = values.map(value => value.nullish ?? (knownAbsentField(value) ? 'undefined'
        : Object.hasOwn(value, 'literalValue') || value.record || value.instance || value.classValue || value.enumValue
          || value.prototypeRecord || value.sourcePrototype || value.callable || value.elements || value.mock || value.mapValue || value.boundCallable ? 'present' : 'unknown'))
      if (facts.length && facts.every(fact => fact === facts[0])) return facts[0]
      if (facts.length && facts.every(fact => fact === 'null' || fact === 'undefined')) return 'undefined'
    }
    return 'unknown'
  }
  const truthQueries = new WeakMap()
  function truthValue(expression, scope, visited = new Set()) {
    if (!expression) return undefined
    if (!truthQueries.has(scope)) truthQueries.set(scope, new Set())
    const active = truthQueries.get(scope)
    if (active.has(expression)) return undefined
    active.add(expression)
    try {
      if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)
        || ts.isSatisfiesExpression(expression) || ts.isTypeAssertionExpression(expression)) return truthValue(expression.expression, scope, visited)
      if (expression.kind === ts.SyntaxKind.NullKeyword || expression.kind === ts.SyntaxKind.FalseKeyword || ts.isVoidExpression(expression)) return false
      if (expression.kind === ts.SyntaxKind.TrueKeyword || ts.isObjectLiteralExpression(expression) || ts.isArrayLiteralExpression(expression)
        || ts.isNewExpression(expression) || callable(expression)) return true
      if (ts.isStringLiteralLike(expression)) return !!expression.text
      if (ts.isNumericLiteral(expression)) return !!Number(expression.text)
      if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
        const value = truthValue(expression.operand, scope, visited)
        return value === undefined ? undefined : !value
      }
      if (ts.isIdentifier(expression)) {
        const declaration = bindingDeclaration(expression)
        if (declaration && ['null', 'undefined'].includes(scope.get(declaration))) return false
        if ((!declaration || !sources.has(declaration.getSourceFile().fileName)) && expression.text === 'undefined') return false
        if (!declaration || visited.has(declaration) || mutatedBindings.has(declaration)) return undefined
        const owner = declarationScope(declaration, scope), next = new Set(visited).add(declaration)
        if (!owner) return undefined
        const bindings = owner.valueBindings?.get(declaration)
        const values = bindings ? bindings.map(binding => binding.elements ? true : truthValue(binding.expression, binding.scope, next))
          : declaration.initializer ? [truthValue(declaration.initializer, owner, next)] : []
        return values.length && values.every(value => value !== undefined && value === values[0]) ? values[0] : undefined
      }
      if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'length' && ts.isIdentifier(expression.expression)) {
        const declaration = bindingDeclaration(expression.expression)
        let owner = declaration?.parent
        while (owner && !callable(owner) && !ts.isSourceFile(owner)) owner = owner.parent
        if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer || !callable(owner)
          || !(declaration.parent.flags & ts.NodeFlags.Const) || mutatedBindings.has(declaration)
          || nodes.get(byAst.get(owner))?.unsafe) return undefined
        let safe = true
        const inspect = node => {
          if (!safe || typeOnly(node)) return
          if (ts.isIdentifier(node) && node !== declaration.name && bindingDeclaration(node) === declaration) {
            let frame = node.parent
            while (frame && !callable(frame)) frame = frame.parent
            if (frame !== owner) { safe = false; return }
            if (node.getStart() >= expression.getStart()) return
            const parent = node.parent, use = parent.parent
            if (frame !== owner || !ts.isPropertyAccessExpression(parent) || parent.expression !== node || parent.name.text !== 'length'
              || ts.isBinaryExpression(use) && use.left === parent && use.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && use.operatorToken.kind <= ts.SyntaxKind.LastAssignment
              || ts.isPrefixUnaryExpression(use) || ts.isPostfixUnaryExpression(use) || ts.isDeleteExpression(use)) safe = false
          }
          ts.forEachChild(node, inspect)
        }
        inspect(owner.body)
        if (!safe) return undefined
        const values = scopedValues(expression.expression, scope)
        const lengths = values.map(value => {
          const allocation = value.allocation, cell = value.elements && heapCell(value, 'arrays')
          let frame = allocation?.parent
          while (frame && !callable(frame)) frame = frame.parent
          return value.elements && allocation && allocation.getSourceFile() === declaration.getSourceFile() && frame === owner
            && declaration.initializer.pos <= allocation.pos && allocation.end <= declaration.initializer.end
            && !value.elements.some(ts.isSpreadElement) && !value.elementBindings?.length && !cell?.invalidated && !cell?.items.length ? !!value.elements.length : undefined
        })
        return lengths.length && lengths.every(value => value !== undefined && value === lengths[0]) ? lengths[0] : undefined
      }
      const values = scopedValues(expression, scope)
      const truths = values.map(value => Object.hasOwn(value, 'literalValue') ? !!value.literalValue : value.nullish || knownAbsentField(value) ? false
        : value.record || value.instance || value.classValue || value.enumValue || value.prototypeRecord || value.sourcePrototype || value.callable || value.elements || value.mock || value.promise ? true : undefined)
      return truths.length && truths.every(value => value !== undefined && value === truths[0]) ? truths[0] : undefined
    } finally { active.delete(expression) }
  }
  const contextIds = new WeakMap()
  let contextOrdinal = 0
  function contextKey(environment) {
    if (!contextIds.has(environment)) contextIds.set(environment, contextOrdinal++)
    return contextIds.get(environment)
  }
  function contextRevision(environment) {
    return `${environment.revision ?? 0}:${[...(environment.contextDependencies ?? [])].map(scope => `${contextKey(scope)}:${scope.revision ?? 0}`).sort().join(',')}`
  }
  const receiverAllocation = value => value?.record ?? value?.allocation ?? value?.callable
  const returnParameterSummaries = new Map()
  const sourceCallableSummaries = new WeakMap()
  function sourceCallables(expression) {
    if (sourceCallableSummaries.has(expression)) return sourceCallableSummaries.get(expression)
    const declarations = [...callableValues(expression)].map(id => nodes.get(id)?.ast).filter(callable)
    const signature = ts.isCallExpression(expression.parent) && expression.parent.expression === expression ? checker.getResolvedSignature(expression.parent)?.declaration : null
    if (callable(signature) && sources.has(signature.getSourceFile().fileName)) declarations.push(signature)
    const result = [...new Set(declarations)]
    sourceCallableSummaries.set(expression, result)
    return result
  }
  function returnedParameters(fn) {
    if (returnParameterSummaries.get(fn)?.settled) return returnParameterSummaries.get(fn).parameters
    const queue = [], queued = new Set(), added = new Set()
    const schedule = entry => { if (!queued.has(entry)) { queued.add(entry); queue.push(entry) } }
    const register = target => {
      if (!returnParameterSummaries.has(target)) returnParameterSummaries.set(target, { fn: target, parameters: new Set(), parents: new Set(), settled: false })
      const entry = returnParameterSummaries.get(target)
      if (!entry.settled && !added.has(entry)) { added.add(entry); schedule(entry) }
      return entry
    }
    const root = register(fn)
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const entry = queue[cursor], target = entry.fn
      queued.delete(entry)
      const result = new Set(), origins = new Set()
      // Return provenance is a monotone union for this function. A shared AST
      // node contributes the same facts on every alias path; revisit the whole
      // summary only when a callee's returned-parameter facts actually grow.
      const origin = (expression, seen = origins) => {
        if (!expression || seen.has(expression) || typeOnly(expression)) return
        const next = seen.add(expression)
        if (callable(expression) || ts.isClassLike(expression)) return
        if (ts.isIdentifier(expression)) {
          const declaration = bindingDeclaration(expression), index = runtimeParameters(target).indexOf(declaration)
          if (index !== -1) { result.add(index); return }
          if (declaration?.initializer) origin(declaration.initializer, next)
          for (const write of valueAssignments.get(declaration) ?? []) origin(write, next)
          for (const write of propertyAssignments.get(declaration) ?? []) origin(write.expression, next)
          return
        }
        if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)
          || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isAwaitExpression(expression)) return origin(expression.expression, next)
        if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) return origin(expression.expression, next)
        if (ts.isConditionalExpression(expression)) { origin(expression.whenTrue, next); origin(expression.whenFalse, next); return }
        if (ts.isBinaryExpression(expression)) {
          if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expression.operatorToken.kind)) { origin(expression.left, next); origin(expression.right, next) }
          else if (expression.operatorToken.kind === ts.SyntaxKind.CommaToken || expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) origin(expression.right, next)
          return
        }
        if (ts.isCallExpression(expression)) {
          for (const callee of sourceCallables(expression.expression)) {
            const dependency = register(callee); dependency.parents.add(entry)
            for (const index of dependency.parameters) origin(expression.arguments[index], next)
          }
          return
        }
        if (ts.isNewExpression(expression)) return
        if (ts.isObjectLiteralExpression(expression)) {
          for (const property of expression.properties) {
            if (ts.isShorthandPropertyAssignment(property)) origin(property.name, next)
            else if (ts.isPropertyAssignment(property)) origin(property.initializer, next)
            else if (ts.isSpreadAssignment(property)) origin(property.expression, next)
          }
        } else if (ts.isArrayLiteralExpression(expression)) for (const element of expression.elements) origin(ts.isSpreadElement(element) ? element.expression : element, next)
      }
      const inspect = node => {
        if (node !== target.body && callable(node)) return
        if (ts.isReturnStatement(node)) origin(node.expression)
        else ts.forEachChild(node, inspect)
      }
      if (ts.isBlock(target.body)) inspect(target.body)
      else origin(target.body)
      let changed = false
      for (const index of result) if (!entry.parameters.has(index)) { entry.parameters.add(index); changed = true }
      if (changed) for (const parent of entry.parents) schedule(parent)
    }
    for (const entry of added) entry.settled = true
    return root.parameters
  }
  const closurePublications = new WeakMap()
  function publishesClosure(fn) {
    if (closurePublications.has(fn)) return closurePublications.get(fn)
    const visited = new Set()
    const published = expression => {
      if (!expression || visited.has(expression) || typeOnly(expression)) return false
      visited.add(expression)
      if (callable(expression)) return expression.getSourceFile() === fn.getSourceFile() && fn.pos < expression.pos && expression.end <= fn.end
      if (ts.isIdentifier(expression)) {
        const declaration = bindingDeclaration(expression)
        return declaration && (callable(declaration) ? published(declaration) : published(declaration.initializer)
          || (valueAssignments.get(declaration) ?? []).some(published)
          || (propertyAssignments.get(declaration) ?? []).some(write => published(write.expression)))
      }
      if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
        const callee = expression.expression
        const receiver = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee) ? callee.expression : null
        if (published(receiver)) return true
        const factory = ts.isNewExpression(expression) && (checker.getTypeAtLocation(callee).symbol?.declarations ?? []).some(declaration => ts.isClassLike(declaration) && sources.has(declaration.getSourceFile().fileName))
          || ts.isPropertyAccessExpression(callee) && callee.name.text === 'assign' && implicitCommonJS(callee.expression, 'Object')
          || ts.isPropertyAccessExpression(callee) && callee.name.text === 'fn' && (emptyMockReceiver(callee.expression) || nativeTracker(callee.expression))
        if (factory) return [...(expression.arguments ?? [])].some(published)
        if (ts.isCallExpression(expression)) for (const target of sourceCallables(callee)) {
          for (const index of returnedParameters(target)) if (published(expression.arguments[index])) return true
        }
        return false
      }
      let found = false
      ts.forEachChild(expression, child => { found ||= published(child) })
      return found
    }
    let result = false
    const inspect = node => {
      if (node !== fn.body && callable(node)) return
      if (ts.isReturnStatement(node)) result ||= published(node.expression)
      else ts.forEachChild(node, inspect)
    }
    if (ts.isBlock(fn.body)) inspect(fn.body)
    else result = published(fn.body)
    closurePublications.set(fn, !!result)
    return !!result
  }
  const sensitiveContexts = new Map()
  let commonSensitiveContexts, sensitivityParents, sensitivityEvents
  function contextSensitiveNodes(testFile) {
    if (sensitiveContexts.has(testFile)) return sensitiveContexts.get(testFile)
    if (!commonSensitiveContexts) {
      commonSensitiveContexts = new Set(); sensitivityParents = new Map(); sensitivityEvents = []
      const nativeProviders = new Set([...nodes.values()].filter(node => node.nodeEntry || node.readerCall).map(node => providerName(node.provider)))
      // These facts belong to the immutable graph. Only module replacement
      // relevance varies by test process; do not rebuild the graph's complete
      // ancestor relation and native/input boundary closure for every suite.
      for (const node of nodes.values()) {
        if (callable(node.ast) && publishesClosure(node.ast) || node.nodeEntry || node.readerCall || node.inputFile || node.directoryInput
          || node.providerEvents?.some(event => event.all || nativeProviders.has(providerName(event.provider)))
          || node.mockInvocations?.length || node.deferredMockArguments?.length || node.recordReads?.length || node.bindingWrites?.length || node.functionAdapters?.length || node.collectionStores?.length || node.arrayMutations?.length || node.arrayIndexWrites?.length || node.jsonStringifications?.length || node.mapCreations?.length || node.mapOperations?.length || node.inlineSetIterations?.length || node.collectionSorts?.length || node.collectionFroms?.length || node.collectionSlices?.length || node.collectionIterations?.length || node.objectSpreads?.length || node.intrinsicExposure?.size || node.nativeDataCalls?.length || node.arrayIntrinsicExposure || node.objectIntrinsicExposure || node.moduleEntryRisks?.length || node.inputRisks?.length || node.unsafe) commonSensitiveContexts.add(node.id)
        if (node.providerEvents?.length) sensitivityEvents.push(node)
        for (const child of node.edges) {
          if (!sensitivityParents.has(child)) sensitivityParents.set(child, [])
          sensitivityParents.get(child).push(node.id)
        }
      }
      for (const id of commonSensitiveContexts) for (const parent of sensitivityParents.get(id) ?? []) commonSensitiveContexts.add(parent)
    }
    const info = files.get(testFile), additions = new Set()
    for (const node of sensitivityEvents) if (!commonSensitiveContexts.has(node.id) && node.providerEvents.some(event =>
      info?.blocked.has(providerTarget(event.provider, event.ast)) || info?.uncertainMocks.has(providerTarget(event.provider, event.ast)))) additions.add(node.id)
    for (const id of additions) for (const parent of sensitivityParents.get(id) ?? []) if (!commonSensitiveContexts.has(parent)) additions.add(parent)
    const sensitive = additions.size ? new Set([...commonSensitiveContexts, ...additions]) : commonSensitiveContexts
    sensitiveContexts.set(testFile, sensitive)
    return sensitive
  }
  function primitiveOrigins(expression, scope, visited = new Set()) {
    if (!expression) return ['undefined']
    if (ts.isLiteralExpression(expression) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(expression.kind)) return [expression.getText()]
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) return primitiveOrigins(expression.expression, scope, visited)
    if (!ts.isIdentifier(expression)) return []
    const declaration = bindingDeclaration(expression)
    if (!declaration || visited.has(declaration) || mutatedBindings.has(declaration)) return []
    const next = new Set(visited).add(declaration), owner = declarationScope(declaration, scope)
    if (!owner) return []
    if (owner.valueBindings?.has(declaration)) return owner.valueBindings.get(declaration).flatMap(binding => primitiveOrigins(binding.expression, binding.scope, next))
    return ts.isVariableDeclaration(declaration) && declaration.initializer ? primitiveOrigins(declaration.initializer, owner, next) : []
  }
  const contextFootprints = new WeakMap()
  function contextFootprint(fn) {
    if (!fn || !callable(fn)) return null
    if (contextFootprints.has(fn)) return contextFootprints.get(fn)
    const declarations = new Set(), captures = new Set()
    let implicitCapture = false
    const inspect = node => {
      if (typeOnly(node)) return
      if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword
        || ts.isIdentifier(node) && node.text === 'arguments') implicitCapture = true
      if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
        const declaration = bindingDeclaration(node)
        if (declaration && sources.has(declaration.getSourceFile().fileName)) {
          declarations.add(declaration)
          let owner = declaration.parent
          while (owner && !callable(owner) && !ts.isSourceFile(owner)) owner = owner.parent
          if (callable(owner) && owner !== fn && !(fn.pos <= declaration.pos && declaration.end <= fn.end)) captures.add(declaration)
        }
      }
      ts.forEachChild(node, inspect)
    }
    inspect(fn)
    const result = { declarations, captures, implicitCapture }
    contextFootprints.set(fn, result)
    return result
  }
  function projectedContextKey(scope) {
    const identity = value => {
      if (!value) return ''
      if (!contextIds.has(value)) contextIds.set(value, contextOrdinal++)
      return contextIds.get(value)
    }
    const shape = value => Object.hasOwn(value, 'literalValue') ? valueKey(value) : value.record || value.instance || value.classValue || value.enumValue || value.prototypeRecord || value.sourcePrototype ? `record:${valueKey(value)}`
      : value.callable ? `callable:${identity(value.callable)}:${identity(value.scope)}:${identity(receiverAllocation(value.receiver))}:${identity(value.receiver?.scope)}`
        : value.mapValue || value.mapMethod || value.functionAdapter || value.boundCallable ? valueKey(value)
        : value.primitiveType ? `primitive:${value.primitiveType}`
        : value.elements ? `array:${identity(value.allocation)}:${identity(value.scope)}`
          : value.setBindings ? `set:${valueKey(value)}`
          : value.promise ? `promise<${value.promise.map(shape).sort().join('|')}>`
            : value.mock ? `mock:${identity(value.mock.candidate ?? value.mock.allocation)}:${value.mock.key}`
              : value.nullish ? value.nullish
                : value.missingOwnField ? `missing:${identity(receiverAllocation(value.missingOwnField))}:${identity(value.missingOwnField.scope)}:${value.missingOwnField.key}`
                  : value.unknown ? '?' : `other:${identity(value)}`
    const captureFacts = (fn, activation) => {
      const facts = new Set(), visited = new Map(), queue = [[fn, activation]]
      for (const [target, frame] of queue) {
        if (!visited.has(target)) visited.set(target, new Set())
        if (visited.get(target).has(frame)) continue
        visited.get(target).add(frame)
        const footprint = contextFootprint(target)
        if (!footprint || footprint.implicitCapture) { facts.add(`implicit:${identity(target)}:${identity(frame)}`); continue }
        for (const declaration of footprint.captures) {
          const owner = declarationScope(declaration, frame), expression = declaration.name
          if (!owner || !expression) { facts.add(`unresolved:${identity(declaration)}:${identity(frame)}`); continue }
          // A lexically declared helper shares its enclosing activation. Follow
          // its captured data instead of inventing a distinct data context for
          // every route to the same helper. Passed/returned callable values and
          // receiver allocations still retain their exact activation identity.
          if (ts.isFunctionDeclaration(declaration) && !contextSensitiveNodes(scope.testFile).has(byAst.get(declaration))) {
            facts.add(`helper:${identity(declaration)}`)
            queue.push([declaration, owner]); continue
          }
          const values = [...new Set(scopedValues(expression, owner).map(shape))].sort()
          const literals = [...new Set(primitiveOrigins(expression, owner))].sort()
          facts.add(`${identity(declaration)}:${values.join('|')}:${literals.join('|')}:${nullishValue(expression, owner)}:${truthValue(expression, owner)}`)
        }
      }
      return [...facts].sort().join(',')
    }
    const footprint = contextFootprint(scope.functionNode)
    const parameters = [...(scope.valueBindings ?? [])].filter(([parameter]) => !footprint || footprint.declarations.has(parameter)).map(([parameter, bindings]) => {
      const values = [...new Set(scopedValues(parameter.name, scope).map(shape))].sort()
      const literals = [...new Set(bindings.flatMap(binding => primitiveOrigins(binding.expression, binding.scope)))].sort()
      return `${identity(parameter)}:${values.join('|')}:${literals.join('|')}`
    }).sort()
    const captures = footprint ? captureFacts(scope.functionNode, scope) : ''
    const receivers = (scope.receivers ?? (scope.receiver ? [scope.receiver] : [])).map(shape).sort()
    // Reference traversal can share equivalent data contexts. The environments
    // used by value queries still retain their actual allocation/capture scopes;
    // this does not certify a native operation or callback as effect-free.
    return `${identity(scope.functionNode)}:${!footprint || footprint.implicitCapture ? identity(scope.lexicalParent) : captures}:${receivers.join('|')}:${JSON.stringify([...scope].filter(([declaration]) => !footprint || footprint.declarations.has(declaration)).map(([declaration, value]) => [identity(declaration), value]).sort())}:${parameters.join(',')}`
  }
  function lexicalScope(owner, scope) {
    const pending = [scope], visited = new Set()
    for (const current of pending) {
      if (!current || visited.has(current)) continue
      visited.add(current)
      if (current.functionNode === owner) return current
      pending.push(current.lexicalParent, current.caller)
    }
    if (!ts.isSourceFile(owner)) return null
    const modules = scope.moduleScopes
    if (!modules) return scope
    if (!modules.has(owner)) {
      const context = new Map()
      Object.assign(context, { functionNode: owner, testFile: scope.testFile, caseRegistration: scope.caseRegistration,
        mockCalls: scope.mockCalls, globalBindings: scope.globalBindings, heap: scope.heap, moduleScopes: modules })
      modules.set(owner, context)
    }
    return modules.get(owner)
  }
  function declarationScope(declaration, scope) {
    if (!declaration || !sources.has(declaration.getSourceFile().fileName)) return scope
    let owner = declaration.parent
    while (owner && !callable(owner) && !ts.isSourceFile(owner)) owner = owner.parent
    return owner ? lexicalScope(owner, scope) : scope
  }
  const callEnvironments = new WeakMap()
  const recursiveEnvironments = new WeakMap()
  function callEnvironment(target, context, parent) {
    // A declaration is initialized in its lexical activation. Merely reading a
    // module allocation from another caller does not allocate it again there.
    if (target.flowBranch) return parent
    if (!callable(target.ast)) return (ts.isSourceFile(target.ast) ? lexicalScope(target.ast, parent)
      : ts.isVariableDeclaration(target.ast) ? declarationScope(target.ast, parent) : parent) ?? parent
    // Recursive activations join argument facts instead of growing call strings.
    // Widen parameters so the first activation's nullish proof cannot hide a
    // later read. Ordinary calls and factory allocations retain their scopes.
    const ancestors = new Set(), pending = [parent]
    for (const ancestor of pending) {
      if (!ancestor || ancestors.has(ancestor)) continue
      ancestors.add(ancestor)
      pending.push(ancestor.caller, ancestor.lexicalParent)
      if (ancestor.functionNode !== target.ast) continue
      let environment = recursiveEnvironments.get(ancestor)
      if (!environment) {
        environment = new Map(ancestor); Object.assign(environment, ancestor)
        environment.valueBindings = new Map([...(ancestor.valueBindings ?? [])].map(([key, values]) => [key, [...values]]))
        environment.contextDependencies = new Set([...(ancestor.contextDependencies ?? []), environment])
        environment.receivers = ancestor.receivers ? [...ancestor.receivers] : ancestor.receiver ? [ancestor.receiver] : []
        environment.revision = 0
        for (const parameter of runtimeParameters(target.ast)) environment.set(parameter, 'unknown')
        recursiveEnvironments.set(ancestor, environment); recursiveEnvironments.set(environment, environment)
      }
      runtimeParameters(target.ast).forEach((parameter, index) => {
        const numeric = !context?.unknownArgs && context?.numberIndexes?.includes(index)
        const unknown = context?.unknownArgs || context?.unknownIndexes?.includes(index)
        const binding = numeric ? { numeric: true, scope: environment } : unknown ? { expression: parameter.name, scope: environment }
          : parameter.dotDotDotToken ? { elements: context?.args?.slice(index) ?? [], scope: parent }
            : { expression: context?.args?.[index] ?? parameter.initializer, scope: context?.args?.[index] ? context?.argScopes?.[index] ?? parent : environment }
        if (!environment.valueBindings.has(parameter)) environment.valueBindings.set(parameter, [])
        const values = environment.valueBindings.get(parameter)
        if (!values.some(value => value.expression === binding.expression && value.scope === binding.scope && !!value.numeric === !!binding.numeric
          && (!value.elements && !binding.elements || value.elements?.length === binding.elements?.length && value.elements.every((node, i) => node === binding.elements[i])))) {
          values.push(binding); environment.revision++; valueFactsRevision++
          if (environment.heap) { environment.heap.version++; advanceProofFacts(environment.heap, true) }
        }
      })
      if (context?.receiver && !environment.receivers.some(receiver => receiverAllocation(receiver) === receiverAllocation(context.receiver) && receiver.scope === context.receiver.scope)) {
        environment.receivers.push(context.receiver); environment.revision++; valueFactsRevision++
        if (environment.heap) { environment.heap.version++; advanceProofFacts(environment.heap, true) }
      }
      return environment
    }
    let lexicalOwner
    for (let ancestor = target.ast.parent; ancestor; ancestor = ancestor.parent) if (callable(ancestor)) { lexicalOwner = ancestor; break }
    const captured = lexicalOwner ? lexicalScope(lexicalOwner, context?.scope ?? parent) : lexicalScope(target.ast.getSourceFile(), parent)
    let cache
    if (target.ast) {
      context ??= {}
      const callsite = context.call ?? target.ast
      if (!callEnvironments.has(parent)) callEnvironments.set(parent, new WeakMap())
      const byCall = callEnvironments.get(parent)
      if (!byCall.has(callsite)) byCall.set(callsite, new Map())
      cache = byCall.get(callsite)
      const identity = value => { if (!value) return ''; if (!contextIds.has(value)) contextIds.set(value, contextOrdinal++); return contextIds.get(value) }
      const argumentsKey = context.argScopes ? context.args.map((argument, index) => `${identity(argument)}@${identity(context.argScopes[index])}`).join(',') : ''
      const key = `${target.id}:${identity(captured)}:${identity(receiverAllocation(context.receiver))}:${identity(context.receiver?.scope)}:${!!context.unknownArgs}:${context.unknownIndexes?.join(',') ?? ''}:${context.numberIndexes?.join(',') ?? ''}:${argumentsKey}`
      if (cache.has(key)) return cache.get(key)
      context = { ...context, cacheKey: key }
    }
    const environment = new Map()
    if (cache) cache.set(context.cacheKey, environment)
    environment.functionNode = target.ast
    environment.callsite = context?.call
    environment.contextDependencies = new Set([...(parent.contextDependencies ?? []), ...(captured?.contextDependencies ?? []), parent, environment, ...(captured ? [captured] : [])])
    environment.caller = parent
    environment.moduleScopes = parent.moduleScopes
    environment.valueBindings = new Map()
    environment.testFile = parent.testFile
    environment.caseRegistration = parent.caseRegistration
    environment.mockCalls = parent.mockCalls
    environment.globalBindings = parent.globalBindings
    environment.heap = parent.heap
    environment.receiver = ts.isArrowFunction(target.ast) ? captured?.receiver : context?.receiver
    if (ts.isArrowFunction(target.ast) && captured?.receivers) environment.receivers = captured.receivers
    if (lexicalOwner) environment.lexicalParent = captured
    for (let ancestor = target.ast.parent; ancestor; ancestor = ancestor.parent) if (callable(ancestor)) {
      for (const parameter of runtimeParameters(ancestor)) {
        if (captured?.has(parameter)) environment.set(parameter, captured.get(parameter))
        if (captured?.valueBindings?.has(parameter)) environment.valueBindings.set(parameter, captured.valueBindings.get(parameter))
      }
    }
    if (!context?.args) {
      // An opaque invocation can provide arguments. Default parameters only
      // describe an actual omitted/undefined argument, not an unknown caller.
      for (const parameter of runtimeParameters(target.ast)) {
        environment.set(parameter, 'unknown')
        environment.valueBindings.set(parameter, [{ expression: parameter.name, scope: environment }])
      }
      return environment
    }
    let spread = false
    runtimeParameters(target.ast).forEach((parameter, index) => {
      const numeric = !context.unknownArgs && context.numberIndexes?.includes(index)
      const unknown = context.unknownArgs || context.unknownIndexes?.includes(index)
      const argument = unknown || numeric ? parameter.name : context.args[index]
      const argumentScope = unknown || numeric ? environment : argument ? context.argScopes?.[index] ?? parent : environment
      environment.valueBindings.set(parameter, [{ expression: argument ?? parameter.initializer, scope: argumentScope,
        ...(numeric ? { numeric: true } : {}), ...(parameter.dotDotDotToken ? { elements: context.args.slice(index) } : {}) }])
      spread ||= !!argument && ts.isSpreadElement(argument)
      let value = numeric ? 'present' : unknown ? 'unknown' : parameter.dotDotDotToken ? 'present' : spread ? 'unknown' : nullishValue(argument, argumentScope)
      if (value === 'undefined' && parameter.initializer) value = nullishValue(parameter.initializer, environment)
      if (value !== 'unknown' && !mutatedBindings.has(parameter)) environment.set(parameter, value)
    })
    return environment
  }
  function advanceProofFacts(heap, valueAlreadyChanged = false) {
    if (!heap) return
    heap.proofVersion++
    if (heap.hasDynamicFromProof && !valueAlreadyChanged) valueFactsRevision++
  }
  function heapCell(value, kind) {
    const heap = value.scope?.heap, ast = kind === 'records' ? receiverAllocation(value) : value.allocation
    if (!heap || !ast) return null
    if (!heap[kind].has(ast)) heap[kind].set(ast, new WeakMap())
    const scopes = heap[kind].get(ast)
    if (!scopes.has(value.scope)) scopes.set(value.scope, { fields: new Map(), items: [], invalidated: false })
    const cell = scopes.get(value.scope)
    if (valueQuery?.current) (valueQuery.current.heapReads ??= new Set()).add(cell)
    return cell
  }
  function heapBinding(cell, key, binding, heap) {
    if (!cell || !heap) return
    const list = key === null ? cell.items : cell.fields.get(key) ?? []
    if (!list.some(value => value.expression === binding.expression && value.scope === binding.scope)) {
      list.push(binding); if (key !== null) cell.fields.set(key, list); heap.version++; valueFactsRevision++; advanceProofFacts(heap, true); heap.notify?.(cell)
    }
  }
  function unknownArrayLength(value) {
    const cell = heapCell(value, 'arrays'), heap = value.scope?.heap
    if (cell && heap && !cell.lengthUnknown) {
      cell.lengthUnknown = true; heap.version++; valueFactsRevision++; advanceProofFacts(heap, true); heap.notify?.(cell)
    }
  }
  function nestedArrays(values, visited = new Set(), records = null) {
    const arrays = []
    for (const value of values) {
      const allocation = receiverAllocation(value)
      if (!allocation || visited.has(valueKey(value))) continue
      visited.add(valueKey(value))
      if (value.elements) {
        arrays.push(value)
        arrays.push(...nestedArrays(aggregateBindings(value).filter(binding => !ts.isSpreadElement(binding.expression))
          .flatMap(binding => scopedValues(binding.expression, binding.scope)), visited, records))
      } else if (value.record) {
        records?.push(value)
        const expressions = value.record.properties.flatMap(property => ts.isPropertyAssignment(property) ? [property.initializer]
          : ts.isShorthandPropertyAssignment(property) ? [property.name] : ts.isSpreadAssignment(property) ? [property.expression] : [])
        const writes = [...(heapCell(value, 'records')?.fields.values() ?? [])].flat()
        arrays.push(...nestedArrays([...expressions.flatMap(expression => scopedValues(expression, value.scope)),
          ...writes.flatMap(binding => scopedValues(binding.expression, binding.scope))], visited, records))
      }
    }
    return arrays
  }
  function knownAbsentField(value) {
    const field = value.missingOwnField
    return field && field.scope?.heap && (field.nullPrototype || !field.scope.heap.objectIntrinsicExposed && !field.scope.globalBindings?.has('Object'))
      && !heapCell(field, 'records')?.invalidated
      && !field.prototype?.scope?.heap?.objectIntrinsicExposed && (!field.prototype || !heapCell(field.prototype, 'records')?.invalidated)
      && (field.nullPrototype || !['constructor', '__proto__', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'toString', 'valueOf', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'].includes(field.key))
  }
  function knownNonCallable(value) {
    return value.nullish || knownAbsentField(value) || Object.hasOwn(value, 'literalValue')
      || value.record || value.elements || value.instance || value.classValue || value.enumValue || value.mapValue
      || value.prototypeRecord || value.sourcePrototype || value.setBindings || value.promise || value.primitiveType
  }
  function memberReceivers(expression, scope) {
    // A nullish base cannot enter an array/Map method or install an indexed
    // value. Retain possible live receivers separately from that throwing arm;
    // argument/key expressions still have their own reached runtime effects.
    return scopedValues(expression, scope).filter(value => !value.nullish && !knownAbsentField(value))
  }
  function plainSpreadSource(value) {
    if (value.nullish || Object.hasOwn(value, 'literalValue')) return true
    if (!value.record || heapCell(value, 'records')?.invalidated) return false
    return value.record.properties.every(property => ts.isSpreadAssignment(property)
      || (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property) || ts.isMethodDeclaration(property))
        && property.name && !ts.isComputedPropertyName(property.name) && property.name.text !== '__proto__')
  }
  function knownBooleanPredicate(expression, scope) {
    while (expression && (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression))) expression = expression.expression
    return !!expression && implicitCommonJS(expression, 'Boolean') && !!scope?.heap
      && !scope.globalBindings?.has('Boolean') && !scope.heap.intrinsicExposed?.has('Boolean')
  }
  function aggregateBindings(value, visited = new Map()) {
    const cell = heapCell(value, 'arrays')
    if (!value.elements) return []
    const allocation = value.allocation, scope = value.scope
    if (allocation && visited.get(allocation)?.has(scope)) return [{ expression: allocation, scope, recursiveSpread: true }]
    const next = new Map(visited)
    if (allocation) next.set(allocation, new Set([...(next.get(allocation) ?? []), scope]))
    const bindings = [...value.elements.map(expression => ({ expression, scope })), ...(value.elementBindings ?? []), ...(cell?.items ?? [])]
    return bindings.flatMap(binding => {
      if (!ts.isSpreadElement(binding.expression)) return [binding]
      const sources = scopedValues(binding.expression.expression, binding.scope)
      if (!sources.length || sources.some(source => source.setBindings ? source.scope?.heap?.intrinsicExposed?.has('Set') || source.scope?.globalBindings?.has('Set')
        : !source.elements || source.scope?.heap?.arrayIntrinsicExposed || heapCell(source, 'arrays')?.invalidated || heapCell(source, 'arrays')?.unresolvedEscape)) return [binding]
      const flattened = sources.flatMap(source => source.setBindings ?? aggregateBindings(source, next))
      return flattened.some(item => item.recursiveSpread) ? [binding] : flattened
    })
  }
  function finiteSpreadBindings(expression, scope) {
    if (!scope.heap || scope.heap.arrayIntrinsicExposed || scope.heap.intrinsicExposed?.has('Array') || scope.globalBindings?.has('Array')) return null
    const inputs = scopedValues(expression, scope)
    if (!inputs.length) return null
    const result = []
    for (const input of inputs) {
      if (input.setBindings) {
        if (input.scope?.heap?.intrinsicExposed?.has('Set') || input.scope?.globalBindings?.has('Set')) return null
        result.push(...input.setBindings)
      } else {
        const cell = input.elements && heapCell(input, 'arrays')
        if (!input.elements || cell?.invalidated || cell?.unresolvedEscape) return null
        result.push(...aggregateBindings(input))
      }
    }
    return result.some(binding => binding.recursiveSpread || ts.isSpreadElement(binding.expression)) ? null : result
  }
  function emptyNativeReduction(call, scope) {
    if (!scope.heap || !ts.isPropertyAccessExpression(call.expression) || !['reduce', 'reduceRight'].includes(call.expression.name.text)
      || scope.heap?.arrayIntrinsicExposed || scope.heap?.intrinsicExposed?.has('Array') || scope.globalBindings?.has('Array')) return false
    const receivers = scopedValues(call.expression.expression, scope)
    return !!receivers.length && receivers.every(receiver => {
      const cell = receiver.elements && heapCell(receiver, 'arrays')
      return receiver.elements && !cell?.invalidated && !cell?.unresolvedEscape && !aggregateBindings(receiver).length
    })
  }
  function strictCallable(fn) {
    for (let node = fn; node; node = node.parent) {
      if (ts.isClassLike(node)) return true
      const body = ts.isSourceFile(node) ? node : node.body
      if (body && (ts.isSourceFile(body) || ts.isBlock(body))) for (const statement of body.statements) {
        if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break
        if (statement.expression.text === 'use strict') return true
      }
      if (ts.isSourceFile(node)) return !!node.externalModuleIndicator
    }
    return false
  }
  function adapterInvocationFacts(input, call, scope, query = scopedValues) {
    const result = { calls: [], bound: [], unresolved: false }
    const directArguments = nodes => nodes.some(ts.isSpreadElement) ? null : nodes.map(expression => ({ expression, scope }))
    let target = input, receiver, argumentsList
    if (input.functionAdapter) {
      const adapter = input.functionAdapter
      target = adapter.target
      if (adapter.name === 'apply') {
        const values = call.arguments[1] ? query(call.arguments[1], scope) : [{ nullish: 'undefined' }]
        argumentsList = []
        for (const value of values) {
          if (value.nullish) { argumentsList.push([]); continue }
          if (!value.elements || value.scope?.heap?.arrayIntrinsicExposed || value.scope?.globalBindings?.has('Array') || heapCell(value, 'arrays')?.invalidated) { result.unresolved = true; continue }
          const bindings = aggregateBindings(value)
          if (bindings.some(binding => ts.isSpreadElement(binding.expression) || binding.recursiveSpread)) result.unresolved = true
          else argumentsList.push(bindings)
        }
        if (!values.length) return result
      } else {
        const bindings = directArguments([...call.arguments].slice(1))
        if (!bindings) result.unresolved = true
        argumentsList = bindings ? [bindings] : []
      }
      const receivers = call.arguments[0] ? query(call.arguments[0], scope) : [{ nullish: 'undefined' }]
      if (!receivers.length) return result
      for (const explicit of receivers) for (const arguments_ of argumentsList) {
        const prior = target.boundCallable
        const original = prior?.target ?? target
        if (!original.callable) { result.unresolved = true; continue }
        const actualReceiver = prior ? prior.receiver : explicit.nullish && !strictCallable(original.callable) ? { unknown: true } : explicit
        const bindings = [...(prior?.arguments ?? []), ...arguments_]
        if (adapter.name === 'bind') result.bound.push({ boundCallable: { target: original, receiver: actualReceiver, arguments: bindings }, allocation: call, scope })
        else result.calls.push({ target: original, receiver: actualReceiver, bindings })
      }
      return result
    }
    if (input.boundCallable) {
      const bindings = directArguments([...call.arguments])
      if (!bindings) result.unresolved = true
      else result.calls.push({ target: input.boundCallable.target, receiver: input.boundCallable.receiver, bindings: [...input.boundCallable.arguments, ...bindings] })
    }
    return result
  }
  function mockValue(expression, scope) {
    if (!expression || !scope.testFile) return null
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) return mockValue(expression.expression, scope)
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
      && ['mockImplementation', 'mockImplementationOnce', 'mockReturnValue', 'mockReturnValueOnce', 'mockResolvedValue', 'mockResolvedValueOnce', 'mockRejectedValue', 'mockRejectedValueOnce'].includes(expression.expression.name.text)) {
      return mockValue(expression.expression.expression, scope)
    }
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && emptyMockReceiver(expression.expression.expression)) {
      if (expression.expression.name.text === 'mocked' && expression.arguments.length === 1) return mockValue(expression.arguments[0], scope)
      if (expression.expression.name.text === 'fn' && expression.arguments.length <= 1 && (!expression.arguments.length || callable(origin(expression.arguments[0])))) {
        return { mock: { allocation: expression, callbacks: expression.arguments.length ? [origin(expression.arguments[0])] : [], scope }, scope }
      }
    }
    if (!mockCandidates.some(candidate => candidate.file === scope.testFile && candidate.mode === 'replacement')) return null
    let base = expression, path = []
    while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) {
      const keys = ts.isPropertyAccessExpression(base) ? [base.name.text] : literalKeys(base.argumentExpression)
      if (keys?.length !== 1) return null
      path.unshift(keys[0]); base = base.expression
    }
    const provider = providerOf(base)
    if (!provider) return null
    if (provider.export !== '*') path.unshift(provider.export)
    const key = JSON.stringify(path)
    const candidate = mockCandidates.find(candidate => candidate.file === scope.testFile && candidate.mode === 'replacement'
      && (candidate.target ? candidate.target === providerTarget(provider, base) : providerName(provider) === providerName({ module: candidate.provider })) && candidate.configurations?.has(key))
    return candidate ? { mock: { allocation: candidate.factory, candidate, key }, scope } : null
  }
  function mockRecords(mock, scope, call) {
    const current = scope.caseRegistration, info = files.get(scope.testFile)
    const frameOf = node => { for (let parent = node?.parent; parent; parent = parent.parent) if (callable(parent)) return parent; return null }
    const registration = node => node.getSourceFile() === info.sf ? info.registrations.filter(registration => registration.pos <= node.pos && node.end <= registration.end)
      .sort((a, b) => (a.end - a.pos) - (b.end - b.pos))[0] : null
    const records = (mock.candidate.configurationRecords.get(mock.key) ?? []).filter(record => {
      const owner = registration(record.call)
      return !current || !owner || owner.pos <= current.pos
    })
    const frame = current?.arguments.find(callable)
    if (!frame) return records
    let point = frameOf(call) === frame ? call : null
    const visited = new Set()
    for (let parent = scope; !point && parent && !visited.has(parent); parent = parent.caller) {
      visited.add(parent)
      if (frameOf(parent.callsite) === frame) point = parent.callsite
    }
    if (!point) return records
    const unconditional = record => {
      if (frameOf(record.call) !== frame) return false
      for (let parent = record.call.parent; parent && parent !== frame; parent = parent.parent) {
        if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent) || ts.isIterationStatement(parent, false) || ts.isTryStatement(parent) || ts.isSwitchStatement(parent)
          || parent.questionDotToken || ts.isBinaryExpression(parent) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind)) return false
      }
      return true
    }
    const possible = records.filter(record => !unconditional(record) || record.call.getStart() < point.getStart())
    const latest = possible.filter(record => !record.once && unconditional(record)).sort((a, b) => a.call.getStart() - b.call.getStart()).at(-1)
    if (!latest) return possible
    // A definite default configuration in this activation replaces older
    // defaults, including an earlier callback or a resolved-value setting.
    // Once queues and helper configurations with unknown ordering stay possible.
    return possible.filter(record => record.once || record === latest || !unconditional(record) && (!registration(record.call) || registration(record.call) === current))
  }
  function mockCallbacks(mock, scope, call) {
    if (!mock.candidate) return mock.callbacks
    return mockRecords(mock, scope, call).flatMap(record => record.callback ? [record.callback] : [])
  }
  function localMockConfigSelection(mock, scope, call) {
    const frame = scope.caseRegistration?.arguments.find(callable)
    const frameOf = node => { for (let parent = node?.parent; parent; parent = parent.parent) if (callable(parent)) return parent; return null }
    const anchor = (environment, site) => {
      if (!frame) return null
      if (frameOf(site) === frame) return site
      const visited = new Set()
      for (let current = environment; current && !visited.has(current); current = current.caller) {
        visited.add(current)
        if (frameOf(current.callsite) === frame) return current.callsite
      }
      return null
    }
    const unconditional = site => {
      if (!frame || frameOf(site) !== frame) return false
      for (let parent = site.parent; parent && parent !== frame; parent = parent.parent) if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent)
        || ts.isIterationStatement(parent, false) || ts.isTryStatement(parent) || ts.isSwitchStatement(parent)
        || ts.isBinaryExpression(parent) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind)) return false
      return true
    }
    const afterHook = site => {
      for (let node = site?.parent; node; node = node.parent) if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && ['afterEach', 'afterAll', 'after'].includes(node.expression.text)) {
        const provider = providerOf(node.expression), binding = bindingDeclaration(node.expression)
        if (['vitest', 'node:test'].includes(provider?.module) || !binding || !sources.has(binding.getSourceFile().fileName)) return node
      }
      return null
    }
    const invokedWithin = (environment, site, hookCall) => {
      const hookBody = hookCall?.arguments.find(callable)
      if (!hookBody) return false
      if (frameOf(site) === hookBody) return true
      const visited = new Set()
      for (let current = environment; current && !visited.has(current); current = current.caller) {
        visited.add(current)
        if (current.functionNode === hookBody || frameOf(current.callsite) === hookBody) return true
      }
      return false
    }
    const point = anchor(scope, call)
    const events = (scope.heap?.localMockEvents ?? []).filter(event => event.all || event.mock.allocation === mock.allocation && event.mock.scope === mock.scope).filter(event => {
      const hookCall = afterHook(event.call)
      if (hookCall && !invokedWithin(scope, call, hookCall)) return false
      const position = anchor(event.scope, event.call)
      return !point || !position || !unconditional(event.call) || position.getStart() < point.getStart()
    })
    const definite = events.filter(event => point && unconditional(event.call) && event.call.getStart() < point.getStart() && !event.method.endsWith('Once'))
      .sort((a, b) => a.call.getStart() - b.call.getStart()).at(-1)
    return { definite, possible: events.filter(event => event.method.endsWith('Once') || event === definite || !unconditional(event.call)) }
  }
  function valueKey(value) {
    const id = item => item ? contextKey(item) : ''
    if (value.unknown) return '?'
    if (Object.hasOwn(value, 'literalValue')) return `literal:${typeof value.literalValue}:${JSON.stringify(value.literalValue)}`
    if (value.nullish) return value.nullish
    if (value.missingOwnField) return `missing:${id(receiverAllocation(value.missingOwnField))}:${id(value.missingOwnField.scope)}:${value.missingOwnField.key}`
    if (value.classValue) return `class:${id(value.classValue)}:${id(value.scope)}`
    if (value.enumValue) return `enum:${id(value.enumValue)}:${id(value.scope)}`
    if (value.sourcePrototype) return `prototype:${id(value.sourcePrototype)}:${id(value.scope)}`
    if (value.prototypeRecord) return `created:${id(value.allocation)}:${id(value.scope)}:${value.prototype ? valueKey(value.prototype) : 'null'}:${[...(value.ownFields ?? [])].map(([key, field]) => `${key}:${id(field.expression)}:${id(field.scope)}`).sort().join('|')}`
    if (value.record) return `record:${id(value.record)}:${id(value.scope)}`
    if (value.instance) return `instance:${id(value.instance)}:${id(value.allocation)}:${id(value.scope)}`
    if (value.callable) return `callable:${id(value.callable)}:${id(value.scope)}:${id(receiverAllocation(value.receiver))}:${id(value.receiver?.scope)}`
    if (value.elements) return `array:${id(value.allocation)}:${id(value.scope)}:${value.elements.map(id).join(',')}:${(value.elementBindings ?? []).map(binding => `${id(binding.expression)}:${id(binding.scope)}`).join(',')}`
    if (value.setBindings) return `set:${id(value.allocation)}:${id(value.scope)}:${value.setBindings.map(binding => `${id(binding.expression)}:${id(binding.scope)}`).join(',')}`
    if (value.mapValue) return `map:${id(value.allocation)}:${id(value.scope)}`
    if (value.mapMethod) return `map-method:${value.mapMethod.name}:${valueKey(value.mapMethod.receiver)}`
    if (value.functionAdapter) return `function-adapter:${value.functionAdapter.name}:${valueKey(value.functionAdapter.target)}`
    if (value.boundCallable) return `bound:${id(value.allocation)}:${id(value.scope)}:${valueKey(value.boundCallable.target)}`
    if (value.primitiveType) return `primitive:${value.primitiveType}`
    if (value.promise) return `promise:${value.promise.map(valueKey).sort().join('|')}`
    for (const key of ['mock', 'mockLog', 'callLog', 'pendingMockLog']) if (value[key]) {
      const mock = value[key]
      return `${key}:${id(mock.candidate ?? mock.allocation)}:${mock.key ?? ''}:${id(value.scope)}`
    }
    return '?'
  }
  function valueUnion(values) {
    const result = new Map(), promised = new Map()
    const add = value => {
      if (value.promise) { for (const item of value.promise) { if (item.promise) add(item); else promised.set(valueKey(item), item) } }
      else result.set(valueKey(value), value)
    }
    values.forEach(add)
    if (promised.size) result.set('promise', { promise: [...promised.values()] })
    return [...result.values()]
  }
  function scopedValues(expression, scope) {
    if (!expression) return []
    if (!scope) return [{ unknown: true }]
    // Literal identity and closure allocation depend only on this immutable
    // source node and activation. They cannot change when unrelated heap cells
    // or mock-call records advance the shared facts revision.
    if (ts.isStringLiteralLike(expression)) return [{ literalValue: expression.text }]
    if (ts.isNumericLiteral(expression)) return [{ literalValue: Number(expression.text) }]
    if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) return [{ literalValue: expression.kind === ts.SyntaxKind.TrueKeyword }]
    if (expression.kind === ts.SyntaxKind.NullKeyword) return [{ nullish: 'null' }]
    if (ts.isVoidExpression(expression)) return [{ nullish: 'undefined' }]
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)
      || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) return scopedValues(expression.expression, scope)
    if (callable(expression)) return [{ callable: expression, scope }]
    if (ts.isObjectLiteralExpression(expression)) return [{ record: expression, scope }]
    if (ts.isArrayLiteralExpression(expression)) return [{ elements: [...expression.elements], allocation: expression, scope }]
    const cellFor = (node, environment) => {
      if (!valueCache.has(environment)) valueCache.set(environment, new WeakMap())
      const expressions = valueCache.get(environment)
      if (!expressions.has(node)) {
        const cell = { expression: node, scope: environment, values: [], dependencies: new Set(), parents: new Set(), evaluated: false, settled: false }
        expressions.set(node, cell)
      }
      return expressions.get(node)
    }
    const schedule = cell => {
      valueQuery.cells.add(cell)
      if (!valueQuery.queued.has(cell)) { valueQuery.queued.add(cell); valueQuery.queue.push(cell) }
    }
    if (valueQuery) {
      const cell = cellFor(expression, scope), parent = valueQuery.current
      if (parent) { parent.dependencies.add(cell); cell.parents.add(parent) }
      if (!cell.evaluated) schedule(cell)
      if (!cell.values.length) valueQuery.pending++
      return [...cell.values]
    }
    // Source/receiver identity is immutable. Parameter, call-log and heap facts
    // are not: only a complete fixed point for their current revision is reused.
    for (;;) {
      if (valueCacheRevision !== valueFactsRevision) {
        valueCache = new WeakMap(); valueCacheRevision = valueFactsRevision
      }
      const root = cellFor(expression, scope)
      if (root.settled) { reportHeapReads(root); return root.values.length ? [...root.values] : [{ unknown: true }] }
      const revision = valueFactsRevision
      valueQuery = { queue: [], queued: new Set(), cells: new Set(), current: null, pending: 0 }
      schedule(root)
      let cursor = 0
      for (;;) {
        while (cursor < valueQuery.queue.length && valueFactsRevision === revision) {
          const cell = valueQuery.queue[cursor++]
          valueQuery.queued.delete(cell)
          for (const child of cell.dependencies) child.parents.delete(cell)
          cell.dependencies.clear()
          cell.heapReads = new Set()
          valueQuery.current = cell
          cell.evaluated = true
          let values
          try { values = scopedValuesBody(cell.expression, cell.scope) }
          catch (error) { valueQuery = null; valueCacheRevision = -1; throw error }
          const joined = valueUnion([...cell.values, ...values])
          const before = cell.values.map(valueKey).sort().join('\0'), after = joined.map(valueKey).sort().join('\0')
          cell.values = joined
          if (before !== after) for (const parent of cell.parents) schedule(parent)
        }
        if (valueFactsRevision !== revision) break
        // An ungrounded cycle/implicit return is unknown, not a proof that no
        // callable or effect exists. Propagate that frontier to its consumers.
        let filledUnknown = false
        for (const cell of valueQuery.cells) if (!cell.settled && !cell.values.length) {
          cell.values = [{ unknown: true }]
          filledUnknown = true
          for (const parent of cell.parents) schedule(parent)
        }
        if (!filledUnknown || cursor === valueQuery.queue.length) break
      }
      const completed = valueQuery.cells
      valueQuery = null
      if (valueFactsRevision !== revision) continue
      // Earlier fixed points already settled their cells for this revision.
      // Visiting the entire cache again makes independent queries quadratic.
      for (const cell of completed) cell.settled = true
      reportHeapReads(root)
      return root.values.length ? [...root.values] : [{ unknown: true }]
    }
  }
  const returnExpressions = new WeakMap(), constructorWrites = new WeakMap()
  function sourceReturns(fn) {
    if (returnExpressions.has(fn)) return returnExpressions.get(fn)
    const returns = []
    const collect = node => {
      if (node !== fn.body && callable(node)) return
      if (ts.isReturnStatement(node)) returns.push(node.expression)
      else ts.forEachChild(node, collect)
    }
    if (ts.isBlock(fn.body)) collect(fn.body)
    else returns.push(fn.body)
    returnExpressions.set(fn, returns)
    return returns
  }
  function sourceConstructorWrites(constructor, key) {
    if (!constructor?.body) return []
    if (!constructorWrites.has(constructor)) {
      const fields = new Map()
      const inspect = node => {
        if (node !== constructor.body && callable(node)) return
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)
          && node.left.expression.kind === ts.SyntaxKind.ThisKeyword) {
          const name = node.left.name.text
          if (!fields.has(name)) fields.set(name, [])
          fields.get(name).push(node.right)
        } else ts.forEachChild(node, inspect)
      }
      inspect(constructor.body); constructorWrites.set(constructor, fields)
    }
    return constructorWrites.get(constructor).get(key) ?? []
  }
  function scopedValuesBody(expression, scope, visiting = new Map()) {
    const unknown = () => [{ unknown: true }]
    if (!expression) return []
    let seen = visiting.get(scope)
    if (seen?.has(expression)) return unknown()
    const next = new Map(visiting); next.set(scope, new Set(seen ?? []).add(expression))
    next.returning = visiting.returning ?? new Set()
    next.parameters = new Set(visiting.parameters ?? [])
    const value = (node, environment = scope) => scopedValues(node, environment, next)
    const mocked = mockValue(expression, scope)
    if (mocked) return [mocked]
    if (ts.isStringLiteralLike(expression)) return [{ literalValue: expression.text }]
    if (ts.isNumericLiteral(expression)) return [{ literalValue: Number(expression.text) }]
    if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) return [{ literalValue: expression.kind === ts.SyntaxKind.TrueKeyword }]
    if (expression.kind === ts.SyntaxKind.NullKeyword) return [{ nullish: 'null' }]
    if (ts.isVoidExpression(expression)) return [{ nullish: 'undefined' }]
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)
      || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) return value(expression.expression)
    if (expression.kind === ts.SyntaxKind.ThisKeyword) return scope.receivers?.length ? scope.receivers : scope.receiver ? [scope.receiver] : unknown()
    if (callable(expression)) return [{ callable: expression, scope }]
    if (ts.isObjectLiteralExpression(expression)) return [{ record: expression, scope }]
    if (ts.isArrayLiteralExpression(expression)) return [{ elements: [...expression.elements], allocation: expression, scope }]
    if (ts.isNewExpression(expression)) {
      if (implicitCommonJS(expression.expression, 'Map') && (expression.arguments?.length ?? 0) <= 1 && scope.heap
        && !scope.heap.intrinsicExposed?.has('Map') && !scope.globalBindings?.has('Map')) {
        if (!expression.arguments?.length) return [{ mapValue: true, allocation: expression, scope }]
        if (scope.heap.arrayIntrinsicExposed || scope.heap.objectIntrinsicExposed || scope.globalBindings?.has('Array') || scope.globalBindings?.has('Object')) return unknown()
        const inputs = value(expression.arguments[0])
        if (!inputs.length) return []
        return inputs.flatMap(input => {
          if (!input.elements || heapCell(input, 'arrays')?.invalidated || heapCell(input, 'arrays')?.unresolvedEscape) return unknown()
          const pending = valueQuery?.pending, bindings = aggregateBindings(input)
          if (bindings.some(binding => ts.isSpreadElement(binding.expression))) return valueQuery && valueQuery.pending !== pending ? [] : unknown()
          const entries = []
          for (const binding of bindings) {
            const pairs = value(binding.expression, binding.scope)
            if (!pairs.length) return []
            for (const pair of pairs) {
              const cell = pair.elements && heapCell(pair, 'arrays')
              if (!pair.elements || pair.elements.length < 2 || pair.elementBindings?.length || cell?.items.length || cell?.invalidated || pair.elements.some(ts.isSpreadElement)) return unknown()
              entries.push({ key: pair.elements[0], expression: pair.elements[1], scope: pair.scope })
            }
          }
          return [{ mapValue: true, initialMapEntries: entries, allocation: expression, scope }]
        })
      }
      if (implicitCommonJS(expression.expression, 'Set') && expression.arguments?.length === 1
        && inlineSetConsumer(expression)
        && scope.heap && !scope.heap.intrinsicExposed?.has('Set') && !scope.globalBindings?.has('Set')
        && !scope.heap?.arrayIntrinsicExposed && !scope.globalBindings?.has('Array')) {
        const inputs = value(expression.arguments[0])
        if (!inputs.length) return []
        return inputs.flatMap(input => {
          if (!input.elements || heapCell(input, 'arrays')?.invalidated || heapCell(input, 'arrays')?.unresolvedEscape) return unknown()
          const pending = valueQuery?.pending, bindings = aggregateBindings(input)
          if (bindings.some(binding => ts.isSpreadElement(binding.expression))) return valueQuery && valueQuery.pending !== pending ? [] : unknown()
          return [{ setBindings: bindings, allocation: expression, scope }]
        })
      }
      const declarations = checker.getTypeAtLocation(expression.expression).symbol?.declarations ?? []
      return declarations.flatMap(declaration => {
        if (!ts.isClassDeclaration(declaration) || !sources.has(declaration.getSourceFile().fileName)
          || declaration.heritageClauses?.length || ts.getDecorators(declaration)?.length
          || mutatedBindings.has(declaration) || mutatedObjectBindings.has(declaration)) return unknown()
        const constructor = declaration.members.find(ts.isConstructorDeclaration)
        if (declaration.members.some(member => ts.isClassStaticBlockDeclaration(member)
          || ts.canHaveDecorators(member) && ts.getDecorators(member)?.length
          || ts.isConstructorDeclaration(member) && member.parameters.some(parameter => ts.canHaveDecorators(parameter) && ts.getDecorators(parameter)?.length))
          || !constructor && declaration.members.some(member => ts.isPropertyDeclaration(member) && member.initializer
            && !member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword))) return unknown()
        let override = false
        const inspectReturn = node => {
          if (node !== constructor?.body && callable(node)) return
          if (ts.isReturnStatement(node) && node.expression) override = true
          else ts.forEachChild(node, inspectReturn)
        }
        if (constructor?.body) inspectReturn(constructor.body)
        if (override) return unknown()
        return [{ instance: declaration, allocation: expression, scope }]
      }).concat(declarations.length ? [] : unknown())
    }
    if (ts.isAwaitExpression(expression)) return value(expression.expression).flatMap(result => result.promise ?? [result])
    if (ts.isConditionalExpression(expression)) {
      const pending = valueQuery?.pending
      const condition = truthValue(expression.condition, scope)
      if (condition === undefined && valueQuery && valueQuery.pending !== pending) return []
      return condition === true ? value(expression.whenTrue) : condition === false ? value(expression.whenFalse) : [...value(expression.whenTrue), ...value(expression.whenFalse)]
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      const pending = valueQuery?.pending, left = value(expression.left)
      if (!left.length || valueQuery && valueQuery.pending !== pending) return []
      const isNullish = item => item.nullish || knownAbsentField(item)
      const isPresent = item => Object.hasOwn(item, 'literalValue') || item.record || item.instance || item.classValue || item.enumValue
        || item.prototypeRecord || item.sourcePrototype || item.callable || item.elements || item.mock || item.promise || item.primitiveType || item.mapValue || item.boundCallable || item.functionAdapter
      const result = left.filter(item => !isNullish(item))
      return left.some(item => isNullish(item) || !isPresent(item)) ? [...result, ...value(expression.right)] : result
    }
    if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(expression.operatorToken.kind)) {
      const pending = valueQuery?.pending, left = value(expression.left), condition = truthValue(expression.left, scope)
      if (!left.length || condition === undefined && valueQuery && valueQuery.pending !== pending) return []
      const and = expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      return condition === undefined ? [...left, ...value(expression.right)] : condition === and ? value(expression.right) : left
    }
    if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(expression.operatorToken.kind)) {
      const left = value(expression.left), right = value(expression.right)
      if (!left.length || !right.length) return []
      const primitive = input => Object.hasOwn(input, 'literalValue') || input.nullish || knownAbsentField(input)
      if (![...left, ...right].every(primitive)) return unknown()
      const scalar = input => input.nullish === 'null' ? null : input.nullish || knownAbsentField(input) ? undefined : input.literalValue
      return left.flatMap(a => right.map(b => ({ literalValue: expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ? scalar(a) === scalar(b) : scalar(a) !== scalar(b) })))
    }
    if (ts.isBinaryExpression(expression) && (numericBinaryOperators.has(expression.operatorToken.kind)
      || supportedCompoundOperators.has(expression.operatorToken.kind))) {
      const left = value(expression.left), right = value(expression.right)
      if (!left.length || !right.length) return []
      // A numeric result keeps its type, not the RHS literal of a compound
      // write. Widening avoids an ever-growing value set through repeated
      // updates; nonnumeric operands retain an unresolved coercion boundary.
      return [...left, ...right].every(numberValue) ? [{ primitiveType: 'number' }] : unknown()
    }
    if (ts.isIdentifier(expression)) {
      let declaration = bindingDeclaration(expression), symbol = symbolAtLocation(expression)
      if (symbol?.flags & ts.SymbolFlags.Alias && !ts.isBindingElement(declaration ?? {})) declaration = checker.getAliasedSymbol(symbol).valueDeclaration
      const definingScope = declarationScope(declaration, scope)
      if (!definingScope) return unknown()
      if (definingScope !== scope) return value(expression, definingScope)
      if ((!declaration || !sources.has(declaration.getSourceFile().fileName)) && scope.globalBindings?.has(expression.text)) return scope.globalBindings.get(expression.text).flatMap(binding => value(binding.expression, binding.scope))
      if (declaration && scope.valueBindings?.has(declaration)) {
        if (mutatedBindings.has(declaration) || next.parameters.has(declaration)) return unknown()
        next.parameters.add(declaration)
        return scope.valueBindings.get(declaration).flatMap(binding => binding.numeric ? [{ primitiveType: 'number' }] : binding.elements ? [{ elements: binding.elements, allocation: declaration, scope: binding.scope }]
          : binding.expression ? value(binding.expression, binding.scope) : [{ nullish: 'undefined' }])
      }
      if (declaration && ts.isBindingElement(declaration)) {
        const parent = declaration.parent.parent, key = ts.isArrayBindingPattern(declaration.parent) ? String(declaration.parent.elements.indexOf(declaration)) : (declaration.propertyName ?? declaration.name).text
        const exported = parent.initializer && nodes.get(commonjs.get(requiredModule(parent.initializer))?.get(key))?.ast
        if (exported && ts.isShorthandPropertyAssignment(exported)) {
          const target = checker.getShorthandAssignmentValueSymbol(exported)?.valueDeclaration
          return target && callable(target) ? [{ callable: target, scope }] : target?.initializer ? value(target.initializer) : unknown()
        }
        if (exported && ts.isPropertyAssignment(exported)) return value(exported.initializer)
        if (exported && ts.isBinaryExpression(exported)) return value(exported.right)
        const loop = ts.isVariableDeclaration(parent) && ts.isVariableDeclarationList(parent.parent) && ts.isForOfStatement(parent.parent.parent)
          ? parent.parent.parent : null
        let inputs
        if (ts.isParameter(parent) && scope.valueBindings?.has(parent)) inputs = scope.valueBindings.get(parent).flatMap(binding => value(binding.expression, binding.scope))
        else if (parent.initializer) inputs = value(parent.initializer)
        else if (loop && !loop.awaitModifier && !scope.heap?.arrayIntrinsicExposed && !scope.globalBindings?.has('Array')) {
          inputs = value(loop.expression).flatMap(input => {
            if (!input.elements || heapCell(input, 'arrays')?.invalidated) return unknown()
            const bindings = aggregateBindings(input)
            if (bindings.some(binding => ts.isSpreadElement(binding.expression) || binding.recursiveSpread)) return unknown()
            return bindings.flatMap(binding => value(binding.expression, binding.scope))
          })
        } else inputs = unknown()
        const projected = project(inputs, [key])
        if (!declaration.initializer) return projected
        const mayDefault = projected.some(result => result.unknown || result.nullish === 'undefined' || knownAbsentField(result))
        return [...projected.filter(result => result.nullish !== 'undefined' && !knownAbsentField(result)), ...(mayDefault ? value(declaration.initializer) : [])]
      }
      if (declaration && ts.isEnumDeclaration(declaration)) {
        return mutatedBindings.has(declaration) || mutatedObjectBindings.has(declaration) ? unknown() : [{ enumValue: declaration, allocation: declaration, scope }]
      }
      if (declaration && ts.isClassDeclaration(declaration)) {
        if (declaration.heritageClauses?.some(clause => clause.token === ts.SyntaxKind.ExtendsKeyword) || ts.getDecorators(declaration)?.length
          || mutatedBindings.has(declaration) || declaration.members.some(member => member.name && ts.isComputedPropertyName(member.name))) return unknown()
        return [{ classValue: declaration, allocation: declaration, scope }]
      }
      if (declaration && callable(declaration)) return [{ callable: declaration, scope }]
      if (declaration && ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent)
        && (declaration.parent.flags & ts.NodeFlags.Const) && ts.isForOfStatement(declaration.parent.parent)) {
        const loop = declaration.parent.parent
        if (loop.awaitModifier) return unknown()
        return value(loop.expression).flatMap(input => {
          if (input.setBindings) {
            if (input.scope?.heap?.intrinsicExposed?.has('Set') || input.scope?.globalBindings?.has('Set')) return unknown()
            return input.setBindings.flatMap(binding => value(binding.expression, binding.scope))
          }
          if (!input.elements || input.scope?.heap?.arrayIntrinsicExposed || heapCell(input, 'arrays')?.invalidated) return unknown()
          const pending = valueQuery?.pending, bindings = aggregateBindings(input)
          if (bindings.some(binding => ts.isSpreadElement(binding.expression))) return valueQuery && valueQuery.pending !== pending ? [] : unknown()
          return bindings.flatMap(binding => value(binding.expression, binding.scope))
        })
      }
      if (declaration?.initializer && !mutatedBindings.has(declaration)) return value(declaration.initializer)
      const loopValues = declaration && finiteNumericLoopValues(declaration)
      if (loopValues?.length) return loopValues.map(literalValue => ({ literalValue }))
      if (declaration && numericInduction(declaration)) return [{ primitiveType: 'number' }]
      if (declaration && ts.isVariableDeclaration(declaration) && !unsupportedBindingWrites.has(declaration) && scope.heap?.bindingWrites) {
        const owner = declarationScope(declaration, scope)
        if (!owner) return unknown()
        const readers = scope.heap.bindingValueReaders
        if (!readers.has(declaration)) readers.set(declaration, new Set())
        readers.get(declaration).add(owner)
        heapCell({ allocation: declaration, scope: owner }, 'records')
        const writes = (scope.heap.bindingWrites.get(declaration) ?? []).filter(write => declarationScope(declaration, write.scope) === owner)
        return [...(declaration.initializer ? value(declaration.initializer, owner) : [{ nullish: 'undefined' }]), ...writes.flatMap(write => value(write.expression, write.scope))]
      }
      if (expression.text === 'undefined' && (!declaration || !sources.has(declaration.getSourceFile().fileName))) return [{ nullish: 'undefined' }]
      return unknown()
    }
    function project(receivers, keys) {
      if (!keys) return unknown()
      const completed = new Map(), active = new Set()
      const identity = (receiver, key) => `${valueKey(receiver)}:${JSON.stringify(key)}`
      const resolve = (receiver, key) => {
        const id = identity(receiver, key)
        if (completed.has(id)) return completed.get(id)
        const stack = [{ id, iterator: projectMember(receiver, key) }]
        active.add(id)
        while (stack.length) {
          const frame = stack.at(-1), step = frame.iterator.next(frame.input)
          frame.input = undefined
          if (step.done) {
            completed.set(frame.id, step.value); active.delete(frame.id); stack.pop()
            if (!stack.length) return step.value
            stack.at(-1).input = step.value
            continue
          }
          const next = step.value, child = identity(next.receiver, next.key)
          if (completed.has(child)) frame.input = completed.get(child)
          else if (active.has(child)) frame.input = unknown()
          else {
            active.add(child)
            stack.push({ id: child, iterator: projectMember(next.receiver, next.key) })
          }
        }
        return []
      }
      // Spread/prototype chains can be deep. Keep the same member precedence
      // and cycle frontier with an explicit stack instead of the JS call stack.
      return receivers.flatMap(receiver => keys.flatMap(key => resolve(receiver, key)))
    }
    function* projectMember(receiver, key) {
      if (receiver.nullish || knownAbsentField(receiver)) return expression.questionDotToken ? [{ nullish: 'undefined' }] : []
      if (receiver.enumValue) {
        const cell = heapCell(receiver, 'records')
        if (cell?.invalidated) return unknown()
        const writes = (cell?.fields.get(key) ?? []).flatMap(binding => value(binding.expression, binding.scope))
        const member = receiver.enumValue.members.find(member => !ts.isComputedPropertyName(member.name) && member.name.text === key)
        const constant = member && checker.getConstantValue(member)
        return [...writes, ...(constant !== undefined ? [{ literalValue: constant }] : member?.initializer ? value(member.initializer, receiver.scope) : unknown())]
      }
      if (receiver.classValue) {
        const cell = heapCell(receiver, 'records')
        if (cell?.invalidated) return unknown()
        const writes = (cell?.fields.get(key) ?? []).flatMap(binding => value(binding.expression, binding.scope))
        const members = receiver.classValue.members.filter(member => member.name && !ts.isComputedPropertyName(member.name)
          && member.name.text === key && member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword))
        if (members.some(member => ts.isGetAccessor(member) || ts.isSetAccessor(member))) return [...writes, ...unknown()]
        const method = members.find(member => ts.isMethodDeclaration(member) && member.body)
        return [...writes, ...(method ? [{ callable: method, scope: receiver.scope, receiver }] : unknown())]
      }
      if (receiver.prototypeRecord || receiver.sourcePrototype) {
        const cell = heapCell(receiver, 'records')
        if (cell?.invalidated) return unknown()
        const writes = (cell?.fields.get(key) ?? []).flatMap(binding => value(binding.expression, binding.scope))
        const missing = () => [{ missingOwnField: { allocation: receiverAllocation(receiver), scope: receiver.scope, key,
          ...(receiver.prototypeRecord ? { prototype: receiver.prototype, nullPrototype: !receiver.prototype && !receiver.ordinaryPrototype } : {}) } }]
        if (receiver.prototypeRecord) {
          const own = receiver.ownFields?.get(key)
          if (own) return [...writes, ...value(own.expression, own.scope).map(result => result.callable && ts.isMethodDeclaration(own.expression) && !own.unbound ? { ...result, receiver } : result)]
          const inherited = receiver.prototype ? (yield { receiver: receiver.prototype, key }).map(result => result.callable ? { ...result, receiver }
            : result.missingOwnField ? missing()[0] : result) : missing()
          return [...writes, ...inherited]
        }
        const members = receiver.sourcePrototype.members.filter(member => member.name && !ts.isComputedPropertyName(member.name)
          && member.name.text === key && !member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword)
          && (ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)))
        if (members.some(member => ts.isGetAccessor(member) || ts.isSetAccessor(member))) return [...writes, ...unknown()]
        const method = members.find(member => ts.isMethodDeclaration(member) && member.body)
        return [...writes, ...(method ? [{ callable: method, scope: receiver.scope, receiver }] : key === 'constructor' ? unknown() : missing())]
      }
      if ((receiver.callable || receiver.boundCallable) && ['call', 'apply', 'bind'].includes(key)) {
        const cell = heapCell(receiver, 'records')
        if (!receiver.scope?.heap || cell?.invalidated || receiver.scope.heap.intrinsicExposed?.has('Function') || receiver.scope?.globalBindings?.has('Function')) return unknown()
        const own = cell?.fields.get(key)
        if (own?.length) return own.flatMap(binding => value(binding.expression, binding.scope))
        return [{ functionAdapter: { name: key, target: receiver }, scope: receiver.scope }]
      }
      if (receiver.mapValue) {
        if (receiver.scope?.heap?.intrinsicExposed?.has('Map') || receiver.scope?.globalBindings?.has('Map') || heapCell(receiver, 'records')?.invalidated) return unknown()
        if (key === 'size') return [{ primitiveType: 'number' }]
        return ['get', 'set', 'has', 'clear', 'delete'].includes(key) ? [{ mapMethod: { name: key, receiver }, scope: receiver.scope }] : unknown()
      }
      if (receiver.mock && key === 'mock') return [{ mockLog: receiver.mock, scope: receiver.scope }]
      if (receiver.mockLog && key === 'calls') return [{ callLog: receiver.mockLog, scope: receiver.scope }]
      if (receiver.pendingMockLog) return [receiver]
      if (receiver.callLog && /^\d+$/.test(key)) {
        const calls = (scope.mockCalls?.get(receiver.callLog.allocation) ?? []).filter(invocation => invocation.key === receiver.callLog.key && invocation.mockScope === receiver.callLog.scope)
        const frame = scope.functionNode, body = frame && callable(frame) && frame.body
        let statement = expression
        while (statement?.parent && statement.parent !== body) statement = statement.parent
        const statements = body && ts.isBlock(body) && statement?.parent === body ? [...body.statements] : []
        const before = statements.slice(0, statements.indexOf(statement))
        // Exact indices require a single straight-line activation: no hooks,
        // escapes, helper calls, branches, resets, or repeated loop calls.
        const allocation = receiver.callLog.allocation
        const straight = before.length && !receiver.callLog.candidate && ts.isCallExpression(allocation) && allocation.arguments.length === 0
          && calls.every(call => call.scope === scope && call.args.every(argument => callable(argument) || inertValue(argument)))
          && before.every(item => ts.isVariableStatement(item) && item.declarationList.declarations.length === 1
            && item.declarationList.declarations[0].initializer === allocation
            || ts.isExpressionStatement(item) && ts.isCallExpression(item.expression)
              && calls.some(call => call.call === item.expression))
          && calls.every(call => call.call.getStart() < expression.getStart())
        if (straight) {
          const ordered = [...calls].sort((a, b) => a.call.getStart() - b.call.getStart()), selected = ordered[Number(key)]
          return selected ? [{ elements: selected.args, scope: selected.scope }] : [{ pendingMockLog: receiver.callLog }]
        }
        return calls.length ? calls.map(invocation => ({ elements: invocation.args, scope: invocation.scope })) : [{ pendingMockLog: receiver.callLog }]
      }
      if (receiver.instance) {
        if (heapCell(receiver, 'records')?.invalidated) return unknown()
        const constructor = receiver.instance.members.find(ts.isConstructorDeclaration)
        const target = nodes.get(byAst.get(constructor))
        const frame = target ? callEnvironment(target, { args: [...(receiver.allocation.arguments ?? [])], call: receiver.allocation, receiver }, receiver.scope) : receiver.scope
        const writes = (heapCell(receiver, 'records')?.fields.get(key) ?? []).flatMap(binding => value(binding.expression, binding.scope))
        const parameter = constructor?.parameters.find(parameter => parameter.name.text === key && parameter.modifiers?.some(modifier =>
          [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword].includes(modifier.kind)))
        const members = receiver.instance.members.filter(member => member.name && !ts.isComputedPropertyName(member.name) && member.name.text === key
          && !member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword))
        const field = members.find(ts.isPropertyDeclaration), method = members.find(ts.isMethodDeclaration)
        const initial = parameter ? value(parameter.name, frame) : field?.initializer ? value(field.initializer, frame)
          : method?.body ? [{ callable: method, scope: receiver.scope, receiver }] : []
        const assignments = sourceConstructorWrites(constructor, key)
        const assigned = assignments.flatMap(expression => value(expression, frame))
        // An unresolved dependency is bottom while the value fixed point is
        // being built. A known field/assignment must not permanently acquire
        // an unknown alternative just because its argument is still pending.
        const defined = parameter || field?.initializer || method?.body || assignments.length || heapCell(receiver, 'records')?.fields.has(key)
        return [...initial, ...assigned, ...writes, ...(members.some(ts.isGetAccessor) || !defined ? unknown() : [])]
      }
      if (receiver.record) {
        if (heapCell(receiver, 'records')?.invalidated) return unknown()
        const changed = heapCell(receiver, 'records')?.fields.get(key) ?? []
        const writes = changed.flatMap(binding => value(binding.expression, binding.scope))
        const found = [], missing = () => ({ missingOwnField: { record: receiver.record, scope: receiver.scope, key } })
        let canFallThrough = true
        for (const candidate of [...receiver.record.properties].reverse()) {
          if (!canFallThrough) break
          if (ts.isSpreadAssignment(candidate)) {
            const sources = value(candidate.expression, receiver.scope)
            if (!sources.length) return [] // Pending source provenance is bottom.
            if (sources.some(source => !plainSpreadSource(source))) return [...writes, ...found, ...unknown()]
            const candidates = []
            for (const source of sources) candidates.push(...(source.record ? yield { receiver: source, key }
              : /^\d+$/.test(key) && typeof source.literalValue === 'string' ? unknown() : [missing()]))
            found.push(...candidates.filter(result => !result.missingOwnField))
            canFallThrough = candidates.some(result => result.missingOwnField)
            continue
          }
          if (!candidate.name) return [...writes, ...found, ...unknown()]
          const computed = ts.isComputedPropertyName(candidate.name)
          const keys = computed ? literalKeys(candidate.name.expression) : [candidate.name.text]
          if (!keys) return [...writes, ...found, ...unknown()]
          if (!computed && keys[0] === '__proto__' && ts.isPropertyAssignment(candidate)) return [...writes, ...found, ...unknown()]
          if (!keys.includes(key)) continue
          const result = ts.isShorthandPropertyAssignment(candidate) ? value(candidate.name, receiver.scope)
            : ts.isPropertyAssignment(candidate) ? value(candidate.initializer, receiver.scope)
              : ts.isGetAccessor(candidate) || ts.isSetAccessor(candidate) ? unknown()
                : callable(candidate) ? [{ callable: candidate, scope: receiver.scope, receiver }] : unknown()
          found.push(...result)
          if (keys.length === 1) canFallThrough = false
        }
        return [...writes, ...found, ...(canFallThrough && !changed.length ? [missing()] : [])]
      }
      if (receiver.elements && key === 'length') {
        const cell = heapCell(receiver, 'arrays')
        if (cell?.invalidated || receiver.scope?.heap?.arrayIntrinsicExposed || receiver.scope?.globalBindings?.has('Array')) return unknown()
        return ts.isArrayLiteralExpression(receiver.allocation) && receiver.elements.length === receiver.allocation.elements.length
          && !cell?.lengthUnknown && !cell?.items.length && !receiver.elementBindings?.length && !receiver.elements.some(ts.isSpreadElement)
          ? [{ literalValue: receiver.elements.length }] : [{ primitiveType: 'number' }]
      }
      if (receiver.elements && /^\d+$/.test(key)) {
        const cell = heapCell(receiver, 'arrays')
        if (cell?.reordered || cell?.items.length || receiver.elementBindings?.length) {
          const bindings = aggregateBindings(receiver)
          return bindings.length ? bindings.flatMap(binding => value(binding.expression, binding.scope)) : [{ nullish: 'undefined' }]
        }
        const element = receiver.elements[Number(key)]
        return !element || ts.isOmittedExpression(element) ? [{ nullish: 'undefined' }] : value(element, receiver.scope)
      }
      return unknown()
    }
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      const keys = ts.isPropertyAccessExpression(expression) ? [expression.name.text] : literalKeys(expression.argumentExpression)
      if (keys?.length === 1 && keys[0] === 'prototype') {
        const declarations = checker.getTypeAtLocation(expression.expression).symbol?.declarations ?? []
        const declaration = declarations.find(node => ts.isClassDeclaration(node) && sources.has(node.getSourceFile().fileName))
        if (declaration && !declaration.heritageClauses?.length && !ts.getDecorators(declaration)?.length
          && !mutatedBindings.has(declaration) && !declaration.members.some(member => member.name && ts.isComputedPropertyName(member.name))) {
          return [{ sourcePrototype: declaration, allocation: declaration, scope: declarationScope(declaration, scope) ?? scope }]
        }
      }
      const module = requiredModule(expression.expression), exported = keys?.length === 1 && nodes.get(commonjs.get(module)?.get(keys[0]))?.ast
      if (exported && ts.isShorthandPropertyAssignment(exported)) {
        const declaration = checker.getShorthandAssignmentValueSymbol(exported)?.valueDeclaration
        return declaration && callable(declaration) ? [{ callable: declaration, scope }] : declaration?.initializer ? value(declaration.initializer) : unknown()
      }
      if (exported && ts.isPropertyAssignment(exported)) return value(exported.initializer)
      if (exported && ts.isBinaryExpression(exported)) return value(exported.right)
      return project(value(expression.expression), keys)
    }
    if (ts.isCallExpression(expression)) {
      const callee = expression.expression
      if (expression.arguments.length >= 2 && ts.isPropertyAccessExpression(callee)
        && ['reduce', 'reduceRight'].includes(callee.name.text) && emptyNativeReduction(expression, scope)) {
        const callbacks = value(expression.arguments[0])
        if (callbacks.length && callbacks.every(callback => callback.callable)) return value(expression.arguments[1])
      }
      if (ts.isPropertyAccessExpression(callee) && ['get', 'set', 'has', 'clear', 'delete'].includes(callee.name.text)) {
        const receivers = value(callee.expression)
        if (receivers.length && receivers.every(receiver => receiver.mapValue)) {
          if (scope.heap?.intrinsicExposed?.has('Map') || scope.globalBindings?.has('Map')) return unknown()
          return receivers.flatMap(receiver => {
            const cell = heapCell(receiver, 'records')
            if (cell?.invalidated) return unknown()
            if (callee.name.text === 'set') return [receiver]
            if (callee.name.text === 'clear') return [{ nullish: 'undefined' }]
            if (callee.name.text === 'has' || callee.name.text === 'delete') return [{ primitiveType: 'boolean' }]
            const keys = expression.arguments[0] ? value(expression.arguments[0]) : [{ nullish: 'undefined' }]
            const primitive = item => Object.hasOwn(item, 'literalValue') || item.nullish
            const entries = [...(receiver.initialMapEntries ?? []), ...(cell?.mapEntries ?? [])].filter(binding => {
              const candidates = value(binding.key, binding.scope)
              return !keys.length || !candidates.length || [...keys, ...candidates].some(item => !primitive(item)) || keys.some(key => candidates.some(candidate => valueKey(key) === valueKey(candidate)))
            })
            return [...entries.flatMap(binding => value(binding.expression, binding.scope)), { nullish: 'undefined' }]
          })
        }
      }
      if (ts.isPropertyAccessExpression(callee) && implicitCommonJS(callee.expression, 'Object') && callee.name.text === 'freeze'
        && expression.arguments.length === 1 && !scope.heap?.objectIntrinsicExposed && !scope.heap?.intrinsicExposed?.has('Object')
        && !scope.globalBindings?.has('Object')) {
        const inputs = value(expression.arguments[0])
        if (!inputs.length) return []
        return inputs.flatMap(input => input.nullish || Object.hasOwn(input, 'literalValue')
          || input.record && !heapCell(input, 'records')?.invalidated || input.elements && !heapCell(input, 'arrays')?.invalidated ? [input] : unknown())
      }
      if (ts.isPropertyAccessExpression(callee) && implicitCommonJS(callee.expression, 'Object') && callee.name.text === 'values'
        && expression.arguments.length === 1 && !scope.heap?.objectIntrinsicExposed && !scope.heap?.intrinsicExposed?.has('Object')
        && !scope.globalBindings?.has('Object')) {
        const inputs = value(expression.arguments[0])
        if (!inputs.length) return []
        return inputs.flatMap(input => {
          const cell = input.record && heapCell(input, 'records')
          if (!input.record || cell?.invalidated || cell?.unresolvedEscape || cell?.fields.size) return unknown()
          const fields = new Map()
          for (const property of input.record.properties) {
            if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return unknown()
            const computed = ts.isComputedPropertyName(property.name)
            const keys = computed ? literalKeys(property.name.expression) : [property.name.text]
            if (!keys || keys.length !== 1 || !computed && keys[0] === '__proto__') return unknown()
            fields.set(keys[0], ts.isPropertyAssignment(property) ? property.initializer : property.name)
          }
          const ordered = Object.keys(Object.fromEntries(fields)).map(key => fields.get(key))
          return [{ elements: [], elementBindings: ordered.map(item => ({ expression: item, scope: input.scope })), allocation: expression, scope }]
        })
      }
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'sort' && expression.arguments.length === 1
        && !scope.heap?.arrayIntrinsicExposed && !scope.globalBindings?.has('Array')) {
        const inputs = value(callee.expression), comparators = value(expression.arguments[0])
        if (!inputs.length || !comparators.length) return []
        if (comparators.some(comparator => !comparator.callable)) return unknown()
        return inputs.flatMap(input => {
          if (!input.elements || heapCell(input, 'arrays')?.invalidated) return unknown()
          const pending = valueQuery?.pending, bindings = aggregateBindings(input)
          if (bindings.some(binding => ts.isSpreadElement(binding.expression))) return valueQuery && valueQuery.pending !== pending ? [] : unknown()
          // Sorting preserves the values, but not their positions.
          return [{ elements: [], elementBindings: bindings, allocation: input.allocation, scope: input.scope }]
        })
      }
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'slice' && expression.arguments.length <= 2
        && !scope.heap?.arrayIntrinsicExposed && !scope.globalBindings?.has('Array')) {
        const inputs = value(callee.expression)
        if (!inputs.length) return []
        return inputs.flatMap(input => {
          if (!input.elements || heapCell(input, 'arrays')?.invalidated) return unknown()
          const pending = valueQuery?.pending, bindings = aggregateBindings(input)
          if (bindings.some(binding => ts.isSpreadElement(binding.expression))) return valueQuery && valueQuery.pending !== pending ? [] : unknown()
          // Slice returns a fresh array containing a subset of the source. Its
          // bounds may be dynamic, so retain each possible element identity.
          return [{ elements: [], elementBindings: bindings, allocation: expression, scope }]
        })
      }
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'filter' && expression.arguments.length >= 1
        && expression.arguments.length <= 2 && !scope.heap?.arrayIntrinsicExposed && !scope.globalBindings?.has('Array')) {
        const inputs = value(callee.expression), callbacks = value(expression.arguments[0])
        if (!inputs.length || !callbacks.length) return []
        if (!knownBooleanPredicate(expression.arguments[0], scope) && callbacks.some(callback => !callback.callable)) return unknown()
        return inputs.flatMap(input => {
          const cell = input.elements && heapCell(input, 'arrays')
          if (!input.elements || cell?.invalidated) return unknown()
          const pending = valueQuery?.pending, bindings = aggregateBindings(input)
          if (bindings.some(binding => ts.isSpreadElement(binding.expression))) return valueQuery && valueQuery.pending !== pending ? [] : unknown()
          // Filter returns a fresh array whose values are a subset of its source.
          // Retain every possible source binding, with its original scope; the
          // predicate invocation and effects are handled at the call boundary.
          return [{ elements: [], elementBindings: bindings, allocation: expression, scope: input.scope }]
        })
      }
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'find' && expression.arguments.length === 1
        && !scope.heap?.arrayIntrinsicExposed && !scope.heap?.intrinsicExposed?.has('Array') && !scope.globalBindings?.has('Array')) {
        const inputs = value(callee.expression), callbacks = value(expression.arguments[0])
        if (!inputs.length || !callbacks.length) return []
        if (callbacks.some(callback => !callback.callable)) return unknown()
        return inputs.flatMap(input => {
          const cell = input.elements && heapCell(input, 'arrays')
          if (!input.elements || cell?.invalidated || cell?.unresolvedEscape) return unknown()
          const pending = valueQuery?.pending, bindings = aggregateBindings(input)
          if (bindings.some(binding => binding.recursiveSpread || ts.isSpreadElement(binding.expression))) return valueQuery && valueQuery.pending !== pending ? [] : unknown()
          // Any source element can be returned; a miss produces undefined.
          // Predicate invocation and effects are analyzed at the call boundary.
          return [...bindings.flatMap(binding => value(binding.expression, binding.scope)), { nullish: 'undefined' }]
        })
      }
      if (ts.isPropertyAccessExpression(callee) && ['map', 'flatMap'].includes(callee.name.text) && expression.arguments.length === 1
        && !scope.heap?.arrayIntrinsicExposed && !scope.globalBindings?.has('Array')) {
        const inputs = value(callee.expression), callbacks = value(expression.arguments[0])
        if (!inputs.length || !callbacks.length) return []
        if (callbacks.some(callback => !callback.callable)) return unknown()
        return inputs.flatMap(input => {
          const cell = input.elements && heapCell(input, 'arrays')
          if (!input.elements || cell?.invalidated) return unknown()
          const pending = valueQuery?.pending, bindings = aggregateBindings(input)
          if (bindings.some(binding => ts.isSpreadElement(binding.expression))) return valueQuery && valueQuery.pending !== pending ? [] : unknown()
          const mapped = []
          for (const callback of callbacks) {
            const body = callback.callable.body, returns = sourceReturns(callback.callable)
            const target = nodes.get(byAst.get(callback.callable))
            if (!returns.length || returns.some(result => !result) || ts.isBlock(body) && !alwaysExits(body)
              || !target || callback.callable.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) return unknown()
            for (const binding of bindings) {
              const frame = callEnvironment(target, { args: [binding.expression], argScopes: [binding.scope], unknownIndexes: [2], numberIndexes: [1], call: expression, scope: callback.scope }, scope)
              if (callee.name.text === 'flatMap') {
                const outputs = returns.flatMap(result => value(result, frame))
                if (!outputs.length) return []
                if (outputs.some(output => !output.elements || heapCell(output, 'arrays')?.invalidated)) return unknown()
                const flattened = outputs.flatMap(output => aggregateBindings(output))
                if (flattened.some(item => ts.isSpreadElement(item.expression) || item.recursiveSpread)) return unknown()
                mapped.push(...flattened)
              } else mapped.push(...returns.map(result => ({ expression: result, scope: frame })))
            }
          }
          return [{ elements: [], elementBindings: mapped, allocation: expression, scope }]
        })
      }
      if (ts.isPropertyAccessExpression(callee) && implicitCommonJS(callee.expression, 'Array') && callee.name.text === 'from'
        && expression.arguments.length === 2 && !scope.heap?.arrayIntrinsicExposed && !scope.heap?.objectIntrinsicExposed
        && !scope.globalBindings?.has('Array') && !scope.globalBindings?.has('Object')) {
        const inputs = value(expression.arguments[0]), mappers = value(expression.arguments[1])
        if (!inputs.length || !mappers.length) return []
        const lengths = inputs.flatMap(input => {
          const cell = heapCell(input, input.elements ? 'arrays' : 'records')
          if (cell?.invalidated) return [undefined]
          if (input.elements) return [input.elements.some(ts.isSpreadElement) || input.elementBindings?.length || cell?.items.length ? undefined : input.elements.length]
          if (!input.record || cell?.fields.has('length') || !input.record.properties.every(property => ts.isPropertyAssignment(property)
            && !ts.isComputedPropertyName(property.name) && property.name.text !== '__proto__')) return [undefined]
          const property = input.record.properties.filter(property => property.name.text === 'length')
          if (property.length !== 1) return [undefined]
          return value(property[0].initializer, input.scope).map(item => Object.hasOwn(item, 'literalValue') ? item.literalValue : undefined)
        })
        if (!lengths.length) return []
        const proof = scope.heap?.fromProofs?.get(expression)?.get(scope)
        const dynamicLength = lengths.some(length => !Number.isSafeInteger(length) || length < 0)
        if (dynamicLength) heapCell({ allocation: expression, scope }, 'arrays') // Subscribe consumers to later proof updates.
        if (dynamicLength && (!proof || proof.proofVersion !== scope.heap.proofVersion || proof.contextRevision !== contextRevision(scope))) return unknown()
        if (!dynamicLength && lengths.every(length => length === 0)) return [{ elements: [], allocation: expression, scope }]
        return mappers.flatMap(mapper => {
          if (!mapper.callable || mapper.callable.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) return unknown()
          const body = mapper.callable.body, returns = sourceReturns(mapper.callable)
          const target = nodes.get(byAst.get(mapper.callable))
          if (!target || !returns.length || returns.some(result => !result) || ts.isBlock(body) && !alwaysExits(body)) return unknown()
          // One unknown index stands for all mapper activations. Retain every
          // possible returned value in that activation; actual mapper effects
          // are reached separately only when an element can exist.
          const frame = callEnvironment(target, { args: [], unknownIndexes: [0], numberIndexes: [1], call: expression, scope: mapper.scope }, scope)
          return [{ elements: [], elementBindings: returns.map(result => ({ expression: result, scope: frame })), allocation: expression, scope }]
        })
      }
      if (ts.isPropertyAccessExpression(callee) && implicitCommonJS(callee.expression, 'Object')
        && !scope.heap?.objectIntrinsicExposed && !scope.heap?.intrinsicExposed?.has('Object') && !scope.globalBindings?.has('Object')) {
        if (callee.name.text === 'getOwnPropertyDescriptor' && expression.arguments.length === 2) {
          const inputs = value(expression.arguments[0]), names = value(expression.arguments[1])
          if (!inputs.length || !names.length) return []
          if (names.some(name => !Object.hasOwn(name, 'literalValue') || typeof name.literalValue !== 'string')) return unknown()
          return inputs.flatMap(receiver => names.flatMap(name => {
            const cell = receiver.sourcePrototype && heapCell(receiver, 'records')
            if (!receiver.sourcePrototype || cell?.invalidated || cell?.fields.has(name.literalValue)) return unknown()
            const members = receiver.sourcePrototype.members.filter(member => member.name && !ts.isComputedPropertyName(member.name)
              && member.name.text === name.literalValue && !member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword)
              && (ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)))
            if (!members.length) return [{ nullish: 'undefined' }]
            const ownFields = new Map()
            for (const member of members) {
              if (ts.isMethodDeclaration(member)) { ownFields.clear(); ownFields.set('value', { expression: member, scope: receiver.scope, unbound: true }) }
              else { ownFields.delete('value'); ownFields.set(ts.isGetAccessor(member) ? 'get' : 'set', { expression: member, scope: receiver.scope, unbound: true }) }
            }
            return [{ prototypeRecord: true, ordinaryPrototype: true, prototype: null, allocation: expression, scope, ownFields }]
          }))
        }
        if (callee.name.text === 'create' && expression.arguments.length === 1) {
          return value(expression.arguments[0]).flatMap(prototype => prototype.sourcePrototype || prototype.nullish === 'null'
            ? [{ prototypeRecord: true, prototype: prototype.sourcePrototype ? prototype : null, allocation: expression, scope, ownFields: new Map() }] : unknown())
        }
        if (callee.name.text === 'assign' && expression.arguments.length > 1) {
          let target = expression.arguments[0]
          while (ts.isParenthesizedExpression(target) || ts.isAsExpression(target) || ts.isNonNullExpression(target)) target = target.expression
          const records = expression.arguments.slice(1)
          if (ts.isCallExpression(target) && records.every(record => ts.isObjectLiteralExpression(record)
            && record.properties.every(property => (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property) || ts.isMethodDeclaration(property))
              && property.name && !ts.isComputedPropertyName(property.name) && property.name.text !== '__proto__'))) {
            return value(expression.arguments[0]).flatMap(receiver => {
              // This fresh target cannot escape before this inline copy. Later
              // own-property definitions affect future reads, not the effects
              // of the copy that created the returned allocation.
              if (!receiver.prototypeRecord || receiver.allocation !== target
                || receiver.prototype && heapCell(receiver.prototype, 'records')?.invalidated) return unknown()
              const ownFields = new Map(receiver.ownFields)
              for (const record of records) for (const property of record.properties) {
                const key = property.name.text
                if (receiver.prototype?.sourcePrototype.members.some(member => member.name && !ts.isComputedPropertyName(member.name)
                  && member.name.text === key && (ts.isGetAccessor(member) || ts.isSetAccessor(member))
                  && !member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword))) return unknown()
                ownFields.set(key, { expression: ts.isShorthandPropertyAssignment(property) ? property.name : ts.isMethodDeclaration(property) ? property : property.initializer, scope })
              }
              return [{ ...receiver, ownFields, copySource: expression }]
            })
          }
        }
      }
      const outputs = []
      for (const input of value(expression.expression)) {
        let alternatives = input.mock ? mockCallbacks(input.mock, scope, expression).map(callable => ({ callable, scope: input.scope })) : [input]
        if (input.mock && !input.mock.candidate) {
          const { definite, possible } = localMockConfigSelection(input.mock, scope, expression)
          if (definite) alternatives = []
          if (!definite && !input.mock.callbacks.length) outputs.push({ nullish: 'undefined' })
          for (const event of possible) {
            if (event.method.startsWith('mockImplementation')) {
              if (!event.call.arguments[0]) { outputs.push({ unknown: true }); continue }
              alternatives.push(...value(event.call.arguments[0], event.scope))
            } else if (/^mock(?:Return|Resolved|Rejected)Value/.test(event.method)) {
              const result = event.call.arguments[0] ? value(event.call.arguments[0], event.scope) : [{ nullish: 'undefined' }]
              outputs.push(...(/^mock(?:Resolved|Rejected)Value/.test(event.method) ? [{ promise: result }] : result))
            } else outputs.push({ unknown: true })
          }
        }
        if (input.mock?.candidate) for (const configuration of mockRecords(input.mock, scope, expression).filter(record => record.expression)) {
          if (configuration.rejected) continue
          const result = value(configuration.expression, input.scope)
          outputs.push(...(configuration.promise ? [{ promise: result }] : result))
        }
        for (const callee of alternatives) {
        if (callee.functionAdapter || callee.boundCallable) {
          const facts = adapterInvocationFacts(callee, expression, scope, value)
          outputs.push(...facts.bound)
          if (facts.unresolved) outputs.push({ unknown: true })
          for (const invocation of facts.calls) {
            const fn = invocation.target, target = nodes.get(byAst.get(fn.callable))
            if (!target || next.returning.has(fn.callable)) { outputs.push({ unknown: true }); continue }
            const frame = callEnvironment(target, { args: invocation.bindings.map(binding => binding.expression), argScopes: invocation.bindings.map(binding => binding.scope), call: expression, scope: fn.scope, receiver: invocation.receiver }, scope)
            const previousReturns = next.returning; next.returning = new Set(previousReturns).add(fn.callable)
            const results = sourceReturns(fn.callable).flatMap(result => value(result, frame))
            outputs.push(...(fn.callable.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ? [{ promise: results }] : results))
            next.returning = previousReturns
          }
          continue
        }
        if (!callee.callable) { outputs.push({ unknown: true }); continue }
        if (next.returning.has(callee.callable)) { outputs.push({ unknown: true }); continue }
        const target = nodes.get(byAst.get(callee.callable))
        if (!target) { outputs.push({ unknown: true }); continue }
        const environment = callEnvironment(target, { args: [...expression.arguments], call: expression, scope: callee.scope, receiver: callee.receiver }, scope)
        const previousReturns = next.returning; next.returning = new Set(previousReturns).add(callee.callable)
        const prior = outputs.length
        for (const expression of sourceReturns(callee.callable)) outputs.push(...value(expression, environment))
        if (callee.callable.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
          const returned = outputs.splice(prior); outputs.push({ promise: returned })
        }
        next.returning = previousReturns
        }
      }
      return outputs
    }
    return unknown()
  }
  let referenceOnly
  function referenceOnlyNodes() {
    if (referenceOnly) return referenceOnly
    const effects = new Set(), parents = new Map()
    for (const node of nodes.values()) {
      if (node.runtimeCalls?.length || node.runtimeWrites?.length || node.recordReads?.length || node.bindingWrites?.length || node.functionAdapters?.length || node.providerEvents?.length || node.mockInvocations?.length || node.deferredMockArguments?.length || node.collectionStores?.length || node.arrayMutations?.length || node.arrayIndexWrites?.length || node.jsonStringifications?.length || node.mapCreations?.length || node.mapOperations?.length || node.inlineSetIterations?.length || node.collectionSorts?.length || node.collectionFroms?.length || node.collectionSlices?.length || node.collectionIterations?.length || node.objectSpreads?.length || node.intrinsicExposure?.size || node.unsafe
        || node.dispatchRisks?.length || node.inputRisks?.length || node.moduleEntryRisks?.length || node.nodeEntry || node.readerCall || node.inputFile || node.directoryInput
        || [...(node.edgeGuards?.values() ?? [])].some(guards => [...guards].some(Boolean))) effects.add(node.id)
      for (const target of node.edges) { if (!parents.has(target)) parents.set(target, []); parents.get(target).push(node.id) }
    }
    for (const id of effects) for (const parent of parents.get(id) ?? []) effects.add(parent)
    referenceOnly = new Set([...nodes.keys()].filter(id => !effects.has(id)))
    return referenceOnly
  }
  function reachable(roots, testFile) {
    valueCache = new WeakMap(); valueCacheRevision = valueFactsRevision
    const blocked = new Set(files.get(testFile)?.blocked ?? []), pending = [], mockUncertainties = new Map()
    const seen = new Set(), states = new Map(), first = new Map(), queue = [], queued = new Set()
    const schedule = (key, state) => {
      if (!queued.has(key)) { queued.add(key); queue.push([key, state]) }
    }
    seen.dynamicEdges = new Map()
    const enqueue = (id, environment, parent, evidence, conservative = false, mainFile = testFile, processContext = 'test') => {
      if (!nodes.has(id)) return
      if (processContext !== 'test' && environment.testFile) {
        const childEnvironment = new Map(environment)
        childEnvironment.valueBindings = environment.valueBindings
        childEnvironment.mockCalls = new Map()
        environment = childEnvironment
      }
      const configuration = nodes.get(id).mockConfigurationFor
      if (processContext === 'test' && configuration?.some(candidate => candidate.file === testFile && blocked.has(candidate.target))) return
      const gate = nodes.get(id).mainGuard
      if (gate && (gate.file === mainFile) !== gate.isMain) return
      if (processContext === 'test' && blocked.has(nodes.get(id).file)) { pending.push([id, environment, parent, evidence, conservative, mainFile, processContext]); return }
      // Value-only declarations have no executable descendants. Their owner
      // reference can be shared, but must never merge two allocation frames.
      const pureReference = referenceOnlyNodes().has(id)
      const key = `${id}\0${processContext}\0${mainFile}\0${pureReference ? 'reference' : contextSensitiveNodes(testFile).has(id) ? contextKey(environment) : projectedContextKey(environment)}`
      if (states.has(key)) {
        if (pureReference) return key
        const state = states.get(key), current = state.environment
        let changed = false
        current.valueBindings ??= new Map()
        for (const [parameter, bindings] of environment.valueBindings ?? []) {
          if (!current.valueBindings.has(parameter)) current.valueBindings.set(parameter, [])
          const prior = current.valueBindings.get(parameter)
          for (const binding of bindings) if (!prior.some(value => value.expression === binding.expression && value.scope === binding.scope && !!value.numeric === !!binding.numeric)) { prior.push(binding); changed = true }
        }
        if (changed) {
          state.conservative = true
          current.revision = (current.revision ?? 0) + 1
          valueFactsRevision++
          if (current.heap) { current.heap.version++; advanceProofFacts(current.heap, true) }
        }
        if (state.revision !== contextRevision(current)) schedule(key, state)
        return key
      }
      const state = { id, environment, parent, evidence, conservative, mainFile, processContext }
      states.set(key, state); schedule(key, state); return key
    }
    const environment = new Map()
    environment.testFile = testFile; environment.mockCalls = new Map(); environment.globalBindings = new Map(); environment.heap = { version: 0, arrays: new WeakMap(), records: new WeakMap(), callScopes: new WeakMap(), bindingWrites: new Map(), bindingReaders: new Set(), bindingValueReaders: new Map(), instanceEscapes: new Map(), exposedProviders: new Set(), fromProofs: new WeakMap(), proofVersion: 0 }; environment.moduleScopes = new Map()
    const heapReaders = new WeakMap(), iterableReaders = new Map(), conditionalReaders = new Map()
    environment.heap.notify = cell => {
      for (const [key, state] of heapReaders.get(cell) ?? []) schedule(key, state)
    }
    environment.caseRegistration = files.get(testFile)?.registrations.filter(registration => roots.some(root => {
      const ast = nodes.get(root)?.ast
      return ast && registration.pos <= ast.pos && ast.end <= registration.end
    })).sort((a, b) => (a.end - a.pos) - (b.end - b.pos))[0]
    roots.forEach(id => {
      const root = new Map(environment)
      Object.assign(root, { testFile, mockCalls: environment.mockCalls, globalBindings: environment.globalBindings, heap: environment.heap, caseRegistration: environment.caseRegistration, functionNode: nodes.get(id)?.ast, moduleScopes: environment.moduleScopes })
      if (ts.isSourceFile(nodes.get(id)?.ast)) environment.moduleScopes.set(nodes.get(id).ast, root)
      enqueue(id, root, null, null)
    })
    seen.trace = { states, first }
    const executions = new Map(), processedExecutions = new Map(), nativeDiagnostics = new Map(), pendingMockReads = [], moduleSummaries = [], summaryTasks = new Map()
    const collectionExecutions = new Map(), collectionDiagnostics = new Map(), iterationDiagnostics = new Map(), nativeDataExecutions = new Map(), nativeDataDiagnostics = new Map(), classEscapeDiagnostics = new Map(), spreadExecutions = new Map(), spreadDiagnostics = new Map()
    const reachedIterations = new WeakMap()
    const nativeReplacementFrames = new WeakMap()
    function replacementBoundaryFor(scope, processContext) {
      const visited = new Set()
      for (let frame = scope; frame && !visited.has(frame); frame = frame.caller) {
        visited.add(frame)
        const proof = nativeReplacementFrames.get(frame)?.get(processContext)
        if (!proof) continue
        const resolution = inputResolution(proof.operation.provider, proof.operation.readerMethod, roots, seen, proof.operation.id, testFile, undefined, proof.executionKey)
        if (resolution.status === 'replaced' && resolution.callback === frame.functionNode) return proof.boundary
      }
    }
    function coveredIterationInvocation(invocation, processContext) {
      if (invocation.sourceArgs !== null || !invocation.call || !invocation.scope) return false
      const processes = reachedIterations.get(invocation.call)?.get(invocation.scope)
      if (!processes?.has(processContext) || !invocation.call.arguments?.[0]) return false
      return scopedValues(invocation.call.arguments[0], invocation.scope).some(value => value.callable === invocation.callback)
    }
    const localMockExecutions = new Map(), localMockEvents = [], localMockDiagnostics = new Map(), deferredMockExecutions = new Map(), deferredMockDiagnostics = new Map()
    environment.heap.localMockEvents = localMockEvents
    let mockRevision = 0, previousMockRevision = 0
    const recordMockCall = (mock, call, scope) => {
      if (!scope.mockCalls.has(mock.allocation)) scope.mockCalls.set(mock.allocation, [])
      const calls = scope.mockCalls.get(mock.allocation)
      if (!calls.some(value => value.call === call && value.scope === scope && value.key === mock.key && value.mockScope === mock.scope)) { calls.push({ call, scope, key: mock.key, mockScope: mock.scope, args: [...call.arguments] }); mockRevision++; valueFactsRevision++; if (scope.heap) { scope.heap.version++; advanceProofFacts(scope.heap, true) } }
    }
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const [key, state] = queue[cursor], entry = nodes.get(state.id)
      queued.delete(key)
      state.revision = contextRevision(state.environment)
      const callValues = new Map()
      let skipExecution = false
      if (entry.truthGuard) {
        conditionalReaders.set(key, state)
        const previousObserver = heapReadObserver
        heapReadObserver = cell => {
          if (!heapReaders.has(cell)) heapReaders.set(cell, new Map())
          heapReaders.get(cell).set(key, state)
        }
        let value
        try { value = truthValue(entry.truthGuard.expression, state.environment) }
        finally { heapReadObserver = previousObserver }
        skipExecution = value !== undefined && value !== entry.truthGuard.expected
        state.conservative ||= value === undefined
        state.evidence = { ...state.evidence, conditionValue: value ?? 'unknown' }
      }
      if (entry.iterationGuard && !skipExecution) {
        const loop = entry.iterationGuard
        iterableReaders.set(key, state)
        const previousObserver = heapReadObserver
        heapReadObserver = cell => {
          if (!heapReaders.has(cell)) heapReaders.set(cell, new Map())
          heapReaders.get(cell).set(key, state)
        }
        let inputs, empty
        try {
          inputs = scopedValues(loop.expression, state.environment)
          empty = !loop.awaitModifier && !state.environment.heap?.arrayIntrinsicExposed
            && !state.environment.globalBindings?.has('Array') && inputs.length && inputs.every(value => {
              if (value.setBindings) return !value.setBindings.length && !value.scope?.heap?.intrinsicExposed?.has('Set')
                && !value.scope?.globalBindings?.has('Set')
              const cell = value.elements && heapCell(value, 'arrays')
              if (cell) heapReadObserver(cell)
              return value.elements && !aggregateBindings(value).length && !cell?.invalidated && !cell?.unresolvedEscape
            })
        } finally { heapReadObserver = previousObserver }
        const escaped = inputs?.some(value => value.elements && heapCell(value, 'arrays')?.unresolvedEscape)
        if (escaped) iterationDiagnostics.set(key, [{ id: entry.id, kind: 'collection-callback', unboundedEffects: true,
          effectCompleteness: 'unproven', reason: 'Escaped array iterator effects are unresolved', expression: loop.expression.getText(),
          callsite: { file: entry.file, start: loop.expression.getStart() } }])
        else iterationDiagnostics.delete(key)
        skipExecution = !!empty
      }
      if (!skipExecution) {
        seen.add(state.id); if (!first.has(state.id)) first.set(state.id, key)
        for (const [name, sites] of entry.intrinsicExposure ?? []) if (state.environment.heap) {
          const escaped = [...sites].some(site => {
            if (name !== 'Boolean' || !ts.isCallExpression(site) || !ts.isPropertyAccessExpression(site.expression)
              || site.expression.name.text !== 'filter' || site.arguments.length !== 1 || !implicitCommonJS(site.arguments[0], 'Boolean')
              || state.environment.heap.arrayIntrinsicExposed || state.environment.globalBindings?.has('Array')) return true
            const receivers = scopedValues(site.expression.expression, state.environment)
            return !receivers.length || receivers.some(value => !value.elements || heapCell(value, 'arrays')?.invalidated)
          })
          if (escaped) {
            const exposed = state.environment.heap.intrinsicExposed ??= new Set()
            if (!exposed.has(name)) { exposed.add(name); state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true) }
          }
        }
        if (entry.arrayIntrinsicExposure && state.environment.heap && !state.environment.heap.arrayIntrinsicExposed) {
          state.environment.heap.arrayIntrinsicExposed = true; state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true)
          for (const [readerKey, reader] of iterableReaders) schedule(readerKey, reader)
        }
        if (entry.objectIntrinsicExposure && state.environment.heap && !state.environment.heap.objectIntrinsicExposed) {
          state.environment.heap.objectIntrinsicExposed = true; state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true)
          for (const [readerKey, reader] of conditionalReaders) schedule(readerKey, reader)
        }
        for (const call of entry.runtimeCalls ?? []) if (state.processContext === 'test' && ts.isPropertyAccessExpression(call.expression)
          && call.expression.name.text === 'stubGlobal' && emptyMockReceiver(call.expression.expression) && call.arguments.length === 2 && ts.isStringLiteralLike(call.arguments[0])) {
          const name = call.arguments[0].text, bindings = state.environment.globalBindings
          if (!bindings.has(name)) bindings.set(name, [])
          if (!bindings.get(name).some(value => value.expression === call.arguments[1] && value.scope === state.environment)) {
            bindings.get(name).push({ expression: call.arguments[1], scope: state.environment }); valueFactsRevision++; state.environment.heap.version++; advanceProofFacts(state.environment.heap, true)
            if (name === 'Object' || name === 'Array') for (const [readerKey, reader] of [...conditionalReaders, ...iterableReaders]) schedule(readerKey, reader)
          }
        }
        for (const write of entry.bindingWrites ?? []) {
          const operand = ts.isBinaryExpression(write) ? write.left : write.operand
          const expression = ts.isBinaryExpression(write) ? write.right : write.operand
          const operator = ts.isBinaryExpression(write) ? write.operatorToken.kind : write.operator
          const declaration = bindingDeclaration(operand), writes = state.environment.heap?.bindingWrites
          if (!declaration || !writes) continue
          if (!writes.has(declaration)) writes.set(declaration, [])
          const reached = writes.get(declaration)
          if (!reached.some(value => value.ast === write && value.scope === state.environment)) {
            reached.push({ expression, ast: write, operator, scope: state.environment })
            const heap = state.environment.heap, owner = declarationScope(declaration, state.environment)
            const valueObserved = owner && heap.bindingValueReaders.get(declaration)?.has(owner)
            if (heap.bindingReaders.has(declaration) || valueObserved) {
              heap.version++
              if (valueObserved) valueFactsRevision++
              advanceProofFacts(heap, !!valueObserved)
              if (valueObserved) heap.notify?.(heapCell({ allocation: declaration, scope: owner }, 'records'))
            }
          }
        }
        for (const write of entry.runtimeWrites ?? []) {
          const keys = ts.isPropertyAccessExpression(write.left) ? [write.left.name.text] : literalKeys(write.left.argumentExpression)
          const assigned = write.operatorToken.kind === ts.SyntaxKind.EqualsToken ? write.right : write
          for (const receiver of scopedValues(write.left.expression, state.environment)) {
            if (receiver.record || receiver.instance || receiver.classValue || receiver.enumValue || receiver.prototypeRecord || receiver.sourcePrototype || receiver.mapValue || receiver.callable || receiver.boundCallable) {
              const cell = heapCell(receiver, 'records')
              if (cell && (receiver.mapValue || !keys || keys.includes('__proto__')) && !cell.invalidated) {
                cell.invalidated = true; state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true); state.environment.heap.notify?.(cell)
              }
              if (keys?.length === 1) heapBinding(cell, keys[0], { expression: assigned, scope: state.environment }, state.environment.heap)
            }
            if (receiver.elements) {
              const cell = heapCell(receiver, 'arrays')
              unknownArrayLength(receiver)
              // Truncating a native array removes values; it does not replace
              // its storage/iteration protocol or insert the length as an item.
              // Retaining prior items is the monotone may-value approximation.
              if (keys?.length === 1 && keys[0] === 'length' && ts.isNumericLiteral(write.right) && Number(write.right.text) === 0) continue
              // Dynamic keys retain a scoped effect frontier until their
              // numeric identity is proved below; a known non-index property
              // can change the array's iteration or method protocol.
              if (cell && keys && keys.some(key => !/^\d+$/.test(key))) {
                if (!cell.invalidated) { cell.invalidated = true; state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true); state.environment.heap.notify?.(cell) }
              }
              heapBinding(cell, null, { expression: assigned, scope: state.environment }, state.environment.heap)
            }
          }
        }
        for (const call of entry.runtimeCalls ?? []) {
          if (state.processContext === 'test' && ts.isPropertyAccessExpression(call.expression)
            && ['resetAllMocks', 'restoreAllMocks'].includes(call.expression.name.text)
            && emptyMockReceiver(call.expression.expression)
            && !localMockEvents.some(event => event.all && event.call === call && event.scope === state.environment)) {
            localMockEvents.push({ all: true, call, scope: state.environment, method: call.expression.name.text })
            state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true); mockRevision++
            for (const execution of localMockExecutions.values()) schedule(execution.key, execution.state)
          }
          if (ts.isPropertyAccessExpression(call.expression)
            && ['mockImplementation', 'mockImplementationOnce', 'mockReturnValue', 'mockReturnValueOnce', 'mockResolvedValue', 'mockResolvedValueOnce', 'mockRejectedValue', 'mockRejectedValueOnce', 'mockReset', 'mockRestore'].includes(call.expression.name.text)) {
            for (const value of scopedValues(call.expression.expression, state.environment)) if (value.mock && !value.mock.candidate) {
              if (!localMockEvents.some(event => event.call === call && event.scope === state.environment && event.mock.allocation === value.mock.allocation && event.mock.scope === value.mock.scope)) {
                localMockEvents.push({ mock: value.mock, call, scope: state.environment, method: call.expression.name.text })
                state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true); mockRevision++
                for (const execution of localMockExecutions.values()) schedule(execution.key, execution.state)
              }
            }
          }
          if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'spyOn'
            && emptyMockReceiver(call.expression.expression) && call.arguments[0]) {
            for (const target of scopedValues(call.arguments[0], state.environment)) if (target.classValue) {
              const cell = heapCell(target, 'records')
              if (cell && !cell.invalidated) { cell.invalidated = true; state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true); state.environment.heap.notify?.(cell) }
            }
          }
          if (ts.isPropertyAccessExpression(call.expression) && ['__defineGetter__', '__defineSetter__'].includes(call.expression.name.text)) {
            for (const target of scopedValues(call.expression.expression, state.environment)) {
              const cell = target.elements ? heapCell(target, 'arrays') : target.record || target.instance || target.classValue || target.enumValue || target.prototypeRecord || target.sourcePrototype || target.mapValue || target.callable || target.boundCallable ? heapCell(target, 'records') : null
              if (cell && !cell.invalidated) { cell.invalidated = true; state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true); state.environment.heap.notify?.(cell) }
            }
          }
          if (ts.isPropertyAccessExpression(call.expression)
            && ['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf', 'set', 'deleteProperty'].includes(call.expression.name.text)
            && ['Object', 'Reflect'].some(name => ambientIntrinsicReference(call.expression.expression, name)) && call.arguments[0]) {
            const copies = call.expression.name.text === 'assign' ? scopedValues(call, state.environment) : []
            if (copies.length && copies.every(value => value.prototypeRecord && value.copySource === call)) continue
            for (const target of scopedValues(call.arguments[0], state.environment)) {
              const cell = target.elements ? heapCell(target, 'arrays') : target.record || target.instance || target.classValue || target.enumValue || target.prototypeRecord || target.sourcePrototype || target.mapValue || target.callable || target.boundCallable ? heapCell(target, 'records') : null
              if (cell && !cell.invalidated) { cell.invalidated = true; state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true); state.environment.heap.notify?.(cell) }
            }
          }
          const callScopes = state.environment.heap?.callScopes
          if (callScopes) {
            if (!callScopes.has(call)) callScopes.set(call, new Set())
            if (!callScopes.get(call).has(state.environment)) {
              callScopes.get(call).add(state.environment)
              // Invocation facts invalidate effect proofs, not point-to queries.
              state.environment.heap.version++; advanceProofFacts(state.environment.heap)
            }
          }
          if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'set' && call.arguments.length === 2) {
            for (const receiver of scopedValues(call.expression.expression, state.environment)) if (receiver.mapValue) {
              const cell = heapCell(receiver, 'records')
              if (!cell || cell.invalidated) continue
              cell.mapEntries ??= []
              if (!cell.mapEntries.some(binding => binding.expression === call.arguments[1] && binding.key === call.arguments[0] && binding.scope === state.environment)) {
                cell.mapEntries.push({ key: call.arguments[0], expression: call.arguments[1], scope: state.environment })
                state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true); state.environment.heap.notify?.(cell)
              }
            }
          }
          const mutation = entry.arrayMutations?.find(item => item.call === call)
          if (mutation) {
            const receivers = memberReceivers(mutation.receiver, state.environment).filter(value => value.elements)
            if (['pop', 'shift', 'splice', 'fill', 'copyWithin'].includes(mutation.method)) for (const receiver of receivers) unknownArrayLength(receiver)
            const inserted = mutation.method === 'splice' ? [...call.arguments].slice(2)
              : mutation.method === 'fill' ? [...call.arguments].slice(0, 1)
                : ['push', 'unshift'].includes(mutation.method) ? [...call.arguments] : []
            const previousObserver = heapReadObserver
            heapReadObserver = cell => {
              if (!heapReaders.has(cell)) heapReaders.set(cell, new Map())
              heapReaders.get(cell).set(key, state)
            }
            try {
              for (const argument of inserted) {
                const bindings = ts.isSpreadElement(argument) ? finiteSpreadBindings(argument.expression, state.environment) : [{ expression: argument, scope: state.environment }]
                for (const receiver of receivers) for (const binding of bindings ?? []) heapBinding(heapCell(receiver, 'arrays'), null, binding, state.environment.heap)
              }
            } finally { heapReadObserver = previousObserver }
          }
          // Static source invocations already carry their actual arguments. Do not
          // re-expand the same source program as a returned-value query. Native
          // signatures have their own callback/input boundaries above.
          const staticTargets = [...(entry.callContexts ?? [])].filter(([, contexts]) => contexts.some(context => context.call === call)).map(([id]) => nodes.get(id)?.ast)
          const captures = target => { for (let owner = target?.parent; owner; owner = owner.parent) if (callable(owner)) return true; return false }
          const directSource = staticTargets.length && !ts.isPropertyAccessExpression(call.expression) && !ts.isElementAccessExpression(call.expression) && !staticTargets.some(captures)
          if (!directSource) {
            const argumentsValues = [...(call.arguments ?? [])].flatMap(argument => scopedValues(ts.isSpreadElement(argument) ? argument.expression : argument, state.environment))
            const targets = scopedValues(call.expression, state.environment)
            const source = value => knownNonCallable(value) || value.mock || value.mapMethod
              || sources.has((value.callable ?? value.functionAdapter?.target.callable ?? value.boundCallable?.target.callable)?.getSourceFile().fileName)
            // These native operations are independently checked at their
            // actual call boundary. A proven freeze or own-data enumeration
            // does not hand nested arrays to an unknown mutator.
            const nativeData = entry.nativeDataCalls?.includes(call) && ['freeze', 'values'].includes(call.expression.name.text)
              ? scopedValues(call, state.environment) : []
            const knownNativeData = nativeData.length && nativeData.every(value => call.expression.name.text === 'values'
              ? value.elements && !heapCell(value, 'arrays')?.invalidated
              : value.nullish || Object.hasOwn(value, 'literalValue')
                || value.record && !heapCell(value, 'records')?.invalidated || value.elements && !heapCell(value, 'arrays')?.invalidated)
            const mutationReceivers = mutation ? memberReceivers(mutation.receiver, state.environment) : []
            const knownNativeMutation = mutation && !state.environment.heap?.arrayIntrinsicExposed
              && !state.environment.heap?.intrinsicExposed?.has('Array') && !state.environment.globalBindings?.has('Array')
              && mutationReceivers.length && mutationReceivers.every(value => value.elements && !heapCell(value, 'arrays')?.invalidated && !heapCell(value, 'arrays')?.unresolvedEscape)
            // Stringification is checked by its scoped effect summary after
            // reachable facts settle; unknown callbacks remain diagnostics.
            const deferredSerialization = entry.jsonStringifications?.includes(call)
            // Function adapters have their own scoped invocation analysis. A
            // proven native adapter does not expose the receiver to an unknown
            // mutator; source invocations and unresolved effects remain in that
            // analysis rather than being assumed harmless here.
            const deferredAdapter = entry.functionAdapters?.includes(call)
            if ((!targets.length || !targets.every(source)) && !knownNativeData && !knownNativeMutation && !deferredSerialization && !deferredAdapter) {
              const records = [], arrays = nestedArrays(argumentsValues, new Set(), records)
              for (const array of arrays) unknownArrayLength(array)
              const changedCells = new Set()
              for (const cell of [...arrays.map(value => heapCell(value, 'arrays')), ...records.map(value => heapCell(value, 'records'))]) {
                if (!cell) continue
                cell.escapeEvents ??= []
                if (!cell.escapeEvents.some(event => event.call === call && event.scope === state.environment && event.processContext === state.processContext)) {
                  cell.escapeEvents.push({ call, scope: state.environment, processContext: state.processContext })
                  cell.unresolvedEscape = true; changedCells.add(cell)
                }
              }
              if (changedCells.size) {
                state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true)
                for (const cell of changedCells) state.environment.heap.notify?.(cell)
              }
            }
            const classes = argumentsValues.filter(value => value.classValue || value.enumValue || value.mapValue)
            if (classes.length) {
              const targets = scopedValues(call.expression, state.environment)
              if (!targets.length || targets.some(value => !value.callable || !sources.has(value.callable.getSourceFile().fileName))) {
                for (const target of classes) {
                  const cell = heapCell(target, 'records')
                  if (cell && !cell.invalidated) { cell.invalidated = true; state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true); state.environment.heap.notify?.(cell) }
                }
                classEscapeDiagnostics.set(`${key}:${call.getStart()}`, { id: entry.id, kind: 'native-data', unboundedEffects: true,
                  effectCompleteness: 'unproven', reason: 'Escaped class or collection may be modified by an unresolved call',
                  expression: call.getText(), callsite: { file: entry.file, start: call.getStart() } })
              }
            }
          }
          if (!directSource && call.arguments?.length && state.environment.heap?.instanceEscapes) {
            const declarations = []
            for (const argument of call.arguments) {
              let declaration = baseBinding(argument), visited = new Set()
              while (declaration && !visited.has(declaration)) {
                visited.add(declaration)
                let initializer = declaration.initializer
                while (initializer && (ts.isParenthesizedExpression(initializer) || ts.isAsExpression(initializer) || ts.isNonNullExpression(initializer))) initializer = initializer.expression
                if (initializer && ts.isNewExpression(initializer)) {
                  const provider = providerOf(initializer.expression)
                  if (provider?.module && !provider.module.startsWith('.')) declarations.push(declaration)
                  break
                }
                declaration = initializer && ts.isIdentifier(initializer) ? bindingDeclaration(initializer) : null
              }
            }
            if (declarations.length) {
              const targets = scopedValues(call.expression, state.environment)
              if (!targets.length || targets.some(value => !value.mock && (!value.callable || !sources.has(value.callable.getSourceFile().fileName)))) for (const declaration of declarations) {
                const escapes = state.environment.heap.instanceEscapes
                if (!escapes.has(declaration)) escapes.set(declaration, [])
                const events = escapes.get(declaration)
                if (!events.some(event => event.call === call && event.scope === state.environment)) {
                  events.push({ call, scope: state.environment }); state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true)
                }
              }
            }
          }
          if (directSource) continue
          if (providerOf(call.expression)?.module && !providerOf(call.expression).module.startsWith('.')) continue
          let values
          const previousObserver = heapReadObserver
          heapReadObserver = cell => {
            if (!heapReaders.has(cell)) heapReaders.set(cell, new Map())
            heapReaders.get(cell).set(key, state)
          }
          try { values = scopedValues(call.expression, state.environment) }
          finally { heapReadObserver = previousObserver }
          callValues.set(call, values)
          for (const value of values) if (value.functionAdapter || value.boundCallable) {
            const facts = adapterInvocationFacts(value, call, state.environment)
            for (const invocation of facts.calls) {
              const target = nodes.get(byAst.get(invocation.target.callable))
              if (!target) continue
              if (!seen.dynamicEdges.has(entry.id)) seen.dynamicEdges.set(entry.id, new Set())
              seen.dynamicEdges.get(entry.id).add(target.id)
              enqueue(target.id, callEnvironment(target, { args: invocation.bindings.map(binding => binding.expression), argScopes: invocation.bindings.map(binding => binding.scope), call, scope: invocation.target.scope, receiver: invocation.receiver }, state.environment), key,
                { evidence: 'actual Function adapter invocation', callsite: { file: entry.file, start: call.getStart() } }, false, state.mainFile, state.processContext)
            }
          }
          if (values.some(value => value.pendingMockLog)) pendingMockReads.push({ call, state, key, entry })
          for (const value of values.flatMap(value => {
            if (!value.mock) return [value]
            recordMockCall(value.mock, call, state.environment)
            if (!value.mock.candidate) {
              const invocationKey = `${key}:${call.getStart()}:${contextKey(value.mock.allocation)}:${contextKey(value.mock.scope)}`
              if (!localMockExecutions.has(invocationKey)) localMockExecutions.set(invocationKey, { key, state, entry, call, mock: value.mock, revision: null })
            }
            return []
          })) if (value.callable) {
          const target = nodes.get(byAst.get(value.callable))
          if (target && value.scope === state.environment && entry.callContexts?.get(target.id)?.some(context => context.call === call)) continue
          if (target) {
            if (!seen.dynamicEdges.has(state.id)) seen.dynamicEdges.set(state.id, new Set())
            seen.dynamicEdges.get(state.id).add(target.id)
            enqueue(target.id, callEnvironment(target, { args: [...call.arguments], call, scope: value.scope, receiver: value.receiver }, state.environment), key,
              { evidence: 'scoped callable value', callsite: { file: entry.file, start: call.getStart() } }, false, state.mainFile, state.processContext)
          }
        }
        }
        for (const access of entry.recordReads ?? []) {
          const previousObserver = heapReadObserver
          heapReadObserver = cell => {
            if (!heapReaders.has(cell)) heapReaders.set(cell, new Map())
            heapReaders.get(cell).set(key, state)
          }
          let receivers
          try { receivers = scopedValues(access.expression, state.environment) }
          finally { heapReadObserver = previousObserver }
          const keys = ts.isPropertyAccessExpression(access) ? [access.name.text] : literalKeys(access.argumentExpression)
          const getters = new Set()
          for (const receiver of receivers) if (receiver.record) for (const name of keys ?? sourceGetterKeys) {
            for (const property of [...receiver.record.properties].reverse()) {
              if (!property.name || ts.isComputedPropertyName(property.name) || property.name.text !== name) continue
              if (ts.isSetAccessor(property)) continue
              if (ts.isGetAccessor(property)) getters.add(property)
              break
            }
          }
          if (!getters.size) continue
          // Runtime allocation evidence finds possible descriptors. The shared
          // effect summary determines which getters this read actually invokes,
          // preserving capture lifetime, preceding writes, and property order.
          const summary = summarizeCallback.expression(access, { scope: state.environment, observation: true, inspectCaptured: true, synchronous: true,
            scopeForCall: (fn, site, parent, capture, args) => { const target = nodes.get(byAst.get(fn)); return target ? callEnvironment(target, { args: args ?? [], unknownArgs: args === null, call: site, scope: capture }, parent) : parent },
            lookupCallable: (expression, scope) => scopedValues(expression, scope).filter(value => value.callable && !blocked.has(local(value.callable.getSourceFile().fileName))) })
          for (const invoked of summary.invocations) if (getters.has(invoked.callback)) {
            const target = nodes.get(byAst.get(invoked.callback))
            if (!target) continue
            if (!seen.dynamicEdges.has(entry.id)) seen.dynamicEdges.set(entry.id, new Set())
            seen.dynamicEdges.get(entry.id).add(target.id)
            const receiver = receivers.find(value => value.record === invoked.callback.parent && value.scope === invoked.capture)
            enqueue(target.id, callEnvironment(target, { args: [], call: invoked.call, scope: invoked.capture, receiver }, invoked.scope), key,
              { evidence: 'actual record getter read', callsite: { file: entry.file, start: access.getStart() } }, false, state.mainFile, state.processContext)
          }
          // A getter's unknown return is still an unknown value. Its proven
          // invocation above enters the actual body, where ordinary runtime
          // calls and inputs retain their existing effect checks.
        }
        if (entry.nodeEntry || entry.readerCall && nativeCallbackProviders.has(providerName(entry.provider))) executions.set(key, [key, state, entry])
        if (entry.collectionStores?.length || entry.arrayMutations?.length || entry.arrayIndexWrites?.length || entry.functionAdapters?.length || entry.mapCreations?.length || entry.mapOperations?.length || entry.inlineSetIterations?.length || entry.collectionSorts?.length || entry.collectionFroms?.length || entry.collectionSlices?.length || entry.collectionIterations?.length) collectionExecutions.set(key, { key, state, entry, revision: null })
        for (const iteration of entry.collectionIterations ?? []) {
          if (!reachedIterations.has(iteration.call)) reachedIterations.set(iteration.call, new WeakMap())
          const scopes = reachedIterations.get(iteration.call)
          if (!scopes.has(state.environment)) scopes.set(state.environment, new Set())
          scopes.get(state.environment).add(state.processContext)
        }
        if (entry.nativeDataCalls?.length || entry.jsonStringifications?.length) nativeDataExecutions.set(key, { key, state, entry, revision: null })
        if (entry.objectSpreads?.length) spreadExecutions.set(key, { key, state, entry, revision: null })
        if (entry.deferredMockArguments?.length) deferredMockExecutions.set(key, { key, state, entry, revision: null })
        for (const invocation of entry.mockInvocations ?? []) for (const { candidate, key: exportKey } of invocation.alternatives) {
          if (state.processContext !== 'test' || candidate.file !== testFile || candidate.mode !== 'replacement') continue
          recordMockCall({ allocation: candidate.factory, key: exportKey }, invocation.call, state.environment)
          for (const callback of mockCallbacks({ candidate, key: exportKey }, state.environment, invocation.call)) {
            const target = nodes.get(byAst.get(callback))
            if (!target) continue
            const callbackKey = enqueue(target.id, callEnvironment(target, { args: invocation.call.arguments, call: invocation.call }, state.environment), key,
              { evidence: 'finite shared mock implementation alternatives', exportPath: JSON.parse(exportKey), callsite: { file: entry.file, start: invocation.call.getStart() }, configurationFile: local(callback.getSourceFile().fileName), replacementStatus: blocked.has(candidate.target) ? 'replaced' : 'uncertain' }, true, state.mainFile, state.processContext)
            if (!finiteMockCallback(callback)) {
              const taskKey = `${key}\0${target.id}\0${invocation.call.getStart()}`
              if (summaryTasks.has(taskKey)) continue
              const task = { revision: null, frontiers: [], scope: state.environment }
              summaryTasks.set(taskKey, task)
              task.run = () => {
              const summary = summarizeCallback(callback, [...invocation.call.arguments], { scope: state.environment, call: invocation.call,
                scopeForCall: (fn, call, parent, capture, args) => { const target = nodes.get(byAst.get(fn)); return target ? callEnvironment(target, { args: args ?? [], unknownArgs: args === null, call, scope: capture }, parent) : parent },
                lookupCallable: (expression, scope) => scopedValues(expression, scope).filter(value => value.callable
                  && !blocked.has(local(value.callable.getSourceFile().fileName))) })
              const invocationKeys = [callbackKey]
              for (const [index, invoked] of (summary.invocations ?? []).entries()) {
                const target = nodes.get(byAst.get(invoked.callback))
                if (target && invoked.callback !== callback) invocationKeys[index] = enqueue(target.id, callEnvironment(target, { args: invoked.sourceArgs ?? [], unknownArgs: invoked.sourceArgs === null, call: invoked.call, scope: invoked.capture }, invoked.scope), invocationKeys[invoked.parent] ?? callbackKey, { evidence: 'actual source invocation from replacement', callsite: { file: local(invoked.call.getSourceFile().fileName), start: invoked.call.getStart() } }, true, state.mainFile, state.processContext)
              }
              task.frontiers = summary.frontiers.map(frontier => ({ id: entry.id, kind: 'callback-effect', moduleMock: true, callback: target.id,
                reason: frontier.reason, frontier, replacementIdentity: 'proven', invocationReplacement: 'proven', effectCompleteness: 'unproven' }))
              }
              moduleSummaries.push(task)
            }
          }
        }
        for (const event of entry.providerEvents ?? []) {
          const module = event.provider?.module?.replace(/^node:/, '')
          if (!module || module.startsWith('.') || !['uncertain', 'replace'].includes(event.action) || !state.environment.heap?.exposedProviders) continue
          if (!state.environment.heap.exposedProviders.has(module)) {
            state.environment.heap.exposedProviders.add(module)
            state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true)
          }
        }
        for (const event of entry.providerEvents ?? []) if (state.processContext === 'test' && event.action === 'uncertain') {
          const target = providerTarget(event.provider, event.ast), replacement = files.get(testFile)?.replacementMocks.get(target)
          if (replacement && blocked.delete(target)) {
            mockUncertainties.set(target, { ...replacement, reason: 'Replacement exports are reconfigured or escape on this case path', reconfiguration: event.ast.getText() })
            for (const attempt of pending) if (nodes.get(attempt[0]).file === target) enqueue(...attempt)
          }
        }
        for (const next of entry.edges) {
          const guards = entry.edgeGuards?.get(next)
          const guarded = guards?.size && !guards.has(null)
          const facts = guarded ? [...guards].map(expression => ({ receiver: expression.getText(), value: memberGuardValue(expression, state.environment) })) : []
          if (guarded && facts.every(fact => fact.value === 'null' || fact.value === 'undefined')) continue
          const target = nodes.get(next)
          if (!target) continue
          const argumentCall = entry.inlineCallbackArguments?.get(next)
          const argumentCallees = argumentCall && callValues.get(argumentCall)
          if (argumentCallees?.length && argumentCallees.every(value => value.mock || value.mapMethod?.name === 'set')) continue
          const argumentSites = [...(entry.callbackArgumentSites?.get(next) ?? [])]
          const deferredSites = argumentSites.filter(argument => (entry.collectionIterations ?? []).some(iteration => {
            if (iteration.call !== argument.parent) return false
            if (iteration.argument === argument) return true
            if (!['reduce', 'reduceRight'].includes(iteration.method) || iteration.call.arguments[1] !== argument) return false
            const previousObserver = heapReadObserver
            heapReadObserver = cell => {
              if (!heapReaders.has(cell)) heapReaders.set(cell, new Map())
              heapReaders.get(cell).set(key, state)
            }
            try { return emptyNativeReduction(iteration.call, state.environment) }
            finally { heapReadObserver = previousObserver }
          }))
          const otherOpaqueUse = entry.opaqueNonArgumentTargets?.has(next) || argumentSites.some(argument => !deferredSites.includes(argument))
          const contexts = [...(entry.callContexts?.get(next) ?? [])]
          if (otherOpaqueUse || !deferredSites.length && (entry.opaqueTargets?.has(next) || !contexts.length)) contexts.push(null)
          for (const context of contexts) {
            const values = context && callValues.get(context.call)
            // A known absent/non-callable property throws at this callsite. Its
            // declared receiver type cannot supply a method on another object.
            const definite = values?.length && values.every(value => value.callable || value.mock || value.functionAdapter || value.boundCallable || value.mapMethod || knownNonCallable(value))
            if (definite && values.every(value => value.functionAdapter || value.boundCallable)) continue
            if (definite && !values.some(value => byAst.get(value.callable) === next || byAst.get(value.functionAdapter?.target.callable ?? value.boundCallable?.target.callable) === next)) continue
            const actual = definite ? values.filter(value => byAst.get(value.callable) === next)
              : context && ts.isNewExpression(context.call) ? scopedValues(context.call, state.environment).filter(value => value.instance === target.ast.parent).map(receiver => ({ receiver })) : []
            for (const value of actual.length ? actual : [null]) {
              const explicit = context?.receiverArgument ? scopedValues(context.receiverArgument, state.environment) : []
              const receivers = explicit.length ? explicit : [value?.receiver]
              for (const receiver of receivers) {
              const environment = callEnvironment(target, context ? { ...context, ...(value ? { scope: value.scope } : {}), ...(receiver ? { receiver } : {}) } : null, state.environment)
              const parameters = context && callable(target.ast) ? target.ast.parameters.filter(parameter => environment.has(parameter)).map(parameter => ({ name: parameter.name.getText(), value: environment.get(parameter) })) : []
              const evidence = { ...entry.edgeEvidence.get(next), ...(context ? { callsite: { file: entry.file, start: context.call.getStart() } } : {}),
                ...(parameters.length ? { parameters } : {}), ...(facts.length ? { optionalGuard: facts } : {}) }
              enqueue(next, environment, key, evidence, entry.conservativeEdges.has(next) || facts.some(fact => fact.value === 'unknown'), state.mainFile, state.processContext)
              }
            }
          }
        }
      }
      if (cursor === queue.length - 1 && mockRevision !== previousMockRevision) {
        previousMockRevision = mockRevision
        for (const pending of pendingMockReads) for (const value of scopedValues(pending.call.expression, pending.state.environment)) if (value.callable) {
          const target = nodes.get(byAst.get(value.callable))
          if (target) enqueue(target.id, callEnvironment(target, { args: [...pending.call.arguments], call: pending.call, scope: value.scope }, pending.state.environment), pending.key,
            { evidence: 'actual mock call argument', callsite: { file: pending.entry.file, start: pending.call.getStart() } }, true, pending.state.mainFile, pending.state.processContext)
        }
      }
      if (cursor === queue.length - 1) for (const task of moduleSummaries) {
        const revision = `${environment.heap.version}:${contextRevision(task.scope)}`
        if (task.revision === revision) continue
        task.revision = revision; task.run()
      }
      if (cursor === queue.length - 1) for (const task of deferredMockExecutions.values()) {
        const { key, state, entry } = task, revision = `${environment.heap.version}:${contextRevision(state.environment)}`
        if (task.revision === revision) continue
        task.revision = revision
        const diagnostics = []; deferredMockDiagnostics.set(key, diagnostics)
        for (const deferred of entry.deferredMockArguments) {
          const receiver = scopedValues(deferred.call.expression.expression, state.environment)
          if (receiver.length && receiver.every(value => value.mock)) continue
          const targets = scopedValues(deferred.call.expression, state.environment)
          if (targets.length && targets.every(value => value.callable && sources.has(value.callable.getSourceFile().fileName))) continue
          diagnostics.push({ id: entry.id, kind: 'callback-effect', unboundedEffects: true, effectCompleteness: 'unproven',
            reason: 'Configuration receiver may execute an unresolved callback', expression: deferred.call.getText(),
            callsite: { file: entry.file, start: deferred.call.getStart() } })
        }
      }
      if (cursor === queue.length - 1) for (const [invocationKey, task] of localMockExecutions) {
        const { key, state, entry, call, mock } = task, revision = `${environment.heap.version}:${contextRevision(state.environment)}`
        if (task.revision === revision) continue
        task.revision = revision
        const diagnostics = []; localMockDiagnostics.set(invocationKey, diagnostics)
        const { definite, possible } = localMockConfigSelection(mock, state.environment, call)
        const implementations = definite ? [] : mock.callbacks.map(callback => ({ callable: callback, scope: mock.scope }))
        for (const event of possible) {
          if (['mockReset', 'mockRestore', 'resetAllMocks', 'restoreAllMocks'].includes(event.method)) {
            diagnostics.push({ id: entry.id, kind: 'callback-effect', moduleMock: true, unboundedEffects: true,
              reason: 'Local mock reset or restore lifetime is unresolved', callsite: { file: entry.file, start: call.getStart() } })
            continue
          }
          if (!event.method.startsWith('mockImplementation')) continue
          const values = event.call.arguments[0] ? scopedValues(event.call.arguments[0], event.scope) : []
          if (!values.length || values.some(value => !value.callable)) diagnostics.push({ id: entry.id, kind: 'callback-effect', moduleMock: true, unboundedEffects: true,
            reason: 'Local mock implementation identity or effects are unresolved', callsite: { file: entry.file, start: call.getStart() } })
          for (const value of values) if (value.callable) implementations.push(value)
        }
        for (const implementation of implementations) {
          const target = nodes.get(byAst.get(implementation.callable))
          if (!target) { diagnostics.push({ id: entry.id, kind: 'callback-effect', moduleMock: true, unboundedEffects: true,
            reason: 'Local mock callback source is unresolved', callsite: { file: entry.file, start: call.getStart() } }); continue }
          if (!seen.dynamicEdges.has(entry.id)) seen.dynamicEdges.set(entry.id, new Set())
          seen.dynamicEdges.get(entry.id).add(target.id)
          const callbackKey = enqueue(target.id, callEnvironment(target, { args: [...call.arguments], call, scope: implementation.scope }, state.environment), key,
            { evidence: 'actual local mock implementation', callsite: { file: entry.file, start: call.getStart() } }, false, state.mainFile, state.processContext)
          if (!finiteMockCallback(implementation.callable)) {
            const summaryKey = `${invocationKey}:${target.id}:${contextKey(implementation.scope)}`
            if (summaryTasks.has(summaryKey)) continue
            const summaryTask = { revision: null, frontiers: [], scope: state.environment }
            summaryTasks.set(summaryKey, summaryTask)
            summaryTask.run = () => {
              const summary = summarizeCallback(implementation.callable, [...call.arguments], { scope: state.environment, call,
                scopeForCall: (fn, site, parent, capture, args) => { const next = nodes.get(byAst.get(fn)); return next ? callEnvironment(next, { args: args ?? [], unknownArgs: args === null, call: site, scope: capture }, parent) : parent },
                lookupCallable: (expression, scope) => scopedValues(expression, scope).filter(value => value.callable && !blocked.has(local(value.callable.getSourceFile().fileName))) })
              const invocationKeys = [callbackKey]
              for (const [index, invoked] of (summary.invocations ?? []).entries()) {
                const next = nodes.get(byAst.get(invoked.callback))
                if (next && invoked.callback !== implementation.callable) invocationKeys[index] = enqueue(next.id, callEnvironment(next, { args: invoked.sourceArgs ?? [], unknownArgs: invoked.sourceArgs === null, call: invoked.call, scope: invoked.capture }, invoked.scope), invocationKeys[invoked.parent] ?? callbackKey,
                  { evidence: 'actual source invocation from local mock', callsite: { file: local(invoked.call.getSourceFile().fileName), start: invoked.call.getStart() } }, true, state.mainFile, state.processContext)
              }
              summaryTask.frontiers = summary.frontiers.map(frontier => ({ id: entry.id, kind: 'callback-effect', moduleMock: true, unboundedEffects: true,
                reason: frontier.reason, frontier, replacementIdentity: 'proven', effectCompleteness: 'unproven' }))
            }
            moduleSummaries.push(summaryTask)
            // This task can be created after the normal summary drain, even
            // when its callback was already reached and adds no queue item.
            summaryTask.revision = `${environment.heap.version}:${contextRevision(summaryTask.scope)}`
            summaryTask.run()
          }
        }
      }
      if (cursor === queue.length - 1) for (const task of nativeDataExecutions.values()) {
        const { key, state, entry } = task, revision = `${environment.heap.version}:${contextRevision(state.environment)}`
        if (task.revision === revision) continue
        task.revision = revision
        const diagnostics = []; nativeDataDiagnostics.set(key, diagnostics)
        for (const call of entry.nativeDataCalls ?? []) {
          const values = scopedValues(call, state.environment), targets = call.arguments[0] ? scopedValues(call.arguments[0], state.environment) : []
          const identityUnknown = state.environment.heap?.objectIntrinsicExposed || state.environment.heap?.intrinsicExposed?.has('Object') || state.environment.globalBindings?.has('Object')
          if (call.expression.name.text === 'values') {
            const safe = values.length && values.every(value => value.elements && !heapCell(value, 'arrays')?.invalidated)
            if (identityUnknown || !safe) diagnostics.push({ id: entry.id, kind: 'native-data', unboundedEffects: true, effectCompleteness: 'unproven',
              reason: 'Object values intrinsic identity or enumerable getter effects are unresolved', expression: call.getText(), callsite: { file: entry.file, start: call.getStart() } })
            continue
          }
          if (call.expression.name.text === 'freeze') {
            const safe = targets.length && targets.every(value => value.nullish || Object.hasOwn(value, 'literalValue')
              || value.record && !heapCell(value, 'records')?.invalidated || value.elements && !heapCell(value, 'arrays')?.invalidated)
            if (identityUnknown || !safe) diagnostics.push({ id: entry.id, kind: 'native-data', unboundedEffects: true, effectCompleteness: 'unproven',
              reason: 'Object freeze intrinsic identity or proxy effects are unresolved', expression: call.getText(), callsite: { file: entry.file, start: call.getStart() } })
            continue
          }
          if (identityUnknown || targets.some(value => value.prototypeRecord || value.sourcePrototype)
            && !(values.length && values.every(value => value.prototypeRecord && value.copySource === call))) diagnostics.push({
              id: entry.id, kind: 'native-data', unboundedEffects: true, effectCompleteness: 'unproven',
              reason: 'Object copy intrinsic identity or source/target accessor effects are unresolved',
              expression: call.getText(), callsite: { file: entry.file, start: call.getStart() },
            })
        }
        for (const call of entry.jsonStringifications ?? []) {
          const summary = summarizeCallback.expression(call, { scope: state.environment, inspectCaptured: true, synchronous: true,
            replacementBoundary: replacementBoundaryFor(state.environment, state.processContext),
            scopeForCall: (fn, site, parent, capture, args) => { const target = nodes.get(byAst.get(fn)); return target ? callEnvironment(target, { args: args ?? [], unknownArgs: args === null, call: site, scope: capture }, parent) : parent },
            lookupCallable: (expression, scope) => scopedValues(expression, scope).filter(value => value.callable && !blocked.has(local(value.callable.getSourceFile().fileName))) })
          const invocationKeys = [key]
          for (const [position, invoked] of summary.invocations.entries()) {
            if (coveredIterationInvocation(invoked, state.processContext)) { invocationKeys[position] = invocationKeys[invoked.parent] ?? key; continue }
            const target = nodes.get(byAst.get(invoked.callback))
            if (target) invocationKeys[position] = enqueue(target.id, callEnvironment(target, { args: invoked.sourceArgs ?? [], unknownArgs: invoked.sourceArgs === null, call: invoked.call, scope: invoked.capture }, invoked.scope), invocationKeys[invoked.parent] ?? key,
              { evidence: 'actual invocation while serializing data', callsite: { file: local(invoked.call.getSourceFile().fileName), start: invoked.call.getStart() } }, false, state.mainFile, state.processContext)
          }
          const directCallbacks = summary.invocations.some(invoked => invoked.call === call)
          if (!summary.complete || summary.value?.kind !== 'scalar' || directCallbacks) {
            const frontier = summary.frontiers[0]
            diagnostics.push({ id: entry.id, kind: 'native-data', unboundedEffects: true, effectCompleteness: 'unproven',
              reason: frontier?.reason ?? 'Serialization getter or toJSON effects are unresolved', ...(frontier ? { frontier } : {}),
              expression: call.getText(), callsite: { file: entry.file, start: call.getStart() } })
          }
        }
      }
      if (cursor === queue.length - 1) for (const task of spreadExecutions.values()) {
        const { key, state, entry } = task, revision = `${environment.heap.version}:${contextRevision(state.environment)}`
        if (task.revision === revision) continue
        task.revision = revision
        const diagnostics = []; spreadDiagnostics.set(key, diagnostics)
        for (const spread of entry.objectSpreads) {
          const factory = mockCandidates.find(candidate => candidate.file === testFile && candidate.factory
            && candidate.factory.pos <= spread.pos && spread.end <= candidate.factory.end)
          // A proven original-only Vitest factory spreads the actual module
          // namespace; its imports and initialization retain the real graph.
          // A partial or opaque factory remains an unresolved mock boundary.
          if (factory?.mode === 'original') continue
          const values = scopedValues(spread.expression, state.environment)
          let unknown = !values.length
          for (const source of values) {
            if (source.nullish || Object.hasOwn(source, 'literalValue')) continue
            if (source.elements && !heapCell(source, 'arrays')?.invalidated) continue
            if (source.prototypeRecord && !heapCell(source, 'records')?.invalidated) continue
            if (!source.record || heapCell(source, 'records')?.invalidated) { unknown = true; continue }
            const fields = new Map()
            for (const property of source.record.properties) {
              // Object spread creates data properties; any getters on its
              // source execute at the earlier spread, which has its own task.
              // A known copied key overwrites a preceding getter descriptor.
              if (ts.isSpreadAssignment(property)) {
                const copied = scopedValues(property.expression, source.scope)
                const keySets = copied.map(value => {
                  if (!value.record || heapCell(value, 'records')?.invalidated) return null
                  const keys = new Set()
                  for (const item of value.record.properties) {
                    if (ts.isSpreadAssignment(item) || item.name && ts.isComputedPropertyName(item.name)) return null
                    const name = item.name?.text
                    if (name && !(name === '__proto__' && ts.isPropertyAssignment(item))) keys.add(name)
                  }
                  return keys
                })
                if (keySets.length && keySets.every(Boolean)) for (const name of keySets[0]) if (keySets.every(keys => keys.has(name))) fields.set(name, null)
                continue
              }
              if (property.name && ts.isComputedPropertyName(property.name)) { unknown = true; continue }
              const name = property.name?.text
              if (!name || name === '__proto__' && ts.isPropertyAssignment(property)) continue
              if (ts.isGetAccessor(property)) fields.set(name, property)
              else if (!ts.isSetAccessor(property) || !ts.isGetAccessor(fields.get(name) ?? {})) fields.set(name, null)
            }
            for (const getter of fields.values()) if (getter) {
              const target = nodes.get(byAst.get(getter))
              if (!target || !getter.body) { unknown = true; continue }
              if (!seen.dynamicEdges.has(entry.id)) seen.dynamicEdges.set(entry.id, new Set())
              seen.dynamicEdges.get(entry.id).add(target.id)
              enqueue(target.id, callEnvironment(target, { args: [], call: spread, scope: source.scope, receiver: source }, state.environment), key,
                { evidence: 'enumerable object spread getter', callsite: { file: entry.file, start: spread.getStart() } }, false, state.mainFile, state.processContext)
            }
          }
          if (unknown) diagnostics.push({ id: entry.id, kind: 'object-spread', moduleMock: factory?.mode === 'uncertain', unboundedEffects: true, effectCompleteness: 'unproven',
            reason: 'Object spread source may execute an unresolved getter or proxy', expression: spread.getText(),
            callsite: { file: entry.file, start: spread.getStart() } })
        }
      }
      if (cursor === queue.length - 1) for (const task of collectionExecutions.values()) {
        const { key, state, entry } = task, revision = `${environment.heap.version}:${contextRevision(state.environment)}`
        if (task.revision === revision) continue
        task.revision = revision
        const diagnostics = []; collectionDiagnostics.set(key, diagnostics)
        for (const store of entry.collectionStores ?? []) {
          const receivers = memberReceivers(store.receiver, state.environment)
          if (!receivers.length) continue
          const absentOptionalReceiver = store.call.expression.questionDotToken && receivers.length && receivers.every(value => value.nullish || knownAbsentField(value))
          if (absentOptionalReceiver) continue
          const storageOnly = state.environment.heap && !state.environment.heap.arrayIntrinsicExposed && !state.environment.globalBindings?.has('Array')
            && closedArrayStorageBinding(store.receiver) && receivers.length && receivers.every(value => value.elements && !heapCell(value, 'arrays')?.invalidated)
          if (storageOnly) continue
          const callbacks = scopedValues(store.argument, state.environment).filter(value => value.callable)
          for (const callback of callbacks.length ? callbacks : [null]) diagnostics.push({ id: entry.id, kind: 'collection-callback', callback: byAst.get(callback?.callable),
              reason: 'Collection storage method identity or receiver allocation is unresolved', expression: store.call.getText(),
              unboundedEffects: !callback || !finiteMockCallback(callback.callable), effectCompleteness: 'unproven',
              callsite: { file: entry.file, start: store.call.getStart() } })
          if (store.nativeArray) continue
          // A different receiver's same-name method may execute the argument.
          // Retain the existing conservative invocation until its source or
          // intrinsic identity proves a storage-only operation.
          for (const value of callbacks) {
            const target = nodes.get(byAst.get(value.callable))
            if (target) {
              if (!seen.dynamicEdges.has(entry.id)) seen.dynamicEdges.set(entry.id, new Set())
              seen.dynamicEdges.get(entry.id).add(target.id)
              enqueue(target.id, callEnvironment(target, { args: [], unknownArgs: true, call: store.call, scope: value.scope }, state.environment), key,
                { evidence: 'unresolved callback-taking collection member', callsite: { file: entry.file, start: store.call.getStart() } }, true, state.mainFile, state.processContext)
            }
          }
        }
        for (const write of entry.arrayIndexWrites ?? []) {
          const receivers = memberReceivers(write.left.expression, state.environment)
          const arrays = receivers.filter(value => value.elements)
          if (!arrays.length) continue
          const compound = supportedCompoundOperators.has(write.operatorToken.kind)
          let safe = (write.operatorToken.kind === ts.SyntaxKind.EqualsToken || compound) && arrays.length === receivers.length
            && !!state.environment.heap && !state.environment.heap.arrayIntrinsicExposed && !state.environment.heap.objectIntrinsicExposed
            && !state.environment.heap.intrinsicExposed?.has('Array') && !state.environment.heap.intrinsicExposed?.has('Object')
            && !state.environment.globalBindings?.has('Array') && !state.environment.globalBindings?.has('Object')
            && arrays.every(value => !heapCell(value, 'arrays')?.invalidated && !heapCell(value, 'arrays')?.unresolvedEscape)
          let frontier
          if (safe) {
            const summary = summarizeCallback.expression(write.left.argumentExpression, { scope: state.environment, inspectCaptured: true, synchronous: true,
              scopeForCall: (fn, site, parent, capture, args) => { const target = nodes.get(byAst.get(fn)); return target ? callEnvironment(target, { args: args ?? [], unknownArgs: args === null, call: site, scope: capture }, parent) : parent },
              lookupCallable: (expression, scope) => scopedValues(expression, scope).filter(value => value.callable && !blocked.has(local(value.callable.getSourceFile().fileName))) })
            const invocationKeys = [key]
            for (const [position, invoked] of summary.invocations.entries()) {
              if (coveredIterationInvocation(invoked, state.processContext)) { invocationKeys[position] = invocationKeys[invoked.parent] ?? key; continue }
              const target = nodes.get(byAst.get(invoked.callback))
              if (target) invocationKeys[position] = enqueue(target.id, callEnvironment(target, { args: invoked.sourceArgs ?? [], unknownArgs: invoked.sourceArgs === null, call: invoked.call, scope: invoked.capture }, invoked.scope), invocationKeys[invoked.parent] ?? key,
                { evidence: 'actual invocation while evaluating an array index', callsite: { file: local(invoked.call.getSourceFile().fileName), start: invoked.call.getStart() } }, false, state.mainFile, state.processContext)
            }
            safe = summary.complete && summary.value?.kind === 'scalar' && summary.value.type === 'number'
            frontier = summary.frontiers[0]
          }
          if (safe && compound) {
            const summary = summarizeCallback.expression(write, { scope: state.environment, observation: true, inspectCaptured: true, synchronous: true,
              scopeForCall: (fn, site, parent, capture, args) => { const target = nodes.get(byAst.get(fn)); return target ? callEnvironment(target, { args: args ?? [], unknownArgs: args === null, call: site, scope: capture }, parent) : parent },
              lookupCallable: (expression, scope) => scopedValues(expression, scope).filter(value => value.callable && !blocked.has(local(value.callable.getSourceFile().fileName))) })
            const invocationKeys = [key]
            for (const [position, invoked] of summary.invocations.entries()) {
              if (coveredIterationInvocation(invoked, state.processContext)) { invocationKeys[position] = invocationKeys[invoked.parent] ?? key; continue }
              const target = nodes.get(byAst.get(invoked.callback))
              if (target) invocationKeys[position] = enqueue(target.id, callEnvironment(target, { args: invoked.sourceArgs ?? [], unknownArgs: invoked.sourceArgs === null, call: invoked.call, scope: invoked.capture }, invoked.scope), invocationKeys[invoked.parent] ?? key,
                { evidence: 'actual invocation in an indexed compound write', callsite: { file: local(invoked.call.getSourceFile().fileName), start: invoked.call.getStart() } }, false, state.mainFile, state.processContext)
            }
            safe = summary.complete && summary.value?.kind === 'scalar' && summary.value.type === 'number'
            frontier = summary.frontiers[0]
          }
          if (!safe) diagnostics.push({ id: entry.id, kind: 'collection-callback', unboundedEffects: true, effectCompleteness: 'unproven',
            reason: frontier?.reason ?? 'Array index identity or assignment effects are unresolved', ...(frontier ? { frontier } : {}),
            expression: write.getText(), callsite: { file: entry.file, start: write.getStart() } })
        }
        for (const mutation of entry.arrayMutations ?? []) {
          const receivers = memberReceivers(mutation.receiver, state.environment), arrays = receivers.filter(value => value.elements)
          if (!receivers.length) continue
          if (!arrays.length && !mutation.nativeArray) {
            const methods = scopedValues(mutation.call.expression, state.environment)
            if (methods.length && (methods.every(value => value.callable) || methods.every(knownNonCallable))) continue
          }
          let safe = !!state.environment.heap && !state.environment.heap.arrayIntrinsicExposed
            && !state.environment.heap.intrinsicExposed?.has('Array') && !state.environment.globalBindings?.has('Array')
            && receivers.length && arrays.length === receivers.length
            && arrays.every(value => !heapCell(value, 'arrays')?.invalidated && !heapCell(value, 'arrays')?.unresolvedEscape)
          let frontier
          const indices = mutation.method === 'splice' ? [0, 1] : mutation.method === 'fill' ? [1, 2]
            : mutation.method === 'copyWithin' ? [0, 1, 2] : []
          if (safe) for (const argument of mutation.call.arguments) if (ts.isSpreadElement(argument)
            && !finiteSpreadBindings(argument.expression, state.environment)) safe = false
          if (safe) for (const index of indices) {
            const argument = mutation.call.arguments[index]
            if (!argument) continue
            if (ts.isSpreadElement(argument)) { safe = false; break }
            const values = scopedValues(argument, state.environment)
            if (values.length && values.every(value => value.nullish || Object.hasOwn(value, 'literalValue') || value.primitiveType)) continue
            const summary = summarizeCallback.expression(argument, { scope: state.environment, inspectCaptured: true, synchronous: true,
              scopeForCall: (fn, site, parent, capture, args) => { const target = nodes.get(byAst.get(fn)); return target ? callEnvironment(target, { args: args ?? [], unknownArgs: args === null, call: site, scope: capture }, parent) : parent },
              lookupCallable: (expression, scope) => scopedValues(expression, scope).filter(value => value.callable && !blocked.has(local(value.callable.getSourceFile().fileName))) })
            const invocationKeys = [key]
            for (const [position, invoked] of summary.invocations.entries()) {
              if (coveredIterationInvocation(invoked, state.processContext)) { invocationKeys[position] = invocationKeys[invoked.parent] ?? key; continue }
              const target = nodes.get(byAst.get(invoked.callback))
              if (target) invocationKeys[position] = enqueue(target.id, callEnvironment(target, { args: invoked.sourceArgs ?? [], unknownArgs: invoked.sourceArgs === null, call: invoked.call, scope: invoked.capture }, invoked.scope), invocationKeys[invoked.parent] ?? key,
                { evidence: 'actual invocation while evaluating an array mutation bound', callsite: { file: local(invoked.call.getSourceFile().fileName), start: invoked.call.getStart() } }, false, state.mainFile, state.processContext)
            }
            if (!summary.complete || summary.value?.kind !== 'scalar') { safe = false; frontier = summary.frontiers[0]; break }
          }
          if (!safe) diagnostics.push({ id: entry.id, kind: 'collection-callback', unboundedEffects: true, effectCompleteness: 'unproven',
            reason: frontier?.reason ?? 'Array mutation identity, inserted iterator, or index coercion is unresolved', ...(frontier ? { frontier } : {}),
            expression: mutation.call.getText(), callsite: { file: entry.file, start: mutation.call.getStart() } })
        }
        for (const call of entry.functionAdapters ?? []) {
          const values = scopedValues(call.expression, state.environment)
          if (values.length && values.every(value => (value.functionAdapter || value.callable)
            && (!value.functionAdapter || !adapterInvocationFacts(value, call, state.environment).unresolved))) continue
          const summary = summarizeCallback.expression(call, { scope: state.environment, inspectCaptured: true,
            scopeForCall: (fn, site, parent, capture, args) => { const target = nodes.get(byAst.get(fn)); return target ? callEnvironment(target, { args: args ?? [], unknownArgs: args === null, call: site, scope: capture }, parent) : parent },
            lookupCallable: (expression, scope) => scopedValues(expression, scope).filter(value => value.callable && !blocked.has(local(value.callable.getSourceFile().fileName))) })
          if (summary.complete && summary.value?.kind === 'scalar') {
            const invocationKeys = [key]
            for (const [index, invoked] of summary.invocations.entries()) {
              const target = nodes.get(byAst.get(invoked.callback))
              if (target) invocationKeys[index] = enqueue(target.id, callEnvironment(target, { args: invoked.sourceArgs ?? [], unknownArgs: invoked.sourceArgs === null, call: invoked.call, scope: invoked.capture }, invoked.scope), invocationKeys[invoked.parent] ?? key,
                { evidence: 'actual source invocation from function adapter', callsite: { file: local(invoked.call.getSourceFile().fileName), start: invoked.call.getStart() } }, false, state.mainFile, state.processContext)
            }
            continue
          }
          const frontier = summary.frontiers[0]
          diagnostics.push({ id: entry.id, kind: 'collection-callback', unboundedEffects: true,
            effectCompleteness: 'unproven', reason: `Function adapter identity or receiver effects are unresolved${frontier ? `: ${frontier.reason}` : ''}`, ...(frontier ? { frontier } : {}),
            expression: call.getText(), callsite: { file: entry.file, start: call.getStart() } })
        }
        for (const creation of entry.mapCreations ?? []) {
          const values = scopedValues(creation, state.environment)
          if (!values.length || values.some(value => !value.mapValue)) diagnostics.push({ id: entry.id, kind: 'collection-callback', unboundedEffects: true, effectCompleteness: 'unproven',
            reason: 'Map constructor identity or entry iterator effects are unresolved', expression: creation.getText(), callsite: { file: entry.file, start: creation.getStart() } })
        }
        for (const operation of entry.mapOperations ?? []) {
          const receivers = memberReceivers(operation.receiver, state.environment)
          if (!receivers.length) continue
          if (!operation.nativeMap && !receivers.some(value => value.mapValue)) continue
          if (!['get', 'set', 'has', 'clear', 'delete'].includes(operation.call.expression.name.text)
            || !receivers.length || receivers.some(value => !value.mapValue || heapCell(value, 'records')?.invalidated)
            || state.environment.heap?.intrinsicExposed?.has('Map') || state.environment.globalBindings?.has('Map')) diagnostics.push({ id: entry.id, kind: 'collection-callback', unboundedEffects: true, effectCompleteness: 'unproven',
            reason: 'Map receiver or native method identity is unresolved', expression: operation.call.getText(), callsite: { file: entry.file, start: operation.call.getStart() } })
        }
        for (const sort of entry.collectionSorts ?? []) {
          const receivers = memberReceivers(sort.receiver, state.environment), arrays = receivers.filter(value => value.elements)
          if (!receivers.length) continue
          if (!arrays.length && !sort.nativeArray) {
            const methods = scopedValues(sort.call.expression, state.environment)
            if (methods.length && methods.every(value => value.callable)) continue
          }
          const callbacks = scopedValues(sort.argument, state.environment)
          const safe = !state.environment.heap?.arrayIntrinsicExposed && !state.environment.globalBindings?.has('Array')
            && arrays.length && arrays.length === receivers.length && arrays.every(value => !heapCell(value, 'arrays')?.invalidated)
            && callbacks.length && callbacks.every(value => value.callable)
          if (!safe) {
            diagnostics.push({ id: entry.id, kind: 'collection-callback', unboundedEffects: true, effectCompleteness: 'unproven',
              reason: 'Array sort receiver, comparator identity, or effects are unresolved', expression: sort.call.getText(), callsite: { file: entry.file, start: sort.call.getStart() } })
            continue
          }
          for (const value of arrays) {
            const cell = heapCell(value, 'arrays')
            if (cell && !cell.reordered) {
              cell.reordered = true; state.environment.heap.version++; valueFactsRevision++; advanceProofFacts(state.environment.heap, true)
              state.environment.heap.notify?.(cell)
            }
          }
          const possible = arrays.filter(value => value.elementBindings?.length || heapCell(value, 'arrays')?.items.length
            || value.elements.some(ts.isSpreadElement) || value.elements.length >= 2)
          if (!possible.length) continue
          const bindings = possible.flatMap(value => aggregateBindings(value))
          if (bindings.some(binding => ts.isSpreadElement(binding.expression) || binding.recursiveSpread)) {
            diagnostics.push({ id: entry.id, kind: 'collection-callback', unboundedEffects: true, effectCompleteness: 'unproven',
              reason: 'Array sort elements or comparator effects are unresolved', expression: sort.call.getText(), callsite: { file: entry.file, start: sort.call.getStart() } })
            continue
          }
          const options = { scope: state.environment, inspectCaptured: true, synchronous: true,
            scopeForCall: (fn, site, parent, capture, args) => { const target = nodes.get(byAst.get(fn)); return target ? callEnvironment(target, { args: args ?? [], unknownArgs: args === null, call: site, scope: capture }, parent) : parent },
            lookupCallable: (expression, scope) => scopedValues(expression, scope).filter(value => value.callable && !blocked.has(local(value.callable.getSourceFile().fileName))) }
          const values = bindings.map(binding => summarizeCallback.expression(binding.expression, { ...options, scope: binding.scope }))
          for (const summary of values) {
            for (const frontier of summary.frontiers) diagnostics.push({ id: entry.id, kind: 'collection-callback', unboundedEffects: true, effectCompleteness: 'unproven',
              reason: frontier.reason, frontier, expression: sort.call.getText(), callsite: { file: entry.file, start: sort.call.getStart() } })
            const invocationKeys = [key]
            for (const [index, invoked] of summary.invocations.entries()) {
              const child = nodes.get(byAst.get(invoked.callback))
              // Reading a captured value can revisit an earlier array call.
              // Its actual callback arguments are already owned by that
              // reached iteration in this activation and process; adding a
              // second unknown-argument invocation would lose that evidence.
              if (coveredIterationInvocation(invoked, state.processContext)) {
                invocationKeys[index] = invocationKeys[invoked.parent] ?? key
                continue
              }
              if (child) invocationKeys[index] = enqueue(child.id, callEnvironment(child, { args: invoked.sourceArgs ?? [], unknownArgs: invoked.sourceArgs === null, call: invoked.call, scope: invoked.capture }, invoked.scope), invocationKeys[invoked.parent] ?? key,
                { evidence: 'actual source invocation while evaluating sort elements', callsite: { file: local(invoked.call.getSourceFile().fileName), start: invoked.call.getStart() } }, false, state.mainFile, state.processContext)
            }
          }
          for (const callback of callbacks) {
            const target = nodes.get(byAst.get(callback.callable))
            if (!target) continue
            const summary = summarizeCallback(callback.callable, [], { ...options, call: sort.call, argumentBindings: [bindings, bindings] })
            const callbackKey = enqueue(target.id, callEnvironment(target, { args: [], unknownArgs: true, call: sort.call, scope: callback.scope }, state.environment), key,
              { evidence: 'array sort comparator', callsite: { file: entry.file, start: sort.call.getStart() } }, false, state.mainFile, state.processContext)
            const invocationKeys = [callbackKey]
            for (const [index, invoked] of summary.invocations.entries()) {
              const child = nodes.get(byAst.get(invoked.callback))
              if (child && invoked.callback !== callback.callable) invocationKeys[index] = enqueue(child.id, callEnvironment(child, { args: invoked.sourceArgs ?? [], unknownArgs: invoked.sourceArgs === null, call: invoked.call, scope: invoked.capture }, invoked.scope), invocationKeys[invoked.parent] ?? callbackKey,
                { evidence: 'actual source invocation from sort comparator', callsite: { file: local(invoked.call.getSourceFile().fileName), start: invoked.call.getStart() } }, false, state.mainFile, state.processContext)
            }
            for (const frontier of summary.frontiers) diagnostics.push({ id: entry.id, kind: 'collection-callback', unboundedEffects: true, effectCompleteness: 'unproven',
              reason: frontier.reason, frontier, expression: sort.call.getText(), callsite: { file: entry.file, start: sort.call.getStart() } })
          }
        }
        for (const creation of entry.inlineSetIterations ?? []) {
          const values = scopedValues(creation, state.environment)
          const unresolved = !values.length || values.some(value => !value.setBindings)
          const consumer = inlineSetConsumer(creation)
          const awaiting = consumer && ts.isForOfStatement(consumer) && consumer.awaitModifier
            && !unresolved && values.some(value => value.setBindings.some(binding => {
              const items = scopedValues(binding.expression, binding.scope)
              return !items.length || items.some(item => !Object.hasOwn(item, 'literalValue') && !item.nullish && !item.primitiveType)
            }))
          if (unresolved || awaiting) diagnostics.push({ id: entry.id, kind: 'collection-callback', unboundedEffects: true,
            effectCompleteness: 'unproven', reason: awaiting ? 'Async Set iteration may execute an unresolved thenable' : 'Set constructor or iterator effects are unresolved',
            expression: creation.getText(), callsite: { file: entry.file, start: creation.getStart() } })
        }
        for (const from of entry.collectionFroms ?? []) {
          const results = scopedValues(from.call, state.environment), callbacks = scopedValues(from.argument, state.environment)
          const safe = !state.environment.heap?.arrayIntrinsicExposed && !state.environment.heap?.objectIntrinsicExposed
            && !state.environment.globalBindings?.has('Array') && !state.environment.globalBindings?.has('Object')
            && results.length && results.every(value => value.elements && !heapCell(value, 'arrays')?.invalidated)
            && callbacks.length && callbacks.every(value => value.callable)
          if (!safe) {
            const input = from.call.arguments[0], properties = ts.isObjectLiteralExpression(input) ? [...input.properties] : []
            const property = properties.length === 1 && ts.isPropertyAssignment(properties[0]) && !ts.isComputedPropertyName(properties[0].name)
              && properties[0].name.text === 'length' ? properties[0] : null
            const stable = property && callbacks.length && callbacks.every(value => {
              const fn = value.callable, returns = fn && sourceReturns(fn)
              return fn && returns.length && returns.every(Boolean) && (!ts.isBlock(fn.body) || alwaysExits(fn.body))
                && !fn.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
            }) && !state.environment.heap?.arrayIntrinsicExposed && !state.environment.heap?.objectIntrinsicExposed
              && !state.environment.heap?.intrinsicExposed?.has('Array') && !state.environment.heap?.intrinsicExposed?.has('Object')
              && !state.environment.globalBindings?.has('Array') && !state.environment.globalBindings?.has('Object')
            const options = { scope: state.environment, inspectCaptured: true,
              scopeForCall: (fn, site, parent, capture, args) => { const target = nodes.get(byAst.get(fn)); return target ? callEnvironment(target, { args: args ?? [], unknownArgs: args === null, call: site, scope: capture }, parent) : parent },
              lookupCallable: (expression, scope) => scopedValues(expression, scope).filter(value => value.callable && !blocked.has(local(value.callable.getSourceFile().fileName))) }
            const length = stable && summarizeCallback.expression(property.initializer, options)
            const mappers = length?.complete && length.value?.kind === 'scalar' && length.value.type === 'number'
              ? callbacks.map(callback => summarizeCallback(callback.callable, [], { ...options, call: from.call, abstractArguments: ['undefined', 'number'] })) : []
            if (mappers.length && mappers.every(summary => summary.complete && summary.value?.kind !== 'bottom')) {
              for (const summary of mappers) {
                const invocationKeys = [key]
                for (const [index, invoked] of summary.invocations.entries()) {
                  const target = nodes.get(byAst.get(invoked.callback))
                  if (target && invoked.callback !== from.argument) invocationKeys[index] = enqueue(target.id, callEnvironment(target, { args: invoked.sourceArgs ?? [], unknownArgs: invoked.sourceArgs === null, call: invoked.call, scope: invoked.capture }, invoked.scope), invocationKeys[invoked.parent] ?? key,
                    { evidence: 'actual source invocation from Array.from mapper', callsite: { file: local(invoked.call.getSourceFile().fileName), start: invoked.call.getStart() } }, false, state.mainFile, state.processContext)
                }
              }
              const heap = state.environment.heap
              if (!heap.fromProofs.has(from.call)) heap.fromProofs.set(from.call, new WeakMap())
              const context = contextRevision(state.environment), prior = heap.fromProofs.get(from.call).get(state.environment)
              // Revalidating the same complete proof does not add a fact. In
              // particular, notifying its own consumers again can otherwise
              // keep an unchanged worklist alive indefinitely.
              if (prior?.proofVersion === heap.proofVersion && prior.contextRevision === context) continue
              heap.version++; valueFactsRevision++; heap.hasDynamicFromProof = true
              heap.fromProofs.get(from.call).set(state.environment, { proofVersion: heap.proofVersion, contextRevision: context })
              heap.notify?.(heapCell({ allocation: from.call, scope: state.environment }, 'arrays'))
              schedule(key, state)
              continue
            }
            const frontier = length?.frontiers?.[0] ?? mappers.flatMap(summary => summary.frontiers)[0]
            diagnostics.push({ id: entry.id, kind: 'collection-callback', unboundedEffects: true, effectCompleteness: 'unproven',
              reason: frontier?.reason ?? 'Array.from input, mapper identity, or iterator effects are unresolved', ...(frontier ? { frontier } : {}), expression: from.call.getText(),
              callsite: { file: entry.file, start: from.call.getStart() } })
            continue
          }
          if (results.every(value => !aggregateBindings(value).length)) continue
          for (const callback of callbacks) {
            const target = nodes.get(byAst.get(callback.callable))
            if (!target) continue
            if (!seen.dynamicEdges.has(entry.id)) seen.dynamicEdges.set(entry.id, new Set())
            seen.dynamicEdges.get(entry.id).add(target.id)
            enqueue(target.id, callEnvironment(target, { args: [], unknownIndexes: [0], numberIndexes: [1], call: from.call, scope: callback.scope }, state.environment), key,
              { evidence: 'Array.from mapper invocation', callsite: { file: entry.file, start: from.call.getStart() } }, false, state.mainFile, state.processContext)
          }
        }
        for (const slice of entry.collectionSlices ?? []) {
          const receivers = memberReceivers(slice.receiver, state.environment), arrays = receivers.filter(value => value.elements)
          if (!receivers.length) continue
          if (!arrays.length && !slice.nativeArray) continue
          const bounds = [...slice.call.arguments].map(argument => scopedValues(argument, state.environment))
          const safe = !state.environment.heap?.arrayIntrinsicExposed && !state.environment.globalBindings?.has('Array')
            && arrays.length === receivers.length && arrays.length && arrays.every(value => !heapCell(value, 'arrays')?.invalidated)
            && bounds.every(values => values.length && values.every(value => value.nullish || Object.hasOwn(value, 'literalValue')))
          if (!safe) diagnostics.push({ id: entry.id, kind: 'native-data', unboundedEffects: true, effectCompleteness: 'unproven',
            reason: 'Array slice identity, receiver, or bound coercion effects are unresolved', expression: slice.call.getText(),
            callsite: { file: entry.file, start: slice.call.getStart() } })
        }
        for (const iteration of entry.collectionIterations ?? []) {
          const receivers = memberReceivers(iteration.receiver, state.environment)
          if (!receivers.length) continue
          const arrays = receivers.filter(value => value.elements)
          if (!arrays.length && !iteration.nativeArray) {
            const methods = scopedValues(iteration.call.expression, state.environment)
            // Source-defined methods receive the callback as an argument; their
            // actual calls, if any, determine whether its body is reached.
            if (methods.length && methods.every(value => value.callable)) continue
            // A proved non-callable member throws before invoking a callback.
            if (methods.length && methods.every(knownNonCallable)) continue
            const callbacks = iteration.argument ? scopedValues(iteration.argument, state.environment) : []
            if (iteration.argument) for (const callback of callbacks) {
              const target = nodes.get(byAst.get(callback.callable))
              if (!target) continue
              if (!seen.dynamicEdges.has(entry.id)) seen.dynamicEdges.set(entry.id, new Set())
              seen.dynamicEdges.get(entry.id).add(target.id)
              enqueue(target.id, callEnvironment(target, { args: [], unknownArgs: true, call: iteration.call, scope: callback.scope }, state.environment), key,
                { evidence: 'unresolved collection callback', callsite: { file: entry.file, start: iteration.call.getStart() } }, true, state.mainFile, state.processContext)
            }
            if (iteration.argument && !ts.isArrowFunction(iteration.argument) && !ts.isFunctionExpression(iteration.argument)) {
              const summary = summarizeCallback.expression(iteration.receiver, { scope: state.environment, inspectCaptured: true,
                scopeForCall: (fn, site, parent, capture, args) => { const target = nodes.get(byAst.get(fn)); return target ? callEnvironment(target, { args: args ?? [], unknownArgs: args === null, call: site, scope: capture }, parent) : parent },
                lookupCallable: (expression, scope) => scopedValues(expression, scope).filter(value => value.callable && !blocked.has(local(value.callable.getSourceFile().fileName))) })
              if (summary.frontiers.length) diagnostics.push({ id: entry.id, kind: 'collection-callback', unboundedEffects: true, effectCompleteness: 'unproven',
                reason: `Collection iteration receiver identity is unresolved: ${summary.frontiers[0].reason}`, frontier: summary.frontiers[0], expression: iteration.call.getText(),
                callsite: { file: entry.file, start: iteration.call.getStart() } })
            }
            continue
          }
          const callbacks = iteration.argument ? scopedValues(iteration.argument, state.environment) : []
          const callbackTargets = new Set(callbacks.map(value => value.callable).filter(Boolean))
          const callbackMutatesReceiver = arrays.some(value => (heapCell(value, 'arrays')?.items ?? []).some(binding => {
            const visited = new Set()
            for (let scope = binding.scope; scope && !visited.has(scope); scope = scope.caller) {
              visited.add(scope)
              if (scope.callsite === iteration.call && callbackTargets.has(scope.functionNode)) return true
            }
            return false
          }))
          const reducing = iteration.method === 'reduce' || iteration.method === 'reduceRight'
          let bounded = !state.environment.heap?.arrayIntrinsicExposed && !state.environment.globalBindings?.has('Array')
            && receivers.length && arrays.length === receivers.length && arrays.every(value => {
              const cell = heapCell(value, 'arrays')
              return !cell?.invalidated && !cell?.unresolvedEscape
            })
            && !callbackMutatesReceiver
            && callbacks.every(value => !value.callable?.parameters?.some(parameter => parameter.dotDotDotToken))
            && (!reducing && knownBooleanPredicate(iteration.argument, state.environment) || callbacks.length && callbacks.every(value => value.callable))
          const hasCallback = !!iteration.argument
          const bindings = bounded && hasCallback ? arrays.flatMap(value => aggregateBindings(value)) : []
          const incomplete = bindings.some(binding => binding.recursiveSpread || ts.isSpreadElement(binding.expression))
          let reductionFrontier
          if (iteration.method === 'find' && bounded && !incomplete) {
            const options = { scope: state.environment, call: iteration.call, inspectCaptured: true, synchronous: true,
              scopeForCall: (fn, site, parent, capture, args) => { const target = nodes.get(byAst.get(fn)); return target ? callEnvironment(target, { args: args ?? [], unknownArgs: args === null, call: site, scope: capture }, parent) : parent },
              lookupCallable: (expression, scope) => scopedValues(expression, scope).filter(value => value.callable && !blocked.has(local(value.callable.getSourceFile().fileName))) }
            let initial = iteration.call
            while (initial.parent && (ts.isParenthesizedExpression(initial.parent) || ts.isAsExpression(initial.parent)
              || ts.isNonNullExpression(initial.parent) || ts.isTypeAssertionExpression(initial.parent))) initial = initial.parent
            const declaration = ts.isVariableDeclaration(initial.parent) && initial.parent.initializer === initial
              && ts.isVariableDeclarationList(initial.parent.parent) && (initial.parent.parent.flags & ts.NodeFlags.Const)
              && ts.isIdentifier(initial.parent.name) ? initial.parent : null
            let initializerSummary
            for (const binding of bindings) for (const callback of callbacks) {
              let summary = summarizeCallback(callback.callable, [], { ...options, argumentBindings: [
                [binding], [{ numeric: true, scope: state.environment }], [{ expression: iteration.receiver, scope: state.environment }],
              ] })
              // A predicate can recursively read the const initialized by its
              // own find. Summarizing that exact initializer establishes the
              // finite return domain before following the recursive read.
              if (declaration && !summary.complete) {
                initializerSummary ??= summarizeCallback.expression(declaration.name, options)
                if (initializerSummary.complete && initializerSummary.invocations.some(invoked => invoked.call === iteration.call
                  && invoked.scope === state.environment && invoked.callback === callback.callable)) summary = initializerSummary
              }
              if (!summary.complete) { bounded = false; reductionFrontier ??= summary.frontiers[0] }
              const invocationKeys = [key]
              for (const [index, invoked] of summary.invocations.entries()) {
                if (invoked.callback === callback.callable) continue
                if (coveredIterationInvocation(invoked, state.processContext)) { invocationKeys[index] = invocationKeys[invoked.parent] ?? key; continue }
                const target = nodes.get(byAst.get(invoked.callback))
                if (target) invocationKeys[index] = enqueue(target.id, callEnvironment(target, { args: invoked.sourceArgs ?? [], unknownArgs: invoked.sourceArgs === null, call: invoked.call, scope: invoked.capture }, invoked.scope), invocationKeys[invoked.parent] ?? key,
                  { evidence: 'actual source invocation from find predicate', callsite: { file: local(invoked.call.getSourceFile().fileName), start: invoked.call.getStart() } }, false, state.mainFile, state.processContext)
              }
            }
          }
          if (reducing && bounded && !incomplete && bindings.length) {
            const options = { scope: state.environment, call: iteration.call, inspectCaptured: true, synchronous: true,
              scopeForCall: (fn, site, parent, capture, args) => { const target = nodes.get(byAst.get(fn)); return target ? callEnvironment(target, { args: args ?? [], unknownArgs: args === null, call: site, scope: capture }, parent) : parent },
              lookupCallable: (expression, scope) => scopedValues(expression, scope).filter(value => value.callable && !blocked.has(local(value.callable.getSourceFile().fileName))) }
            const initial = iteration.call.arguments[1] && summarizeCallback.expression(iteration.call.arguments[1], options)
            bounded = !!initial?.complete && initial.value?.kind === 'scalar' && initial.value.type === 'number'
            if (!bounded) reductionFrontier = initial?.frontiers?.[0]
            for (const binding of bounded ? bindings : []) for (const callback of callbacks) {
              const summary = summarizeCallback(callback.callable, [], { ...options, argumentBindings: [
                [{ numeric: true, scope: state.environment }], [binding], [{ numeric: true, scope: state.environment }],
                [{ expression: iteration.receiver, scope: state.environment }],
              ] })
              if (!summary.complete || summary.value?.kind !== 'scalar' || summary.value.type !== 'number') {
                bounded = false; reductionFrontier ??= summary.frontiers[0]
              }
            }
          }
          if (bounded && hasCallback && !incomplete) for (const binding of bindings) for (const callback of callbacks) {
            const target = nodes.get(byAst.get(callback.callable))
            if (!target) continue
            if (!seen.dynamicEdges.has(entry.id)) seen.dynamicEdges.set(entry.id, new Set())
            seen.dynamicEdges.get(entry.id).add(target.id)
            const args = reducing ? [null, binding.expression, null, iteration.receiver] : [binding.expression, null, iteration.receiver]
            const argScopes = reducing ? [state.environment, binding.scope, state.environment, state.environment] : [binding.scope, state.environment, state.environment]
            enqueue(target.id, callEnvironment(target, { args, argScopes, numberIndexes: reducing ? [0, 2] : [1], call: iteration.call, scope: callback.scope }, state.environment), key,
              { evidence: 'array iteration callback', callsite: { file: entry.file, start: iteration.call.getStart() } }, false, state.mainFile, state.processContext)
          }
          if ((!bounded || incomplete) && hasCallback) for (const callback of callbacks) {
            const target = nodes.get(byAst.get(callback.callable))
            if (!target) continue
            if (!seen.dynamicEdges.has(entry.id)) seen.dynamicEdges.set(entry.id, new Set())
            seen.dynamicEdges.get(entry.id).add(target.id)
            enqueue(target.id, callEnvironment(target, { args: [], unknownArgs: true, call: iteration.call, scope: callback.scope }, state.environment), key,
              { evidence: 'unresolved collection callback', callsite: { file: entry.file, start: iteration.call.getStart() } }, true, state.mainFile, state.processContext)
          }
          if (!bounded || incomplete || hasCallback && !reducing && iteration.call.arguments.length > 1) diagnostics.push({ id: entry.id, kind: 'collection-callback', unboundedEffects: true, effectCompleteness: 'unproven',
            reason: reductionFrontier?.reason ?? (reducing ? 'Reduction accumulator or callback effects are unresolved' : 'Collection iteration method identity, receiver, or callback effects are unresolved'),
            ...(reductionFrontier ? { frontier: reductionFrontier } : {}),
            expression: iteration.call.getText(), callsite: { file: entry.file, start: iteration.call.getStart() } })
        }
      }
      if (cursor === queue.length - 1) for (const [executionKey, executionState, operation] of executions.values()) {
        const revision = `${environment.heap.version}:${contextRevision(executionState.environment)}`
        if (processedExecutions.get(executionKey) === revision) continue
        processedExecutions.set(executionKey, revision)
        const diagnostics = []
        nativeDiagnostics.set(executionKey, diagnostics)
        const resolution = inputResolution(operation.provider, operation.readerMethod, roots, seen, operation.id, testFile, undefined, executionKey)
        if (resolution.status === 'replaced') {
          const target = nodes.get(byAst.get(resolution.callback)), call = operation.readerCall
          const boundary = { call, scope: executionState.environment, processContext: executionState.processContext }
          const frame = target && call ? callEnvironment(target, { args: call.arguments, call }, executionState.environment) : null
          if (frame) {
            if (!nativeReplacementFrames.has(frame)) nativeReplacementFrames.set(frame, new Map())
            nativeReplacementFrames.get(frame).set(executionState.processContext, { boundary, operation, executionKey })
          }
          const callbackKey = frame ? enqueue(target.id, frame, executionKey,
            { evidence: 'finite native replacement callback', callsite: { file: local(call.getSourceFile().fileName), start: call.getStart() } }, true, executionState.mainFile, executionState.processContext) : null
          if (target && call && !finiteMockCallback(resolution.callback)) {
            const summary = summarizeCallback(resolution.callback, [...call.arguments], { scope: executionState.environment, call, replacementBoundary: boundary,
              scopeForCall: (fn, call, parent, capture, args) => { const target = nodes.get(byAst.get(fn)); return target ? callEnvironment(target, { args: args ?? [], unknownArgs: args === null, call, scope: capture }, parent) : parent },
              lookupCallable: (expression, scope) => scopedValues(expression, scope).filter(value => value.callable
                && !files.get(testFile)?.blocked.has(local(value.callable.getSourceFile().fileName))) })
            const invocationKeys = [callbackKey]
            for (const [index, invoked] of (summary.invocations ?? []).entries()) {
              const target = nodes.get(byAst.get(invoked.callback))
              if (target && invoked.callback !== resolution.callback) invocationKeys[index] = enqueue(target.id, callEnvironment(target, { args: invoked.sourceArgs ?? [], unknownArgs: invoked.sourceArgs === null, call: invoked.call, scope: invoked.capture }, invoked.scope), invocationKeys[invoked.parent] ?? callbackKey, { evidence: 'actual source invocation from native replacement', callsite: { file: local(invoked.call.getSourceFile().fileName), start: invoked.call.getStart() } }, true, executionState.mainFile, executionState.processContext)
            }
            for (const frontier of summary.frontiers) {
              diagnostics.push({ id: operation.id, kind: 'callback-effect', callback: target.id, reason: frontier.reason, frontier,
                replacementIdentity: 'proven', invocationReplacement: 'proven', effectCompleteness: 'unproven' })
            }
          }
          continue
        }
        if (resolution.status === 'uncertain' && executionState.processContext === 'test') {
          // Ordering/binding uncertainty must retain the possible replacement's
          // input scope, not only the original child/reader's dependencies.
          const alternatives = [...persistentNativeEvents(operation.provider, operation.readerMethod, testFile)]
          for (const id of seen) if ([...states.values()].some(state => state.id === id && state.processContext === 'test')) {
            alternatives.push(...(nodes.get(id).providerEvents ?? []).filter(event => event.callback))
          }
          for (const event of alternatives) {
            if (providerName(event.provider) !== providerName(operation.provider)
              || event.method && operation.readerMethod && event.method !== operation.readerMethod
              || !event.callback && event.action === 'replace') continue
            diagnostics.push({ id: operation.id, callback: byAst.get(event.callback), kind: 'native-callback',
              provider: providerName(event.provider), method: event.method, registration: { file: local(event.ast.getSourceFile().fileName), start: event.ast.getStart() },
              effectScope: event.callback && finiteMockCallback(event.callback) ? 'bounded conservative callback graph' : 'unbounded callback effects',
              unboundedEffects: !event.callback || !finiteMockCallback(event.callback),
              reason: event.persistent ? 'Persistent global native mock lifetime or callback effects are unresolved' : 'Native replacement callback invocation or ordering is unresolved' })
          }
        }
        if (!operation.nodeEntry) continue
        if (resolution.status === 'uncertain') {
          const candidates = new Set(executionState.processContext === 'test' ? persistentNativeEvents(operation.provider, operation.readerMethod, testFile) : [])
          for (const [, state] of states) if (state.processContext === executionState.processContext) {
            for (const event of nodes.get(state.id).providerEvents ?? []) candidates.add(event)
          }
          const replacementBoundaries = [...candidates].filter(event => event.boundaryDiagnostic
            && providerName(event.provider) === providerName(operation.provider)
            && (!event.method || !operation.readerMethod || event.method === operation.readerMethod))
            .map(event => ({ ...event.boundaryDiagnostic, invocationReplacement: 'unproven', evidenceRole: 'matching registration candidate, not proof of invocation' }))
          diagnostics.push({ id: operation.id, file: operation.nodeEntry.file, reason: 'Node entry provider replacement or delegation is unresolved', replacementBoundaries })
          continue
        }
        enqueue(operation.nodeEntry.target, new Map(), executionKey, { evidence: 'proven Node entry', mainFile: operation.nodeEntry.file }, false, operation.nodeEntry.file, `node:${operation.nodeEntry.file}`)
      }
    }
    seen.entryUncertainties = [...nativeDiagnostics.values(), ...collectionDiagnostics.values(), ...iterationDiagnostics.values(), ...nativeDataDiagnostics.values(), ...classEscapeDiagnostics.values(), ...spreadDiagnostics.values(), ...localMockDiagnostics.values(), ...deferredMockDiagnostics.values()].flat().concat(moduleSummaries.flatMap(task => task.frontiers))
      .sort((a, b) => Number(!!b.moduleMock) - Number(!!a.moduleMock))
    seen.trace = { states, first }
    seen.mockUncertainties = mockUncertainties
    return seen
  }
  const deferredHelpers = new WeakMap()
  function deferredAfter(fn, acquisition, processEntry, visiting = new Set()) {
    if (!fn?.name || visiting.has(fn)) return false
    let memo = deferredHelpers.get(fn)
    if (!memo) { memo = new Map(); deferredHelpers.set(fn, memo) }
    const key = processEntry + ':' + local(acquisition.getSourceFile().fileName) + ':' + acquisition.end
    if (memo.has(key)) return memo.get(key)
    const symbol = symbolAtLocation(fn.name), source = fn.getSourceFile()
    let valid = true, calls = 0
    const visit = node => {
      if (!valid || typeOnly(node)) return
      if (ts.isIdentifier(node) && node !== fn.name && symbolAtLocation(node) === symbol) {
        if (!ts.isCallExpression(node.parent) || node.parent.expression !== node) { valid = false; return }
        calls++
        let owner
        for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) if (callable(parent)) { owner = parent; break }
        const registrationCall = owner?.parent, provider = registrationCall && ts.isCallExpression(registrationCall) && providerOf(registrationCall.expression)
        if (owner && ['node:test', 'vitest'].includes(provider?.module) && ['test', 'it'].includes(provider.export) && stableBinding(registrationCall.expression)) {
          const ownerFile = local(source.fileName), loadedFile = local(acquisition.getSourceFile().fileName)
          if (!(ownerFile === loadedFile && owner.getStart() > acquisition.end
            || ownerFile === processEntry && (initializationSites.get(processEntry) ?? []).some(site => site.ast.end < owner.getStart() && initializesFrom(site.target, loadedFile)))) valid = false
        } else if (!owner || !deferredAfter(owner, acquisition, processEntry, new Set(visiting).add(fn))) valid = false
      }
      ts.forEachChild(node, visit)
    }
    visit(source); memo.set(key, valid && calls > 0)
    return valid && calls > 0
  }
  function moduleEntryStatus(risk, reached, ownerId, testFile) {
    const acquisition = loaderAcquisitions.get(risk)
    if (!factsComplete || !acquisition || !reached.trace) return 'uncertain'
    // A local require needs an actual, ordered cache-deletion proof. An eager
    // captured binding instead uses the existing process/scope proof below.
    let localAcquisition = false
    for (let ast = acquisition.parent; ast && !ts.isSourceFile(ast); ast = ast.parent) if (callable(ast)) {
      localAcquisition = true
      const contexts = [...reached.trace.states].filter(([, state]) => state.id === ownerId)
      if (contexts.length && contexts.every(([key, state]) => {
        if (state.processContext !== 'test') return false
        const path = explain([], reached, ownerId, key), root = nodes.get(path.rootId)?.ast
        return root && freshModuleCapture(risk.target, ast, acquisition.end, ast, acquisition)
      })) return 'real'
      break
    }
    const declaration = baseBinding(acquisition.expression)
    if (!declaration || mutatedBindings.has(declaration) || bindingAliases.has(declaration)) return 'uncertain'
    const facts = bindingInvalidations.get(declaration)
    if (!facts?.size) return 'uncertain' // Never reinterpret missing provenance as safety.
    let scoped = loaderScopeContexts.get(reached)
    if (!scoped) {
      scoped = new Map()
      for (const state of reached.trace.states.values()) {
        if (!scoped.has(state.id)) scoped.set(state.id, [])
        scoped.get(state.id).push(state)
      }
      loaderScopeContexts.set(reached, scoped)
    }
    const contexts = scoped.get(ownerId) ?? []
    if (!contexts.length) return 'uncertain'
    for (const context of contexts) {
      const processEntry = context.mainFile ?? testFile
      const rootAst = nodes.get(explain([], reached, ownerId, [...reached.trace.states].find(([, state]) => state === context)?.[0]).rootId)?.ast
      if (localAcquisition && !rootAst) return 'uncertain'
      const previouslyLoaded = rootAst && (initializationSites.get(processEntry) ?? []).some(site => site.ast.end < rootAst.getStart()
        && initializesFrom(site.target, risk.target))
      // A module loaded later by a callback is not an eager process capture.
      if (!initializesFrom(processEntry, local(acquisition.getSourceFile().fileName))) return 'uncertain'
      for (const fact of facts) {
        const file = local(fact.getSourceFile().fileName)
        if (!runtimeReaches(processEntry, file)) continue
        let owner, callback, helper
        for (let ast = fact; ast && !ts.isSourceFile(ast); ast = ast.parent) {
          if (!owner && byAst.has(ast)) owner = byAst.get(ast)
          if (!helper && callable(ast)) helper = ast
          if (callable(ast) && ts.isCallExpression(ast.parent) && registration(ast.parent)) {
            const provider = providerOf(ast.parent.expression)
            if (['node:test', 'vitest'].includes(provider?.module) && ['test', 'it'].includes(provider.export)
              && stableBinding(ast.parent.expression)) callback = byAst.get(ast)
          }
        }
        const ownerStates = scoped.get(owner) ?? []
        // Deleting a cache slot in a later registered leaf cannot change the
        // initialization that an earlier eager require already executed. Keep
        // earlier registrations and mutations of cached exports conservative.
        const cacheSlotDeletion = (ts.isDeleteExpression(fact.parent) || ts.isBinaryExpression(fact.parent) && fact.parent.left === fact)
          && ts.isElementAccessExpression(fact)
          && ts.isPropertyAccessExpression(fact.expression) && fact.expression.name.text === 'cache' && implicitRequire(fact.expression.expression)
        const restoration = ts.isBinaryExpression(fact.parent) && fact.parent.right === fact && ts.isElementAccessExpression(fact.parent.left)
          && ts.isPropertyAccessExpression(fact.parent.left.expression) && fact.parent.left.expression.name.text === 'cache'
          && implicitRequire(fact.parent.left.expression.expression)
        if (cacheSlotDeletion && callback) {
          const callbackAst = nodes.get(callback).ast, acquisitionFile = local(acquisition.getSourceFile().fileName)
          const earlierAcquisition = file === acquisitionFile && callbackAst.getStart() > acquisition.end
            || file === processEntry && (initializationSites.get(file) ?? []).some(site => site.ast.end < callbackAst.getStart() && initializesFrom(site.target, acquisitionFile))
          const laterCacheChange = localAcquisition && file === acquisitionFile && fact.getStart() > acquisition.end
          if ((!localAcquisition && earlierAcquisition) || laterCacheChange) continue
        }
        if ((cacheSlotDeletion || restoration) && !localAcquisition && helper && deferredAfter(helper, acquisition, processEntry)) continue
        if (ownerStates.some(state => state.processContext === context.processContext)) return 'uncertain'
        if (ownerStates.length) continue // An actually reached different process cannot mutate this cache.
        // An unrelated registered leaf is not an initializer. Do not extend this
        // exemption to arbitrary callbacks/helpers whose invocation is unknown.
        if (callback && !(scoped.get(callback) ?? []).some(state => state.processContext === context.processContext)) {
          if (localAcquisition && !previouslyLoaded) return 'uncertain'
          continue
        }
        return 'uncertain'
      }
    }
    return 'real'
  }
  function callbackMayAffect(callback, targets, changedFile, reached, testFile) {
    if (!callback) return true // An opaque persistent callback has no bounded effect proof.
    const pending = [callback], visited = new Set()
    for (const id of pending) {
      if (visited.has(id)) continue
      visited.add(id)
      if (targets.has(id)) return true
      const node = nodes.get(id)
      if (!node) continue
      if (node.inputRisks?.some(risk => ['import', 'execute', 'glob'].includes(risk.kind) || risk.moduleImport
        || (risk.pattern ? new RegExp(risk.pattern).test(changedFile) : !risk.candidates?.length || risk.candidates.includes(changedFile)))) return true
      if (node.moduleEntryRisks?.some(risk => entryMayAffect(risk.target, changedFile))) return true
      if (node.unsafe) return true
      for (const store of node.collectionStores ?? []) {
        const callbacks = [...callableValues(store.argument)]
        if (!callbacks.length) return true
        pending.push(...callbacks)
      }
      pending.push(...node.edges, ...(reached.dynamicEdges?.get(id) ?? []))
      for (const invocation of node.mockInvocations ?? []) for (const { candidate, key } of invocation.alternatives) {
        if (candidate.file === testFile && candidate.mode === 'replacement') pending.push(...(candidate.configurations.get(key) ?? []).map(fn => byAst.get(fn)).filter(Boolean))
      }
      if (node.readerCall && nativeCallbackProviders.has(providerName(node.provider))) {
        const alternatives = [...persistentNativeEvents(node.provider, node.readerMethod, testFile)]
        for (const owner of reached) if ([...reached.trace.states.values()].some(state => state.id === owner && state.processContext === 'test')) alternatives.push(...(nodes.get(owner)?.providerEvents ?? []))
        if (alternatives.some(event => (event.callback || event.action === 'uncertain') && providerName(event.provider) === providerName(node.provider)
          && (!event.method || !node.readerMethod || event.method === node.readerMethod))) return true
      }
      if (node.nodeEntry) pending.push(node.nodeEntry.target)
    }
    return false
  }
  function persistentNativeEvents(provider, method, testFile) {
    return persistentNativeCandidates.filter(event => providerName(event.provider) === providerName(provider)
      && (!event.method || !method || event.method === method) && runtimeReaches(testFile, event.file))
  }
  function entryMayAffect(file, target) {
    if (runtimeReaches(file, target)) return true
    if (inputEdges.some(input => input.to === target && runtimeReaches(file, input.readerFile ?? input.from))) return true
    return [...inputRisks, ...inputPatterns].some(input => runtimeReaches(file, input.readerFile ?? input.from)
      && (input.pattern ? new RegExp(input.pattern).test(target) : !input.candidates?.length || input.candidates.includes(target)))
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
    const info = files.get(file)
    if (!info) return []
    const roots = new Set([info.top])
    // Ambiguous collection selects the complete owner, not every dormant
    // helper and nested callback declaration as an independent invocation.
    // Helpers remain reachable through the registrations that actually use them.
    for (const call of [...info.registrations, ...info.hooks]) {
      // `test.each(rows)` is a registration factory; its returned call owns
      // the leaf callback and its rows are inspected through that outer call.
      if (ts.isCallExpression(call.parent) && call.parent.expression === call && registration(call.parent)) continue
      roots.add(byAst.get(call))
      let callbacks = 0
      for (const argument of call.arguments) {
        const ids = callable(argument) ? [byAst.get(argument)] : [...callableValues(argument)]
        for (const id of ids.filter(Boolean)) { roots.add(id); callbacks++ }
      }
      if (!callbacks && nodes.has(byAst.get(call))) nodes.get(byAst.get(call)).unsafe = 'Test registration callback provenance is unresolved for the complete owner'
    }
    return [...roots].filter(Boolean)
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
    if (moduleEffect) { ids.add(files.get(file).top); nodes.get(files.get(file).top).unmappedModuleEffect = true }
    // Source files may also be consumed as bytes, independently of executed declarations.
    for (const id of inputTargets) ids.add(id)
    return ids
  }
  const explanations = new WeakMap()
  function explain(roots, reached, target, stateKey) {
    if (reached.trace) {
      const { states, first } = reached.trace
      if (!first.has(target)) return []
      const path = []
      for (let key = stateKey ?? first.get(target); key; key = states.get(key).parent) path.unshift(states.get(key))
      const result = path.map((state, index) => {
        const node = nodes.get(state.id)
        return { file: node.file, behavior: node.label, line: node.ast.getSourceFile().getLineAndCharacterOfPosition(node.ast.getStart()).line + 1, processContext: state.processContext, ...(index ? state.evidence : { root: true }) }
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
  // A captured CommonJS callable can observe a replacement only through a new
  // module instance acquired after installation. Prove the cache deletion and
  // export acquisition from finite lexical values; a later require alone is not
  // proof of freshness. This does not change captured-original behavior.
  function freshModuleCapture(moduleFile, installed, invocation, root, exactAcquisition) {
    if (installed.getSourceFile() !== root.getSourceFile() || invocation == null) return false
    const resolving = new Set()
    const values = (expression, env = new Map()) => {
      if (!expression || resolving.has(expression)) return undefined
      if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) return values(expression.expression, env)
      if (ts.isIdentifier(expression)) {
        const declaration = bindingDeclaration(expression)
        if (env.has(declaration)) return env.get(declaration)
        resolving.add(expression)
        const result = declaration?.initializer && !mutatedBindings.has(declaration) ? values(declaration.initializer, env) : undefined
        resolving.delete(expression); return result
      }
      if (ts.isArrayLiteralExpression(expression)) return expression.elements.map(item => values(item, env))
      if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
        const member = expression.expression
        if (implicitRequire(member.expression) && member.name.text === 'resolve' && expression.arguments.length === 1 && ts.isStringLiteralLike(expression.arguments[0])) {
          return importedModule(local(expression.getSourceFile().fileName), expression.arguments[0].text)
        }
        if (member.name.text === 'map' && expression.arguments.length === 1) {
          const input = values(member.expression, env), callback = expression.arguments[0]
          if (!Array.isArray(input) || !callable(callback) || ts.isBlock(callback.body) || callback.parameters.length !== 1 || !ts.isIdentifier(callback.parameters[0].name)) return undefined
          return input.map(value => values(callback.body, new Map([...env, [callback.parameters[0], value]])))
        }
      }
      return undefined
    }
    const deleted = new Set()
    let acquired = false
    const walk = (node, env = new Map()) => {
      if (node.getStart() >= invocation || node.end <= installed.getStart() || node !== root && callable(node)) return
      if (ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isForStatement(node)) { deleted.clear(); return }
      if (ts.isForOfStatement(node)) {
        const input = values(node.expression, env), declaration = ts.isVariableDeclarationList(node.initializer) && node.initializer.declarations[0]
        if (!Array.isArray(input) || !declaration) return
        for (const row of input) {
          const next = new Map(env)
          if (ts.isIdentifier(declaration.name)) next.set(declaration, row)
          else if (ts.isArrayBindingPattern(declaration.name) && Array.isArray(row)) declaration.name.elements.forEach((item, index) => {
            if (ts.isBindingElement(item) && ts.isIdentifier(item.name) && !item.initializer && !item.dotDotDotToken) next.set(item, row[index])
          })
          else return
          walk(node.statement, next)
        }
        return
      }
      if (ts.isDeleteExpression(node) && ts.isElementAccessExpression(node.expression)) {
        ts.forEachChild(node, child => walk(child, env))
        const access = node.expression
        if (ts.isPropertyAccessExpression(access.expression) && access.expression.name.text === 'cache' && implicitRequire(access.expression.expression)) {
          const file = values(access.argumentExpression, env)
          if (typeof file === 'string') deleted.add(file)
        }
        return
      }
      if (ts.isCallExpression(node) && implicitRequire(node.expression) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])
        && importedModule(local(node.getSourceFile().fileName), node.arguments[0].text) === moduleFile && deleted.has(moduleFile)
        && (!exactAcquisition || node === exactAcquisition)) acquired = true
      if (ts.isCallExpression(node)) deleted.clear() // Any intervening invocation may repopulate the cache.
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))) deleted.clear()
      ts.forEachChild(node, child => walk(child, env))
    }
    walk(root)
    if (!acquired) return false
    if (exactAcquisition) return true
    let invocationNode
    const locate = node => {
      if (node.getStart() === invocation && ts.isCallExpression(node)) invocationNode = node
      if (node.getStart() <= invocation && invocation < node.end) ts.forEachChild(node, locate)
    }
    locate(root)
    const binding = invocationNode && bindingDeclaration(invocationNode.expression)
    const initializer = binding && ts.isBindingElement(binding) && binding.parent.parent.initializer
    return !!initializer && ts.isCallExpression(initializer) && implicitRequire(initializer.expression)
      && initializer.arguments.length === 1 && ts.isStringLiteralLike(initializer.arguments[0])
      && importedModule(local(initializer.getSourceFile().fileName), initializer.arguments[0].text) === moduleFile
      && installed.getStart() < initializer.getStart() && initializer.end < invocation
  }
  function inputResolution(provider, method, roots, reached, target, testFile, inputProof, stateKey) {
    if (!provider) return { status: 'real' }
    if (!stateKey && reached.trace) {
      const states = [...reached.trace.states].filter(([, state]) => state.id === target)
      const results = states.map(([key]) => [key, inputStatus(provider, method, roots, reached, target, testFile, inputProof, key)])
      if (results.some(([, status]) => status === 'uncertain')) return { status: 'uncertain' }
      const real = results.find(([, status]) => status === 'real')
      if (real) { reached.trace.first.set(target, real[0]); return { status: 'real' } }
      return { status: results.length ? 'replaced' : 'uncertain' }
    }
    const processContext = reached.trace?.states.get(stateKey)?.processContext ?? 'test'
    if (processContext !== 'test') {
      // A real subprocess cannot inherit its parent's test mock registry. Local
      // replacement machinery in that process is not modeled as a test scope.
      for (const [, state] of reached.trace.states) if (state.processContext === processContext) {
        const entry = nodes.get(state.id), info = files.get(entry.file)
        if (info?.blockedProviders.has(providerName(provider)) || info?.uncertainProviders.has(providerName(provider))) return { status: 'uncertain' }
        if ((entry.providerEvents ?? []).some(event => event.all || providerName(event.provider) === providerName(provider))) return { status: 'uncertain' }
      }
      return { status: 'real' }
    }
    const key = providerName(provider)
    if (files.get(testFile)?.uncertainProviders.has(key)) return { status: 'uncertain' }
    const binding = inputProof ? readerBinding(inputProof) : nodes.get(target)?.readerBinding ?? { live: false }
    const initial = persistentNativeEvents(provider, method, testFile).length ? 'uncertain' : files.get(testFile)?.blockedProviders.has(key) ? binding.live && binding.moduleKind === 'esm' ? 'replaced' : 'uncertain' : 'real'
    const inputPath = explain(roots, reached, target, stateKey)
    const rootAst = nodes.get(inputPath.rootId)?.ast
    if (!rootAst) return { status: 'uncertain' }
    const invocation = inputPath.find(step => step.callsite?.file === testFile && rootAst.getStart() <= step.callsite.start && step.callsite.start < rootAst.end)?.callsite.start
      ?? (nodes.get(target)?.file === testFile ? nodes.get(target).ast.getStart() : null)
    const events = []
    const frameOf = ast => { for (let node = ast?.parent; node; node = node.parent) if (callable(node)) return node; return null }
    const callAt = site => {
      const info = files.get(site.file)
      if (!info) return null
      let found
      const locate = node => {
        if (node.getStart() === site.start && ts.isCallExpression(node)) found = node
        if (node.getStart() <= site.start && site.start < node.end) ts.forEachChild(node, locate)
      }
      locate(info.sf); return found
    }
    const capturedAfter = event => {
      if (!binding.capture) return false
      if (freshModuleCapture(binding.capture.file, event.ast, invocation, rootAst)) return true
      const frame = frameOf(event.ast)
      return frame && inputPath.some(step => step.callsite && step.callsite.file === local(frame.getSourceFile().fileName)
        && frame.getStart() <= step.callsite.start && step.callsite.start < frame.end
        && freshModuleCapture(binding.capture.file, event.ast, step.callsite.start, frame))
    }
    const canReachOperation = start => {
      const pending = [start], visited = new Set()
      for (const id of pending) {
        if (id === target) return true
        if (visited.has(id)) continue
        visited.add(id); pending.push(...(nodes.get(id)?.edges ?? []), ...(reached.dynamicEdges?.get(id) ?? []))
      }
      return false
    }
    // A final restore is after the operation only when every reachable callsite
    // from this root is before it. Do not conflate two calls around a restore.
    const laterInvocation = event => [...reached].some(id => [...(nodes.get(id)?.callContexts ?? [])].some(([next, contexts]) => canReachOperation(next)
      && contexts.some(({ call }) => call.getSourceFile() === rootAst.getSourceFile() && rootAst.getStart() <= call.getStart()
        && call.getStart() < rootAst.end && call.getStart() > event.ast.getStart())))
    for (const id of reached) for (const event of nodes.get(id)?.providerEvents ?? []) {
      if (reached.trace && ![...reached.trace.states.values()].some(state => state.id === id && state.processContext === processContext)) continue
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
        if ((event.action === 'restore' || event.action === 'uncertain' || event.callback) && laterInvocation(event)) return { status: 'uncertain' }
        continue
      }
      if (scope === 'helper') {
        const frame = frameOf(event.ast)
        const innerSite = frame && inputPath.find(step => step.callsite && frameOf(callAt(step.callsite)) === frame)?.callsite
        if (innerSite) {
          if (event.ast.getStart() > innerSite.start) {
            const later = [...reached].some(id => [...(nodes.get(id)?.runtimeCalls ?? [])].some(call => frameOf(call) === frame && call.getStart() > event.ast.getStart()
              && scopedValues(call.expression, reached.trace.states.get(reached.trace.first.get(id))?.environment ?? new Map()).some(value => value.callable && canReachOperation(byAst.get(value.callable)))))
            if (later) return { status: 'uncertain' }
            continue
          }
          events.push({ action: conditional ? 'uncertain' : event.action, native: event.native, callback: event.callback, order: event.ast.getStart(), capturedAfter: capturedAfter(event) })
          continue
        }
        const eventPath = explain(roots, reached, id)
        const callsite = eventPath.find(step => step.callsite?.file === testFile && rootAst.getStart() <= step.callsite.start && step.callsite.start < rootAst.end)?.callsite.start
        if (callsite === undefined || invocation === null) { events.push({ action: 'uncertain', order: Infinity }); continue }
        if (callsite > invocation) {
          if (event.action === 'restore' || event.action === 'uncertain' || event.callback) return { status: 'uncertain' }
          continue
        }
        events.push({ action: conditional ? 'uncertain' : event.action, native: event.native, callback: event.callback, order: callsite, capturedAfter: capturedAfter(event) })
      } else events.push({ action: conditional || scope === 'body' && invocation === null ? 'uncertain' : event.action, native: event.native, callback: event.callback, order: scope === 'before' ? -1 : event.ast.getStart(), capturedAfter: capturedAfter(event) })
    }
    events.sort((a,b) => a.order - b.order)
    const event = events.at(-1), action = event?.action
    const tied = events.filter(candidate => candidate.order === event?.order)
    if (tied.some(candidate => candidate.callback) && tied.some(candidate => candidate.callback !== event.callback || candidate.action !== action)) return { status: 'uncertain' }
    // Unresolved input risks have no scheduled operation node. Do not suppress
    // them while silently dropping an effectful replacement callback.
    if (action === 'replace' && event.callback && (!nodes.get(target)?.readerCall || inputProof && actualReaderCall(inputProof) !== nodes.get(target).readerCall)) return { status: 'uncertain' }
    const status = action === 'replace' ? (binding.live || event.capturedAfter) && binding.methodLive !== false ? 'replaced' : 'uncertain' : action === 'uncertain' ? 'uncertain' : initial
    return { status, callback: status === 'replaced' ? event?.callback : null }
  }
  function inputStatus(...args) { return inputResolution(...args).status }
  factsComplete = true
  return { nodes, reachable, moduleEntryStatus, caseRoots, wholeFileRoots, changedNodes, snapshot, explain, inputStatus, mockUncertainty, runtimeReaches, entryMayAffect, callbackMayAffect, hasFile: file => files.has(file) }
}

function selectBehaviors(inventory, changed, consumers, evidence) {
  const { sources, previousSources, ranges, compilerOptions } = evidence
  const head = behaviorGraph(sources, consumers.graph, compilerOptions, evidence.repositoryRoot, consumers.inputEdges, consumers.inputRisks, consumers.runtimeImportRisks, consumers.inputPatterns)
  const previous = evidence.previousConsumers ?? (previousSources === sources ? consumers : require('./dependencies.cjs').dependencyConsumers(inventory, previousSources))
  const graphs = [head, previousSources === sources ? head : behaviorGraph(previousSources, previous.graph, compilerOptions, evidence.repositoryRoot, previous.inputEdges, previous.inputRisks, previous.runtimeImportRisks, previous.inputPatterns)]
  const testRenames = evidence.testRenames ?? new Map()
  const oldTestPaths = new Map([...testRenames].map(([before, after]) => [after, before]))
  const selectedCases = {}, reasons = {}, details = {}, changedBehaviors = new Set(), candidates = new Set(), uncovered = new Set(), unobservedInputCandidates = [], unobservedEquivalentSources = []
  const analyses = changed.map(change => {
    const targets = graphs.map((g, i) => change.status === 'A' && i === 1 ? new Set() : g.changedNodes(change.file, graphs[1 - i], change.status))
    for (let i=0; i<2; i++) for (const id of targets[i]) changedBehaviors.add(`${change.file}#${graphs[i].nodes.get(id).label}`)
    const covered = [new Set(), new Set()]
    const riskConsumers = graph => [...(graph.runtimeImportRisks ?? []), ...(graph.inputPatterns ?? []), ...(graph.inputRisks ?? []).filter(risk => risk.pattern ? new RegExp(risk.pattern).test(change.file) : !risk.candidates?.length || risk.candidates.includes(change.file))]
      .flatMap(risk => [...(graph[risk.from] ?? []), ...(inventory.some(suite => suite.file === risk.from) ? [risk.from] : [])])
    const files = new Set([...(consumers[change.file] ?? []), ...riskConsumers(consumers), ...[...(previous[change.file] ?? []), ...riskConsumers(previous)].map(file => testRenames.get(file) ?? file)])
    for (const file of files) candidates.add(file)
    return { change, targets, covered, files }
  })
  // Reachability depends on the immutable snapshot and actual leaf roots, not
  // on which changed input is queried. Consume every input's evidence while
  // that one leaf trace is live, then release it before the next leaf.
  for (const suite of inventory) {
      const file = suite.file
      const jobs = analyses.filter(analysis => analysis.files.has(file)).map(analysis => ({
        ...analysis, caseEvidence: [], matched: [], owners: new Set(), conservativeCases: new Set(), initializationCases: new Set(),
        runtimeHit: false, caller: false, whole: false,
      }))
      if (!jobs.length) continue
      // A complete-owner fallback has identical roots for every ambiguous row.
      // Keep that immutable trace once per snapshot and owner, while retaining
      // independent case evidence and per-change coverage below.
      const ownerTraces = new Map()
      const fallback = !suite.locations || suite.locations.length !== suite.names.length
        || suite.names.some((name, i) => suite.names.indexOf(name) !== i)
        || suite.nativeNames && new Set(suite.nativeNames).size !== suite.nativeNames.length
      for (let index=0; index<suite.names.length; index++) {
        let uncertain = fallback
        const hits = new Set(), leafTraces = new Map()
        for (let i=0; i<2; i++) {
          const graphFile = i === 1 ? oldTestPaths.get(file) ?? file : file
          // Current collection coordinates are not trustworthy for an edited
          // base test body. Follow its whole old owner, then execute head leaves.
          const sameBody = i === 0 || previousSources.get(graphFile) === sources.get(file)
          const roots = sameBody && suite.locations?.[index] && graphs[i].caseRoots(graphFile, suite.locations[index])
          if (!roots) uncertain = true
          const actualRoots = roots || graphs[i].wholeFileRoots(graphFile)
          const traceKey = JSON.stringify([graphFile, [...actualRoots].sort()])
          // Multiple generated rows at the same source registration share an
          // unknown row context. Analyze that body once; execution still falls
          // back to the entire file if a duplicate identity is selected.
          const repeatedLocation = roots && fallback && suite.locations?.some((location, other) => other !== index
            && location?.line === suite.locations[index]?.line && location?.column === suite.locations[index]?.column)
          const traceCache = !roots || repeatedLocation ? ownerTraces : leafTraces
          if (!traceCache.has(graphs[i])) traceCache.set(graphs[i], new Map())
          const traces = traceCache.get(graphs[i])
          if (!traces.has(traceKey)) traces.set(traceKey, graphs[i].reachable(actualRoots, graphFile))
          const reached = traces.get(traceKey)
          for (const job of jobs) {
          const { change, targets, covered, caseEvidence, owners, conservativeCases, initializationCases } = job
          for (const entry of reached.entryUncertainties ?? []) if (entry.kind === 'callback-effect' || entry.unboundedEffects || (['native-callback', 'collection-callback'].includes(entry.kind) ? graphs[i].callbackMayAffect(entry.callback, targets[i], change.file, reached, graphFile) : graphs[i].entryMayAffect(entry.file, change.file))) {
            const error = new Error(`Unsafe ${entry.moduleMock ? 'mock boundary' : entry.kind === 'native-data' ? 'native data operation' : entry.kind === 'object-spread' ? 'object spread' : entry.kind === 'collection-callback' ? 'collection callback' : entry.kind === 'native-callback' ? 'native callback' : 'Node entry'}: ${entry.reason}; case ${file}#${suite.names[index]}; changed ${change.file}`)
            error.diagnostics = { executable: false, changed: change.file, test: file, caseIndex: index, path: [...graphs[i].explain(actualRoots, reached, entry.id)], unresolved: entry }
            throw error
          }
          for (const id of reached) {
            const unresolved = graphs[i].nodes.get(id)
            const failRisk = (message, risk) => {
              const error = new Error(`${message}; case ${file}#${suite.names[index]}; changed ${change.file}`)
              error.diagnostics = { executable: false, result: 'blocked', changed: change.file, test: file, caseIndex: index, case: suite.names[index], path: [...graphs[i].explain(actualRoots, reached, id)], unresolved: risk }
              throw error
            }
            if (unresolved?.unsafe) failRisk(`Unsafe runtime dispatch: ${file}: ${unresolved.unsafe}`, { reason: unresolved.unsafe })
            for (const risk of unresolved?.moduleEntryRisks ?? []) if (graphs[i].entryMayAffect(risk.target, change.file) && graphs[i].moduleEntryStatus(risk, reached, id, graphFile) !== 'real') failRisk(`Unsafe module initialization: ${risk.reason}`, risk)
            if (unresolved?.directoryInput) {
              const listing = unresolved.directoryInput
              const status = graphs[i].inputStatus(listing.listingProvider, listing.listingProvider?.export, actualRoots, reached, id, graphFile)
              if (status !== 'real') failRisk('Unsafe runtime directory membership: listing provider is replaced or its delegation is unresolved', { ...listing, providerStatus: status })
            }
            for (const risk of unresolved?.inputRisks ?? []) {
              if (risk.shellProof) {
                const status = graphs[i].inputStatus(risk.provider, risk.provider?.export, actualRoots, reached, id, graphFile, risk)
                if (status === 'replaced') continue
                if (status !== 'real') failRisk('Unsafe shell boundary: process provider is replaced or unresolved', risk)
                for (const proof of risk.shellProof.operations) if (graphs[i].inputStatus(proof.provider, proof.provider?.export, actualRoots, reached, id, graphFile, proof) !== 'real') {
                  failRisk('Unsafe shell bytes: data provider is replaced or unresolved', { ...risk, unprovenOperation: proof })
                }
                continue
              }
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
            // Importing a module executes initialization, but does not prove a
            // contract for an otherwise unaddressable changed module effect.
            if (target.unmappedModuleEffect) continue
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
            hits.add(job); covered[i].add(id)
            const path = graphs[i].explain(actualRoots, reached, id)
            caseEvidence.push({ index, name: suite.names[index], snapshot: i === 0 ? 'after' : 'before', reason: uncertain ? 'necessary whole-owner fallback' : path.initialization ? 'necessary module initialization' : path.conservative ? 'finite receiver dependency' : 'exact symbol dependency', path: [...path] })
            if (path.initialization) initializationCases.add(index)
            else job.runtimeHit = true
            if (path.conservative) { conservativeCases.add(index); job.caller = true }
            for (const step of path) if (step.file !== file && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(step.file) && !step.root) { owners.add(step.behavior); if (step.file !== change.file) job.caller = true }
          }
          }
        }
        for (const job of hits) {
          job.matched.push(index)
          if (uncertain) job.whole = true
        }
      }
      for (const job of jobs) {
      const { change, caseEvidence, matched, owners, conservativeCases, initializationCases, runtimeHit, caller, whole } = job
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
    }
  for (const { change, targets, covered } of analyses) {
    for (let i=0; i<2; i++) for (const id of targets[i]) {
      if (covered[i].has(id)) continue
      const label = graphs[i].nodes.get(id).label
      if (graphs[i].nodes.get(id).shape) continue
      const inputFile = graphs[i].nodes.get(id).inputFile
      if (inputFile && [...covered[i]].some(covered => graphs[i].nodes.get(covered)?.inputFile === inputFile)) continue
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
