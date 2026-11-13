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
const NODE_TEST_APIS = new Set(['test', 'it', 'describe', 'suite'])
const NODE_TEST_CASE_APIS = new Set(['test', 'it'])
const NODE_TEST_SUITE_APIS = new Set(['describe', 'suite'])

function isFunction(node) {
  return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression'
}

function isTestApiExpression(node) {
  return hasApiExpression(node, TEST_APIS)
}

function isSuiteApiExpression(node) {
  return hasApiExpression(node, SUITE_APIS)
}

function hasApiExpression(node, apiNames) {
  let current = node
  while (current?.type === 'CallExpression' || current?.type === 'MemberExpression') {
    current = current.type === 'CallExpression' ? current.callee : current.object
  }
  return current?.type === 'Identifier' && apiNames.has(current.name)
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
      }
    }

    if (definition.type !== 'Variable' || definition.node.type !== 'VariableDeclarator') continue
    const declarator = definition.node
    if (declarator.init?.type !== 'CallExpression' || declarator.init.callee?.name !== 'require' ||
        declarator.init.arguments?.[0]?.type !== 'Literal') continue
    const source = declarator.init.arguments[0].value
    if (declarator.id.type === 'Identifier') return { source, namespace: true, imported: null }
    if (declarator.id.type !== 'ObjectPattern') continue
    const property = declarator.id.properties.find(item =>
      item.type === 'Property' && item.value.type === 'Identifier' && item.value.name === variable.name)
    if (property) return { source, namespace: false, imported: staticMemberName(property) ?? property.key.name }
  }
  return null
}

function importedBinding(sourceCode, identifier) {
  if (identifier?.type !== 'Identifier') return null
  return externalImportFor(variableInScope(sourceCode.getScope(identifier), identifier.name))
}

function moduleMatches(source, suffix) {
  return Boolean(suffix && typeof source === 'string' &&
    source.replaceAll('\\', '/').replace(/\.(?:[cm]?[jt]sx?)$/, '').endsWith(suffix))
}

function isHeavyImportedConstructor(sourceCode, node) {
  const callee = unwrapExpression(node.callee)
  if (callee.type === 'Identifier') {
    if (!HEAVY_CONSTRUCTORS.has(callee.name) && !HEAVY_ACTOR_NAMES.has(callee.name)) return false
    const binding = importedBinding(sourceCode, callee)
    if (!binding) return false
    if (binding.source === 'three') return !binding.namespace && HEAVY_CONSTRUCTORS.has(binding.imported)
    return moduleMatches(binding.source, HEAVY_ACTOR_MODULES.get(binding.imported))
  }

  if (callee.type !== 'MemberExpression') return false
  const member = staticMemberName(callee)
  if (!member || !HEAVY_CONSTRUCTORS.has(member) && !HEAVY_ACTOR_NAMES.has(member)) return false
  const object = unwrapExpression(callee.object)
  const binding = importedBinding(sourceCode, object)
  if (!binding) return false
  if (binding.source === 'three') return binding.namespace && HEAVY_CONSTRUCTORS.has(member)
  return binding.namespace && moduleMatches(binding.source, HEAVY_ACTOR_MODULES.get(member))
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

function nodeTestDisabledCall(sourceCode, node) {
  const callee = unwrapExpression(node.callee)
  if (callee.type === 'MemberExpression' && ['skip', 'todo'].includes(staticMemberName(callee)) &&
      nodeTestApiName(sourceCode, callee.object)) return true

  if (!NODE_TEST_CASE_APIS.has(nodeTestApiName(sourceCode, node.callee))) return false
  const options = node.arguments[1]
  if (options?.type !== 'ObjectExpression') return false
  return options.properties.some(property => {
    if (property.type !== 'Property' || !['skip', 'todo'].includes(staticMemberName(property) ?? property.key.name)) return false
    return !(property.value.type === 'Literal' && property.value.value === false)
  })
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

function isTestCaseCall(node) {
  return node?.type === 'CallExpression' && isTestApiExpression(node.callee) && Boolean(testCallback(node))
}

function isTestSuiteCall(node) {
  return node?.type === 'CallExpression' && isSuiteApiExpression(node.callee) && Boolean(testCallback(node))
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

function usesConditionalTestMethod(node) {
  let current = node
  while (current?.type === 'CallExpression' || current?.type === 'MemberExpression') {
    if (current.type === 'MemberExpression' && ['runIf', 'skipIf'].includes(current.property?.name) &&
        (isTestApiExpression(current.object) || isSuiteApiExpression(current.object))) return true
    current = current.type === 'CallExpression' ? current.callee : current.object
  }
  return false
}

function testCallback(node) {
  return [...(node.arguments ?? [])].reverse().find(isFunction)
}

function isInsideTestBody(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (isFunction(current) && current.parent?.type === 'CallExpression' &&
        isTestCaseCall(current.parent) && testCallback(current.parent) === current) return true
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
        docs: { description: 'Disallow skipped and todo tests registered through node:test' },
        schema: [],
        messages: { disabled: 'Do not disable or mark a Node test as todo; remove it or make it runnable.' },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (nodeTestDisabledCall(context.sourceCode, node)) context.report({ node, messageId: 'disabled' })
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
        // Keep parameterized loops legal; this covers conditional registration forms such as if/ternary/logical branches and runIf/skipIf.
        return {
          CallExpression(node) {
            if (!isTestCaseCall(node) && !isTestSuiteCall(node)) return
            if (usesConditionalTestMethod(node.callee) || conditionalRegistrationAncestor(node)) {
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
            if (!isTestCaseCall(node)) return
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
            if (isInsideTestBody(node) && hasRealTimerWait(sourceCode, node)) {
              context.report({ node, messageId: 'sleep' })
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
  'vitest/no-identical-title': 'error',
}

const sharedTestRules = {
  ...vitestBlockers,
  'test-authoring/no-heavy-three-constructor': 'error',
  'test-authoring/no-conditional-test-registration': 'error',
  'test-authoring/large-test-body': 'warn',
  'test-authoring/no-real-timer-sleep': 'warn',
}

export default [
  { ignores: ['tests/helpers/**', 'tests/tooling/**', 'tests/fixtures/**'] },
  {
    files: ['tests/**/*.test.ts'],
    languageOptions: {
      parser: tseslint.parser,
      sourceType: 'module',
      globals: vitest.environments.env.globals,
    },
    plugins: { vitest, '@typescript-eslint': tseslint.plugin, 'test-authoring': testAuthoring },
    rules: {
      ...sharedTestRules,
      'vitest/expect-expect': 'warn',
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
    plugins: { vitest, 'test-authoring': testAuthoring },
    rules: {
      ...sharedTestRules,
      'test-authoring/no-node-disabled-tests': 'error',
      'test-authoring/no-node-identical-title': 'error',
    },
  },
]
