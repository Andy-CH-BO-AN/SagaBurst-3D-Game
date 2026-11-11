'use strict'
// Independent CI step. Runtime contracts are read only here, never by Node unit
// contracts or Vitest; only the pure validator has synthetic unit fixtures.
const fs = require('node:fs')
const { resolve, join } = require('node:path')
const { execFileSync } = require('node:child_process')
const { validateAssets, hash, requireStaticManifestChange } = require('./ci-assets.cjs')
const root = resolve(__dirname, '../..')
function literal(node, ts) {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression, ts)
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return ts.isNumericLiteral(node) ? Number(node.text) : node.text
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return -literal(node.operand, ts)
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(n => literal(n, ts))
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(p => {
    if (!ts.isPropertyAssignment(p) || !p.name || ts.isComputedPropertyName(p.name)) throw Error('Non-literal asset contract')
    return [p.name.text, literal(p.initializer, ts)]
  }))
  throw Error('Non-literal asset contract; review validator integration')
}
function runtimeContracts() {
  const ts = require('typescript')
  const read = file => fs.readFileSync(join(root, file), 'utf8')
  const source = file => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
  const registry = source('src/world/HumanoidAssetRegistry.ts')
  const validator = registry.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'validateHumanoidManifest')
  if (!validator) throw Error('Production humanoid validator missing')
  const exports = {}
  // Only the existing pure function, with TS types removed. Missing future
  // dependencies fail here instead of silently using a weaker copied schema.
  const compiled = ts.transpileModule(validator.getText(registry), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('exports', compiled)(exports)
  const descriptors = {}, shields = {}
  const visit = node => {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(p => ts.isPropertyAssignment(p) && p.name?.text === 'assetId')) {
      const value = literal(node, ts); descriptors[value.assetId] = value
    }
    ts.forEachChild(node, visit)
  }
  for (const file of ['src/world/HumanoidAssetRegistry.ts', 'src/world/HeroAssetCatalog.ts', 'src/world/BanditAsset.ts']) visit(source(file))
  const equipment = source('src/world/HighTierEquipment.ts')
  for (const statement of equipment.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (['HIGH_TIER_WEAPON_ASSETS', 'BYZANTINE_EQUIPMENT_ASSETS'].includes(declaration.name.getText(equipment))) {
        Object.assign(shields, literal(declaration.initializer, ts))
      }
    }
  }
  const colliderSource = source('src/combat/FactionShieldGeometry.ts')
  const colliderDeclaration = colliderSource.statements.find(ts.isVariableStatement)?.declarationList.declarations[0]
  const colliders = literal(colliderDeclaration.initializer, ts)
  let aliases, sockets
  const selectedSource = source('src/world/SelectedHumanoidSource.ts')
  const findMappings = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(selectedSource) === 'MIXAMO_ALIASES') aliases = literal(node.initializer, ts)
    if (ts.isVariableDeclaration(node) && node.name.getText(selectedSource) === 'sockets') sockets = literal(node.initializer, ts)
    ts.forEachChild(node, findMappings)
  }
  findMappings(selectedSource)
  return { descriptors, shields, colliders, aliases, sockets,
    validateHumanoid: (manifest, descriptor) => exports.validateHumanoidManifest(descriptor.faction, manifest, descriptor),
    validateBuilder(file) {
      // Producer scripts may have generated TS outputs, but cannot themselves
      // be consumed by runtime, tests, npm scripts or workflows.
      const scan = dir => fs.readdirSync(join(root, dir), { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? scan(dir + '/' + e.name) : [dir + '/' + e.name])
      for (const consumer of [...scan('src'), ...scan('.github'), 'package.json', ...scan('tests').filter(f => !f.startsWith('tests/tooling/') && !f.startsWith('tests/release/'))]) {
        if (!/\.(?:[cm]?[jt]sx?|json|ya?ml)$/.test(consumer)) continue
        const text = read(consumer), name = file.split('/').at(-1)
        let consumed = false
        if (/\.ya?ml$/.test(consumer)) consumed = text.split('\n').filter(line => !line.trimStart().startsWith('#')).some(line => line.includes(name))
        else {
          const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text)
          for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
            if (scanner.getTokenText().includes(name)) consumed = true
          }
        }
        if (consumed) throw Error('Offline builder has executable consumer: ' + consumer)
      }
      if (file.endsWith('.py')) execFileSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', file], { cwd: root })
      else execFileSync(process.execPath, ['--check', file], { cwd: root })
    },
  }
}
async function run(inputs, evidence) {
  const host = { read(file) {
    const path = resolve(root, file)
    if (!path.startsWith(root + '/') || !fs.lstatSync(path).isFile() || fs.realpathSync(path) !== path) throw Error('Non-regular asset: ' + file)
    return fs.readFileSync(path)
  } }
  const assets = inputs.filter(i => ['asset', 'builder'].includes(i.kind))
  // Known manifests include executable animation timing. Existing timing
  // changes cannot be declared static solely because the path is JSON.
  for (const input of assets.filter(i => i.status === 'M' && i.file.endsWith('/manifest.json'))) {
    const old = JSON.parse(execFileSync('git', ['show', evidence.baseSha + ':' + input.file], { cwd: root, encoding: 'utf8' }))
    const next = JSON.parse(host.read(input.file).toString('utf8'))
    requireStaticManifestChange(old, next)
  }
  const result = assets.length ? validateAssets(assets, host, runtimeContracts()) : { result: 'not-needed', files: [] }
  if (host.glbs?.some(a => a.document.extensionsUsed?.includes('EXT_meshopt_compression'))) {
    const { decodeMeshoptGlb } = await import('../../tools/lib/meshopt-glb.mjs')
    for (const asset of host.glbs) await decodeMeshoptGlb(asset)
  }
  return { ...result, checkoutSha: evidence.checkoutSha, baseSha: evidence.baseSha, headSha: evidence.headSha,
    inputsHash: hash(Buffer.from(JSON.stringify(inputs))), hashes: Object.fromEntries(result.files.map(f => [f, hash(host.read(f))])) }
}
if (require.main === module) (async () => {
  const path = process.argv[2] || 'output/ci-inputs.json'
  const { inputs, evidence } = JSON.parse(fs.readFileSync(resolve(root, path), 'utf8'))
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== evidence.checkoutSha) throw Error('Stale asset checkout')
  let report
  try { report = await run(inputs, evidence) }
  catch (error) { report = { result: 'failed', error: error.message, checkoutSha: evidence.checkoutSha }; throw error }
  finally {
    fs.mkdirSync(join(root, 'output'), { recursive: true })
    fs.writeFileSync(join(root, 'output/asset-validation.json'), JSON.stringify(report, null, 2))
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n### Asset validation\n\n```json\n' + JSON.stringify(report, null, 2) + '\n```\n')
  }
  console.log('Asset validation: ' + report.result + '; checked files: ' + report.files.length)
})().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { run }
