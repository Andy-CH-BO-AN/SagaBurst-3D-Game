const ts = require('typescript')
const { posix } = require('node:path')

// A deliberately bounded constant evaluator, not a source/test ownership table.
// Unknown terms survive as wildcards and diagnostics, never as proven edges.
const UNKNOWN = '\u0000'
const URL_VALUE = Symbol('resolved import-relative URL')
const choices = value => value && typeof value === 'object' && value.alternatives ? value.alternatives : [value]
const union = values => { const all = [...new Set(values.flatMap(choices))]; return all.length === 1 ? all[0] : { alternatives: all } }
const combine = (left, right, operation) => union(choices(left).flatMap(a => choices(right).map(b => operation(a, b))))
const stringValue = value => ['string', 'number'].includes(typeof value) ? String(value) : UNKNOWN
function inputDependencies(sources, exists, files = [...sources.keys()], texts = sources) {
  const units = new Map(), edges = [], risks = [], patterns = [], pathnamePatterns = new Map()
  const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const unknownPath = value => value.includes(UNKNOWN) || /\x01\d+\x02/.test(value)
  const pathPattern = value => {
    const captures = new Map()
    return '^' + value.split(/(\x00|\x01\d+\x02)/).map(part => {
      if (part === UNKNOWN) return '.*'
      if (!pathnamePatterns.has(part)) return escapePattern(part)
      if (captures.has(part)) return '\\k<' + captures.get(part) + '>'
      const name = 'entry' + captures.size
      captures.set(part, name)
      return '(?<' + name + '>' + pathnamePatterns.get(part).pattern + ')'
    }).join('') + '$'
  }
  const modulePath = (file, name) => {
    const stem = posix.normalize(posix.join(posix.dirname(file), name))
    return [stem, ...['.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.js', '/index.cjs', '/index.mjs'].map(ext => stem + ext)].find(exists)
  }
  for (const [file, text] of sources) {
    if (!/\.[cm]?[jt]sx?$/.test(file) || /\.d\.[cm]?ts$/.test(file)) continue
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const declarations = new Map(), imports = new Map(), calls = [], opaqueModules = new Set(), importBindings = new Map(), pendingImports = [], cjsExports = new Map(), cjsExportRefs = new Set()
    let exportWrites = 0, invalidExports = false
    function scan(node) {
      if ((ts.isVariableDeclaration(node) || ts.isBindingElement(node) || ts.isFunctionDeclaration(node) || ts.isParameter(node)) && node.name && ts.isIdentifier(node.name)) {
        const list = declarations.get(node.name.text) ?? []
        list.push(node); declarations.set(node.name.text, list)
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const target = modulePath(file, node.moduleSpecifier.text)
        const bindings = node.importClause?.namedBindings
        if (target && bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) imports.set(item.name.text, [target, item.propertyName?.text ?? item.name.text])
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        const left = node.left.getText(ast)
        if (left === 'module.exports') {
          exportWrites++
          if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isObjectLiteralExpression(node.right)) invalidExports = true
          else for (const property of node.right.properties) {
            const value = ts.isShorthandPropertyAssignment(property) ? property.name : ts.isPropertyAssignment(property) ? property.initializer : null
            if (!value || !ts.isIdentifier(value) || !property.name || ts.isComputedPropertyName(property.name)) invalidExports = true
            else { cjsExports.set(property.name.text, value.text); cjsExportRefs.add(value) }
          }
        } else if (/^(?:module\.exports|exports)[.[]/.test(left)) invalidExports = true
      }
      if (ts.isCallExpression(node)) {
        calls.push(node)
        if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && ts.isStringLiteralLike(node.arguments[0])) {
          const target = modulePath(file, node.arguments[0].text)
          if (target) {
            const declaration = node.parent
            if (ts.isIdentifier(node.expression) && ts.isVariableDeclaration(declaration) && declaration.initializer === node && ts.isObjectBindingPattern(declaration.name) && declaration.name.elements.every(item => ts.isIdentifier(item.name) && !item.dotDotDotToken && !item.initializer)) {
              for (const item of declaration.name.elements) pendingImports.push({ name: item.name.text, imported: item.propertyName?.text ?? item.name.text, target, binding: item, call: node })
            } else opaqueModules.add(target)
          }
        }
      }
      ts.forEachChild(node, scan)
    }
    scan(ast)
    if (exportWrites !== 1 || invalidExports || declarations.has('module') || declarations.has('exports')) { cjsExports.clear(); cjsExportRefs.clear() }
    units.set(file, { ast, declarations, imports, calls, opaqueModules, importBindings, pendingImports, cjsExports, cjsExportRefs, cjsBoundary: exportWrites > 0 || invalidExports || file.endsWith('.cjs') })
  }
  const lexicalBindings = new WeakMap()
  function binding(unit, name, at) {
    if (!at) return null
    let byNode = lexicalBindings.get(unit)
    if (!byNode) { byNode = new WeakMap(); lexicalBindings.set(unit, byNode) }
    let names = byNode.get(at)
    if (!names) { names = new Map(); byNode.set(at, names) }
    if (names.has(name)) return names.get(name)
    const declarations = unit.declarations.get(name) ?? []
    // Bind nearest enclosing lexical scope, not another function's same-name local.
    for (let scope = at; scope; scope = scope.parent) {
      const found = declarations.find(decl => {
        let owner = decl.parent
        while (owner && !ts.isBlock(owner) && !ts.isSourceFile(owner) && !ts.isFunctionLike(owner)) owner = owner.parent
        return owner === scope
      })
      if (found) { names.set(name, found); return found }
    }
    names.set(name, null)
    return null
  }
  for (const unit of units.values()) for (const item of unit.pendingImports) {
    if (binding(unit, 'require', item.call)) unit.opaqueModules.add(item.target)
    else { unit.imports.set(item.name, [item.target, item.imported]); unit.importBindings.set(item.name, item.binding) }
  }
  function importOrigin(unit, identifier, at, seen = new Set()) {
    if (ts.isCallExpression(identifier) && ts.isIdentifier(identifier.expression) && identifier.expression.text === 'require' && !binding(unit, 'require', identifier) && identifier.arguments.length === 1 && ts.isStringLiteralLike(identifier.arguments[0])) return { module: identifier.arguments[0].text, imported: '*' }
    if (!ts.isIdentifier(identifier) || seen.has(identifier.text)) return null
    seen = new Set(seen).add(identifier.text)
    const declaration = binding(unit, identifier.text, at)
    const required = node => node && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require' && !binding(unit, 'require', node) && ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : null
    if (declaration) {
      if (effects(unit, declaration).written) return null
      if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
        const module = required(declaration.parent.parent.initializer)
        return module ? { module, imported: declaration.propertyName?.text ?? declaration.name.text } : null
      }
      const module = required(declaration.initializer)
      if (module) return { module, imported: '*' }
      if (declaration.initializer && ts.isIdentifier(declaration.initializer)) return importOrigin(unit, declaration.initializer, declaration.initializer, seen)
      return null
    }
    for (const statement of unit.ast.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        const found = bindings.elements.find(item => item.name.text === identifier.text)
        if (found) return { module: statement.moduleSpecifier.text, imported: found.propertyName?.text ?? found.name.text }
      }
      if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === identifier.text || statement.importClause?.name?.text === identifier.text) return { module: statement.moduleSpecifier.text, imported: '*' }
    }
    return null
  }
  function provenReader(unit, node) {
    const callee = node.expression
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
    if ((name === 'fetch' || name === 'URL') && ts.isIdentifier(callee) && !binding(unit, name, node) && !importOrigin(unit, callee, node)) return { global: name }
    const named = ts.isIdentifier(callee)
    const readerOrigin = importOrigin(unit, named ? callee : ts.isPropertyAccessExpression(callee) ? callee.expression : callee, node)
    const readerName = named ? readerOrigin?.imported : name
    if (ts.isCallExpression(node) && ['readFile', 'readFileSync'].includes(readerName)) {
      return readerOrigin && ['fs', 'node:fs', 'fs/promises', 'node:fs/promises'].includes(readerOrigin.module) && (named || readerOrigin.imported === '*') ? { module: readerOrigin.module, export: readerName } : false
    }
    if (name === 'loadAsync' && ts.isPropertyAccessExpression(callee)) {
      let receiver = callee.expression
      const setters = ['setCrossOrigin', 'setDRACOLoader', 'setKTX2Loader', 'setMeshoptDecoder']
      while (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression) && setters.includes(receiver.expression.name.text)) receiver = receiver.expression.expression
      if (ts.isIdentifier(receiver)) {
        const declaration = binding(unit, receiver.text, receiver)
        if (effects(unit, declaration).written || (referenceIndex(unit).get(declaration) ?? []).some(reference => ts.isPropertyAccessExpression(reference.parent) && reference.parent.expression === reference && ['setPath', 'setResourcePath'].includes(reference.parent.name.text))) return false
        receiver = declaration?.initializer ?? receiver
      }
      if (!ts.isNewExpression(receiver)) return false
      const constructor = receiver.expression
      const origin = importOrigin(unit, ts.isIdentifier(constructor) ? constructor : ts.isPropertyAccessExpression(constructor) ? constructor.expression : constructor, receiver)
      const exported = ts.isIdentifier(constructor) ? origin?.imported : constructor.name.text
      return !!origin && (origin.module === 'three' || /^three\/examples\/jsm\/loaders\//.test(origin.module)) && /Loader$/.test(exported) ? { module: origin.module, export: exported } : false
    }
    return false
  }
  function referenceIndex(unit) {
    if (unit.references) return unit.references
    const references = new Map()
    unit.importReferences = new Map()
    function inspect(node) {
      if (ts.isIdentifier(node)) {
        const declaration = binding(unit, node.text, node)
        if ((!declaration || declaration === unit.importBindings.get(node.text)) && unit.imports.has(node.text) && !ts.isImportSpecifier(node.parent) && node !== declaration?.name) {
          const list = unit.importReferences.get(node.text) ?? []
          list.push(node); unit.importReferences.set(node.text, list)
        }
        if (declaration && node !== declaration.name) {
          const list = references.get(declaration) ?? []
          list.push(node); references.set(declaration, list)
        }
      }
      ts.forEachChild(node, inspect)
    }
    inspect(unit.ast)
    unit.references = references
    return references
  }
  const bindingEffects = new Map()
  function effects(unit, declaration) {
    if (!declaration) return { written: false, escaped: false, escapedMembers: new Set() }
    if (bindingEffects.has(declaration)) return bindingEffects.get(declaration)
    const result = { written: false, escaped: false, escapedMembers: new Set() }
    const harmlessObjectCall = call => ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression) && call.expression.expression.text === 'Object' && !binding(unit, 'Object', call) && !importOrigin(unit, call.expression.expression, call) && ['keys', 'values', 'entries'].includes(call.expression.name.text)
    function inspect(node) {
      if (ts.isIdentifier(node) && node !== declaration.name && binding(unit, node.text, node) === declaration) {
        let value = node
        while (value.parent && (ts.isPropertyAccessExpression(value.parent) && value.parent.expression === value || ts.isElementAccessExpression(value.parent) && value.parent.expression === value || ts.isParenthesizedExpression(value.parent) || ts.isAsExpression(value.parent) || ts.isNonNullExpression(value.parent))) value = value.parent
        const parent = value.parent
        function escape() {
          const access = node.parent
          const firstMember = ts.isPropertyAccessExpression(access) && access.expression === node ? access.name.text : ts.isElementAccessExpression(access) && access.expression === node && ts.isStringLiteralLike(access.argumentExpression) ? access.argumentExpression.text : null
          const receiverMethod = ts.isCallExpression(parent) && parent.expression === value && value === access
          if (firstMember && !receiverMethod) result.escapedMembers.add(firstMember)
          else result.escaped = true
        }
        let initial = declaration.initializer
        while (initial && (ts.isAsExpression(initial) || ts.isParenthesizedExpression(initial))) initial = initial.expression
        const property = ts.isPropertyAccessExpression(value) && initial && ts.isObjectLiteralExpression(initial) ? initial.properties.find(item => ts.isPropertyAssignment(item) && item.name.text === value.name.text) : null
        const scalarMember = property && (ts.isStringLiteralLike(property.initializer) || ts.isNumericLiteral(property.initializer) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(property.initializer.kind))
        if (ts.isBinaryExpression(parent) && parent.left === value && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          || (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator)
          || ts.isDeleteExpression(parent)) result.written = true
        if (ts.isCallExpression(parent)) {
          if (parent.expression === value && value !== node) {
            // Mutating and unknown instance methods cannot establish a stable
            // registry. Only enumeration over scalar entries is non-mutating.
            const method = ts.isPropertyAccessExpression(value) ? value.name.text : ''
            let initializer = declaration.initializer
            while (initializer && (ts.isAwaitExpression(initializer) || ts.isParenthesizedExpression(initializer))) initializer = initializer.expression
            const responseJson = method === 'json' && initializer && ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) && initializer.expression.text === 'fetch'
            if (!responseJson && !['map', 'forEach', 'includes', 'indexOf', 'slice', 'join'].includes(method)) escape()
            if (['map', 'forEach'].includes(method)) {
              const callback = parent.arguments[0]
              if (!callback || !ts.isFunctionLike(callback) || callback.parameters[2] && (referenceIndex(unit).get(callback.parameters[2]) ?? []).length) escape()
            }
          } else if (parent.arguments.includes(value) && !scalarMember && !harmlessObjectCall(parent)) escape()
        }
        if (ts.isNewExpression(parent) && parent.arguments?.includes(value) && !scalarMember) escape()
        if (!scalarMember && (ts.isVariableDeclaration(parent) && parent.initializer === value || ts.isPropertyAssignment(parent) && parent.initializer === value || ts.isReturnStatement(parent) || ts.isBinaryExpression(parent) && parent.right === value && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken)) escape()
      }
      ts.forEachChild(node, inspect)
    }
    for (const reference of referenceIndex(unit).get(declaration) ?? []) inspect(reference)
    bindingEffects.set(declaration, result)
    return result
  }
  function pathCall(unit, callee, at) {
    const named = ts.isIdentifier(callee)
    const origin = importOrigin(unit, named ? callee : ts.isPropertyAccessExpression(callee) ? callee.expression : callee, at)
    return !!origin && ['path', 'node:path'].includes(origin.module) && (named ? ['join', 'resolve'].includes(origin.imported) : origin.imported === '*')
  }
  function directoryEntryPattern(declaration, file, env, seen) {
    const unit = units.get(file), loop = declaration?.parent?.parent
    if (!loop || !ts.isForOfStatement(loop) || loop.initializer !== declaration.parent) return UNKNOWN
    let iterable = loop.expression
    if (ts.isCallExpression(iterable) && ts.isPropertyAccessExpression(iterable.expression) && iterable.expression.name.text === 'sort' && iterable.arguments.length === 0) iterable = iterable.expression.expression
    if (!ts.isCallExpression(iterable) || !ts.isPropertyAccessExpression(iterable.expression) || iterable.expression.name.text !== 'filter' || iterable.arguments.length !== 1) return UNKNOWN
    const predicate = iterable.arguments[0], listing = iterable.expression.expression
    if (!ts.isArrowFunction(predicate) || predicate.parameters.length !== 1 || !ts.isIdentifier(predicate.parameters[0].name) || !ts.isCallExpression(predicate.body)) return UNKNOWN
    if (!ts.isCallExpression(listing) || listing.arguments.length !== 1) return UNKNOWN
    const callee = listing.expression, origin = importOrigin(unit, ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.expression : callee, listing)
    const method = ts.isIdentifier(callee) ? origin?.imported : ts.isPropertyAccessExpression(callee) ? callee.name.text : null
    if (!origin || !['fs', 'node:fs'].includes(origin.module) || method !== 'readdirSync' || !ts.isIdentifier(callee) && origin.imported !== '*') return UNKNOWN
    const directory = evaluate(listing.arguments[0], file, env, seen)
    if (typeof directory !== 'string' || unknownPath(directory) || !files.some(path => posix.dirname(path) === posix.normalize(directory))) return UNKNOWN
    const body = predicate.body, name = predicate.parameters[0].name.text
    let suffix = null, predicateContract = null, accepts = null
    if (ts.isPropertyAccessExpression(body.expression) && body.expression.name.text === 'endsWith' && ts.isIdentifier(body.expression.expression) && body.expression.expression.text === name && body.arguments.length === 1 && ts.isStringLiteralLike(body.arguments[0])) {
      suffix = body.arguments[0].text
      predicateContract = { kind: 'endsWith', value: suffix }
      accepts = name => name.endsWith(suffix)
    }
    if (ts.isPropertyAccessExpression(body.expression) && body.expression.name.text === 'test' && body.expression.expression.kind === ts.SyntaxKind.RegularExpressionLiteral && body.arguments.length === 1 && ts.isIdentifier(body.arguments[0]) && body.arguments[0].text === name) {
      const literal = body.expression.expression.getText(unit.ast), slash = literal.lastIndexOf('/')
      if (slash !== literal.length - 1) return UNKNOWN // flags change the predicate contract
      const source = literal.slice(1, slash)
      // A required terminal literal is a sound (possibly wider) constraint.
      // Alternatives/groups/escaped terminal classes remain unresolved.
      if (source.includes('|') || source.includes('(')) return UNKNOWN
      const terminal = /([A-Za-z0-9_-]+)\$$/.exec(source)
      if (!terminal || source[terminal.index - 1] === '\\') return UNKNOWN
      let regex
      try { regex = new RegExp(source) } catch { return UNKNOWN }
      predicateContract = { kind: 'regex', source, flags: '' }
      accepts = name => regex.test(name)
      suffix = terminal[1]
    }
    if (!suffix || /[\\/]/.test(suffix)) return UNKNOWN
    const pattern = '[^/]*' + escapePattern(suffix)
    const normalizedDirectory = posix.normalize(directory)
    const prefix = normalizedDirectory === '.' ? '' : normalizedDirectory + '/'
    const names = [...new Set(files.filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length).split('/')[0]))].filter(accepts).sort()
    const contract = { pattern, names, directory: normalizedDirectory, predicate: predicateContract, bindingFile: file, bindingStart: declaration.getStart(unit.ast), bindingEnd: declaration.end, listingFile: file, listingStart: listing.getStart(unit.ast), listingEnd: listing.end, listingExpression: listing.getText(unit.ast), listingProvider: { module: origin.module, export: 'readdirSync' }, snapshotBoundary: 'Names are observed Git-snapshot inventory only, not runtime membership proof; the read domain remains open' }
    let token = [...pathnamePatterns].find(([, existing]) => JSON.stringify(existing) === JSON.stringify(contract))?.[0]
    if (!token) { token = '\x01' + pathnamePatterns.size + '\x02'; pathnamePatterns.set(token, contract) }
    return token
  }
  function evaluate(node, file, env = new Map(), seen = new Set()) {
    if (!node || seen.has(node)) return UNKNOWN
    const next = new Set(seen).add(node), unit = units.get(file)
    const ev = value => evaluate(value, file, env, next)
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(item => ts.isSpreadElement(item) ? ev(item.expression) : [ev(item)])
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Set' && !binding(unit, 'Set', node) && !importOrigin(unit, node.expression, node)) { const values = ev(node.arguments?.[0]); return Array.isArray(values) ? [...new Set(values)] : UNKNOWN }
    if (ts.isObjectLiteralExpression(node)) return node.properties.every(prop => ts.isPropertyAssignment(prop) && !ts.isComputedPropertyName(prop.name)) ? Object.fromEntries(node.properties.map(prop => [prop.name.text, ev(prop.initializer)])) : UNKNOWN
    if (ts.isConditionalExpression(node)) return union([ev(node.whenTrue), ev(node.whenFalse)])
    if (ts.isElementAccessExpression(node)) {
      const object = ev(node.expression), key = ev(node.argumentExpression)
      if (object && typeof object === 'object' && !object.alternatives && !Array.isArray(object)) return key === UNKNOWN ? union(Object.values(object)) : union(choices(key).map(item => object[item] ?? UNKNOWN))
    }
    if (ts.isNewExpression(node) && node.expression.getText(unit.ast) === 'URL' && node.arguments?.length === 2 && node.arguments[1].getText(unit.ast) === 'import.meta.url' && provenReader(unit, node)) {
      return { [URL_VALUE]: true, href: union(choices(ev(node.arguments[0])).map(value => posix.normalize(posix.join(posix.dirname(file), stringValue(value))))) }
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isAwaitExpression(node) || ts.isNonNullExpression(node)) return ev(node.expression)
    if (ts.isIdentifier(node)) {
      if (node.text === '__dirname') return posix.dirname(file)
      const decl = binding(unit, node.text, node), effect = effects(unit, decl)
      if (effect.written) return UNKNOWN
      const value = env.has(node.text) ? env.get(node.text) : decl?.initializer ? ev(decl.initializer) : directoryEntryPattern(decl, file, env, next)
      return choices(value).some(item => item && typeof item === 'object' && (effect.escaped || [...effect.escapedMembers].some(member => item[member] === UNKNOWN || !['string', 'number', 'boolean'].includes(typeof item[member])))) ? UNKNOWN : value
    }
    if (ts.isTemplateExpression(node)) return node.templateSpans.reduce((prefix, span) => combine(prefix, ev(span.expression), (a, b) => stringValue(a) + stringValue(b) + span.literal.text), node.head.text)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return combine(ev(node.left), ev(node.right), (a, b) => ['string', 'number'].includes(typeof a) && ['string', 'number'].includes(typeof b) ? a + b : UNKNOWN)
    if (ts.isPropertyAccessExpression(node)) {
      if (node.getText(unit.ast) === 'import.meta.env.BASE_URL') return '/'
      const evaluatedOwner = ev(node.expression)
      if (evaluatedOwner && typeof evaluatedOwner === 'object') return evaluatedOwner[node.name.text] ?? UNKNOWN

    }
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''
      if (['values', 'entries', 'keys'].includes(name) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(unit.ast) === 'Object' && !binding(unit, 'Object', node) && !importOrigin(unit, node.expression.expression, node)) {
        const object = ev(node.arguments[0]); return object && typeof object === 'object' ? Object[name](object) : UNKNOWN
      }
      if (name === 'fetch' && provenReader(unit, node)) {
        const url = ev(node.arguments[0])
        return { inputFile: typeof url === 'string' && url.startsWith('/') ? 'public/' + url.slice(1) : url }
      }
      if (name === 'json' && ts.isPropertyAccessExpression(node.expression)) {
        const response = ev(node.expression.expression)
        if (response?.inputFile && texts.has(response.inputFile)) {
          try { return JSON.parse(texts.get(response.inputFile)) } catch {}
        }
      }
      if (['join', 'resolve'].includes(name) && pathCall(unit, node.expression, node)) return union(choices(node.arguments.reduce((prefix, arg) => combine(prefix, ev(arg), (a, b) => typeof b !== 'string' ? UNKNOWN : name === 'resolve' && posix.isAbsolute(b) ? b : stringValue(a) + '/' + b), '.')).map(value => posix.normalize(stringValue(value)).replace(/^\.\//, '')))
      if (name === 'cwd' && node.expression.getText(unit.ast) === 'process.cwd') return '.'
      if (name === 'replace' && ts.isPropertyAccessExpression(node.expression) && node.arguments.length === 2 && node.arguments[0].getText(unit.ast) === '/^\\/+/' && ev(node.arguments[1]) === '') return union(choices(ev(node.expression.expression)).map(value => stringValue(value).replace(/^\/+/, '')))
      if (ts.isIdentifier(node.expression)) {
        let targetFile = file, decl = binding(unit, name, node)
        if ((!decl || decl === unit.importBindings.get(name)) && unit.imports.has(name) && !effects(unit, decl).written) {
          const [target, imported] = unit.imports.get(name); targetFile = target
          const targetUnit = units.get(target)
          const exported = targetUnit?.cjsBoundary ? targetUnit.cjsExports.get(imported) : imported
          decl = exported && targetUnit?.declarations.get(exported)?.[0]
        }
        const fn = decl?.initializer ?? decl
        if (decl && effects(units.get(targetFile), decl).written) return UNKNOWN
        if (fn && ts.isFunctionLike(fn)) {
          const local = new Map(env)
          fn.parameters.forEach((p, i) => { if (ts.isIdentifier(p.name)) local.set(p.name.text, ev(node.arguments[i])) })
          if (ts.isBlock(fn.body)) {
            const returned = []
            function collect(statement) {
              if (ts.isReturnStatement(statement)) returned.push(evaluate(statement.expression, targetFile, local, next))
              else if (!ts.isFunctionLike(statement)) ts.forEachChild(statement, collect)
            }
            fn.body.statements.forEach(collect)
            if (!ts.isReturnStatement(fn.body.statements.at(-1))) returned.push(UNKNOWN)
            return union(returned.length ? returned : [UNKNOWN])
          }
          return evaluate(fn.body, targetFile, local, next)
        }
      }
    }
    return UNKNOWN
  }
  function record(file, node, operand, kind, env, origin, execution = null) {
    const unit = units.get(file), evaluated = execution?.unresolved ? UNKNOWN : evaluate(operand, file, env)
    for (const alternative of choices(evaluated).flatMap(value => kind === 'read' && value?.[URL_VALUE] ? choices(value.href) : [value])) {
    const raw = typeof alternative === 'string' ? alternative : UNKNOWN
    if (/^(?:https?:|data:|blob:)/.test(raw)) continue
    if (kind === 'import' && !raw.startsWith('.') && !unknownPath(raw)) continue
    let value = raw.replace(/[?#].*$/, '')
    if (kind === 'import' && !unknownPath(value)) value = modulePath(file, value) ?? posix.join(posix.dirname(file), value)
    else if (kind === 'url') value = posix.join(posix.dirname(file), value)
    else if (!['read', 'execute'].includes(kind) && value.startsWith('/')) value = 'public/' + value.replace(/^\/+/, '')
    value = posix.normalize(value).replace(/^\.\//, '')
    const evidenceNode = origin ?? node
    const evidenceAst = evidenceNode.getSourceFile()
    const position = evidenceAst.getLineAndCharacterOfPosition(evidenceNode.getStart(evidenceAst))
    const proof = { from: evidenceAst.fileName, readerFile: file, readerStart: node.getStart(unit.ast), readerEnd: node.end, kind, line: position.line + 1, column: position.character + 1, start: evidenceNode.getStart(evidenceAst), end: evidenceNode.end, expression: evidenceNode.getText(evidenceAst), inputExpression: node.getText(unit.ast), contract: 'runtime-input' }
    if (execution?.executionKind) proof.executionKind = execution.executionKind
    if (execution?.pathOrigin) proof.pathOrigin = execution.pathOrigin
    const provider = kind === 'execute' ? execution?.provider : ['read', 'fetch', 'load', 'url'].includes(kind) ? provenReader(unit, node) : null
    if (provider) proof.provider = provider
    const verified = !['read', 'fetch', 'load', 'url', 'execute'].includes(kind) || !!provider
    if (!verified) {
      const pattern = '^.*$'
      risks.push({ ...proof, pattern, candidates: [], reason: 'Input-like call lacks verified API receiver provenance', missingEvidence: node.expression.getText(unit.ast) })
    } else if (!value.includes(UNKNOWN) && /\x01\d+\x02/.test(value)) {
      const tokens = [...new Set(value.match(/\x01\d+\x02/g))]
      let resolved = [value]
      for (const token of tokens) resolved = resolved.flatMap(path => pathnamePatterns.get(token).names.map(name => path.split(token).join(name)))
      const directoryInputs = tokens.map(token => pathnamePatterns.get(token))
      const pattern = pathPattern(value)
      const observedTargets = [...new Set(resolved.map(path => posix.normalize(path)))].sort()
      // A real directory listing yields basenames in this bounded domain, but
      // runtime writes/removes can change membership. Snapshot names therefore
      // never prove absence or execution: retain every matching tracked target.
      const domain = new RegExp(pattern)
      const candidates = files.filter(path => domain.test(path)).sort()
      const possible = { conservative: true, possible: true, resolution: 'possible-directory-input' }
      const membershipPatterns = directoryInputs.map(input => ({
        pattern: '^' + escapePattern(input.directory === '.' ? '' : input.directory + '/') + input.pattern + '$',
        candidates: input.names.map(name => posix.join(input.directory, name)), directory: input.directory, predicate: input.predicate, changeKinds: ['A', 'D', 'R'],
      }))
      patterns.push({ ...proof, ...possible, contract: 'bounded-directory-input-set', pattern, candidates, observedTargets, directoryInputs, membershipPatterns })
      for (const [index, membership] of membershipPatterns.entries()) for (const entry of membership.candidates) {
        const listing = directoryInputs[index], provider = listing.listingProvider
        const position = units.get(listing.listingFile).ast.getLineAndCharacterOfPosition(listing.listingStart)
        const membershipProof = { ...proof, from: listing.listingFile, readerFile: listing.listingFile, readerStart: listing.listingStart, readerEnd: listing.listingEnd, start: listing.listingStart, end: listing.listingEnd, line: position.line + 1, column: position.character + 1, expression: listing.listingExpression, inputExpression: listing.listingExpression, provider, context: { from: proof.from, start: proof.start, expression: proof.expression } }
        if (exists(entry)) edges.push({ ...membershipProof, ...possible, to: entry, kind: 'directory-membership', changeKinds: membership.changeKinds, inputSet: { pattern, directoryInputs } })
        else risks.push({ ...membershipProof, pattern: '^' + escapePattern(entry) + '(?:/.*)?$', candidates: files.filter(file => file.startsWith(entry + '/')), reason: 'Directory membership spans multiple tracked descendants', missingEvidence: entry })
      }
      for (const target of candidates) edges.push({ ...proof, ...possible, to: target, inputSet: { pattern, directoryInputs, observedTargets } })
    } else if (unknownPath(value)) {
      const pattern = pathPattern(value)
      risks.push({ ...proof, pattern, candidates: value.replaceAll(UNKNOWN, '').replaceAll('/', '').length ? files.filter(candidate => new RegExp(pattern).test(candidate)) : [], reason: execution?.reason ?? 'Input expression has an unresolved runtime value', missingEvidence: execution?.missingEvidence ?? operand.getText(unit.ast) })
    } else if (exists(value)) edges.push({ ...proof, to: value })
    else risks.push({ ...proof, pattern: '^' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', candidates: [], reason: 'Resolved input is absent from this snapshot', missingEvidence: value })
    }
  }
  const inputBodies = new Map(), closedBodies = new Map()
  function containsInput(fn) {
    if (inputBodies.has(fn)) return inputBodies.get(fn)
    let found = false
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''
        if (['fetch', 'readFile', 'readFileSync', 'loadAsync'].includes(name) || ['readFile', 'readFileSync'].includes(provenReader(units.get(fn.getSourceFile().fileName), node)?.export)) found = true
      }
      if (!found) ts.forEachChild(node, visit)
    }
    visit(fn); inputBodies.set(fn, found); return found
  }
  function onlyDirectLocalCalls(unit, fn) {
    if (closedBodies.has(fn)) return closedBodies.get(fn)
    const declaration = ts.isFunctionDeclaration(fn) ? fn : ts.isVariableDeclaration(fn.parent) ? fn.parent : null
    if (!declaration?.name || !ts.isIdentifier(declaration.name)) return false
    let exported = [...unit.cjsExports.values()].includes(declaration.name.text)
    for (let owner = declaration; owner && !ts.isSourceFile(owner); owner = owner.parent) if (owner.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)) exported = true
    let calls = 0, escape = false
    function references(node) {
      if (ts.isIdentifier(node) && node !== declaration.name && node.text === declaration.name.text && binding(unit, node.text, node) === declaration) {
        if (ts.isCallExpression(node.parent) && node.parent.expression === node) calls++
        else if (!unit.cjsExportRefs.has(node)) escape = true
      }
      ts.forEachChild(node, references)
    }
    for (const reference of referenceIndex(unit).get(declaration) ?? []) references(reference)
    if (exported) {
      for (const [otherFile, other] of units) {
        if (other.opaqueModules.has(unit.ast.fileName)) escape = true
        for (const statement of other.ast.statements) {
          if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier) || modulePath(otherFile, statement.moduleSpecifier.text) !== unit.ast.fileName) continue
          if (ts.isExportDeclaration(statement)) escape = true
          else {
            const namespace = statement.importClause?.name ?? (statement.importClause?.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings) ? statement.importClause.namedBindings.name : null)
            if (namespace) {
              function namespaceReferences(node) {
                if (ts.isIdentifier(node) && node !== namespace && node.text === namespace.text && !binding(other, node.text, node)) {
                  const access = node.parent
                  const key = ts.isPropertyAccessExpression(access) && access.expression === node ? access.name.text : ts.isElementAccessExpression(access) && access.expression === node && ts.isStringLiteralLike(access.argumentExpression) ? access.argumentExpression.text : null
                  // A namespace's explicit other member does not expose this
                  // callable. Unknown keys, object escapes and this callable
                  // retain uncertainty until namespace-call context is supported.
                  if (key === null || (unit.cjsExports.get(key) ?? key) === declaration.name.text) escape = true
                }
                ts.forEachChild(node, namespaceReferences)
              }
              namespaceReferences(other.ast)
            }
          }
        }
        for (const [alias, [target, imported]] of other.imports) if (target === unit.ast.fileName && (unit.cjsExports.get(imported) ?? imported) === declaration.name.text) {
          referenceIndex(other)
          for (const reference of other.importReferences.get(alias) ?? []) {
            if (ts.isCallExpression(reference.parent) && reference.parent.expression === reference) calls++
            else escape = true
          }
        }
      }
    }
    const closed = calls > 0 && !escape
    closedBodies.set(fn, closed)
    return closed
  }
  const processApis = ['spawn', 'spawnSync', 'execFile', 'execFileSync']
  const callName = node => ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''
  function readKind(unit, node) {
    if (!node.arguments.length) return null
    const name = callName(node), aliased = ['readFile', 'readFileSync'].includes(provenReader(unit, node)?.export)
    return aliased || name.startsWith('readFile') && ['readFile', 'readFileSync'].includes(name) ? 'read'
      : name === 'fetch' ? 'fetch' : name === 'loadAsync' ? 'load' : null
  }
  function inspectedTarget(file, node) {
    if (!ts.isIdentifier(node.expression)) return null
    const unit = units.get(file), name = node.expression.text
    let targetFile = file, decl = binding(unit, name, node)
    if ((!decl || decl === unit.importBindings.get(name)) && unit.imports.has(name) && !effects(unit, decl).written) {
      const [target, imported] = unit.imports.get(name); targetFile = target
      const targetUnit = units.get(target), exported = targetUnit?.cjsBoundary ? targetUnit.cjsExports.get(imported) : imported
      decl = exported && targetUnit?.declarations.get(exported)?.[0]
    }
    const fn = decl?.initializer ?? decl
    return fn && ts.isFunctionLike(fn) && fn.body && !effects(units.get(targetFile), decl).written && (targetFile === file || containsInput(fn)) ? { fn, file: targetFile } : null
  }
  // This summarizes emissions of this inspector, not runtime freedom from I/O.
  // Only its recursive callable-body expansion is pruned. Original syntax and
  // argument walks remain unchanged; pure recursive SCCs need a fixed point.
  const emissionSummaries = new Map()
  function mayEmitInput(target) {
    if (emissionSummaries.has(target.fn)) return emissionSummaries.get(target.fn).mayEmit
    const added = []
    function register(item) {
      if (!emissionSummaries.has(item.fn)) {
        const summary = { ...item, seed: false, mayEmit: false, dependencies: new Set(), parents: new Set() }
        emissionSummaries.set(item.fn, summary); added.push(summary)
      }
      return emissionSummaries.get(item.fn)
    }
    const root = register(target)
    for (let index = 0; index < added.length; index++) {
      const summary = added[index], unit = units.get(summary.file)
      function scan(node) {
        if (ts.isCallExpression(node)) {
          const name = callName(node), imported = ts.isIdentifier(node.expression) ? importOrigin(unit, node.expression, node) : null
          if (readKind(unit, node) || (name === 'require' || node.expression.kind === ts.SyntaxKind.ImportKeyword) && node.arguments.length === 1 && !ts.isStringLiteralLike(node.arguments[0])
            || processApis.includes(name) || imported && ['child_process', 'node:child_process'].includes(imported.module) && processApis.includes(imported.imported)) summary.seed = true
          const next = inspectedTarget(summary.file, node)
          if (next) { const dependency = register(next); summary.dependencies.add(dependency); dependency.parents.add(summary) }
        }
        if (ts.isNewExpression(node) && node.expression.getText(unit.ast) === 'URL' && node.arguments?.length === 2 && node.arguments[1].getText(unit.ast) === 'import.meta.url') summary.seed = true
        // Include nested declarations/defaults/arguments: no runtime branch or
        // callback-execution assumptions are introduced by this optimization.
        ts.forEachChild(node, scan)
      }
      scan(summary.fn)
    }
    const pending = added.filter(summary => summary.seed || [...summary.dependencies].some(dependency => dependency.mayEmit))
    for (const summary of pending) summary.mayEmit = true
    for (let index = 0; index < pending.length; index++) for (const parent of pending[index].parents) if (!parent.mayEmit) {
      parent.mayEmit = true; pending.push(parent)
    }
    return root.mayEmit
  }
  function inspect(node, file, env = new Map(), active = new Set(), origin) {
      const unit = units.get(file)
      // A closed local wrapper is analyzed at every invocation with its actual
      // arguments; its unbound declaration is not a runtime invocation. Escaped
      // or exported wrappers retain the unknown boundary.
      if (ts.isFunctionLike(node) && node.parameters?.length && node.parameters.every(parameter => ts.isIdentifier(parameter.name) && !env.has(parameter.name.text)) && containsInput(node) && onlyDirectLocalCalls(unit, node)) return
      const handled = new Set()
      if (ts.isCallExpression(node)) {
        const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''
        if ((name === 'require' || node.expression.kind === ts.SyntaxKind.ImportKeyword) && node.arguments.length === 1 && !ts.isStringLiteralLike(node.arguments[0])) record(file, node, node.arguments[0], 'import', env, origin)
        if (['map', 'forEach'].includes(name) && ts.isPropertyAccessExpression(node.expression)) {
          const values = evaluate(node.expression.expression, file, env), fn = node.arguments[0]
          if (Array.isArray(values) && fn && ts.isFunctionLike(fn) && fn.body) {
            handled.add(fn)
            for (const value of values) {
              const local = new Map(env), parameter = fn.parameters[0]?.name
              if (parameter && ts.isIdentifier(parameter)) local.set(parameter.text, value)
              if (parameter && ts.isArrayBindingPattern(parameter) && Array.isArray(value)) parameter.elements.forEach((item, i) => { if (item.name && ts.isIdentifier(item.name)) local.set(item.name.text, value[i]) })
              inspect(fn.body, file, local, active, origin)
            }
          }
        }
        const calleeOrigin = ts.isIdentifier(node.expression) ? importOrigin(unit, node.expression, node) : null
        if (processApis.includes(name) || calleeOrigin && ['child_process', 'node:child_process'].includes(calleeOrigin.module) && processApis.includes(calleeOrigin.imported)) {
          const apiOrigin = calleeOrigin ?? (ts.isPropertyAccessExpression(node.expression) ? importOrigin(unit, node.expression.expression, node) : null)
          const method = ts.isIdentifier(node.expression) ? apiOrigin?.imported : name
          const provider = apiOrigin && ['child_process', 'node:child_process'].includes(apiOrigin.module) && processApis.includes(method) && (ts.isIdentifier(node.expression) || apiOrigin.imported === '*') ? { module: apiOrigin.module, export: method } : null
          const command = node.arguments[0]
          const executable = evaluate(command, file, env)
          const nodeExecutable = executable === 'node' || command && ts.isPropertyAccessExpression(command) && command.name.text === 'execPath' && ts.isIdentifier(command.expression) && command.expression.text === 'process' && !binding(unit, 'process', command) && !importOrigin(unit, command.expression, command)
          const unresolvedExecutable = !nodeExecutable && (typeof executable !== 'string' || unknownPath(executable)) && (provider || command && ts.isPropertyAccessExpression(command) && command.name.text === 'execPath')
          if (nodeExecutable || unresolvedExecutable || ['bash', 'sh', 'python', 'python3'].includes(executable)) {
            const args = node.arguments[1], operand = args && ts.isArrayLiteralExpression(args) ? args.elements[0] : null
            const values = operand && !ts.isSpreadElement(operand) ? choices(evaluate(operand, file, env)) : [UNKNOWN]
            const options = node.arguments[2]
            // Node's __dirname is absolute even though snapshot paths are stored
            // repository-relative. A verified path call anchored there is
            // independent of a subprocess cwd; arbitrary strings are not.
            const anchor = operand && ts.isCallExpression(operand) && pathCall(unit, operand.expression, operand) ? operand.arguments[0] : null
            const pathOrigin = anchor && ts.isIdentifier(anchor) && anchor.text === '__dirname' && !binding(unit, '__dirname', anchor) && !importOrigin(unit, anchor, anchor) ? 'module-directory' : undefined
            const safeOptions = !options || ts.isObjectLiteralExpression(options) && options.properties.every(property => ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name) && (property.name.text !== 'shell' || property.initializer.kind === ts.SyntaxKind.FalseKeyword) && (property.name.text !== 'cwd' || pathOrigin === 'module-directory' || ts.isStringLiteralLike(property.initializer) && property.initializer.text === '.'))
            const unresolved = !!unresolvedExecutable || !safeOptions || values.some(value => typeof value !== 'string' || unknownPath(value) || value.startsWith('-'))
            record(file, node, operand ?? args ?? command, 'execute', env, origin, { provider, unresolved, pathOrigin, reason: unresolved ? 'Subprocess executable, script argument or launch options lack bounded entry evidence' : undefined, missingEvidence: unresolved ? node.getText(unit.ast) : undefined, executionKind: nodeExecutable ? 'node-entry' : unresolvedExecutable ? undefined : 'script-entry' })
          }
        }
        const kind = readKind(unit, node)
        if (kind) record(file, node, node.arguments[0], kind, env, origin)
        // Preserve caller environments/origins for every potentially emitting
        // body; arguments are still visited even when the body is emission-free.
        const target = inspectedTarget(file, node)
        if (target && !active.has(target.fn) && mayEmitInput(target)) {
          const local = new Map(env)
          target.fn.parameters.forEach((p, i) => { if (ts.isIdentifier(p.name)) local.set(p.name.text, evaluate(node.arguments[i], file, env)) })
          inspect(target.fn.body, target.file, local, new Set(active).add(target.fn), origin ?? node)
        }
      }
      if (ts.isNewExpression(node) && node.expression.getText(unit.ast) === 'URL' && node.arguments?.length === 2 && node.arguments[1].getText(unit.ast) === 'import.meta.url') record(file, node, node.arguments[0], 'url', env, origin)
      ts.forEachChild(node, child => { if (!handled.has(child)) inspect(child, file, env, active, origin) })
    }
  for (const [file, unit] of units) inspect(unit.ast, file)
  // HTML link rel=icon is an explicit browser presentation contract, unlike a
  // public/ or binary extension whitelist. Other HTML references stay runtime.
  for (const [file, text] of texts) if (/\.html?$/.test(file)) {
    const tags = /<(link|script|img|source)\b[^>]*>/gi
    for (const match of text.matchAll(tags)) {
      const attrs = Object.fromEntries([...match[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(item => [item[1].toLowerCase(), item[3]]))
      const url = attrs.href ?? attrs.src
      if (!url || /^(?:[a-z]+:|#|\/\/)/i.test(url)) continue
      const target = 'public/' + url.replace(/^\/+/, '').replace(/[?#].*$/, '')
      if (!exists(target)) continue
      const prefix = text.slice(0, match.index), line = prefix.split('\n').length
      edges.push({ from: file, to: target, kind: 'html', line, column: match.index - prefix.lastIndexOf('\n'), start: match.index, end: match.index + match[0].length, expression: match[0], contract: match[1].toLowerCase() === 'link' && /^(?:shortcut )?icon$/i.test(attrs.rel ?? '') ? 'browser-icon' : 'runtime-input' })
    }
  }
  const unique = values => [...new Map(values.map(value => [JSON.stringify(value), value])).values()]
  return { edges: unique(edges), risks: unique(risks), patterns: unique(patterns) }
}
function classifyChangedInput(file, consumers) {
  const edges = (consumers.inputEdges ?? []).filter(edge => edge.to === file)
  const risks = (consumers.inputRisks ?? []).filter(risk => risk.from === file || risk.candidates.includes(file) || risk.pattern && new RegExp(risk.pattern).test(file))
  const patterns = (consumers.inputPatterns ?? []).filter(input => new RegExp(input.pattern).test(file))
  const text = consumers.inputTexts?.get(file)
  const inertSvg = typeof text === 'string' && /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text) && !/<(?:script|foreignObject|image|use|animate[\w-]*|set|style)\b|\bon[\w-]+\s*=|(?:href|url)\s*[=(]|<!DOCTYPE|<!ENTITY/i.test(text)
  const codeReferences = [...(consumers.sources ?? [])].some(([, source]) => source.includes(file) || source.includes(posix.basename(file)))
  if (edges.length && edges.every(edge => edge.contract === 'browser-icon') && !risks.length && inertSvg && !codeReferences) return { kind: 'visual-asset', edges, risks, patterns, logicCoverage: false, reason: 'Inert SVG is consumed only by an HTML browser-icon contract', validationBoundary: 'Browser icon presentation; logic tests do not verify appearance. Existing build validation still applies.' }
  return { kind: risks.length ? 'unresolved-input' : edges.length ? 'runtime-input' : 'unclassified', edges, risks, patterns }
}
module.exports = { inputDependencies, classifyChangedInput }
