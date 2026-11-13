import tseslint from 'typescript-eslint'
import vitest from '@vitest/eslint-plugin'

const TEST_APIS = new Set(['it', 'test', 'specify'])
const SUITE_APIS = new Set(['describe', 'suite'])
const HEAVY_CONSTRUCTORS = [
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
].join('|')

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
        // Member selectors also catch namespace aliases (e.g. T3.Group). The repository has no renamed named imports from Three.js, so no import-resolution machinery is needed.
        const memberSelector = `NewExpression[callee.type="MemberExpression"][callee.property.name=/^(${HEAVY_CONSTRUCTORS})$/]`
        const directSelector = `NewExpression[callee.type="Identifier"][callee.name=/^(?:${HEAVY_CONSTRUCTORS}|NPC|Player|Mount|TownScene|TownWorld|Game)$/]`
        return {
          [memberSelector](node) { context.report({ node, messageId: 'heavyweight' }) },
          [directSelector](node) { context.report({ node, messageId: 'heavyweight' }) },
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
    rules: sharedTestRules,
  },
]
