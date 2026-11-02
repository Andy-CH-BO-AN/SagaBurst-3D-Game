const ts = require('typescript')
const runtimeParameters = node => (node.parameters ?? []).filter(parameter => !(ts.isIdentifier(parameter.name) && parameter.name.text === 'this'))

// Abstract values are evidence about data, never executable application values.
// Replacement identity is owned by the caller. This summary separately records
// effects of actual invocation and leaves an explicit frontier at unknown protocols.
function callbackEffects({ checker, declarationOf, providerOf, operation, local, sources, assignments, propertyAssignments = new Map(), scopeForDeclaration, allocationFacts, bindingScalar, observedScalar, invocationScopes, reachedBindingWrites, bindingMayHaveUnmodeledWrites, hasCompoundBindingWrites, finiteNumericLoopValues, numericInduction, contextMayReenter = () => true, bindingEscaped = () => true, providerStable = () => false, intrinsicStable = () => false }) {
  const unknown = Object.freeze({ kind: 'unknown' })
  const scalars = new Map(), constants = new Map()
  const scalar = type => {
    if (!scalars.has(type)) scalars.set(type, Object.freeze({ kind: 'scalar', type }))
    return scalars.get(type)
  }
  const constant = value => {
    if (!constants.has(value)) constants.set(value, Object.freeze({ kind: 'scalar', type: typeof value, value, constant: true }))
    return constants.get(value)
  }
  const data = (kind, fields = new Map(), items = []) => ({ kind, fields, items })
  const alternatives = value => value.kind === 'union' ? value.values : [value]
  const truth = value => value.constant ? !!value.value
    : value.kind === 'bottom' ? undefined
      : ['object', 'array', 'function', 'class', 'instance', 'map', 'set', 'buffer', 'native', 'mock', 'observer', 'promise', 'regexp'].includes(value.kind) ? true : undefined
  const possible = (value, expected) => alternatives(value).filter(part => truth(part) === undefined || truth(part) === expected)
  const nullish = value => value.constant ? value.value == null
    : value.kind === 'scalar' ? value.type === 'undefined' : ['unknown', 'json'].includes(value.kind) ? undefined : false
  const optionalUndefined = () => ({ ...constant(undefined), shortCircuit: true })
  const fork = env => Object.assign(new Map(env), { writes: new Set() })
  function merge(env, branches) {
    const keys = new Set([...env.keys(), ...branches.flatMap(branch => [...(branch.writes ?? [])])])
    for (const key of keys) env.set(key, join(branches.map(branch => branch.get(key) ?? env.get(key) ?? constant(undefined))))
    for (const branch of branches) for (const key of branch.writes ?? []) env.writes?.add(key)
  }
  const join = values => {
    const all = [...new Set(values.flatMap(alternatives))].filter(value => value.kind !== 'bottom')
    return all.length === 0 ? { kind: 'bottom' } : all.length === 1 ? all[0] : { kind: 'union', values: all }
  }
  const primitive = value => alternatives(value).every(v => v.kind === 'scalar')
  const numericResult = (left, right) => [...alternatives(left), ...alternatives(right)].some(value => value.kind !== 'scalar' || value.type === 'bigint')
    ? join([scalar('number'), scalar('bigint')]) : scalar('number')
  const additionResult = (left, right) => {
    const lhs = alternatives(left), rhs = alternatives(right)
    if (lhs.every(value => value.kind === 'scalar' && value.type === 'string') || rhs.every(value => value.kind === 'scalar' && value.type === 'string')) return scalar('string')
    if ([...lhs, ...rhs].every(value => value.kind === 'scalar' && !['string', 'bigint', 'symbol'].includes(value.type))) return scalar('number')
    if ([...lhs, ...rhs].every(value => value.kind === 'scalar' && value.type === 'bigint')) return scalar('bigint')
    return join([scalar('number'), scalar('string'), scalar('bigint')])
  }
  const dataScalar = value => alternatives(value).every(v => v.kind === 'scalar'
    || ['json', 'object', 'array'].includes(v.kind) && dataOnly(v)
      && intrinsicStable('Object', currentScope) && (v.kind !== 'array' || intrinsicStable('Array', currentScope))
      && !v.fields?.has('__proto__'))
  const dataOnly = (value, seen = new Set()) => {
    if (seen.has(value)) return false
    syncAllocation(value)
    const next = new Set(seen).add(value)
    return alternatives(value).every(v => v.kind === 'scalar' || v.kind === 'json' && !v.dataShape && !v.poisoned || !v.poisoned && !v.mathType && (['object', 'array'].includes(v.kind) || v.kind === 'json' && v.dataShape)
      && [...v.fields.values(), ...v.items, ...(v.fallback ? [v.fallback] : [])].every(item => dataOnly(item, next)))
  }
  const plain = (value, seen = new Set()) => {
    if (seen.has(value)) return true
    syncAllocation(value)
    seen.add(value)
    return alternatives(value).every(v => v.kind === 'scalar' || v.kind === 'function' || v.kind === 'json'
      || ['array', 'object', 'map', 'set', 'buffer'].includes(v.kind) && !v.fields.has('toJSON')
        && [...v.fields.values(), ...v.items, ...(v.fallback ? [v.fallback] : [])].every(item => plain(item, seen)))
  }
  const thisBinding = Symbol('source receiver')
  const native = (name, receiver) => ({ kind: 'native', name, receiver })
  const active = new Set(), activeInvocations = new Map()
  let frontiers, calls, reading, currentScope, parameterQueries, parameterValues, lookupCallable, scopeForCall, invocations, invocationStack, heapValues, activeScopes, entryScope, bindingValues, inspectCapturedInitializers, synchronousInvocation, recursiveBindings, pendingMapWrites, queuedMapWrites, pendingCompoundWrites, queuedCompoundWrites, flushedMapWrites, flushedCompoundWrites, replacementBoundary
  function queueCompoundWrite(write, declaration, owner, seed, env) {
    const node = write.ast ?? write.expression
    if (!queuedCompoundWrites.has(node)) queuedCompoundWrites.set(node, new Map())
    const scopes = queuedCompoundWrites.get(node), existing = scopes.get(write.scope)
    if (existing) {
      const added = alternatives(seed ?? unknown).filter(value => !alternatives(existing.seed).includes(value))
      if (added.length) {
        existing.seed = join([existing.seed, ...added])
        if (existing.processed) { existing.processed = false; pendingCompoundWrites.push(existing) }
      }
    }
    else {
      const pending = { write, declaration, owner, seed: seed ?? unknown, env: new Map(env) }
      scopes.set(write.scope, pending); pendingCompoundWrites.push(pending)
    }
  }
  function mayRepeatActivation(scope) {
    const seen = new Set()
    for (let current = scope; current?.caller && !seen.has(current); current = current.caller) {
      seen.add(current)
      if (contextMayReenter(current)) return true
      const site = current.callsite, frame = current.caller.functionNode
      // An opaque callback has no proved single invocation at its source site.
      if (!site) { if (ts.isFunctionLike(current.functionNode ?? {})) return true; continue }
      for (let node = site.parent; node && node !== frame; node = node.parent) if (ts.isIterationStatement(node, false)) return true
      if (ts.isCallExpression(site)) {
        const member = ts.isPropertyAccessExpression(site.expression) ? site.expression.name.text : null
        if (['forEach', 'map', 'flatMap', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every', 'reduce', 'reduceRight',
          'sort', 'replace', 'replaceAll', 'from', 'on', 'addListener', 'addEventListener', 'setInterval', 'then'].includes(member)) return true
        if (site.arguments.some(argument => {
          if (argument.pos <= current.functionNode?.pos && current.functionNode.end <= argument.end) return true
          const declaration = declarationOf(argument)
          return declaration === current.functionNode || declaration?.initializer === current.functionNode
        })) return true
      }
    }
    return false
  }
  function fixedLiteralData(node) {
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)
      || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true
    if (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operator)) return fixedLiteralData(node.operand)
    if (ts.isArrayLiteralExpression(node)) return node.elements.every(element => fixedLiteralData(element))
    return ts.isObjectLiteralExpression(node) && node.properties.every(property => ts.isPropertyAssignment(property)
      && !ts.isComputedPropertyName(property.name) && property.name.text !== '__proto__' && fixedLiteralData(property.initializer))
  }
  function stableFindDomain(receiver, declaration, owner) {
    if (contextMayReenter(owner)) return false
    const source = receiver.sourceNode, frameOf = node => { while (node && !ts.isFunctionLike(node) && !ts.isSourceFile(node)) node = node.parent; return node }
    let repeated = frameOf(source) === owner.functionNode && mayRepeatActivation(owner)
    if (source.getSourceFile() === declaration.getSourceFile()) for (let node = declaration.parent; node && node !== owner.functionNode; node = node.parent) {
      if (ts.isIterationStatement(node, false) && node.pos <= source.pos && source.end <= node.end) repeated = true
    }
    return !repeated || fixedLiteralData(source)
  }
  function effectAfterInvocation(scope, effect) {
    if (!synchronousInvocation || !scope || !entryScope || !effect) return false
    const readers = new Map(), seen = new Set()
    let child = null, delayed = false
    for (let current = entryScope; current && !seen.has(current); current = current.caller) {
      seen.add(current); readers.set(current, { child, delayed })
      const fn = current.functionNode
      delayed ||= !!fn?.asteriskToken || !!fn?.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      child = current
    }
    const frameOf = node => { while (node && !ts.isFunctionLike(node) && !ts.isSourceFile(node)) node = node.parent; return node }
    seen.clear(); child = null
    for (let current = scope; current && !seen.has(current); current = current.caller) {
      seen.add(current)
      const reader = readers.get(current)
      if (reader) {
        const before = reader.child?.callsite, after = child?.callsite ?? effect, frame = current.functionNode
        if (!before || !after || reader.delayed || mayRepeatActivation(current) || before.getSourceFile() !== after.getSourceFile()
          || frameOf(before) !== frame || frameOf(after) !== frame || after.getStart() < before.end) return false
        // A later statement can already have run on a previous iteration when
        // both sites are inside the same repeated region.
        for (let node = before.parent; node && node !== frame; node = node.parent) if (ts.isIterationStatement(node, false)
          && node.pos <= after.pos && after.end <= node.end) return false
        return true
      }
      child = current
    }
    return false
  }
  function entryFact(scope, effect) {
    const pending = [scope], visited = new Set()
    for (const current of pending) {
      if (!current || visited.has(current)) continue
      if (current === entryScope) return false
      visited.add(current); pending.push(current.caller, current.lexicalParent)
    }
    return !effectAfterInvocation(scope, effect)
  }
  function syncAllocation(value, includeItems = true) {
    // The interpreter owns allocations made by this invocation. Reinjecting
    // their own eventual graph writes as entry facts creates a feedback loop.
    // Captured allocations instead receive the preceding program's heap facts.
    if (!value.sourceNode || !value.capturedAllocation || activeScopes.has(value.sourceScope) || !allocationFacts) return
    const facts = allocationFacts(value.sourceNode, value.sourceScope)
    if (!facts) return
    if (facts.invalidated) value.poisoned = true
    if (facts.unresolvedEscape && (!replacementBoundary || !facts.escapeEvents?.length
      || facts.escapeEvents.some(event => event.call !== replacementBoundary.call || event.scope !== replacementBoundary.scope
        || event.processContext !== replacementBoundary.processContext))) value.iteratorEscaped = true
    value.heapBindings ??= new Set()
    const resolve = binding => {
      if (heapValues.has(binding)) return heapValues.get(binding)
      const type = bindingScalar?.(binding)
      if (type) { const value = scalar(type); heapValues.set(binding, value); return value }
      heapValues.set(binding, unknown)
      const scope = currentScope, prior = reading
      currentScope = binding.scope; reading = true
      const result = evaluate(binding.expression, new Map())
      currentScope = scope; reading = prior
      heapValues.set(binding, result)
      return result
    }
    for (const [key, bindings] of facts.fields) for (const binding of bindings) if (entryFact(binding.scope, binding.expression) && !value.heapBindings.has(binding)) {
      value.heapBindings.add(binding)
      const field = resolve(binding)
      value.fields.set(key, value.fields.has(key) ? join([value.fields.get(key), field]) : field)
    }
    for (const binding of includeItems ? facts.items : []) if (entryFact(binding.scope, binding.expression) && !value.heapBindings.has(binding)) {
      value.heapBindings.add(binding); value.items.push(resolve(binding)); value.allIndices = true
    }
  }
  function frontier(node, reason, evidence) {
    if (!reading) {
      const sf = node.getSourceFile(), position = sf.getLineAndCharacterOfPosition(node.getStart())
      frontiers.push({ reason, file: local(sf.fileName), start: node.getStart(), line: position.line + 1,
        column: position.character + 1, syntax: ts.SyntaxKind[node.kind], expression: node.getText().slice(0, 400), ...(evidence ? { evidence } : {}) })
    }
    return unknown
  }
  const collectionReferences = new WeakMap()
  function allocationBinding(node) {
    const path = []
    while (node.parent && (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent) || ts.isSatisfiesExpression(node.parent))) node = node.parent
    while (node.parent && ts.isPropertyAssignment(node.parent) && !ts.isComputedPropertyName(node.parent.name)) {
      path.unshift(node.parent.name.text); node = node.parent.parent
      while (node.parent && (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent))) node = node.parent
    }
    const parent = node.parent
    return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? { declaration: parent, path }
      : ts.isBinaryExpression(parent) && parent.right === node && ts.isIdentifier(parent.left) ? { declaration: declarationOf(parent.left), path } : null
  }
  function collectionUses(allocation) {
    const binding = allocationBinding(allocation)
    if (!binding?.declaration) return { closed: false, writes: [] }
    const { declaration, path } = binding
    let byPath = collectionReferences.get(declaration)
    if (!byPath) { byPath = new Map(); collectionReferences.set(declaration, byPath) }
    const key = JSON.stringify(path)
    if (byPath.has(key)) return byPath.get(key)
    let owner = declaration.parent
    while (owner && !ts.isFunctionLike(owner) && !ts.isSourceFile(owner)) owner = owner.parent
    let exported = false
    if (ts.isSourceFile(owner ?? {})) {
      // An exported binding can be mutated through an import in another file;
      // scanning references in its declaring file cannot prove it closed.
      const module = checker.getSymbolAtLocation(owner), symbol = checker.getSymbolAtLocation(declaration.name)
      if (!module || !symbol) exported = true
      else try {
        exported = checker.getExportsOfModule(module).some(candidate => {
          const target = candidate.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(candidate) : candidate
          return target === symbol || target.declarations?.includes(declaration)
        })
      } catch { exported = true }
    }
    const result = { closed: !exported, writes: [] }
    byPath.set(key, result)
    const inspect = node => {
      if (ts.isTypeNode(node)) return
      if (ts.isIdentifier(node) && node !== declaration.name && declarationOf(node) === declaration
        && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
        let value = node, matches = true
        for (const key of path) {
          const parent = value.parent
          if (!ts.isPropertyAccessExpression(parent) || parent.expression !== value || parent.name.text !== key) { matches = false; break }
          value = parent
        }
        if (matches) {
          const member = value.parent, call = member.parent
          if (ts.isPropertyAccessExpression(member) && member.expression === value && ts.isCallExpression(call) && call.expression === member
            && ['get', 'has', 'set', 'add', 'delete', 'clear', 'keys', 'values', 'entries', 'push', 'unshift', 'slice', 'at', 'filter', 'map', 'flatMap', 'find', 'findIndex', 'some', 'every', 'forEach', 'sort', 'includes', 'reduce', 'reduceRight', 'join', 'concat'].includes(member.name.text)) {
            if (['set', 'add', 'push', 'unshift', 'delete', 'clear'].includes(member.name.text)) result.writes.push({ call, method: member.name.text, args: [...call.arguments] })
          } else if (ts.isPropertyAccessExpression(member) && ['size', 'length'].includes(member.name.text)
            || ts.isElementAccessExpression(member) && member.expression === value) {
            // Reading a collection element does not mutate its membership.
          } else if (!(ts.isBinaryExpression(member) && member.left === value && member.operatorToken.kind === ts.SyntaxKind.EqualsToken)) result.closed = false
        } else if (!(ts.isPropertyAccessExpression(value.parent) && value.parent.expression === value)
          && !(ts.isBinaryExpression(value.parent) && value.parent.left === value)) result.closed = false
      }
      ts.forEachChild(node, inspect)
    }
    inspect(declaration.getSourceFile())
    return result
  }
  function widenCollection(value, node, env) {
    if (value.widening || value.widened) return value
    value.widening = true
    const uses = collectionUses(node), binding = allocationBinding(node), prior = reading; reading = true
    // A closed collection belongs to the activation in which its binding was
    // initialized. Writes from another invocation of the same function refer
    // to a different allocation, even though their syntax is identical.
    const owner = uses.closed && binding?.declaration ? scopeForDeclaration?.(binding.declaration, currentScope) : null
    if (value.kind === 'map' && uses.closed && invocationScopes) value.stored ??= []
    const updates = []
    for (const write of uses.writes) {
      if (value.kind === 'map' && ['set', 'delete', 'clear'].includes(write.method)
        || value.kind === 'set' && ['add', 'delete', 'clear'].includes(write.method)) for (const scope of invocationScopes?.(write.call, currentScope) ?? []) {
        const writeOwner = owner && scopeForDeclaration?.(binding.declaration, scope)
        if (owner && writeOwner && owner !== writeOwner) continue
        if (!entryFact(scope, write.call)) continue
        updates.push({ ...write, scope })
      }
    }
    const writes = updates.filter(write => write.method === 'set')
    if (updates.length) value.hasUpdates = true
    if (['map', 'set'].includes(value.kind) && !uses.closed && !value.freshLocal) {
      value.hasUpdates = true
      value.items.push(value.kind === 'map' ? data('array', new Map(), [unknown, unknown]) : unknown)
    }
    if (uses.closed) for (const write of updates) {
      if (!queuedMapWrites.has(write.call)) queuedMapWrites.set(write.call, new Set())
      if (!queuedMapWrites.get(write.call).has(write.scope)) {
        queuedMapWrites.get(write.call).add(write.scope); pendingMapWrites.push(write)
      }
    }
    if (value.kind === 'set') {
      for (const write of updates) if (write.method === 'add') {
        const scope = currentScope; currentScope = write.scope
        try { value.items.push(write.args[0] ? evaluate(write.args[0], new Map()) : constant(undefined)) }
        finally { currentScope = scope }
      }
    } else if (value.kind === 'map' && uses.closed) {
      // Map.get does not inspect stored keys. Re-evaluating a later set key
      // while resolving an earlier get can create an artificial value cycle.
      // Analyze the reached arguments separately once captured values settle;
      // retain the original key expression for keys()/entries() observations.
      const scope = currentScope
      const unwrap = expression => {
        while (expression && (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
          || ts.isNonNullExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression))) expression = expression.expression
        return expression
      }
      const targets = [...active].filter(declaration => {
        if (!ts.isVariableDeclaration(declaration) || !binding?.declaration) return false
        const initial = unwrap(declaration.initializer)
        const owner = scopeForDeclaration?.(declaration, scope)
        return ts.isCallExpression(initial ?? {}) && ts.isPropertyAccessExpression(initial.expression)
          && initial.expression.name.text === 'get' && ts.isIdentifier(initial.expression.expression)
          && declarationOf(initial.expression.expression) === binding.declaration
          && !!owner && owner === scopeForDeclaration?.(binding.declaration, scope)
      })
      const primitiveTypes = values => {
        const parts = values.flatMap(alternatives).filter(item => item.kind !== 'bottom')
        if (!parts.length || parts.some(item => item.kind !== 'scalar')) return null
        return join(parts.map(item => item.constant && item.value == null ? item : scalar(item.type)))
      }
      const signature = result => alternatives(result).map(item => item.constant && item.value == null ? `nullish:${String(item.value)}` : `${item.kind}:${item.type}`).sort().join('|')
      const initial = value.items.map(pair => {
        syncAllocation(pair)
        return pair.kind === 'array' && !pair.poisoned && !pair.allIndices && pair.items.length >= 2 ? pair.items[1] : unknown
      })
      let seed = targets.length && intrinsicStable('Array', scope) && intrinsicStable('Object', scope)
        ? primitiveTypes([...initial, constant(undefined)]) : null
      let produced = []
      const previousSeeds = recursiveBindings
      try {
        for (;;) {
          recursiveBindings = new Map(previousSeeds)
          if (seed) for (const declaration of targets) recursiveBindings.set(declaration, { scope: scopeForDeclaration(declaration, scope), value: seed })
          produced = writes.map(write => {
            const previousScope = currentScope; currentScope = write.scope
            try { return write.args[1] ? evaluate(write.args[1], new Map()) : constant(undefined) }
            finally { currentScope = previousScope }
          })
          if (!seed) break
          const next = primitiveTypes([...initial, constant(undefined), seed, ...produced])
          if (!next || signature(next) === signature(seed)) break
          seed = next
        }
      } finally { recursiveBindings = previousSeeds }
      for (let index = 0; index < writes.length; index++) {
        const write = writes[index], pair = data('array', new Map(), [unknown, produced[index]])
        pair.keyBinding = { expression: write.args[0], scope: write.scope }
        value.items.push(pair)
      }
    } else for (const write of writes) {
      const previousScope = currentScope; currentScope = write.scope
      value.items.push(data('array', new Map(), write.args.map(arg => evaluate(arg, new Map()))))
      currentScope = previousScope
    }
    reading = prior; value.widening = false; value.widened = true
    return value
  }
  function symbolValue(node, env) {
    let declaration = declarationOf(node)
    const symbol = checker.getSymbolAtLocation(node)
    if (symbol?.flags & ts.SymbolFlags.Alias && !ts.isBindingElement(declaration ?? {})) declaration = checker.getAliasedSymbol(symbol).valueDeclaration
    let lexical = declaration && [ts.isVariableDeclaration, ts.isParameter, ts.isBindingElement, ts.isFunctionDeclaration,
      ts.isFunctionExpression, ts.isClassDeclaration, ts.isEnumDeclaration, ts.isImportSpecifier, ts.isNamespaceImport, ts.isImportClause].some(kind => kind(declaration))
    for (let owner = declaration; lexical && owner; owner = owner.parent) if (ts.getCombinedModifierFlags(owner) & ts.ModifierFlags.Ambient) lexical = false
    if (env.has(declaration)) return env.get(declaration)
    const definingScope = declaration && currentScope && scopeForDeclaration?.(declaration, currentScope)
    if (lexical && scopeForDeclaration && definingScope === null) return unknown
    if (definingScope && definingScope !== currentScope) {
      const prior = currentScope; currentScope = definingScope
      const result = symbolValue(node, env)
      currentScope = prior; return result
    }
    let shared
    if (lexical && ts.isVariableDeclaration(declaration) && currentScope) {
      let owner = declaration.parent
      while (owner && !ts.isFunctionLike(owner) && !ts.isSourceFile(owner)) owner = owner.parent
      if (ts.isSourceFile(owner) || !activeScopes.has(currentScope)) {
        if (!bindingValues.has(currentScope)) bindingValues.set(currentScope, new Map())
        shared = bindingValues.get(currentScope)
        if (shared.has(declaration)) return shared.get(declaration)
      }
    }
    if (declaration && currentScope?.valueBindings?.has(declaration)) {
      const scope = currentScope
      let cached = parameterValues.get(scope)
      if (!cached) { cached = new Map(); parameterValues.set(scope, cached) }
      if (cached.has(declaration)) return cached.get(declaration)
      let activeParameters = parameterQueries.get(scope)
      if (!activeParameters) { activeParameters = new Set(); parameterQueries.set(scope, activeParameters) }
      if (activeParameters.has(declaration) || assignments.has(declaration) || bindingMayHaveUnmodeledWrites?.(declaration)) return unknown
      activeParameters.add(declaration)
      const result = join(scope.valueBindings.get(declaration).map(binding => {
        currentScope = binding.scope
        const result = binding.numeric ? scalar('number') : binding.elements ? data('array', new Map(), binding.elements.map(element => evaluate(element, new Map()))) : evaluate(binding.expression, new Map())
        currentScope = scope; return result
      }))
      activeParameters.delete(declaration)
      cached.set(declaration, result)
      return result
    }
    if (lexical && sources.has(declaration.getSourceFile().fileName) && ts.isClassDeclaration(declaration)) return { kind: 'class', node: declaration }
    if (lexical && sources.has(declaration.getSourceFile().fileName) && ts.isEnumDeclaration(declaration)) {
      const result = data('object'); env.set(declaration, result)
      let next = 0
      for (const member of declaration.members) {
        if (ts.isComputedPropertyName(member.name)) return frontier(member, 'Enum property identity is unresolved')
        const value = member.initializer ? evaluate(member.initializer, env) : next == null ? scalar('number') : constant(next)
        result.fields.set(member.name.text, value); env.set(member, value)
        if (value.constant && typeof value.value === 'number') { result.fields.set(String(value.value), constant(member.name.text)); next = value.value + 1 }
        else next = null
      }
      return result
    }
    if (lexical && sources.has(declaration.getSourceFile().fileName) && ts.isFunctionLike(declaration) && declaration.body) return { kind: 'function', node: declaration, env, scope: currentScope }
    if (declaration && active.has(declaration)) {
      const seed = recursiveBindings.get(declaration)
      return seed && scopeForDeclaration?.(declaration, currentScope) === seed.scope ? seed.value : unknown
    }
    if (lexical && sources.has(declaration.getSourceFile().fileName)) {
      active.add(declaration)
      const prior = reading; reading = prior || !inspectCapturedInitializers
      let result = declaration.initializer ? evaluate(declaration.initializer, env) : ts.isVariableDeclaration(declaration) ? constant(undefined) : unknown
      const loopValues = finiteNumericLoopValues?.(declaration)
      if (loopValues?.length) result = join(loopValues.map(constant))
      else if (numericInduction?.(declaration)) result = scalar('number')
      if (bindingMayHaveUnmodeledWrites?.(declaration)) result = join([result, unknown])
      const compoundBinding = hasCompoundBindingWrites?.(declaration)
      if (assignments.has(declaration) || compoundBinding) {
        const immediate = synchronousInvocation && [...activeScopes.keys()].every(scope => !scope?.functionNode?.asteriskToken
          && !scope?.functionNode?.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword))
        const reached = reachedBindingWrites?.(declaration, currentScope, immediate ? entryScope : undefined)
        const compounds = reached?.filter(write => write.operator && write.operator !== ts.SyntaxKind.EqualsToken) ?? []
        if (reached === null || reached === undefined) result = join([result, ...(assignments.get(declaration) ?? []).map(value => evaluate(value, env)), ...(compoundBinding ? [unknown] : [])])
        else if (!compounds.length) result = join([result, ...reached.map(write => {
          const scope = currentScope; currentScope = write.scope
          const value = evaluate(write.expression, env)
          currentScope = scope; return value
        })])
        else {
          // A captured local may be updated from its previous primitive value
          // (including within another assignment). Compute a finite type fixed
          // point over writes reached in this same lexical activation.
          const initial = result, owner = scopeForDeclaration?.(declaration, currentScope)
          const primitiveTypes = value => {
            const parts = alternatives(value).filter(item => item.kind !== 'bottom')
            if (!parts.length || parts.some(item => item.kind !== 'scalar')) return null
            return join(parts.map(item => item.constant && item.value == null ? item : scalar(item.type)))
          }
          const signature = value => value && alternatives(value).map(item => item.constant && item.value == null
            ? `nullish:${String(item.value)}` : `${item.kind}:${item.type}`).sort().join('|')
          let seed = owner && primitiveTypes(initial), values = [initial]
          const previousSeeds = recursiveBindings
          try {
            for (;;) {
              recursiveBindings = new Map(previousSeeds)
              if (owner) recursiveBindings.set(declaration, { scope: owner, value: seed ?? unknown })
              values = [initial, ...reached.map(write => {
                const scope = currentScope; currentScope = write.scope
                try {
                  const value = evaluate(write.expression, new Map(env))
                  if (!write.operator || write.operator === ts.SyntaxKind.EqualsToken) return value
                  if (reading) queueCompoundWrite(write, declaration, owner, seed, env)
                  if (!seed || !dataScalar(seed) || !dataScalar(value)) return frontier(write.ast ?? write.expression, 'Assignment coercion may execute user code')
                  return write.operator === ts.SyntaxKind.PlusEqualsToken ? additionResult(seed, value) : numericResult(seed, value)
                } finally { currentScope = scope }
              })]
              const next = primitiveTypes(join([...(seed ? [seed] : []), ...values]))
              if (seed && !next) for (const write of compounds) {
                if (reading) queueCompoundWrite(write, declaration, owner, unknown, env)
                else frontier(write.ast ?? write.expression, 'Assignment coercion may execute user code')
                values.push(unknown)
              }
              if (!seed || !next || signature(next) === signature(seed)) break
              seed = next
            }
          } finally { recursiveBindings = previousSeeds }
          result = join([...(seed ? [seed] : []), ...values])
        }
      }
      if (ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent) && ts.isForOfStatement(declaration.parent.parent)) {
        const loop = declaration.parent.parent, input = evaluate(loop.expression, env)
        result = join(alternatives(input).flatMap(value => {
          syncAllocation(value)
          if (!loop.awaitModifier && !value.poisoned && !value.iteratorEscaped
            && (value.kind === 'array' && intrinsicStable('Array', currentScope)
              || value.kind === 'set' && intrinsicStable('Set', currentScope))) return value.items
          return value.kind === 'bottom' ? [] : [unknown]
        }))
      }
      if (ts.isBindingElement(declaration) && !declaration.dotDotDotToken) {
        const owner = declaration.parent.parent
        let input
        if (owner.initializer) input = evaluate(owner.initializer, env)
        else if (ts.isVariableDeclaration(owner) && ts.isVariableDeclarationList(owner.parent) && ts.isForOfStatement(owner.parent.parent)) {
          const loop = owner.parent.parent
          if (loop.awaitModifier || !intrinsicStable('Array', currentScope)) input = frontier(loop.expression, 'Destructured loop iterator identity is unresolved')
          else input = join(alternatives(evaluate(loop.expression, env)).flatMap(value => value.kind === 'array' ? value.items
            : value.kind === 'bottom' ? [] : [frontier(loop.expression, 'Destructured loop iterator effects are unresolved')]))
        }
        if (input) {
          const key = ts.isArrayBindingPattern(declaration.parent) ? constant(String(declaration.parent.elements.indexOf(declaration)))
            : declaration.propertyName && ts.isComputedPropertyName(declaration.propertyName) ? evaluate(declaration.propertyName.expression, env)
              : constant((declaration.propertyName ?? declaration.name).text)
          result = ts.isArrayBindingPattern(declaration.parent) && alternatives(input).some(value => !['array', 'json', 'bottom'].includes(value.kind))
            ? frontier(node, 'Destructuring iterator protocol is unresolved') : read(input, key, node, env)
        }
      }
      if (['object', 'instance', 'map', 'set', 'buffer', 'array'].includes(result.kind)) {
        if (result.sourceNode && allocationFacts) syncAllocation(result)
        else for (const write of propertyAssignments.get(declaration) ?? []) {
          if (write.key == null || write.key === '__proto__') { result = unknown; break }
          const value = evaluate(write.expression, env)
          result.fields.set(write.key, result.fields.has(write.key) ? join([result.fields.get(write.key), value]) : value)
        }
      }
      reading = prior; active.delete(declaration)
      if (result !== unknown) {
        if (alternatives(result).some(value => value.mathType) && bindingEscaped(declaration, currentScope)) return frontier(node, 'Library instance may have escaped to an unresolved operation')
        env.set(declaration, result)
        shared?.set(declaration, result)
        for (const value of alternatives(result)) if (['array', 'map', 'set'].includes(value.kind) && declaration.initializer) widenCollection(value, declaration.initializer, env)
        return result
      }
    }
    const provider = providerOf(node)
    if (provider?.module && !provider.module.startsWith('.')) return native(provider.module.replace(/^node:/, '') + ':' + provider.export)
    const callables = lookupCallable?.(node, currentScope) ?? []
    if (callables.length) return join(callables.map(value => ({ kind: 'function', node: value.callable, env: new Map(env) })))
    if (!lexical || !sources.has(declaration.getSourceFile().fileName)) {
      if (node.text === 'globalThis' || node.text === 'window') return unknown
      if (node.text === 'undefined') return constant(undefined)
      if (node.text === 'Infinity' || node.text === 'NaN') return scalar('number')
      if (['JSON', 'Buffer', 'Map', 'Set', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Error', 'process', 'Math', 'console', 'structuredClone'].includes(node.text)) return native('global:' + node.text)
      if (node.text === '__dirname' || node.text === '__filename') return scalar('string')
    }
    return lexical && sources.has(declaration.getSourceFile().fileName) ? unknown : frontier(node, 'Ambient value may invoke an unknown global accessor')
  }
  function intrinsicName(name) {
    if (name.startsWith('global:')) return name.slice(7).split('.')[0]
    if (name.startsWith('array.')) return 'Array'
    if (name.startsWith('map.')) return 'Map'
    if (name.startsWith('set.')) return 'Set'
    if (name.startsWith('buffer.')) return 'Buffer'
    if (name.startsWith('string.')) return 'String'
    if (name.startsWith('regexp.')) return 'RegExp'
    if (name.startsWith('object.hasOwnProperty')) return 'Object'
    return null
  }
  function read(receiver, key, node, env) {
    return join(alternatives(receiver).flatMap(value => alternatives(key).map(property => {
      const name = property.constant ? String(property.value) : null
      // The length of an actual array is a numeric own data property. Reading
      // it does not inspect stored elements or rerun their earlier producers.
      // Descriptor invalidation is still checked; item reads and iteration
      // continue to materialize all reached element writes.
      syncAllocation(value, value.kind !== 'array' || name !== 'length')
      if (value.poisoned) return frontier(node, 'Receiver allocation or property descriptors are unresolved')
      if (value.kind === 'bottom' || property.kind === 'bottom' || value.constant && value.value == null) return { kind: 'bottom' } // Abrupt access cannot invoke a getter.
      if (!dataScalar(property)) return frontier(node, 'Property key may execute an unknown coercion')
      // A primitive but nonconstant key can select every own accessor. Preserve
      // those actual calls rather than leaking descriptor records as values.
      if (name === null && value.fields && ['object', 'instance', 'json'].includes(value.kind)) {
        return join([...value.fields.keys()].map(name => read(value, constant(name), node, env)).concat([value.fallback ?? constant(undefined)]))
      }
      if (value.kind === 'regexp' && ['test', 'exec'].includes(name)) return native('regexp.' + name)
      if (value.kind === 'observer') return name === 'not' ? value : native('expect.' + name, value)
      if (value.kind === 'mock') return name === 'mock' ? data('object', new Map([['calls', data('array')]])) : frontier(node, 'Mock handle member is outside the observation contract')
      if (value.kind === 'native') {
        if (value.name.startsWith('three:') && !providerStable('three', currentScope)) return frontier(node, 'Library provider identity or prototype effects are unresolved')
        const intrinsic = intrinsicName(value.name)
        if (intrinsic && !intrinsicStable(intrinsic, currentScope)) return frontier(node, `Native ${intrinsic} identity or property effects are unresolved`)
        if (value.name === 'three:MathUtils' && ['clamp', 'smoothstep', 'smootherstep', 'lerp', 'inverseLerp', 'mapLinear', 'damp', 'degToRad', 'radToDeg'].includes(name)) return native('numeric-library.' + name)
        if (value.name === 'vitest:vi' && ['fn', 'mocked'].includes(name)) return native('vitest:vi.' + name)
        if (value.name === 'global:process' && ['execPath', 'cwd', 'env'].includes(name)) {
          return name === 'execPath' ? { ...scalar('string'), token: 'process.execPath' } : native('process:' + name)
        }
        if (value.name === 'global:Math' && ['PI', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT1_2', 'SQRT2'].includes(name)) return scalar('number')
        if (value.name === 'global:Number' && ['MAX_SAFE_INTEGER', 'MIN_SAFE_INTEGER', 'MAX_VALUE', 'MIN_VALUE', 'POSITIVE_INFINITY', 'NEGATIVE_INFINITY', 'NaN', 'EPSILON'].includes(name)) return scalar('number')
        if (value.name === 'process:env') return scalar('string')
        if (value.name === 'global:Object.prototype' && name === 'hasOwnProperty') return native('object.hasOwnProperty')
        if (value.name === 'object.hasOwnProperty' && name === 'call') return intrinsicStable('Function', currentScope)
          ? native('object.hasOwnProperty.call') : frontier(node, 'Native Function adapter identity is unresolved')
        if (name !== null && (value.name.endsWith(':*') || ['global:JSON', 'global:Buffer', 'global:Object', 'global:Array', 'global:Number', 'global:Math', 'global:console', 'global:String'].includes(value.name))) return native(value.name.endsWith(':*') ? value.name.slice(0, -1) + name : value.name + '.' + name, value)
        return frontier(node, 'Native callable property may invoke an unknown getter or proxy')
      }
      if (value.mathType && !value.fields.has(name) && ['clone', 'copy', 'set', 'setScalar', 'add', 'sub', 'addScaledVector', 'multiplyScalar', 'divideScalar', 'normalize', 'length', 'lengthSq', 'distanceTo', 'distanceToSquared', 'dot', 'cross', 'crossVectors', 'lerp', 'equals'].includes(name)) return native('math.' + name, value)
      if (value.kind === 'class') {
        const member = value.node.members.find(member => member.name && !ts.isComputedPropertyName(member.name) && member.name.text === name && member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword))
        if (member && ts.isMethodDeclaration(member) && member.body) return { kind: 'function', node: member, receiver: value, env: new Map(env) }
        if (member && ts.isPropertyDeclaration(member) && member.initializer) return evaluate(member.initializer, env)
        return frontier(node, 'Static receiver member identity or accessor effects are unresolved')
      }
      if (value.kind === 'instance' && !value.fields.has(name)) {
        const members = value.node.members.filter(member => member.name && !ts.isComputedPropertyName(member.name) && member.name.text === name)
        if (members.some(ts.isGetAccessor)) return frontier(node, 'Source instance getter requires its actual accessor effects')
        const method = members.find(ts.isMethodDeclaration)
        if (method?.body) return { kind: 'function', node: method, receiver: value, env: new Map(value.env) }
      }
      if (value.fields?.has(name)) {
        const field = value.fields.get(name)
        return field.kind === 'accessor' ? field.get ? invoke({ node: field.get, env: field.env, scope: field.scope, receiver: value }, [], node) : constant(undefined) : value.fallback ? join([field, value.fallback]) : field
      }
      if (value.kind === 'instance') return frontier(node, 'Source instance field provenance is unresolved')
      if (value.kind === 'object') {
        if (!intrinsicStable('Object', currentScope)) return frontier(node, 'Native Object prototype identity or inherited getter effects are unresolved')
        if (name !== null && ['constructor', '__proto__', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'toString', 'valueOf', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'].includes(name)) return frontier(node, 'Inherited Object prototype member identity is unresolved')
        return value.fallback ?? (name !== null ? constant(undefined) : join([...value.fields.values(), constant(undefined)]))
      }
      if (value.kind === 'json') {
        if (!intrinsicStable('Object', currentScope) || value.dataShape === 'array' && !intrinsicStable('Array', currentScope)) return frontier(node, 'Parsed data prototype identity or inherited effects are unresolved')
        if (value.dataShape === 'object') return value.fallback ?? constant(undefined)
        if (value.dataShape === 'array' && (name === null || /^\d+$/.test(name))) return !value.allIndices && name !== null && Number(name) < value.items.length ? value.items[Number(name)] : join([...value.items, constant(undefined)])
        if (value.dataShape === 'array' && name === 'length') return scalar('number')
        if (['trim', 'slice', 'substring', 'repeat', 'toLowerCase', 'toUpperCase', 'split', 'startsWith', 'endsWith'].includes(name)) return native('string.' + name, scalar('string'))
        if (['map', 'flatMap', 'filter', 'find', 'findIndex', 'some', 'every', 'forEach', 'includes', 'indexOf', 'at', 'slice', 'sort', 'join', 'push', 'reduce', 'reduceRight', 'concat', 'entries', 'values', 'keys', 'unshift', 'shift', 'pop', 'splice', 'reverse'].includes(name)) return native('array.' + name, value.dataShape === 'array' ? { ...value, kind: 'array' } : data('array', new Map(), [{ kind: 'json' }]))
        return { kind: 'json' }
      }
      if (value.kind === 'array' && (name === null || /^\d+$/.test(name))) {
        if (!intrinsicStable('Array', currentScope) || !intrinsicStable('Object', currentScope)) return frontier(node, 'Array prototype identity or indexed getter effects are unresolved')
        return !value.allIndices && name !== null && Number(name) < value.items.length ? value.items[Number(name)] : join([...value.items, constant(undefined)])
      }
      if (['array', 'map', 'set', 'buffer'].includes(value.kind) || value.kind === 'scalar' && value.type === 'string') {
        const intrinsic = value.kind === 'scalar' ? 'String' : ({ array: 'Array', map: 'Map', set: 'Set', buffer: 'Buffer' })[value.kind]
        if (!intrinsicStable(intrinsic, currentScope)) return frontier(node, `Native ${intrinsic} identity or property effects are unresolved`)
        if (name === 'length' && ['array', 'buffer', 'scalar'].includes(value.kind)
          || name === 'size' && ['map', 'set'].includes(value.kind)) return scalar('number')
        return name === null ? frontier(node, 'Computed native data member is unresolved') : native(value.kind === 'scalar' ? 'string.' + name : value.kind + '.' + name, value)
      }
      return frontier(node, 'Property read may invoke an unknown getter or proxy', { receiver: value.kind, key: property.kind })
    })))
  }
  function serializable(value, node, env, seen = new Set()) {
    if (seen.has(value)) return true // A cycle throws without invoking additional data protocols.
    const next = new Set(seen).add(value)
    return alternatives(value).every(part => {
      syncAllocation(part)
      if (part.poisoned || part.iteratorEscaped) { frontier(node, 'Serialization receiver provenance was invalidated or escaped'); return false }
      if (part.mathType && !providerStable('three', currentScope)) { frontier(node, 'Serialization of the external prototype is unresolved'); return false }
      const prototype = ({ object: 'Object', array: 'Array', map: 'Map', set: 'Set', buffer: 'Buffer', json: 'Object' })[part.kind]
      if (prototype && (!intrinsicStable('Object', currentScope) || !intrinsicStable(prototype, currentScope))) {
        frontier(node, `Native ${prototype} prototype identity or inherited toJSON effects are unresolved`); return false
      }
      if (part.kind === 'scalar' && part.type === 'bigint') { frontier(node, 'BigInt serialization or inherited toJSON effects are unresolved'); return false }
      if (part.kind === 'scalar' || part.kind === 'json' || part.kind === 'bottom' || part.kind === 'buffer') return true
      if (!['object', 'array', 'map', 'set'].includes(part.kind)) { frontier(node, 'Serialization may inspect an unknown toJSON or callable object'); return false }
      if (part.fields.has('toJSON')) {
        const method = read(part, constant('toJSON'), node, env)
        const result = join(alternatives(method).map(method => method.kind === 'function' ? invoke(method, [scalar('string')], node) : method))
        if (alternatives(method).some(method => method.kind === 'function')) return serializable(result, node, env, next)
        if (method.kind === 'unknown') { frontier(node, 'Serialization toJSON identity is unresolved'); return false }
      }
      const fields = [...part.fields].filter(([, field]) => field.kind !== 'accessor' || field.enumerable !== false)
      const values = fields.map(([key, field]) => field.kind === 'accessor' ? read(part, constant(key), node, env) : field)
      if (part.kind === 'array') values.push(...part.items)
      if (part.fallback) values.push(part.fallback)
      return values.every(value => serializable(value, node, env, next))
    })
  }
  function call(fn, args, node, env, constructing = false, sourceArgs = null) {
    if (args.some(value => value.kind === 'bottom')) return { kind: 'bottom' }
    return join(alternatives(fn).map(value => {
      if (value.kind === 'class' && constructing) {
        const instance = { kind: 'instance', node: value.node, fields: new Map(), env: new Map(env) }
        const context = new Map(env); context.set(thisBinding, instance)
        for (const member of value.node.members) if (ts.isPropertyDeclaration(member) && member.initializer && !ts.isComputedPropertyName(member.name)) instance.fields.set(member.name.text, evaluate(member.initializer, context))
        const constructor = value.node.members.find(ts.isConstructorDeclaration)
        if (constructor?.body) invoke({ kind: 'function', node: constructor, receiver: instance, env: context }, args, node, sourceArgs)
        return instance
      }
      if (value.kind === 'function') return invoke(value, args, node, sourceArgs)
      if (value.kind === 'mock') return value.implementation ? call(value.implementation, args, node, env) : constant(undefined)
      if (value.kind === 'json') return { kind: 'bottom' } // JSON cannot contain functions.
      if (operation(node) && value.kind !== 'native') return unknown // Runtime graph retains the effect.
      if (value.kind === 'bottom' || value.constant && value.value == null) return { kind: 'bottom' }
      if (value.kind !== 'native') return frontier(node, 'Call target and external effects are unresolved')
      const { name, receiver } = value
      if ((name.startsWith('three:') || name.startsWith('math.') || name.startsWith('numeric-library.')) && !providerStable('three', currentScope)) return frontier(node, 'Library provider identity or prototype effects are unresolved')
      const intrinsic = intrinsicName(name)
      if (intrinsic && !intrinsicStable(intrinsic, currentScope)) return frontier(node, `Native ${intrinsic} identity or invocation effects are unresolved`)
      if (name === 'vitest:vi.fn') return args.length <= 1 && (!args.length || alternatives(args[0]).every(part => part.kind === 'function')) ? { kind: 'mock', implementation: args[0] } : frontier(node, 'Mock implementation identity is unresolved')
      if (name === 'vitest:vi.mocked') return args.length === 1 ? args[0] : unknown
      if (name === 'vitest:expect') return args.length === 1 ? { kind: 'observer', observed: args[0] } : frontier(node, 'Expectation protocol is unresolved')
      if (name.startsWith('expect.')) {
        const method = name.slice(7), observed = receiver.observed
        if (['toBeDefined', 'toBeUndefined', 'toBeNull', 'toBeTruthy', 'toBeFalsy', 'toBe', 'toEqual'].includes(method)
          && (['toBe', 'toBeDefined', 'toBeUndefined', 'toBeNull', 'toBeTruthy', 'toBeFalsy'].includes(method) || plain(observed) && args.every(arg => plain(arg)))) return constant(undefined)
        if (['toHaveBeenCalled', 'toHaveBeenCalledOnce', 'toHaveBeenCalledTimes'].includes(method)
          && alternatives(observed).every(part => part.kind === 'mock' || part.kind === 'bottom') && args.every(primitive)) return constant(undefined)
        return frontier(node, 'Expectation may execute an unknown observer protocol')
      }
      if (['three:Vector2', 'three:Vector3'].includes(name) && constructing && args.every(dataScalar)) {
        const result = data('object', new Map((name.endsWith('3') ? ['x', 'y', 'z'] : ['x', 'y']).map(key => [key, scalar('number')])))
        result.mathType = name; return result
      }
      if (name === 'three:Box3' && constructing && args.length === 2 && args.every(arg => arg.mathType === 'three:Vector3')) return { ...data('object', new Map([['min', args[0]], ['max', args[1]]])), mathType: 'three:Box3' }
      if (name.startsWith('numeric-library.')) return args.every(dataScalar) ? scalar('number') : frontier(node, 'Numeric library coercion is unresolved')
      if (name.startsWith('math.')) {
        if (!args.every(arg => alternatives(arg).every(part => dataScalar(part) || part.kind === 'object' && [...part.fields.values()].every(dataScalar)))) return frontier(node, 'Mathematical data protocol is unresolved')
        if (['math.length', 'math.lengthSq', 'math.distanceTo', 'math.distanceToSquared', 'math.dot'].includes(name)) return scalar('number')
        if (name === 'math.equals') return scalar('boolean')
        return receiver
      }
      if (name === 'fs:readdirSync' && reading) {
        const withTypes = args[1]?.fields?.get('withFileTypes')
        return data('array', new Map(), [withTypes?.constant && withTypes.value === true
          ? data('object', new Map([['name', scalar('string')], ['isDirectory', native('fs:Dirent.isDirectory')]])) : scalar('string')])
      }
      if (name === 'fs:Dirent.isDirectory' && reading) return scalar('boolean')
      if (name === 'fs:mkdtempSync' && reading) return scalar('string')
      if (name === 'crypto:randomUUID') return scalar('string')
      if (operation(node)) return name === 'fs:readFileSync' && args[1]?.kind === 'scalar' && args[1].type === 'string' ? scalar('string') : unknown
      if (['global:Map', 'global:Set'].includes(name) && constructing) {
        if (args.length && !args.every(arg => alternatives(arg).every(part => {
          syncAllocation(part)
          if (part.poisoned) return false
          if (part.kind === 'array') return !part.iteratorEscaped && intrinsicStable('Array', currentScope)
            && ![...part.fields.values()].some(field => field.kind === 'accessor')
          if (part.kind === 'set') return intrinsicStable('Set', currentScope)
          return part.kind === 'json' && intrinsicStable('Array', currentScope) || part.constant && part.value == null
        }))) return frontier(node, 'Constructor iterator effects are unresolved')
        const collection = data(name === 'global:Map' ? 'map' : 'set', new Map(), args.flatMap(arg => alternatives(arg).flatMap(part => part.items ?? (part.kind === 'json' ? [{ kind: 'json' }] : []))))
        const uses = collectionUses(node)
        collection.freshLocal = !reading && (!allocationBinding(node)?.declaration || activeScopes.has(currentScope))
        collection.sourceNode = node; collection.sourceScope = currentScope; collection.capturedAllocation = reading || !activeScopes.has(currentScope)
        if (collection.kind === 'map' && uses.closed && invocationScopes) collection.stored = []
        return collection
      }
      if (name === 'global:Error' && constructing && args.every(primitive)) return data('object')
      if (name === 'global:String' || name === 'global:Number' || name === 'global:Boolean') {
        if (name !== 'global:Boolean' && !args.every(arg => dataScalar(arg))) frontier(node, 'Primitive conversion may invoke user coercion')
        return scalar(name.slice(7).toLowerCase())
      }
      if (['global:Number.isFinite', 'global:Number.isInteger', 'global:Number.isNaN', 'global:Number.isSafeInteger', 'global:Array.isArray'].includes(name)) return scalar('boolean')
      if (/^global:Math\.(?:floor|ceil|round|trunc|min|max|abs|sqrt|hypot|sin|cos|tan|asin|acos|atan|atan2|pow|sign|imul|exp|expm1|log|log1p|log2|log10|cbrt|fround|clz32|random)$/.test(name)) {
        if (!args.every(arg => dataScalar(arg))) frontier(node, 'Numeric coercion may execute user code')
        return scalar('number')
      }
      if (name === 'object.hasOwnProperty.call' && args.length === 2 && alternatives(args[0]).every(value => value.kind === 'object' || value.kind === 'json' || value.kind === 'scalar') && dataScalar(args[1])) return scalar('boolean')
      if (/^global:console\.(?:log|warn|error|info|debug)$/.test(name) && args.every(arg => dataScalar(arg))) return constant(undefined)
      if (/^path:(?:resolve|join|relative|dirname|basename|extname|normalize|toNamespacedPath)$/.test(name) && args.every(primitive)
        || /^os:(?:tmpdir|homedir|hostname|platform|arch|release|type)$/.test(name) && args.length === 0) return scalar('string')
      if (name === 'regexp.test' || name === 'regexp.exec') return args.every(dataScalar) ? name === 'regexp.test' ? scalar('boolean') : data('array', new Map(), [scalar('string')]) : frontier(node, 'Regular expression input may execute user coercion')
      if (name === 'process:cwd') return scalar('string')
      if (/^assert(?:\/strict)?:/.test(name)) {
        const method = name.split(':')[1]
        if (['strictEqual', 'notStrictEqual', 'ok', '*'].includes(method)
          || ['equal', 'notEqual'].includes(method) && (name.startsWith('assert/strict:') || args.every(primitive))
          || ['deepEqual', 'deepStrictEqual', 'notDeepEqual', 'notDeepStrictEqual'].includes(method) && args.every(arg => plain(arg))) return constant(undefined)
        return frontier(node, 'Assertion may execute a callback, getter or coercion')
      }
      if (name === 'global:JSON.stringify') {
        const replacer = args[1]
        if (replacer && !alternatives(replacer).every(value => value.constant && value.value == null)) return frontier(node, 'JSON replacer execution is unresolved')
        if (args[2] && !dataScalar(args[2])) return frontier(node, 'JSON indentation coercion is unresolved')
        const input = args[0] ?? constant(undefined), complete = serializable(input, node, env)
        if (!complete) return unknown
        return join(alternatives(input).flatMap(part => part.kind === 'scalar' && ['undefined', 'symbol'].includes(part.type)
          ? [constant(undefined)] : part.fields?.has('toJSON') ? [scalar('string'), constant(undefined)] : [scalar('string')]))
      }
      if (name === 'global:JSON.parse') {
        if (args.length !== 1) return frontier(node, 'JSON parsing reviver effects and result provenance are unresolved')
        if (!dataScalar(args[0])) frontier(node, 'JSON parsing may execute a coercion or reviver')
        return { kind: 'json' }
      }
      if (name === 'global:Buffer.from') return args.every(arg => primitive(arg) || arg.kind === 'array' && plain(arg) || arg.kind === 'buffer') ? data('buffer') : frontier(node, 'Buffer conversion protocol is unresolved')
      if (name === 'global:Buffer.concat') return args[0]?.kind === 'array' && args[0].items.every(v => alternatives(v).every(part => part.kind === 'buffer')) ? data('buffer') : frontier(node, 'Buffer sequence is unresolved')
      if (['global:String.fromCharCode', 'global:String.fromCodePoint'].includes(name)) return args.every(dataScalar) ? scalar('string') : frontier(node, 'Character construction may execute numeric coercion')
      if (name === 'global:Object.freeze') {
        const target = args[0] ?? constant(undefined)
        return join(alternatives(target).map(part => {
          syncAllocation(part)
          if (part.poisoned || !['scalar', 'bottom', 'object', 'array', 'json', 'map', 'set'].includes(part.kind)) return frontier(node, 'Object freeze receiver or proxy effects are unresolved')
          // Freezing an ordinary allocation changes its descriptors without
          // reading property values. Keep the same allocation and accessors;
          // subsequent reads still execute those getters. Possible writes are
          // conservatively retained, rather than discarded as frozen data.
          return part
        }))
      }
      if (['global:Object.defineProperty', 'global:Object.defineProperties'].includes(name)) {
        const target = args[0], properties = name.endsWith('Properties') ? args[1] : data('object', new Map(args[1]?.constant ? [[String(args[1].value), args[2]]] : []))
        if (target?.kind !== 'object' || properties?.kind !== 'object' || properties.fallback || name.endsWith('Property') && !args[1]?.constant) { if (target && typeof target === 'object') target.poisoned = true; return frontier(node, 'Property descriptor target or enumeration is unresolved') }
        for (const [key, descriptor] of properties.fields) {
          if (descriptor.kind !== 'object' || descriptor.fallback) { target.poisoned = true; return frontier(node, 'Property descriptor may execute an unknown getter or proxy') }
          const get = descriptor.fields.get('get'), set = descriptor.fields.get('set'), value = descriptor.fields.get('value')
          if (get && get.kind !== 'function' || set && set.kind !== 'function') return frontier(node, 'Descriptor accessor identity is unresolved')
          if (get || set) target.fields.set(key, { kind: 'accessor', get: get?.node, set: set?.node, env: get?.env ?? set?.env, scope: get?.scope ?? set?.scope, enumerable: descriptor.fields.get('enumerable')?.value === true })
          else target.fields.set(key, value ?? constant(undefined))
        }
        return target
      }
      if (name === 'global:Object.assign') {
        return join(alternatives(args[0] ?? unknown).map(target => {
        if (target.kind === 'bottom' || target.constant && target.value == null) return { kind: 'bottom' }
        if (!['object', 'json'].includes(target.kind)) return frontier(node, 'Assignment target may execute an unknown setter or proxy')
        for (const source of args.slice(1)) for (const part of alternatives(source)) {
          if (part.kind === 'scalar' || part.kind === 'bottom') continue
          if (!['object', 'json'].includes(part.kind) || part.poisoned) { target.poisoned = true; return frontier(node, 'Assignment source may execute an unknown getter or proxy') }
          for (const [key, field] of part.fields ?? []) {
            if (field.kind === 'accessor' && field.enumerable === false) continue
            const value = read(part, constant(key), node, env), existing = target.fields?.get(key)
            if (existing?.kind === 'accessor') {
              if (existing.set) invoke({ node: existing.set, env: existing.env, scope: existing.scope, receiver: target }, [value], node)
            } else if (target.kind === 'object') target.fields.set(key, existing ? join([existing, value]) : value)
            else if (!dataOnly(value)) { target.poisoned = true; return frontier(node, 'Assignment introduces unknown callable data') }
          }
          const dynamic = part.fallback ?? (part.kind === 'json' && !part.dataShape ? { kind: 'json' } : null)
          if (dynamic && target.kind === 'object') {
            for (const field of target.fields.values()) if (field.kind === 'accessor' && field.set) invoke({ node: field.set, env: field.env, scope: field.scope, receiver: target }, [dynamic], node)
            target.fallback = target.fallback ? join([target.fallback, dynamic]) : dynamic
          }
        }
        return target
        }))
      }
      if (name === 'global:structuredClone') return args.length === 1 && dataOnly(args[0]) ? { kind: 'json' } : frontier(node, 'Cloning may execute an unknown accessor or transfer protocol')
      if (name === 'global:Object.fromEntries') {
        const result = data('object')
        for (const source of alternatives(args[0] ?? unknown)) {
          if (source.kind === 'json') { result.fallback = { kind: 'json' }; continue }
          if (source.kind !== 'array' && source.kind !== 'map') return frontier(node, 'Entry iterator provenance is unresolved')
          for (const entry of source.items) for (const pair of alternatives(entry)) {
            if (pair.kind === 'json') { result.fallback = { kind: 'json' }; continue }
            if (pair.kind !== 'array') return frontier(node, 'Entry property access may invoke a getter or proxy')
            const key = pair.items[0] ?? constant(undefined), value = pair.items[1] ?? constant(undefined)
            if (!dataScalar(key)) return frontier(node, 'Entry key may execute user coercion')
            if (key.constant) result.fields.set(String(key.value), value)
            else result.fallback = result.fallback ? join([result.fallback, value]) : value
          }
        }
        return result
      }
      if (name === 'global:Array.from') {
        const source = args[0], values = []; let allIndices = false
        for (const part of alternatives(source)) {
          if (['array', 'set', 'map'].includes(part.kind)) { values.push(...part.items); allIndices ||= !!part.allIndices || !!part.hasUpdates }
          else if (part.kind === 'json' || part.kind === 'scalar' && part.type === 'string') values.push(part)
          else if (part.kind === 'object' && !part.fallback && [...part.fields.keys()].every(key => key === 'length' || /^\d+$/.test(key)) && dataScalar(part.fields.get('length') ?? constant(undefined))) values.push(join([...part.fields].filter(([key]) => key !== 'length').map(([, value]) => value).concat([constant(undefined)])))
          else frontier(node, 'Array construction iterator or length protocol is unresolved')
        }
        return { ...data('array', new Map(), args[1] ? [call(args[1], [join(values), scalar('number')], node, env)] : values), allIndices }
      }
      if (['global:Object.keys', 'global:Object.values', 'global:Object.entries'].includes(name)) return join(alternatives(args[0] ?? constant(undefined)).map(source => {
        if (source.kind === 'json') return data('array', new Map(), [name.endsWith('keys') ? scalar('string') : name.endsWith('entries') ? data('array', new Map(), [scalar('string'), { kind: 'json' }]) : { kind: 'json' }])
        if (source.kind === 'scalar' || source.kind === 'bottom') return source.constant && source.value == null || source.kind === 'bottom' ? { kind: 'bottom' } : data('array', new Map(), source.type === 'string' ? [scalar('string')] : [])
        if (source.kind !== 'object') return frontier(node, 'Enumeration may execute a proxy or accessor')
        const entries = [...source.fields].filter(([, value]) => value.kind !== 'accessor' || value.enumerable !== false).map(([key, value]) => [key, value.kind === 'accessor' && !name.endsWith('keys') ? read(source, constant(key), node, env) : value])
        if (source.fallback) entries.push(['<dynamic key>', source.fallback])
        return data('array', new Map(), entries.map(([key, value]) => name.endsWith('keys') ? constant(key) : name.endsWith('values') ? value : data('array', new Map(), [constant(key), value])))
      }))
      if (name.startsWith('map.')) {
        const entryKey = pair => {
          if (!pair.keyBinding) {
            syncAllocation(pair)
            if (pair.poisoned) return frontier(node, 'Map entry key provenance was invalidated')
            return pair.allIndices ? join([...(pair.items ?? []), constant(undefined)]) : pair.items?.[0] ?? (pair.kind === 'json' ? pair : unknown)
          }
          const previous = currentScope; currentScope = pair.keyBinding.scope
          try { return evaluate(pair.keyBinding.expression, new Map()) }
          finally { currentScope = previous }
        }
        if (name === 'map.set') { receiver.hasUpdates = true; receiver.items.push(data('array', new Map(), args)); return receiver }
        if (name === 'map.delete') { receiver.hasUpdates = true; return scalar('boolean') }
        if (name === 'map.clear') { receiver.hasUpdates = true; return constant(undefined) }
        if (name === 'map.keys') return { ...data('array', new Map(), [...receiver.items.map(entryKey), ...(receiver.storedKeys ?? [])]), allIndices: !!receiver.hasUpdates }
        if (name === 'map.values') return { ...data('array', new Map(), [...receiver.items.flatMap(pair => pair.items?.slice(1) ?? [pair.kind === 'json' ? pair : unknown]), ...(receiver.stored ?? [])]), allIndices: !!receiver.hasUpdates }
        if (name === 'map.entries') return { ...data('array', new Map(), receiver.items.map(pair => pair.keyBinding
          ? data('array', new Map(), [entryKey(pair), pair.items[1]]) : pair)), allIndices: !!receiver.hasUpdates }
        if (name === 'map.get') return join([...receiver.items.flatMap(pair => pair.items?.slice(1) ?? [pair.kind === 'json' ? pair : unknown]), ...(receiver.stored ?? (receiver.freshLocal ? [] : [unknown])), constant(undefined)])
        if (name === 'map.has') return scalar('boolean')
      }
      if (name.startsWith('set.')) {
        if (name === 'set.has') return scalar('boolean')
        if (name === 'set.delete') { receiver.hasUpdates = true; return scalar('boolean') }
        if (name === 'set.clear') { receiver.hasUpdates = true; return constant(undefined) }
        if (name === 'set.add') { receiver.hasUpdates = true; receiver.items.push(...args); return receiver }
        if (name === 'set.values' || name === 'set.keys') return { ...data('array', new Map(), receiver.items), allIndices: !!receiver.hasUpdates }
      }
      if (name.startsWith('array.')) {
        const method = name.slice(6)
        if (method === 'entries') return { ...data('array', new Map(), receiver.items.map(item => data('array', new Map(), [scalar('number'), item]))), allIndices: !!receiver.allIndices }
        if (method === 'values') return receiver
        if (method === 'keys') return data('array', new Map(), [scalar('number')])
        if (method === 'reduce' || method === 'reduceRight') {
          const item = join(receiver.items), hasInitial = args.length > 1, initial = hasInitial ? args[1] : item
          if (!receiver.items.length && !receiver.allIndices) return hasInitial ? initial : { kind: 'bottom' }
          if (!receiver.items.length) return frontier(node, 'Reduction element domain is unresolved')
          if (!hasInitial && receiver.items.length === 1 && !receiver.allIndices) return initial
          // Later invocations receive the previous result, not the literal
          // starting value. Prove a stable primitive domain before using one
          // summary for all possible elements and iterations.
          const parts = alternatives(initial), type = parts[0]?.kind === 'scalar' && parts[0].type
          if (!type || parts.some(part => part.kind !== 'scalar' || part.type !== type)) return frontier(node, 'Reduction accumulator evolution is unresolved')
          const reduced = call(args[0] ?? unknown, [scalar(type), item, scalar('number'), receiver], node, env)
          if (alternatives(reduced).some(part => part.kind !== 'scalar' || part.type !== type)) return frontier(node, 'Reduction accumulator evolution is unresolved')
          return scalar(type)
        }
        if (method === 'concat') return { ...data('array', new Map(), [...receiver.items, ...args.flatMap(value => alternatives(value).flatMap(part => part.kind === 'array' ? part.items : [part]))]),
          allIndices: !!receiver.allIndices || args.some(value => alternatives(value).some(part => part.kind === 'array' && part.allIndices)) }
        if (['map', 'flatMap', 'filter', 'find', 'findIndex', 'some', 'every', 'forEach'].includes(method)) {
          // A native find can only return one of its actual array elements or
          // undefined. Make that finite domain available to recursive value
          // queries of the const being initialized while still analyzing every
          // actual predicate invocation. Mutated or escaped arrays cannot use
          // this proof.
          const previousSeeds = recursiveBindings
          if (method === 'find' && receiver.sourceNode && receiver.capturedAllocation && allocationFacts && !activeScopes.has(receiver.sourceScope)
            && !receiver.poisoned && !receiver.allIndices && !receiver.fallback && !receiver.fields.size
            && intrinsicStable('Array', currentScope) && intrinsicStable('Object', currentScope)) {
            for (const declaration of active) if (ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent)
              && (declaration.parent.flags & ts.NodeFlags.Const)) {
              let initial = declaration.initializer
              while (initial && (ts.isParenthesizedExpression(initial) || ts.isAsExpression(initial) || ts.isTypeAssertionExpression(initial)
                || ts.isNonNullExpression(initial) || ts.isSatisfiesExpression(initial))) initial = initial.expression
              const owner = initial === node && scopeForDeclaration?.(declaration, currentScope)
              if (owner && stableFindDomain(receiver, declaration, owner)) {
                if (recursiveBindings === previousSeeds) recursiveBindings = new Map(previousSeeds)
                recursiveBindings.set(declaration, { scope: owner, value: join([...receiver.items, constant(undefined)]) })
              }
            }
          }
          let results
          try { results = receiver.items.map((item, index) => call(args[0] ?? unknown, [item, receiver.allIndices ? scalar('number') : constant(index), receiver], node, env)) }
          finally { recursiveBindings = previousSeeds }
          if (!receiver.items.length) return method === 'some' || method === 'every' ? scalar('boolean') : method === 'findIndex' ? scalar('number') : ['find', 'forEach'].includes(method) ? constant(undefined) : data('array')
          if (method === 'some' || method === 'every') return scalar('boolean')
          if (method === 'findIndex') return scalar('number')
          if (method === 'forEach') return constant(undefined)
          if (method === 'filter') return { ...data('array', new Map(), [...receiver.items]), allIndices: true }
          if (method === 'find') return join([...receiver.items, constant(undefined)])
          return { ...data('array', new Map(), method === 'flatMap' ? results.flatMap(result => alternatives(result).flatMap(part => part.kind === 'array' ? part.items : part.kind === 'bottom' ? [] : [part])) : results),
            allIndices: !!receiver.allIndices || method === 'flatMap' && results.some(result => alternatives(result).some(part => part.allIndices)) }
        }
        if (['includes', 'indexOf'].includes(method)) return args.length < 2 || primitive(args[1]) ? scalar(method === 'includes' ? 'boolean' : 'number') : frontier(node, 'Array start-index conversion is unresolved')
        if (method === 'push' || method === 'unshift') { receiver.items.push(...args); receiver.allIndices = true; return scalar('number') }
        if (method === 'shift' || method === 'pop') { receiver.allIndices = true; return join([...receiver.items, constant(undefined)]) }
        if (method === 'splice' && args.slice(0, 2).every(dataScalar)) { const removed = [...receiver.items]; receiver.items.push(...args.slice(2)); receiver.allIndices = true; return { ...data('array', new Map(), removed), allIndices: true } }
        if (method === 'at') return join(receiver.items)
        if (method === 'slice') return args.every(dataScalar) ? { ...data('array', new Map(), [...receiver.items]), allIndices: true } : frontier(node, 'Array slice index coercion is unresolved')
        if (method === 'reverse') { receiver.allIndices = true; return receiver }
        if (method === 'sort') {
          receiver.allIndices = true
          if (args.length === 0) return receiver.items.every(dataScalar) ? receiver : frontier(node, 'Default sorting may execute user coercion')
          const compared = join(receiver.items)
          call(args[0], [compared, compared], node, env)
          return receiver
        }
        if (method === 'join') return receiver.items.every(dataScalar) && args.every(dataScalar) ? scalar('string') : frontier(node, 'Array join may execute coercion')
      }
      if (name.startsWith('string.')) {
        if (['string.replace', 'string.replaceAll'].includes(name)) {
          if (!alternatives(args[0] ?? unknown).every(value => value.kind === 'regexp' || dataScalar(value))) return frontier(node, 'Replacement pattern protocol is unresolved')
          if (args[1]?.kind === 'function') invoke(args[1], [scalar('string'), scalar('number'), scalar('string')], node)
          else if (args[1] && !dataScalar(args[1])) return frontier(node, 'Replacement value coercion is unresolved')
          return scalar('string')
        }
        if (!args.every(primitive)) return frontier(node, 'String operation may execute a callback or coercion')
        if (['string.charCodeAt', 'string.codePointAt'].includes(name)) return scalar('number')
        if (name === 'string.split') return data('array', new Map(), [scalar('string')])
        if (['slice', 'substring', 'trim', 'repeat', 'toLowerCase', 'toUpperCase'].includes(name.slice(7))) return scalar('string')
        if (['includes', 'startsWith', 'endsWith'].includes(name.slice(7))) return scalar('boolean')
      }
      return frontier(node, 'Native operation lacks an effect/protocol summary')
    }))
  }
  function assign(left, value, env, node) {
    if (ts.isIdentifier(left)) { const declaration = declarationOf(left); env.set(declaration, value); env.writes?.add(declaration); return value }
    if (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) {
      const receiver = evaluate(left.expression, env), key = ts.isPropertyAccessExpression(left) ? constant(left.name.text) : evaluate(left.argumentExpression, env)
      return join(alternatives(receiver).flatMap(part => alternatives(key).map(property => {
        if (part.kind === 'bottom' || part.constant && part.value == null) return { kind: 'bottom' }
        if (part.kind === 'object' && !property.constant && dataScalar(property) && dataOnly(value)) { part.fallback = part.fallback ? join([part.fallback, value]) : value; return value }
        if (part.kind === 'json' && !dataOnly(value)) part.poisoned = true
        if (part.kind === 'array' && dataScalar(property)) { part.items.push(value); part.allIndices = true; return value }
        if (part.kind === 'json' && dataOnly(value) && dataScalar(property)) return value
        if (['object', 'instance'].includes(part.kind) && property.constant && property.value !== '__proto__') {
          const name = String(property.value), prior = part.fields.get(name)
          if (prior?.kind === 'accessor') return prior.set ? invoke({ node: prior.set, env: prior.env, scope: prior.scope, receiver: part }, [value], node) : { kind: 'bottom' }
          part.fields.set(name, prior ? join([prior, value]) : value); return value
        }
        return frontier(node, 'Assignment receiver may invoke a setter or proxy')
      })))
    }
    return frontier(node, 'Assignment binding is unresolved')
  }
  function evaluate(node, env) {
    if (!node) return constant(undefined)
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return evaluate(node.expression, env)
    if (ts.isAwaitExpression(node)) {
      const value = evaluate(node.expression, env)
      return join(alternatives(value).map(part => part.kind === 'promise' ? part.value : primitive(part) || part.kind === 'json'
        || part.kind === 'object' && !part.fields.has('then') && !part.fallback ? part : frontier(node, 'Await may execute an unknown thenable')))
    }
    if (ts.isRegularExpressionLiteral(node)) return { kind: 'regexp' }
    if (ts.isStringLiteralLike(node)) return constant(node.text)
    if (ts.isNumericLiteral(node)) return constant(Number(node.text))
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return constant(node.kind === ts.SyntaxKind.TrueKeyword)
    if (node.kind === ts.SyntaxKind.NullKeyword) return constant(null)
    if (node.kind === ts.SyntaxKind.ThisKeyword) return env.get(thisBinding) ?? unknown
    if (ts.isIdentifier(node)) return symbolValue(node, env)
    if (ts.isFunctionLike(node) && node.body) return { kind: 'function', node, env, scope: currentScope }
    if (ts.isObjectLiteralExpression(node)) {
      const fields = new Map()
      for (const property of node.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          const value = evaluate(property.name, env)
          if (value.kind === 'bottom') return value
          fields.set(property.name.text, value)
        }
        else if (ts.isPropertyAssignment(property)) {
          const key = ts.isComputedPropertyName(property.name) ? evaluate(property.name.expression, env) : constant(property.name.text)
          if (!dataScalar(key)) return frontier(property, 'Computed property allocation is unresolved')
          const value = evaluate(property.initializer, env)
          if (value.kind === 'bottom') return value
          const name = key.constant ? String(key.value) : '<computed fields>'
          fields.set(name, fields.has(name) ? join([fields.get(name), value]) : value)
        }
        else if (ts.isMethodDeclaration(property) && !ts.isComputedPropertyName(property.name)) fields.set(property.name.text, evaluate(property, env))
        else if ((ts.isGetAccessor(property) || ts.isSetAccessor(property)) && !ts.isComputedPropertyName(property.name)) {
          const previous = fields.get(property.name.text)
          fields.set(property.name.text, { ...(previous?.kind === 'accessor' ? previous : {}), kind: 'accessor',
            ...(ts.isGetAccessor(property) ? { get: property } : { set: property }), env, scope: currentScope })
        }
        else if (ts.isSpreadAssignment(property)) {
          const spread = evaluate(property.expression, env)
          for (const part of alternatives(spread)) {
            if (part.kind === 'native' && part.name === 'process:env') fields.set('<native environment>', { kind: 'environment' })
            else if (part.kind === 'json') fields.set('<data fields>', part)
            else if (part.kind === 'object') for (const [key, value] of part.fields) fields.set(key, fields.has(key) ? join([fields.get(key), value]) : value)
            else if (part.kind !== 'bottom' && !primitive(part)) return frontier(property, 'Object spread may execute an unknown getter or proxy')
          }
        }
        else return frontier(property, 'Object spread, accessor or computed property effects are unresolved')
      }
      const result = { ...data('object', fields), sourceNode: node, sourceScope: currentScope, capturedAllocation: reading || !activeScopes.has(currentScope) }
      if (fields.has('<computed fields>')) { result.fallback = fields.get('<computed fields>'); fields.delete('<computed fields>') }
      if (fields.has('<data fields>')) { fields.delete('<data fields>'); result.fallback = { kind: 'json' } }
      if (fields.has('<native environment>')) { fields.delete('<native environment>'); result.fallback = scalar('string') }
      return result
    }
    if (ts.isArrayLiteralExpression(node)) {
      const items = []; let allIndices = false
      for (const item of node.elements) {
        if (ts.isSpreadElement(item)) {
          const value = evaluate(item.expression, env)
          for (const part of alternatives(value)) {
            if (part.kind === 'array' || part.kind === 'set') { items.push(...part.items); allIndices ||= !!part.allIndices || part.kind === 'set' && !!part.hasUpdates }
            else if (part.kind === 'json') items.push(part)
            else if (part.kind !== 'bottom' && !(part.constant && part.value == null)) return frontier(item, 'Spread iterator effects are unresolved')
          }
        } else { const value = evaluate(item, env); if (value.kind === 'bottom') return value; items.push(value) }
      }
      return { ...data('array', new Map(), items), allIndices, sourceNode: node, sourceScope: currentScope, capturedAllocation: reading || !activeScopes.has(currentScope) }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        const declaration = declarationOf(node.expression), owner = declaration && scopeForDeclaration?.(declaration, currentScope)
        // Reading a captured binding does not re-execute its initializer.
        // Reuse only a scalar data-property fact from the actual runtime heap;
        // getters/unknown receivers have no such proof, and active source
        // invocations continue to use the interpreter's own environment.
        if (owner && !env.has(declaration) && !activeScopes.has(owner)) {
          const type = observedScalar?.(node, currentScope)
          if (type) return scalar(type)
        }
      }
      const receiver = evaluate(node.expression, env)
      const skipped = alternatives(receiver).filter(value => node.flags & ts.NodeFlags.OptionalChain && value.shortCircuit || node.questionDotToken && nullish(value) !== false)
      const live = alternatives(receiver).filter(value => !(node.flags & ts.NodeFlags.OptionalChain && value.shortCircuit) && !(node.questionDotToken && nullish(value) === true))
      return join([...(skipped.length ? [optionalUndefined()] : []), ...(live.length ? [read(join(live), ts.isPropertyAccessExpression(node) ? constant(node.name.text) : evaluate(node.argumentExpression, env), node, env)] : [])])
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const target = evaluate(node.expression, env), args = []
      const skipped = alternatives(target).filter(value => node.flags & ts.NodeFlags.OptionalChain && value.shortCircuit || node.questionDotToken && nullish(value) !== false)
      const live = alternatives(target).filter(value => !(node.flags & ts.NodeFlags.OptionalChain && value.shortCircuit) && !(node.questionDotToken && nullish(value) === true))
      if (!live.length) return skipped.length ? optionalUndefined() : { kind: 'bottom' }
      for (const arg of node.arguments ?? []) {
        if (ts.isSpreadElement(arg)) {
          const value = evaluate(arg.expression, env)
          const sequences = alternatives(value)
          if (!sequences.every(part => ['array', 'set', 'json', 'bottom'].includes(part.kind) || part.kind === 'scalar')) return frontier(arg, 'Argument iterator effects are unresolved')
          const count = Math.max(0, ...sequences.map(part => part.items?.length ?? (part.kind === 'json' ? Math.max(1, ...alternatives(target).map(fn => fn.node ? runtimeParameters(fn.node).length : 1)) : 0)))
          for (let index = 0; index < count; index++) args.push(join(sequences.map(part => part.kind === 'json' ? part : part.items?.[index] ?? constant(undefined))))
        } else args.push(evaluate(arg, env))
      }
      if (!reading) calls.add(node)
      return join([...(skipped.length ? [optionalUndefined()] : []), call(join(live), args, node, env, ts.isNewExpression(node), [...(node.arguments ?? [])])])
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op === ts.SyntaxKind.EqualsToken) return assign(node.left, evaluate(node.right, env), env, node)
      if ([ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken].includes(op)) {
        const prior = evaluate(node.left, env)
        const replace = op === ts.SyntaxKind.QuestionQuestionEqualsToken ? alternatives(prior).filter(value => nullish(value) !== false) : possible(prior, op === ts.SyntaxKind.AmpersandAmpersandEqualsToken)
        if (!replace.length) return prior
        const retained = op === ts.SyntaxKind.QuestionQuestionEqualsToken ? alternatives(prior).filter(value => nullish(value) !== true) : possible(prior, op !== ts.SyntaxKind.AmpersandAmpersandEqualsToken)
        const value = join([...retained, evaluate(node.right, env)])
        return assign(node.left, value, env, node)
      }
      if (op >= ts.SyntaxKind.FirstCompoundAssignment && op <= ts.SyntaxKind.LastCompoundAssignment) {
        const left = evaluate(node.left, env), right = evaluate(node.right, env)
        if (!dataScalar(left) || !dataScalar(right)) {
          frontier(node, 'Assignment coercion may execute user code')
          return assign(node.left, unknown, env, node)
        }
        return assign(node.left, op === ts.SyntaxKind.PlusEqualsToken ? additionResult(left, right) : numericResult(left, right), env, node)
      }
      const left = evaluate(node.left, env)
      if (left.kind === 'bottom') return left
      if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(op)) {
        const proceed = op === ts.SyntaxKind.QuestionQuestionToken ? alternatives(left).filter(value => nullish(value) !== false) : possible(left, op === ts.SyntaxKind.AmpersandAmpersandToken)
        const retained = op === ts.SyntaxKind.QuestionQuestionToken ? alternatives(left).filter(value => nullish(value) !== true) : possible(left, op !== ts.SyntaxKind.AmpersandAmpersandToken)
        if (!proceed.length) return join(retained)
        const branch = fork(env)
        if (op !== ts.SyntaxKind.QuestionQuestionToken) refine(node.left, branch, op === ts.SyntaxKind.AmpersandAmpersandToken)
        const right = evaluate(node.right, branch)
        merge(env, retained.length ? [env, branch] : [branch])
        return join([...retained, right])
      }
      const right = evaluate(node.right, env)
      if (op === ts.SyntaxKind.InKeyword) return dataScalar(left) && alternatives(right).every(value => ['object', 'json', 'array', 'map', 'set', 'instance'].includes(value.kind)) ? scalar('boolean') : frontier(node, 'Membership receiver or property-key protocol is unresolved')
      if (left.kind === 'bottom' || right.kind === 'bottom') return { kind: 'bottom' }
      if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(op)) {
        const same = left.constant && right.constant ? left.value === right.value : left.token && left.token === right.token ? true : undefined
        return same === undefined ? scalar('boolean') : constant(op === ts.SyntaxKind.EqualsEqualsEqualsToken ? same : !same)
      }
      if (!dataScalar(left) || !dataScalar(right)) return frontier(node, 'Binary operation may invoke user coercion')
      if ([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
        ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(op)) return scalar('boolean')
      return op === ts.SyntaxKind.PlusToken ? additionResult(left, right) : numericResult(left, right)
    }
    if (ts.isConditionalExpression(node)) {
      const condition = evaluate(node.condition, env)
      if (condition.kind === 'bottom') return condition
      if (!possible(condition, false).length) return evaluate(node.whenTrue, env)
      if (!possible(condition, true).length) return evaluate(node.whenFalse, env)
      const left = fork(env), right = fork(env); refine(node.condition, left, true); refine(node.condition, right, false)
      const result = join([evaluate(node.whenTrue, left), evaluate(node.whenFalse, right)])
      merge(env, [left, right]); return result
    }
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      const value = evaluate(node.operand, env)
      if (value.kind === 'bottom') return value
      if (node.operator === ts.SyntaxKind.ExclamationToken) {
        const values = alternatives(value).map(truth)
        return values.every(value => value === true) ? constant(false) : values.every(value => value === false) ? constant(true) : scalar('boolean')
      }
      return dataScalar(value) ? scalar('number') : frontier(node, 'Unary operation may invoke user coercion')
    }
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) if (!dataScalar(evaluate(span.expression, env))) return frontier(span.expression, 'Template interpolation may invoke user coercion')
      return scalar('string')
    }
    if (ts.isVoidExpression(node) || ts.isTypeOfExpression(node)) { evaluate(node.expression, env); return ts.isVoidExpression(node) ? constant(undefined) : scalar('string') }
    if (ts.isDeleteExpression(node)) {
      const target = node.expression
      if (!ts.isPropertyAccessExpression(target) && !ts.isElementAccessExpression(target)) return frontier(node, 'Delete target scope is unresolved')
      const receiver = evaluate(target.expression, env), key = ts.isPropertyAccessExpression(target) ? constant(target.name.text) : evaluate(target.argumentExpression, env)
      for (const part of alternatives(receiver)) {
        syncAllocation(part)
        if (part.kind === 'bottom' || part.constant && part.value == null) continue
        if (part.poisoned || !['object', 'array', 'json'].includes(part.kind) || !dataScalar(key)) return frontier(node, 'Delete may invoke a proxy or property-key coercion')
        // Keep both memberships when a shared abstract allocation also occurs
        // on the other branch. Removing an ordinary own property calls no getter.
        for (const property of alternatives(key)) {
          const keys = property.constant ? [String(property.value)] : [...(part.fields?.keys() ?? [])]
          for (const key of keys) if (part.fields?.has(key)) part.fields.set(key, join([part.fields.get(key), constant(undefined)]))
          if (part.kind === 'array') { part.items.push(constant(undefined)); part.allIndices = true }
        }
      }
      return scalar('boolean')
    }
    return frontier(node, 'Expression lacks a finite value/effect summary')
  }
  function bind(pattern, value, env, owner) {
    if (ts.isIdentifier(pattern)) { env.set(owner, value); env.writes?.add(owner); return }
    const parts = alternatives(value)
    if (ts.isArrayBindingPattern(pattern) && !parts.every(part => part.kind === 'array' || part.kind === 'json' || part.kind === 'bottom')) frontier(pattern, 'Destructuring iterator protocol is unresolved')
    for (const [index, element] of pattern.elements.entries()) {
      if (ts.isOmittedExpression(element)) continue
      if (element.dotDotDotToken) { frontier(element, 'Rest destructuring protocol is unresolved'); continue }
      const key = ts.isArrayBindingPattern(pattern) ? String(index) : (element.propertyName ?? element.name).text
      const projected = read(value, constant(key), element, env)
      bind(element.name, projected, env, element)
    }
  }
  function refine(condition, env, truth) {
    if (ts.isParenthesizedExpression(condition)) return refine(condition.expression, env, truth)
    if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken) return refine(condition.operand, env, !truth)
    if (ts.isIdentifier(condition)) { env.set(declarationOf(condition), join(possible(symbolValue(condition, env), truth))); return }
    if (!ts.isBinaryExpression(condition)) return
    const op = condition.operatorToken.kind
    if (op === ts.SyntaxKind.AmpersandAmpersandToken && truth || op === ts.SyntaxKind.BarBarToken && !truth) { refine(condition.left, env, truth); refine(condition.right, env, truth); return }
    if (![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(op)) return
    const equal = truth === (op === ts.SyntaxKind.EqualsEqualsEqualsToken)
    if (ts.isTypeOfExpression(condition.left) && ts.isIdentifier(condition.left.expression) && ts.isStringLiteralLike(condition.right)) {
      const expected = condition.right.text, declaration = declarationOf(condition.left.expression)
      const actualType = value => value.kind === 'scalar' ? value.type
        : ['object', 'array', 'instance', 'map', 'set', 'buffer', 'promise', 'regexp'].includes(value.kind) || value.kind === 'json' && value.dataShape ? 'object'
          : ['function', 'class', 'mock'].includes(value.kind) ? 'function' : undefined
      const values = alternatives(symbolValue(condition.left.expression, env)).flatMap(value => {
        const type = actualType(value)
        if (type !== undefined) return (type === expected) === equal ? [value] : []
        return [equal && ['string', 'number', 'boolean', 'undefined', 'bigint', 'symbol'].includes(expected) ? scalar(expected) : value]
      })
      env.set(declaration, join(values))
    } else if (ts.isIdentifier(condition.left) && (condition.right.kind === ts.SyntaxKind.NullKeyword || condition.right.kind === ts.SyntaxKind.UndefinedKeyword || ts.isIdentifier(condition.right) && condition.right.text === 'undefined')) {
      const declaration = declarationOf(condition.left), value = symbolValue(condition.left, env), expected = condition.right.kind === ts.SyntaxKind.NullKeyword ? null : undefined
      env.set(declaration, equal ? constant(expected) : join(alternatives(value).filter(part => !(part.constant && part.value === expected))))
    }
  }
  function statement(node, env, returns) {
    if (!node) return false
    if (ts.isBlock(node)) { for (const child of node.statements) if (statement(child, env, returns)) return true; return false }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        const value = evaluate(declaration.initializer, env)
        bind(declaration.name, value, env, declaration)
      }
    } else if (ts.isExpressionStatement(node)) evaluate(node.expression, env)
    else if (ts.isReturnStatement(node)) { returns.push(evaluate(node.expression, env)); return true }
    else if (ts.isThrowStatement(node)) { evaluate(node.expression, env); return true }
    else if (ts.isIfStatement(node)) {
      const condition = evaluate(node.expression, env)
      if (condition.kind === 'bottom') return true
      if (!possible(condition, false).length) return statement(node.thenStatement, env, returns)
      if (!possible(condition, true).length) return statement(node.elseStatement, env, returns)
      const left = fork(env), right = fork(env)
      refine(node.expression, left, true); refine(node.expression, right, false)
      const a = statement(node.thenStatement, left, returns), b = statement(node.elseStatement, right, returns)
      merge(env, a && !b ? [right] : b && !a ? [left] : [left, right])
      return a && b
    } else if (ts.isForStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      const loop = fork(env)
      if (node.initializer) {
        if (ts.isVariableDeclarationList(node.initializer)) for (const declaration of node.initializer.declarations) {
          const value = evaluate(declaration.initializer, loop)
          bind(declaration.name, value.kind === 'scalar' ? scalar(value.type) : value, loop, declaration)
        } else evaluate(node.initializer, loop)
      }
      evaluate(node.condition ?? node.expression, loop)
      statement(node.statement, loop, returns)
      if (node.incrementor) evaluate(node.incrementor, loop)
      merge(env, [env, loop])
    } else if (ts.isSwitchStatement(node)) {
      evaluate(node.expression, env)
      for (const clause of node.caseBlock.clauses) {
        const branch = fork(env)
        if (clause.expression) evaluate(clause.expression, branch)
        for (const child of clause.statements) if (statement(child, branch, returns)) break
        merge(env, [env, branch])
      }
    } else if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const input = evaluate(node.expression, env), values = []
      for (const part of alternatives(input)) {
        if (ts.isForInStatement(node) && (part.kind === 'json' || part.kind === 'object' && plain(part))) values.push(scalar('string'))
        else if (['array', 'set', 'map'].includes(part.kind)) values.push(...part.items)
        else if (part.kind === 'json') values.push(part)
        else if (part.kind === 'scalar' && part.type === 'string') values.push(scalar('string'))
        else if (part.kind === 'scalar' || part.kind === 'bottom') continue
        else if (part.kind !== 'bottom') frontier(node.expression, 'Loop iterator or property protocol is unresolved')
      }
      const loop = fork(env), value = join(values)
      if (ts.isVariableDeclarationList(node.initializer)) for (const declaration of node.initializer.declarations) bind(declaration.name, value, loop, declaration)
      else assign(node.initializer, value, loop, node)
      statement(node.statement, loop, returns)
      merge(env, [env, loop])
    } else if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) return false
    else if (ts.isTryStatement(node)) {
      const normal = fork(env), exceptional = fork(env)
      const a = statement(node.tryBlock, normal, returns)
      if (node.catchClause?.variableDeclaration) exceptional.set(node.catchClause.variableDeclaration, unknown)
      const b = node.catchClause ? statement(node.catchClause.block, exceptional, returns) : false
      merge(env, [normal, exceptional])
      return statement(node.finallyBlock, env, returns) || a && b
    } else if (ts.isFunctionDeclaration(node) || ts.isEmptyStatement(node)) return false
    else frontier(node, 'Statement lacks a finite control/effect summary')
    return false
  }
  function invoke(fn, args, at, sourceArgs = null) {
    const node = fn.node
    const frames = activeInvocations.get(node) ?? []
    // Reading an argument's provenance can revisit an earlier, completed call
    // of the same function. Only an activation on the current call chain is
    // recursive; sharing a function body alone is not evidence of re-entry.
    const ancestors = new Set(), pending = [currentScope]
    for (const scope of pending) if (scope && !ancestors.has(scope)) {
      ancestors.add(scope); pending.push(scope.caller, scope.lexicalParent)
    }
    const recursive = frames.findLast(frame => !currentScope || !frame.scope || ancestors.has(frame.scope))
    if (recursive) {
      recursive.recursive = true
      return reading ? recursive.value : frontier(at, 'Recursive callback effects are unresolved')
    }
    const callerScope = currentScope
    const invocationIndex = reading ? null : invocations.length
    if (invocationIndex !== null) { invocations.push({ callback: node, call: at, scope: callerScope, capture: fn.scope, sourceArgs, parent: invocationStack.at(-1) }); invocationStack.push(invocationIndex) }
    currentScope = scopeForCall?.(node, at, callerScope, fn.scope, sourceArgs) ?? callerScope
    const invocationScope = currentScope
    const activation = { scope: invocationScope, recursive: false, value: { kind: 'bottom' } }
    frames.push(activation); activeInvocations.set(node, frames)
    if (invocationIndex === 0) entryScope = invocationScope
    activeScopes.set(invocationScope, (activeScopes.get(invocationScope) ?? 0) + 1)
    active.add(node)
    const env = new Map(fn.env)
    if (fn.receiver) env.set(thisBinding, fn.receiver)
    runtimeParameters(node).forEach((parameter, index) => {
      {
        const argument = args[index] ?? constant(undefined)
        const values = alternatives(argument)
        const defaulted = values.some(value => value.kind === 'unknown' || value.kind === 'json' || value.constant && value.value === undefined || value.kind === 'scalar' && value.type === 'undefined')
        const value = parameter.dotDotDotToken ? data('array', new Map(), args.slice(index)) : !parameter.initializer || !defaulted ? argument
          : join([...values.filter(value => !(value.constant && value.value === undefined || value.kind === 'scalar' && value.type === 'undefined')), evaluate(parameter.initializer, env)])
        bind(parameter.name, value, env, parameter)
        if (ts.isConstructorDeclaration(node) && parameter.modifiers?.some(modifier => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword].includes(modifier.kind))) fn.receiver.fields.set(parameter.name.text, env.get(parameter))
      }
    })
    let result = unknown
    const shape = (value, seen = new Set()) => {
      if (seen.has(value)) return '<cycle>'
      const next = new Set(seen).add(value)
      if (value.kind === 'union') return [...new Set(value.values.map(item => shape(item, next)))].sort().join('|')
      if (value.kind === 'array' || value.kind === 'map') return value.kind + '<' + [...new Set(value.items.map(item => shape(item, next)))].sort().join('|') + '>'
      if (value.fields) return value.kind + '{' + [...value.fields].map(([key, item]) => key + ':' + shape(item, next)).sort().join(',') + '}'
      return value.kind === 'scalar' ? value.type : value.kind === 'function' ? 'function:' + value.node.getSourceFile().fileName + ':' + value.node.pos : value.kind
    }
    const widen = (value, seen = new Map()) => {
      if (seen.has(value)) return seen.get(value)
      if (value.kind === 'scalar') return scalar(value.type)
      const result = { ...value }; seen.set(value, result)
      if (value.fields) result.fields = new Map([...value.fields].map(([key, item]) => [key, widen(item, seen)]))
      if (value.items) result.items = value.items.map(item => widen(item, seen))
      if (value.values) result.values = value.values.map(item => widen(item, seen))
      return result
    }
    for (let iteration = 0; iteration < (reading ? 4 : 1); iteration++) {
      const returns = []
      const frame = fork(env)
      if (ts.isBlock(node.body)) { if (!statement(node.body, frame, returns)) returns.push(constant(undefined)) }
      else returns.push(evaluate(node.body, frame))
      // Closures observe their lexical binding after an invoked helper writes
      // it. Only writes to outer declarations propagate out of this activation;
      // parameters and locals belong to the new frame.
      for (const declaration of frame.writes) {
        let owner = declaration?.parent
        while (owner && !ts.isFunctionLike(owner) && !ts.isSourceFile(owner)) owner = owner.parent
        if (owner === node) continue
        const value = frame.get(declaration)
        fn.env.set(declaration, fn.env.has(declaration) ? join([fn.env.get(declaration), value]) : value)
        fn.env.writes?.add(declaration)
      }
      const next = activation.recursive ? widen(join(returns)) : join(returns)
      if (!reading || !activation.recursive || shape(next) === shape(result)) { result = next; break }
      result = next; activation.value = result
      if (iteration === 3) result = unknown
    }
    frames.pop()
    if (!frames.length) { activeInvocations.delete(node); active.delete(node) }
    const remaining = activeScopes.get(invocationScope) - 1
    if (remaining) activeScopes.set(invocationScope, remaining)
    else activeScopes.delete(invocationScope)
    currentScope = callerScope
    if (invocationIndex !== null) invocationStack.pop()
    // Source returns retain the allocation itself. A helper cannot turn a
    // mutable object into immutable JSON merely by returning it.
    return node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ? { kind: 'promise', value: result } : result
  }
  function initialize({ scope, lookupCallable: lookup, scopeForCall: sourceScope, inspectCaptured = false, synchronous = false, replacementBoundary: boundary }) {
    frontiers = []; calls = new Set(); invocations = []; invocationStack = []; heapValues = new WeakMap(); activeScopes = new Map(); bindingValues = new WeakMap(); entryScope = null; reading = true
    currentScope = scope; parameterQueries = new WeakMap(); parameterValues = new WeakMap(); lookupCallable = lookup; scopeForCall = sourceScope
    recursiveBindings = new Map(); pendingMapWrites = []; queuedMapWrites = new WeakMap(); pendingCompoundWrites = []; queuedCompoundWrites = new WeakMap()
    flushedMapWrites = 0; flushedCompoundWrites = 0
    inspectCapturedInitializers = inspectCaptured
    synchronousInvocation = synchronous
    replacementBoundary = boundary
  }
  function flushMapWriteEffects() {
    const previousScope = currentScope, previousReading = reading
    reading = false
    try {
      while (flushedMapWrites < pendingMapWrites.length) {
        const write = pendingMapWrites[flushedMapWrites++]; currentScope = write.scope
        for (const argument of write.args) evaluate(argument, new Map())
      }
    } finally { currentScope = previousScope; reading = previousReading }
  }
  function flushCompoundWriteEffects() {
    const previousScope = currentScope, previousReading = reading, previousSeeds = recursiveBindings
    reading = false
    try {
      while (flushedCompoundWrites < pendingCompoundWrites.length) {
        const pending = pendingCompoundWrites[flushedCompoundWrites++]; pending.processed = true
        const { write, declaration, owner, seed, env } = pending
        currentScope = write.scope; recursiveBindings = new Map(previousSeeds)
        if (owner) recursiveBindings.set(declaration, { scope: owner, value: seed })
        const value = evaluate(write.expression, env)
        if (!dataScalar(seed) || !dataScalar(value)) frontier(write.ast ?? write.expression, 'Assignment coercion may execute user code')
      }
    } finally { currentScope = previousScope; reading = previousReading; recursiveBindings = previousSeeds }
  }
  function flushCapturedWriteEffects() {
    while (flushedMapWrites < pendingMapWrites.length || flushedCompoundWrites < pendingCompoundWrites.length) {
      flushMapWriteEffects(); flushCompoundWriteEffects()
    }
  }
  function summarize(callback, args = [], options = {}) {
    const { scope, call: actualCall, abstractArguments, argumentBindings } = options
    initialize(options)
    const sourceArgs = abstractArguments || argumentBindings ? null : actualCall?.arguments ? [...actualCall.arguments] : null
    entryScope = scopeForCall?.(callback, actualCall ?? callback, scope, undefined, sourceArgs) ?? scope
    const values = argumentBindings ? argumentBindings.map(bindings => join(bindings.map(binding => {
      const prior = currentScope; currentScope = binding.scope
      const value = binding.numeric ? scalar('number') : evaluate(binding.expression, new Map())
      currentScope = prior; return value
    }))) : abstractArguments ? abstractArguments.map(kind => kind === 'undefined' ? constant(undefined) : kind === 'number' ? scalar('number') : unknown)
      : args.map(arg => evaluate(arg, new Map()))
    reading = false
    const value = invoke({ node: callback, env: new Map() }, values, actualCall ?? callback, sourceArgs)
    flushCapturedWriteEffects()
    return { value, calls, invocations, frontiers, complete: frontiers.length === 0 }
  }
  summarize.expression = (expression, options = {}) => {
    initialize(options)
    // Observing an existing value is a read within the enclosing activation,
    // not a fresh execution that owns all of that activation's heap writes.
    entryScope = options.observation ? { caller: options.scope, callsite: expression } : options.scope
    reading = false
    const value = evaluate(expression, new Map())
    flushCapturedWriteEffects()
    return { value, calls, invocations, frontiers, complete: frontiers.length === 0 }
  }
  return summarize
}
module.exports = { callbackEffects }
