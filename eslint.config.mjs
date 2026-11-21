import tseslint from 'typescript-eslint'
import vitest from '@vitest/eslint-plugin'

const TEST_APIS = new Set(['it', 'test', 'specify'])
const SUITE_APIS = new Set(['describe', 'suite'])
const HEAVY_CONSTRUCTORS = new Set([
  'Scene', 'Group', 'Object3D', 'Mesh', 'SkinnedMesh', 'InstancedMesh', 'Points', 'Line', 'LineSegments', 'Sprite',
  'Bone', 'Skeleton', 'SkeletonHelper', 'AnimationMixer',
  'Geometry', 'BufferGeometry', 'InstancedBufferGeometry',
  'BoxGeometry', 'SphereGeometry', 'PlaneGeometry', 'CylinderGeometry', 'ConeGeometry', 'CapsuleGeometry',
  'RingGeometry', 'CircleGeometry', 'TorusGeometry', 'IcosahedronGeometry', 'DodecahedronGeometry',
  'OctahedronGeometry', 'TetrahedronGeometry', 'ShapeGeometry', 'ExtrudeGeometry', 'LatheGeometry',
  'EdgesGeometry', 'WireframeGeometry',
  'Material', 'MeshBasicMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshStandardMaterial',
  'MeshPhysicalMaterial', 'MeshNormalMaterial', 'MeshDepthMaterial', 'PointsMaterial', 'LineBasicMaterial',
  'LineDashedMaterial', 'ShaderMaterial', 'RawShaderMaterial', 'SpriteMaterial',
  'Texture', 'CanvasTexture', 'DataTexture', 'CompressedTexture', 'CubeTexture', 'VideoTexture', 'DepthTexture',
  'FramebufferTexture', 'DataArrayTexture', 'Data3DTexture',
  'WebGLRenderTarget', 'WebGLRenderer',
  'Camera', 'PerspectiveCamera', 'OrthographicCamera', 'ArrayCamera', 'CubeCamera', 'StereoCamera',
  'Light', 'AmbientLight', 'DirectionalLight', 'PointLight', 'SpotLight', 'HemisphereLight', 'RectAreaLight',
  'LightProbe', 'CameraHelper', 'ArrowHelper', 'AxesHelper', 'GridHelper', 'BoxHelper', 'Box3Helper',
])
const HEAVY_ACTOR_MODULES = new Map([
  ['NPC', '/src/world/NPC'],
  ['Player', '/src/player/Player'],
  ['Mount', '/src/world/Mount'],
  ['TownScene', '/src/town/TownScene'],
  ['TownWorld', '/src/town/TownWorld'],
  ['Game', '/src/Game'],
])
const HEAVY_ACTOR_NAMES = new Set(HEAVY_ACTOR_MODULES.keys())
// Small pilot only. The classification pair below is a composed route, while
// the warning pattern joins two independently asserted decisions in one leaf.
const CROSS_OWNER_DECISION_ENTRYPOINTS = [
  {
    owner: 'CareerBridgeBattle',
    module: '/src/career/CareerBridgeBattle',
    names: new Set(['isCareerFelineBattle', 'careerFieldTacticalOrder', 'commitCareerBridgeBattleResult']),
  },
  {
    owner: 'CareerFieldBattle',
    module: '/src/career/CareerFieldBattle',
    names: new Set([
      'isMigratedCareerFieldTemplate', 'isMigratedCareerFieldMission', 'resolveFieldDamagedTargetId',
      'shouldTriggerSweepAlert', 'findVeteranSquadsInRange',
    ]),
  },
]
const CROSS_OWNER_WARNING_PATTERNS = [
  [
    { owner: 'CareerBridgeBattle', entrypoint: 'careerFieldTacticalOrder' },
    { owner: 'CareerFieldBattle', entrypoint: 'resolveFieldDamagedTargetId' },
  ],
]
const CAREER_PROFILE_STORE_MODULE = '/src/career/CareerProfileStore'
const CAREER_PROFILE_STORE_METHODS = new Set(['load', 'loadChecked', 'save'])
// Ratchet for existing prototype harnesses: Object.create(Class.prototype) and, counted from the
// re-baseline commit "test(lint): count prototype method borrowing", borrowed production methods
// (Class.prototype.m.call/apply/bind, assigned/spread into objects, or passed to
// Object.getOwnPropertyDescriptor/defineProperty). A file warns once it exceeds its count, and a
// lower count asks for the entry to shrink. That re-baseline was one-time; never raise or add entries.
const PROTOTYPE_HARNESS_BASELINE = new Map([
  ['tests/actors/MountDeathPresentation.test.ts', 10],
  ['tests/actors/NPCEquipmentLifecycle.test.ts', 1],
  ['tests/combat/CombatAttribution.test.ts', 6],
  ['tests/combat/CombatBalance.test.ts', 1],
  ['tests/combat/CommanderWeaponSwitching.test.ts', 6],
  ['tests/combat/MountArmor.test.ts', 2],
  ['tests/integration/GameInventoryLifecycle.test.ts', 3],
  ['tests/integration/GameWeaponPickup.test.ts', 2],
  ['tests/integration/MissionModeRouting.test.ts', 4],
  ['tests/integration/PersonalSquadCommandRouting.test.ts', 1],
  ['tests/integration/ReliefResultSettlement.test.ts', 1],
  ['tests/missions/ArenaSquadTrials.test.ts', 2],
  ['tests/missions/CareerDuelState.test.ts', 1],
  ['tests/missions/SiegeRampPolicy.test.ts', 7],
  ['tests/missions/TownDefenseOutcome.test.ts', 1],
  ['tests/missions/TownSiegePolicy.test.ts', 8],
  ['tests/movement/ChaseTargetCoordinator.test.ts', 20],
  ['tests/movement/FriendlyMovementBypass.test.ts', 8],
  ['tests/movement/SweptBodyCollision.test.ts', 1],
  ['tests/persistence/CareerMissionCheckpoint.test.ts', 2],
  ['tests/persistence/CareerMissionSettlement.test.ts', 2],
  ['tests/persistence/CareerPrisonBreak.test.ts', 9],
  ['tests/progression/CombatSkills.test.ts', 1],
  ['tests/town/TownConquest.test.ts', 1],
  ['tests/town/TownTutorialUX.test.ts', 1],
])
const NODE_TEST_APIS = new Set(['test', 'it', 'describe', 'suite'])
const NODE_TEST_CASE_APIS = new Set(['test', 'it'])
const NODE_TEST_SUITE_APIS = new Set(['describe', 'suite'])

function isFunction(node) {
  return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression'
}

function isFunctionBoundary(node) {
  return isFunction(node) || node?.type === 'FunctionDeclaration'
}

function unwrapExpression(node) {
  while (['ChainExpression', 'ParenthesizedExpression', 'TSAsExpression', 'TSTypeAssertion',
    'TSNonNullExpression', 'TSInstantiationExpression'].includes(node?.type)) {
    node = node.expression
  }
  return node
}

function staticMemberName(node) {
  if (node?.type === 'Property') {
    if (node.key.type === 'Identifier') return node.key.name
    if (node.key.type === 'Literal') return String(node.key.value)
    return null
  }
  if (node?.type !== 'MemberExpression') return null
  if (!node.computed && node.property.type === 'Identifier') return node.property.name
  if (node.computed && node.property.type === 'Literal') return String(node.property.value)
  return null
}

function variableInScope(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name)
    if (variable) return variable
  }
  return null
}

function externalImportFor(variable) {
  for (const definition of variable?.defs ?? []) {
    if (definition.type === 'ImportBinding') {
      const specifier = definition.node
      return {
        source: definition.parent.source.value,
        namespace: specifier.type === 'ImportNamespaceSpecifier',
        imported: specifier.type === 'ImportSpecifier' ? specifier.imported.name : null,
        typeOnly: definition.parent.importKind === 'type' || specifier.importKind === 'type',
      }
    }

    if (definition.type !== 'Variable' || definition.node.type !== 'VariableDeclarator') continue
    const declarator = definition.node
    if (declarator.init?.type !== 'CallExpression' || declarator.init.callee?.name !== 'require' ||
        declarator.init.arguments?.[0]?.type !== 'Literal') continue
    const source = declarator.init.arguments[0].value
    if (declarator.id.type === 'Identifier') return { source, namespace: true, imported: null, typeOnly: false }
    if (declarator.id.type !== 'ObjectPattern') continue
    const property = declarator.id.properties.find(item =>
      item.type === 'Property' && item.value.type === 'Identifier' && item.value.name === variable.name)
    if (property) return { source, namespace: false, imported: staticMemberName(property) ?? property.key.name, typeOnly: false }
  }
  return null
}

function importedBinding(sourceCode, identifier) {
  if (identifier?.type !== 'Identifier') return null
  return externalImportFor(variableInScope(sourceCode.getScope(identifier), identifier.name))
}

function directDecisionEntryPoint(sourceCode, expression) {
  const callee = unwrapExpression(expression)
  let binding
  let importedName

  if (callee.type === 'Identifier') {
    binding = importedBinding(sourceCode, callee)
    if (binding?.namespace) return null
    importedName = binding?.imported
  } else if (callee.type === 'MemberExpression') {
    importedName = staticMemberName(callee)
    binding = importedBinding(sourceCode, unwrapExpression(callee.object))
    if (!binding?.namespace) return null
  } else return null

  if (!binding || binding.typeOnly) return null
  const owner = CROSS_OWNER_DECISION_ENTRYPOINTS.find(candidate =>
    candidate.names.has(importedName) && moduleMatches(binding.source, candidate.module))
  return owner ? { owner: owner.owner, entrypoint: importedName } : null
}

function careerProfileStoreMethodEntryPoint(sourceCode, expression) {
  const callee = unwrapExpression(expression)
  if (callee.type !== 'MemberExpression') return null
  const method = staticMemberName(callee)
  if (!CAREER_PROFILE_STORE_METHODS.has(method)) return null
  const object = unwrapExpression(callee.object)
  if (object.type !== 'Identifier') return null

  const variable = variableInScope(sourceCode.getScope(object), object.name)
  for (const definition of variable?.defs ?? []) {
    if (definition.type !== 'Variable' || definition.node.type !== 'VariableDeclarator') continue
    const init = unwrapExpression(definition.node.init)
    const constructor = init?.type === 'NewExpression' ? unwrapExpression(init.callee) : null
    if (constructor?.type !== 'Identifier') continue
    const binding = importedBinding(sourceCode, constructor)
    if (binding?.typeOnly || binding?.namespace || binding?.imported !== 'CareerProfileStore' ||
        !moduleMatches(binding.source, CAREER_PROFILE_STORE_MODULE)) continue
    return { owner: 'CareerProfileStore', entrypoint: `CareerProfileStore.${method}` }
  }
  return null
}

function calledOwnerEntryPoint(sourceCode, expression) {
  return directDecisionEntryPoint(sourceCode, expression) ??
    careerProfileStoreMethodEntryPoint(sourceCode, expression)
}

function moduleMatches(source, suffix) {
  return Boolean(suffix && typeof source === 'string' &&
    source.replaceAll('\\', '/').replace(/\.(?:[cm]?[jt]sx?)$/, '').endsWith(suffix))
}

function relativeLintPath(context) {
  const cwd = context.cwd.replaceAll('\\', '/').replace(/\/?$/, '/')
  const file = context.filename.replaceAll('\\', '/')
  return file.startsWith(cwd) ? file.slice(cwd.length) : file
}

function isProductionSource(source) {
  if (typeof source !== 'string') return false
  const normalized = source.replaceAll('\\', '/')
  return normalized.startsWith('src/') || normalized.includes('/src/')
}

function productionBindingRoot(sourceCode, expression) {
  let node = unwrapExpression(expression)
  const members = []
  while (node?.type === 'MemberExpression') {
    members.unshift(staticMemberName(node))
    node = unwrapExpression(node.object)
  }
  const binding = importedBinding(sourceCode, node)
  if (!binding || binding.typeOnly || !isProductionSource(binding.source)) return null
  return { root: node, binding, members }
}

const PROTOTYPE_DESCRIPTOR_APIS = new Set(['getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'defineProperty', 'defineProperties'])

function wrappedParent(node) {
  let current = node
  let parent = node.parent
  while (['ChainExpression', 'ParenthesizedExpression', 'TSAsExpression', 'TSTypeAssertion',
    'TSNonNullExpression', 'TSInstantiationExpression'].includes(parent?.type)) {
    current = parent
    parent = parent.parent
  }
  return { current, parent }
}

// `node` is X.prototype.name (isMethod) or X.prototype; decide whether it is borrowed onto another object.
function isPrototypeBorrow(node, prototype, isMethod) {
  const { current, parent } = wrappedParent(node)
  if (!parent) return false
  if (isMethod) {
    if (parent.type === 'MemberExpression' && parent.object === current &&
        ['call', 'apply', 'bind'].includes(staticMemberName(parent))) return true
    if (parent.type === 'Property' && parent.value === current) return true
    if (parent.type === 'AssignmentExpression' && parent.right === current) return true
    return false
  }
  // Bare X.prototype: spread into an object, or an Object.getOwnPropertyDescriptor/defineProperty argument.
  if (parent.type === 'SpreadElement' && parent.parent?.type === 'ObjectExpression') return true
  if (parent.type === 'CallExpression' && parent.arguments[0] === current) {
    const callee = unwrapExpression(parent.callee)
    return callee.type === 'MemberExpression' && PROTOTYPE_DESCRIPTOR_APIS.has(staticMemberName(callee)) &&
      unwrapExpression(callee.object).type === 'Identifier' && unwrapExpression(callee.object).name === 'Object'
  }
  return false
}

// Short all-caps names without an underscore (NPC, HUD) are usually classes, not constants.
const SCREAMING_SNAKE_CASE = /^(?=.*_|.{4,})[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/

function isLiteralValue(node) {
  node = unwrapExpression(node)
  if (node?.type === 'Literal') return !node.regex
  if (node?.type === 'TemplateLiteral') return node.expressions.length === 0
  if (node?.type === 'UnaryExpression') return ['-', '+'].includes(node.operator) && isLiteralValue(node.argument)
  if (node?.type === 'ArrayExpression') return node.elements.every(element => element && isLiteralValue(element))
  if (node?.type === 'ObjectExpression') {
    return node.properties.every(property => property.type === 'Property' && !property.computed &&
      property.kind === 'init' && !property.method && isLiteralValue(property.value))
  }
  return false
}

function productionConstantName(sourceCode, expression) {
  const target = productionBindingRoot(sourceCode, expression)
  if (!target) return null
  // A namespace import names the module, so the constant is its first member.
  const name = target.binding.namespace ? target.members[0] : target.root.name
  return name && SCREAMING_SNAKE_CASE.test(name) ? name : null
}

const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises'])
const FS_READ_FUNCTIONS = new Set(['readFileSync', 'readFile'])

function isFsReadCall(sourceCode, callee) {
  callee = unwrapExpression(callee)
  if (callee.type === 'Identifier') {
    const binding = importedBinding(sourceCode, callee)
    return Boolean(binding && !binding.namespace && FS_MODULES.has(binding.source) &&
      FS_READ_FUNCTIONS.has(binding.imported))
  }
  if (callee.type !== 'MemberExpression' || !FS_READ_FUNCTIONS.has(staticMemberName(callee))) return false
  let object = unwrapExpression(callee.object)
  // fs.promises.readFile(...)
  if (object.type === 'MemberExpression' && staticMemberName(object) === 'promises') object = unwrapExpression(object.object)
  const binding = importedBinding(sourceCode, object)
  // Namespace, require(), default import (imported === null) or a named `promises` import.
  return Boolean(binding && !binding.typeOnly && FS_MODULES.has(binding.source) &&
    (binding.namespace || binding.imported === null || ['default', 'promises'].includes(binding.imported)))
}

function mentionsProductionSourcePath(node) {
  const pending = [node]
  while (pending.length) {
    const current = pending.pop()
    if (!current || typeof current !== 'object') continue
    if (current.type === 'Literal' && typeof current.value === 'string') {
      const value = current.value.replaceAll('\\', '/')
      if (value === 'src' || value.startsWith('src/') || value.includes('/src/') || value.endsWith('/src')) return true
    } else if (current.type === 'TemplateElement') {
      const value = current.value.cooked?.replaceAll('\\', '/') ?? ''
      if (value.startsWith('src/') || value.includes('/src/')) return true
    }
    for (const [key, child] of Object.entries(current)) {
      if (key === 'parent' || key === 'loc' || key === 'range') continue
      if (Array.isArray(child)) pending.push(...child)
      else if (child && typeof child.type === 'string') pending.push(child)
    }
  }
  return false
}

function isHeavyImportedConstructor(sourceCode, node) {
  const callee = unwrapExpression(node.callee)
  if (callee.type === 'Identifier') {
    const binding = importedBinding(sourceCode, callee)
    if (!binding) return false
    if (binding.source === 'three') return !binding.namespace && HEAVY_CONSTRUCTORS.has(binding.imported)
    return HEAVY_ACTOR_NAMES.has(binding.imported) &&
      moduleMatches(binding.source, HEAVY_ACTOR_MODULES.get(binding.imported))
  }

  if (callee.type !== 'MemberExpression') return false
  const member = staticMemberName(callee)
  if (!member) return false
  const object = unwrapExpression(callee.object)
  const binding = importedBinding(sourceCode, object)
  if (!binding) return false
  if (binding.source === 'three') return binding.namespace && HEAVY_CONSTRUCTORS.has(member)
  return binding.namespace && HEAVY_ACTOR_NAMES.has(member) &&
    moduleMatches(binding.source, HEAVY_ACTOR_MODULES.get(member))
}

function nodeTestApiName(sourceCode, expression) {
  const node = unwrapExpression(expression)
  if (node.type === 'Identifier') {
    const binding = importedBinding(sourceCode, node)
    if (binding?.source !== 'node:test') return null
    if (binding.namespace) return 'test'
    return NODE_TEST_APIS.has(binding.imported) ? binding.imported : null
  }
  if (node.type !== 'MemberExpression') return null
  const member = staticMemberName(node)
  const object = unwrapExpression(node.object)
  const binding = importedBinding(sourceCode, object)
  if (binding?.source === 'node:test' && binding.namespace && NODE_TEST_APIS.has(member)) return member
  const ownerApi = nodeTestCallbackOwner(sourceCode, node)
  return NODE_TEST_APIS.has(member) && ownerApi ? member : null
}

function nodeTestCallbackOwner(sourceCode, memberExpression) {
  const object = unwrapExpression(memberExpression.object)
  if (object.type !== 'Identifier') return null
  for (let current = memberExpression.parent; current; current = current.parent) {
    if (!isFunction(current) || !current.params.some(parameter =>
      unwrapExpression(parameter).type === 'Identifier' && unwrapExpression(parameter).name === object.name)) continue
    const registration = current.parent
    if (registration?.type !== 'CallExpression' || testCallback(registration) !== current) return null
    const ownerApi = nodeTestApiName(sourceCode, registration.callee)
    return NODE_TEST_CASE_APIS.has(ownerApi) || NODE_TEST_SUITE_APIS.has(ownerApi) ? ownerApi : null
  }
  return null
}

function nodeTestDisabledKind(sourceCode, node) {
  const callee = unwrapExpression(node.callee)
  if (callee.type === 'MemberExpression') {
    const modifier = staticMemberName(callee)
    if (nodeTestApiName(sourceCode, callee.object)) {
      if (modifier === 'only') return 'focused'
      if (['skip', 'todo'].includes(modifier)) return 'disabled'
    }
  }

  const api = nodeTestApiName(sourceCode, node.callee)
  if (!NODE_TEST_CASE_APIS.has(api) && !NODE_TEST_SUITE_APIS.has(api)) return null
  const options = node.arguments[1]
  if (options?.type !== 'ObjectExpression') return null
  for (const property of options.properties) {
    if (property.type !== 'Property') continue
    const option = staticMemberName(property) ?? property.key.name
    if (!['only', 'skip', 'todo'].includes(option) ||
        (property.value.type === 'Literal' && property.value.value === false)) continue
    return option === 'only' ? 'focused' : 'disabled'
  }
  return null
}

function literalTestTitle(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked
  return null
}

function enclosingNodeTestSuite(sourceCode, node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'CallExpression' && NODE_TEST_APIS.has(nodeTestApiName(sourceCode, current.callee))) return current
  }
  return sourceCode.ast
}

const VITEST_CHAIN_METHODS = new Set([
  'each', 'for', 'concurrent', 'sequential', 'fails', 'only', 'skip', 'todo', 'runIf', 'skipIf',
])

function registrationChain(expression) {
  let current = unwrapExpression(expression)
  const members = []
  while (current?.type === 'CallExpression' || current?.type === 'MemberExpression') {
    if (current.type === 'CallExpression') current = unwrapExpression(current.callee)
    else {
      members.unshift(staticMemberName(current))
      current = unwrapExpression(current.object)
    }
  }
  return { root: current, members }
}

function registrationApi(sourceCode, expression) {
  const nodeApi = nodeTestApiName(sourceCode, expression)
  if (NODE_TEST_APIS.has(nodeApi)) return { api: nodeApi, framework: 'node:test' }

  const { root, members } = registrationChain(expression)
  if (root?.type !== 'Identifier') return null
  const binding = importedBinding(sourceCode, root)
  if (binding?.source === 'vitest') {
    const api = binding.namespace ? members.shift() : binding.imported
    if (!TEST_APIS.has(api) && !SUITE_APIS.has(api)) return null
    return members.every(method => VITEST_CHAIN_METHODS.has(method))
      ? { api, framework: 'vitest', modifiers: members, namespace: binding.namespace }
      : null
  }
  if (binding) return null

  const variable = variableInScope(sourceCode.getScope(root), root.name)
  if (variable?.defs?.length) return null
  if (Object.hasOwn(vitest.environments.env.globals, root.name) &&
      (TEST_APIS.has(root.name) || SUITE_APIS.has(root.name))) {
    return members.every(method => VITEST_CHAIN_METHODS.has(method))
      ? { api: root.name, framework: 'vitest', modifiers: members, namespace: false }
      : null
  }
  return null
}

function isTestCaseCall(sourceCode, node) {
  return node?.type === 'CallExpression' && TEST_APIS.has(registrationApi(sourceCode, node.callee)?.api) &&
    Boolean(testCallback(node))
}

function enclosingTestCaseCallback(sourceCode, node) {
  for (let current = node.parent; current; current = current.parent) {
    if (!isFunctionBoundary(current)) continue
    const registration = current.parent
    if (registration?.type === 'CallExpression' && testCallback(registration) === current &&
        isTestCaseCall(sourceCode, registration)) return current
    // Calls inside fixture callbacks or deferred work are not direct calls in
    // the leaf body, even when that helper was declared inside the test.
    return null
  }
  return null
}

function isTestSuiteCall(sourceCode, node) {
  return node?.type === 'CallExpression' && SUITE_APIS.has(registrationApi(sourceCode, node.callee)?.api) &&
    Boolean(testCallback(node))
}

function conditionalRegistrationAncestor(node) {
  let current = node
  while (current?.parent) {
    const parent = current.parent
    if (parent.type === 'IfStatement' && (parent.consequent === current || parent.alternate === current)) return parent
    if (parent.type === 'SwitchCase' && parent.consequent.includes(current)) return parent
    if (parent.type === 'ConditionalExpression' && (parent.consequent === current || parent.alternate === current)) return parent
    if (parent.type === 'LogicalExpression' && parent.right === current && ['&&', '||', '??'].includes(parent.operator)) return parent
    current = parent
  }
  return null
}

function usesConditionalTestMethod(sourceCode, node) {
  let current = node
  while (current?.type === 'CallExpression' || current?.type === 'MemberExpression') {
    if (current.type === 'MemberExpression' && ['runIf', 'skipIf'].includes(staticMemberName(current)) &&
        registrationApi(sourceCode, current.object)?.framework === 'vitest') return true
    current = current.type === 'CallExpression' ? current.callee : current.object
  }
  return false
}

function isRegistrationWrapperCall(sourceCode, node) {
  const callee = unwrapExpression(node.callee)
  if (callee.type !== 'MemberExpression' || !['each', 'for', 'runIf', 'skipIf'].includes(staticMemberName(callee))) {
    return false
  }
  return registrationApi(sourceCode, callee.object) !== null
}

function enclosingVitestSuite(sourceCode, node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type !== 'CallExpression' || isRegistrationWrapperCall(sourceCode, current)) continue
    const registration = registrationApi(sourceCode, current.callee)
    if (registration?.framework === 'vitest' && SUITE_APIS.has(registration.api)) return current
  }
  return sourceCode.ast
}

function isFocusedCallHandledByVitestPlugin(node) {
  const callee = unwrapExpression(node.callee)
  if (callee.type === 'MemberExpression') {
    return staticMemberName(callee) === 'only' && callee.object.type === 'Identifier' &&
      ['it', 'test', 'describe'].includes(callee.object.name)
  }
  if (callee.type !== 'CallExpression') return false
  const each = unwrapExpression(callee.callee)
  if (each.type !== 'MemberExpression' || staticMemberName(each) !== 'each') return false
  const only = unwrapExpression(each.object)
  return only.type === 'MemberExpression' && staticMemberName(only) === 'only' &&
    only.object.type === 'Identifier' && ['it', 'test', 'describe'].includes(only.object.name)
}

function testCallback(node) {
  return [...(node.arguments ?? [])].reverse().find(isFunction)
}

function isInsideTestBody(sourceCode, node) {
  for (let current = node.parent; current; current = current.parent) {
    if (isFunction(current) && current.parent?.type === 'CallExpression' &&
        isTestCaseCall(sourceCode, current.parent) && testCallback(current.parent) === current) return true
  }
  return false
}

function effectiveBodyLines(sourceCode, body) {
  const lines = new Set()
  for (const token of sourceCode.getTokens(body)) {
    if (body.type === 'BlockStatement' && token.value === '{' && token.range[0] === body.range[0]) continue
    if (body.type === 'BlockStatement' && token.value === '}' && token.range[1] === body.range[1]) continue
    for (let line = token.loc.start.line; line <= token.loc.end.line; line++) lines.add(line)
  }
  return lines.size
}

function hasRealTimerWait(sourceCode, promise) {
  if (promise.callee?.type !== 'Identifier' || promise.callee.name !== 'Promise') return false
  const executor = promise.arguments?.[0]
  if (!isFunction(executor)) return false
  const tokens = sourceCode.getTokens(executor.body)
  return tokens.some((token, index) => token.value === 'setTimeout' && tokens[index + 1]?.value === '(')
}

const testAuthoring = {
  meta: { name: 'test-authoring' },
  rules: {
    'no-vitest-unrunnable-tests': {
      meta: {
        type: 'problem',
        docs: { description: 'Disallow focused and todo registrations not covered by the Vitest plugin' },
        schema: [],
        messages: {
          focused: 'Do not focus a Vitest test with only; keep the full test suite runnable.',
          disabled: 'Do not skip a Vitest test or suite; remove it or make it runnable.',
          todo: 'Do not leave a Vitest test marked todo; implement or remove it.',
        },
      },
      create(context) {
        const sourceCode = context.sourceCode
        return {
          CallExpression(node) {
            if (isRegistrationWrapperCall(sourceCode, node)) return
            const registration = registrationApi(sourceCode, node.callee)
            if (registration?.framework !== 'vitest') return
            if (registration.modifiers.includes('todo')) {
              context.report({ node, messageId: 'todo' })
            } else if (registration.namespace && registration.modifiers.includes('skip')) {
              context.report({ node, messageId: 'disabled' })
            } else if (registration.modifiers.includes('only') && !isFocusedCallHandledByVitestPlugin(node)) {
              context.report({ node, messageId: 'focused' })
            }
          },
        }
      },
    },
    'no-vitest-identical-title': {
      meta: {
        type: 'problem',
        docs: { description: 'Disallow duplicate Vitest test and suite titles within the same suite' },
        schema: [],
        messages: {
          duplicateTest: 'Test title "{{title}}" is already registered in this suite.',
          duplicateSuite: 'Suite title "{{title}}" is already registered in this suite.',
        },
      },
      create(context) {
        const sourceCode = context.sourceCode
        const titlesBySuite = new Map()
        return {
          CallExpression(node) {
            if (isRegistrationWrapperCall(sourceCode, node)) return
            const registration = registrationApi(sourceCode, node.callee)
            if (registration?.framework !== 'vitest' ||
                registration.modifiers.some(method => method === 'each' || method === 'for')) return
            const title = literalTestTitle(node.arguments[0])
            if (title === null) return

            const suite = enclosingVitestSuite(sourceCode, node)
            let titles = titlesBySuite.get(suite)
            if (!titles) {
              titles = { tests: new Set(), suites: new Set() }
              titlesBySuite.set(suite, titles)
            }
            const kind = SUITE_APIS.has(registration.api) ? 'suites' : 'tests'
            if (titles[kind].has(title)) {
              context.report({
                node,
                messageId: kind === 'tests' ? 'duplicateTest' : 'duplicateSuite',
                data: { title },
              })
            } else titles[kind].add(title)
          },
        }
      },
    },
    'no-heavy-three-constructor': {
      meta: {
        type: 'problem',
        docs: { description: 'Disallow heavyweight scene, render-resource, and actor constructors in unit tests' },
        schema: [],
        messages: {
          heavyweight: 'Do not construct a 3D scene, render resource, or heavyweight game actor in a unit test. Use a narrow fixture or mock the external boundary.',
        },
      },
      create(context) {
        return {
          NewExpression(node) {
            if (isHeavyImportedConstructor(context.sourceCode, node)) {
              context.report({ node, messageId: 'heavyweight' })
            }
          },
        }
      },
    },
    'no-node-disabled-tests': {
      meta: {
        type: 'problem',
        docs: { description: 'Disallow focused, skipped, and todo tests registered through node:test' },
        schema: [],
        messages: {
          focused: 'Do not focus a Node test with only; keep the full test suite runnable.',
          disabled: 'Do not disable or mark a Node test as todo; remove it or make it runnable.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            const kind = nodeTestDisabledKind(context.sourceCode, node)
            if (kind) context.report({ node, messageId: kind })
          },
        }
      },
    },
    'no-node-identical-title': {
      meta: {
        type: 'problem',
        docs: { description: 'Disallow duplicate literal test and suite titles within one node:test suite' },
        schema: [],
        messages: {
          duplicateTest: 'Duplicate Node test title "{{title}}" in the same suite.',
          duplicateSuite: 'Duplicate Node suite title "{{title}}" in the same suite.',
        },
      },
      create(context) {
        const titlesBySuite = new Map()
        return {
          CallExpression(node) {
            const api = nodeTestApiName(context.sourceCode, node.callee)
            if (!NODE_TEST_CASE_APIS.has(api) && !NODE_TEST_SUITE_APIS.has(api)) return
            const title = literalTestTitle(node.arguments[0])
            if (title === null) return
            const suite = enclosingNodeTestSuite(context.sourceCode, node)
            let titles = titlesBySuite.get(suite)
            if (!titles) {
              titles = { tests: new Set(), suites: new Set() }
              titlesBySuite.set(suite, titles)
            }
            const kind = NODE_TEST_SUITE_APIS.has(api) ? 'suites' : 'tests'
            if (titles[kind].has(title)) {
              context.report({ node, messageId: kind === 'tests' ? 'duplicateTest' : 'duplicateSuite', data: { title } })
            } else titles[kind].add(title)
          },
        }
      },
    },
    'no-conditional-test-registration': {
      meta: {
        type: 'problem',
        docs: { description: 'Disallow test registration inside conditional control flow or runIf/skipIf' },
        schema: [],
        messages: { conditional: 'Do not register tests conditionally. Use a data-driven case only when it checks the same invariant.' },
      },
      create(context) {
        const sourceCode = context.sourceCode
        // Identify the registrar independently of callback syntax; named callbacks are valid registrations too.
        // Unconditional .each and data-driven loops stay legal.
        return {
          CallExpression(node) {
            if (isRegistrationWrapperCall(sourceCode, node)) return
            if (!registrationApi(sourceCode, node.callee)) return
            if (usesConditionalTestMethod(sourceCode, node.callee) || conditionalRegistrationAncestor(node)) {
              context.report({ node, messageId: 'conditional' })
            }
          },
        }
      },
    },
    'large-test-body': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Warn when one test callback exceeds 120 effective source lines' },
        schema: [],
        messages: { large: 'Test body has {{lines}} effective code lines (limit: 120); review whether independent failure modes need separate cases.' },
      },
      create(context) {
        const sourceCode = context.sourceCode
        return {
          CallExpression(node) {
            if (!isTestCaseCall(sourceCode, node)) return
            const callback = testCallback(node)
            if (!callback) return
            const lines = effectiveBodyLines(sourceCode, callback.body)
            if (lines > 120) context.report({ node: callback, messageId: 'large', data: { lines } })
          },
        }
      },
    },
    'no-real-timer-sleep': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Warn about Promise waits backed by a real setTimeout inside test bodies' },
        schema: [],
        messages: { sleep: 'This Promise waits on setTimeout; prefer fake timers, an injected Clock, or a deferred Promise. Review intentional real-timer behavior tests manually.' },
      },
      create(context) {
        const sourceCode = context.sourceCode
        return {
          NewExpression(node) {
            if (isInsideTestBody(sourceCode, node) && hasRealTimerWait(sourceCode, node)) {
              context.report({ node, messageId: 'sleep' })
            }
          },
        }
      },
    },
    'warn-cross-owner-test-calls': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Warn when one test leaf directly exercises selected decisions from different owners' },
        schema: [],
        messages: {
          crossOwner: 'This leaf directly calls selected decision entry points from different owners ({{entrypoints}}). Review whether they verify one production path or combine independently verifiable behavior; ownership and case responsibility remain a review decision.',
        },
      },
      create(context) {
        const sourceCode = context.sourceCode
        const entryPointsByCallback = new Map()
        return {
          CallExpression(node) {
            const callback = enclosingTestCaseCallback(sourceCode, node)
            const entryPoint = calledOwnerEntryPoint(sourceCode, node.callee)
            if (!callback || !entryPoint) return

            let byOwner = entryPointsByCallback.get(callback)
            if (!byOwner) {
              byOwner = new Map()
              entryPointsByCallback.set(callback, byOwner)
            }
            let names = byOwner.get(entryPoint.owner)
            if (!names) {
              names = new Set()
              byOwner.set(entryPoint.owner, names)
            }
            names.add(entryPoint.entrypoint)
          },
          'Program:exit'() {
            for (const [callback, byOwner] of entryPointsByCallback) {
              const pattern = CROSS_OWNER_WARNING_PATTERNS.find(entrypoints =>
                entrypoints.every(({ owner, entrypoint }) => byOwner.get(owner)?.has(entrypoint)))
              if (!pattern) continue
              const entrypoints = pattern
                .map(({ owner, entrypoint }) => `${owner}.${entrypoint}`)
                .join('; ')
              context.report({ node: callback, messageId: 'crossOwner', data: { entrypoints } })
            }
          },
        }
      },
    },
    'no-constant-literal-assert': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Warn when a production SCREAMING_SNAKE_CASE constant is asserted against a copied literal' },
        schema: [],
        messages: {
          tautological: '{{name}} is compared with a literal copied from production; assert the behavior that depends on it instead of restating its value.',
        },
      },
      create(context) {
        const sourceCode = context.sourceCode
        return {
          CallExpression(node) {
            const callee = unwrapExpression(node.callee)
            if (callee.type !== 'MemberExpression' ||
                !['toBe', 'toEqual', 'toStrictEqual'].includes(staticMemberName(callee))) return
            const subject = unwrapExpression(callee.object)
            if (subject.type !== 'CallExpression' || unwrapExpression(subject.callee).type !== 'Identifier' ||
                unwrapExpression(subject.callee).name !== 'expect' || node.arguments.length !== 1 ||
                !isLiteralValue(node.arguments[0])) return
            const name = productionConstantName(sourceCode, subject.arguments[0])
            if (name) context.report({ node, messageId: 'tautological', data: { name } })
          },
        }
      },
    },
    'no-prototype-harness': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Warn when a test builds a production class instance with Object.create(Class.prototype) or borrows Class.prototype methods onto plain objects' },
        schema: [{
          type: 'object',
          properties: { baseline: { type: 'object', additionalProperties: { type: 'integer', minimum: 1 } } },
          additionalProperties: false,
        }],
        messages: {
          harness: 'Object.create({{name}}.prototype) bypasses the production constructor and couples the test to private fields. Use a small production entry point or narrow dependency instead.',
          aboveBaseline: 'Object.create({{name}}.prototype) bypasses the production constructor; this file now has {{count}} prototype harnesses (baseline: {{baseline}}). Do not add new ones.',
          borrowed: '{{name}} borrows a production prototype method onto a plain object (.call/.apply/.bind, assignment or descriptor copy); it bypasses the constructor and couples the test to private fields. Use a small production entry point or narrow dependency instead.',
          borrowedAboveBaseline: '{{name}} borrows a production prototype method onto a plain object; this file now has {{count}} prototype harnesses (baseline: {{baseline}}). Do not add new ones.',
          staleBaseline: 'This file has {{count}} prototype harnesses but the baseline allows {{baseline}}; lower its no-prototype-harness baseline entry.',
        },
      },
      create(context) {
        const sourceCode = context.sourceCode
        const file = relativeLintPath(context)
        const baseline = context.options[0]?.baseline?.[file] ?? 0
        const harnesses = []
        return {
          MemberExpression(node) {
            // X.prototype.name (or X.prototype itself for descriptor/spread use) from a src/ class.
            const inner = unwrapExpression(node.object)
            const isMethod = inner?.type === 'MemberExpression' && staticMemberName(inner) === 'prototype'
            const prototype = staticMemberName(node) === 'prototype' ? node : isMethod ? inner : null
            if (!prototype) return
            const target = productionBindingRoot(sourceCode, prototype.object)
            if (!target || (target.binding.namespace && target.members.length === 0)) return
            if (!isPrototypeBorrow(node, prototype, isMethod)) return
            harnesses.push({ node, name: sourceCode.getText(prototype.object) + '.prototype', borrowed: true })
          },
          CallExpression(node) {
            const callee = unwrapExpression(node.callee)
            if (callee.type !== 'MemberExpression' || staticMemberName(callee) !== 'create' ||
                unwrapExpression(callee.object).type !== 'Identifier' || unwrapExpression(callee.object).name !== 'Object') return
            const prototype = unwrapExpression(node.arguments[0])
            if (prototype?.type !== 'MemberExpression' || staticMemberName(prototype) !== 'prototype') return
            const target = productionBindingRoot(sourceCode, prototype.object)
            if (!target || (target.binding.namespace && target.members.length === 0)) return
            harnesses.push({ node, name: sourceCode.getText(prototype.object) })
          },
          'Program:exit'(program) {
            if (harnesses.length > baseline) {
              for (const { node, name, borrowed } of harnesses) {
                const messageId = borrowed ? (baseline ? 'borrowedAboveBaseline' : 'borrowed')
                  : (baseline ? 'aboveBaseline' : 'harness')
                context.report({ node, messageId, data: { name, count: harnesses.length, baseline } })
              }
            } else if (harnesses.length < baseline) {
              context.report({
                node: program,
                loc: { line: 1, column: 0 },
                messageId: 'staleBaseline',
                data: { count: harnesses.length, baseline },
              })
            }
          },
        }
      },
    },
    'no-production-source-read': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Warn when a Vitest test reads production source files to assert on their text' },
        schema: [],
        messages: {
          sourceRead: 'This test reads a src/ file; asserting on source text breaks on refactors that keep behavior. Call the production code and assert its observable result.',
        },
      },
      create(context) {
        const sourceCode = context.sourceCode
        return {
          CallExpression(node) {
            if (isFsReadCall(sourceCode, node.callee) && mentionsProductionSourcePath(node.arguments[0])) {
              context.report({ node, messageId: 'sourceRead' })
            }
          },
        }
      },
    },
  },
}

const vitestBlockers = {
  'vitest/no-focused-tests': 'error',
  'vitest/no-disabled-tests': 'error',
  'vitest/no-test-prefixes': 'error',
  'test-authoring/no-vitest-identical-title': 'error',
}

const sharedTestRules = {
  'test-authoring/no-vitest-unrunnable-tests': 'error',
  'test-authoring/no-heavy-three-constructor': 'error',
  'test-authoring/no-conditional-test-registration': 'error',
  'test-authoring/large-test-body': 'warn',
  'test-authoring/no-real-timer-sleep': 'warn',
  'test-authoring/warn-cross-owner-test-calls': 'warn',
  'test-authoring/no-constant-literal-assert': 'warn',
  'test-authoring/no-prototype-harness': ['warn', { baseline: Object.fromEntries(PROTOTYPE_HARNESS_BASELINE) }],
}

export default [
  {
    files: ['tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    ignores: ['tests/**/*.test.cjs', 'tests/release/**'],
    languageOptions: {
      parser: tseslint.parser,
      sourceType: 'module',
      globals: vitest.environments.env.globals,
    },
    plugins: { vitest, '@typescript-eslint': tseslint.plugin, 'test-authoring': testAuthoring },
    rules: {
      ...sharedTestRules,
      ...vitestBlockers,
      'vitest/expect-expect': 'warn',
      'test-authoring/no-production-source-read': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': ['warn', {
        'ts-ignore': true,
        'ts-nocheck': true,
        'ts-expect-error': false,
        'ts-check': false,
      }],
    },
  },
  {
    files: ['tests/**/*.test.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    plugins: { 'test-authoring': testAuthoring },
    rules: {
      ...sharedTestRules,
      'test-authoring/no-node-disabled-tests': 'error',
      'test-authoring/no-node-identical-title': 'error',
    },
  },
]
