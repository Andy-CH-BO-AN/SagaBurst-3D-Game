const ts = require('typescript')

// Compare runtime declarations rather than textual hunk envelopes. A comment,
// erased type, or adjacent declaration must not turn an entire file into an owner.
function runtimeFingerprint(source, fileName = 'owner.ts') {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  let needsEmit = false
  function inspect(node) {
    if (node.type || node.typeParameters?.length || ts.isTypeNode(node) || ts.isEnumDeclaration(node)
      || ts.isModuleDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)
      || ts.isDecorator(node) || node.isTypeOnly || node.token === ts.SyntaxKind.ImplementsKeyword
      || [ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword,
        ts.SyntaxKind.ReadonlyKeyword, ts.SyntaxKind.AbstractKeyword, ts.SyntaxKind.DeclareKeyword,
        ts.SyntaxKind.OverrideKeyword].includes(node.kind)) needsEmit = true
    ts.forEachChild(node, inspect)
  }
  inspect(parsed)
  const runtime = needsEmit ? ts.transpileModule(source, { fileName, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
  } }).outputText : ts.createPrinter({ removeComments: true }).printFile(parsed)
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, runtime)
  const tokens = []
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) tokens.push([kind, scanner.getTokenText()])
  return JSON.stringify(tokens)
}

// This is deliberately a syntactic proof, not a purity guess based on a name.
// Calls/new, spreads, accessors and computed keys may have import-time effects.
function inertValue(node) {
  if (!node) return true
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return inertValue(node.expression)
  if (ts.isLiteralExpression(node) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true
  if (ts.isPrefixUnaryExpression(node)) {
    if (node.operator === ts.SyntaxKind.ExclamationToken) return inertValue(node.operand)
    // Numeric coercion of an object/function can invoke user valueOf/toString.
    const numeric = value => ts.isNumericLiteral(value) || ts.isPrefixUnaryExpression(value)
      && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.TildeToken].includes(value.operator) && numeric(value.operand)
    return [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.TildeToken].includes(node.operator) && numeric(node.operand)
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(inertValue)
  if (ts.isObjectLiteralExpression(node)) return node.properties.every(property =>
    ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name) && inertValue(property.initializer)
    || ts.isMethodDeclaration(property) && !ts.isComputedPropertyName(property.name))
  return false
}

function runtimeImports(sf) {
  // Erased type positions do not keep an import alive. Name matching is allowed
  // to over-retain shadowed bindings; it must never erase a runtime reference.
  const used = new Set()
  function inspect(node) {
    if (ts.isExpressionWithTypeArguments(node) && ts.isHeritageClause(node.parent)
      && node.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent.parent)) { inspect(node.expression); return }
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
      || ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) return
    if (ts.isExportDeclaration(node) && node.isTypeOnly || ts.isExportSpecifier(node) && node.isTypeOnly) return
    if (ts.isIdentifier(node)) used.add(node.text)
    ts.forEachChild(node, inspect)
  }
  inspect(sf)
  const bindings = new Set(), modules = []
  for (const statement of sf.statements) if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause
    if (clause?.isTypeOnly) continue
    const names = []
    if (clause?.name && used.has(clause.name.text)) names.push(clause.name.text)
    if (clause?.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        if (used.has(clause.namedBindings.name.text)) names.push(clause.namedBindings.name.text)
      } else for (const binding of clause.namedBindings.elements) {
        if (!binding.isTypeOnly && used.has(binding.name.text)) names.push(binding.name.text)
      }
    }
    names.forEach(name => bindings.add(name))
    if (!clause || names.length) modules.push(statement.moduleSpecifier.getText(sf) + (statement.attributes?.getText(sf) ?? statement.assertClause?.getText(sf) ?? ''))
  }
  return { bindings, modules }
}

function declarationSnapshot(sf, byAst) {
  const entries = new Map(), initializationOrder = [], imports = runtimeImports(sf)
  const fingerprint = source => runtimeFingerprint(source, sf.fileName)
  const emptyClass = fingerprint('class __BehaviorOwner {}')
  const duplicates = new Map()
  function add(key, node, source, effect = false, initializes = false) {
    const ordinal = duplicates.get(key) ?? 0
    duplicates.set(key, ordinal + 1)
    key += `:${ordinal}`
    entries.set(key, { id: byAst.get(node), fingerprint: fingerprint(source), effect })
    if (initializes) initializationOrder.push(key)
  }
  const decorators = node => ts.canHaveDecorators(node) && !!ts.getDecorators(node)?.length
  for (const statement of sf.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEmptyStatement(statement)
      || statement.modifiers?.some(mod => mod.kind === ts.SyntaxKind.DeclareKeyword)
      || ts.isFunctionDeclaration(statement) && !statement.body
      || ts.isExportDeclaration(statement) && statement.isTypeOnly) continue
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause, module = statement.moduleSpecifier.getText(sf)
      if (clause?.name && imports.bindings.has(clause.name.text)) add(`import:${clause.name.text}`, clause, `import ${clause.name.text} from ${module}; void ${clause.name.text}`)
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          const binding = clause.namedBindings
          if (imports.bindings.has(binding.name.text)) add(`import:${binding.name.text}`, binding, `import * as ${binding.name.text} from ${module}; void ${binding.name.text}`)
        } else for (const binding of clause.namedBindings.elements) if (imports.bindings.has(binding.name.text)) {
          add(`import:${binding.name.text}`, binding, `import { ${binding.propertyName?.text ?? binding.name.text} as ${binding.name.text} } from ${module}; void ${binding.name.text}`)
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.body) {
      add(`function:${statement.name?.text ?? '<default>'}`, statement, statement.getText(sf))
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const kind = statement.declarationList.flags & ts.NodeFlags.Const ? 'const' : statement.declarationList.flags & ts.NodeFlags.Let ? 'let' : 'var'
        const prefix = statement.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ? 'export ' : ''
        add(`variable:${declaration.name.getText(sf)}`, declaration, `${prefix}${kind} ${declaration.getText(sf)}`,
          !ts.isIdentifier(declaration.name) || !inertValue(declaration.initializer), true)
      }
    } else if (ts.isEnumDeclaration(statement)) {
      add(`enum:${statement.name.text}`, statement, statement.getText(sf),
        statement.members.some(m => ts.isComputedPropertyName(m.name) || !inertValue(m.initializer)), true)
    } else if (ts.isClassDeclaration(statement)) {
      const name = statement.name?.text ?? '<default>'
      const printer = ts.createPrinter({ removeComments: true })
      const header = ts.factory.updateClassDeclaration(statement, statement.modifiers, statement.name,
        statement.typeParameters, statement.heritageClauses, [])
      add(`class:${name}`, statement, printer.printNode(ts.EmitHint.Unspecified, header, sf),
        decorators(statement) || (statement.heritageClauses ?? []).some(c => c.token === ts.SyntaxKind.ExtendsKeyword), true)
      // Adding/removing/reordering members changes reflective class shape even
      // when no case invokes a new member. Class references retain this owner.
      const runtimeMembers = statement.members.filter(m => fingerprint(`class __BehaviorOwner { ${m.getText(sf)} }`) !== emptyClass)
      const shape = runtimeMembers.map(m => [m.kind, m.name?.getText(sf) ?? '<constructor>',
        !!m.modifiers?.some(mod => mod.kind === ts.SyntaxKind.StaticKeyword)])
      add(`class-shape:${name}`, statement, `void ${JSON.stringify(shape)}`, true)
      for (const member of runtimeMembers) {
        // Abstract/overload/type members have no executable body or initializer.
        const source = `class __BehaviorOwner { ${member.getText(sf)} }`
        if (fingerprint(source) === emptyClass) continue
        const key = `class:${name}:${member.kind}:${member.name?.getText(sf) ?? '<constructor>'}`
        const staticMember = member.modifiers?.some(mod => mod.kind === ts.SyntaxKind.StaticKeyword)
        const effect = decorators(member) || member.name && ts.isComputedPropertyName(member.name)
          || ts.isClassStaticBlockDeclaration(member)
          || staticMember && ts.isPropertyDeclaration(member) && !inertValue(member.initializer)
        add(key, member, source, !!effect, !!staticMember)
      }
    } else {
      // Exports, assignments, registration calls, namespaces and unknown syntax
      // retain the module initialization boundary, including their removal.
      add(`module:${statement.kind}`, statement, statement.getText(sf), true, true)
    }
  }
  return { entries, initializationOrder, modules: imports.modules }
}

function changedDeclarations(current, previous) {
  const ids = new Set()
  let moduleEffect = current.modules.join('\n') !== previous.modules.join('\n')
  const common = new Set(current.initializationOrder.filter(key => previous.entries.has(key)))
  const beforeOrder = previous.initializationOrder.filter(key => common.has(key))
  if (current.initializationOrder.filter(key => common.has(key)).join('\n') !== beforeOrder.join('\n')) moduleEffect = true
  for (const [key, owner] of current.entries) {
    if (owner.fingerprint === previous.entries.get(key)?.fingerprint) continue
    // Initializers and class shape are value/class owners in Related/dev.
    // Their potential ambient effects do not expand to every importing leaf.
    if (owner.id) ids.add(owner.id)
    else moduleEffect = true
  }
  return { ids, moduleEffect }
}
module.exports = { declarationSnapshot, changedDeclarations, runtimeImports, inertValue }
