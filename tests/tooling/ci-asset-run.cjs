'use strict'
// Independent CI step. Runtime contracts are read only here, never by Node unit
// contracts or Vitest; only the pure validator has synthetic unit fixtures.
const fs = require('node:fs')
const { resolve, join } = require('node:path')
const { execFileSync } = require('node:child_process')
const { validateAssets, hash, runtimeManifestFields } = require('./ci-assets.cjs')
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
  const scan = dir => fs.existsSync(join(root, dir)) ? fs.readdirSync(join(root, dir), { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? scan(dir + '/' + e.name) : [dir + '/' + e.name]) : []
  return { descriptors, shields, colliders, aliases, sockets,
    validateHumanoid: (manifest, descriptor) => exports.validateHumanoidManifest(descriptor.faction, manifest, descriptor),
    validateRetired(file) {
      // A removed model or builder must have no remaining runtime, package, manifest or workflow consumer.
      if (fs.existsSync(join(root, file))) throw Error('Retired input still present: ' + file)
      const name = file.split('/').at(-1), dir = file.slice(0, file.lastIndexOf('/'))
      const publicPath = file.startsWith('public/') ? file.slice('public/'.length) : null
      // A basename alone is evidence only when no surviving public file shares it.
      const sharedName = scan('public').some(f => f.split('/').at(-1) === name)
      const code = [...scan('src'), ...scan('.github'), 'index.html', 'package.json',
        ...scan('tests').filter(f => !f.startsWith('tests/tooling/'))].filter(f => /\.(?:[cm]?[jt]sx?|json|ya?ml|html)$/.test(f))
      const needles = publicPath ? [publicPath, ...(sharedName ? [] : [name])] : [name]
      for (const consumer of code) {
        const text = read(consumer)
        if (needles.some(n => text.includes(n))) throw Error('Retired input still referenced by ' + consumer + ': ' + file)
      }
      // The runtime manifest beside the file names it relatively (e.g. "files", supplemental clips);
      // build/provenance logs may still describe it historically.
      for (const sibling of scan(dir).filter(f => f.endsWith('/manifest.json'))) {
        if (new RegExp('["/]' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(read(sibling))) {
          throw Error('Retired input still referenced by ' + sibling + ': ' + file)
        }
      }
      // GLBs in this package (or its parent, for textures/ maps) may load it by relative URI.
      const parent = dir.slice(0, dir.lastIndexOf('/'))
      for (const glb of [...scan(dir), ...(dir.endsWith('/textures') ? scan(parent) : [])].filter(f => f.endsWith('.glb'))) {
        const bytes = fs.readFileSync(join(root, glb))
        if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF') continue
        const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'))
        const base = glb.slice(0, glb.lastIndexOf('/') + 1)
        const uris = [...(document.images ?? []), ...(document.buffers ?? [])].map(entry => entry.uri).filter(Boolean)
        if (uris.some(uri => base + decodeURIComponent(uri) === file)) throw Error('Retired input still loaded by ' + glb + ': ' + file)
      }
    },
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
  const assets = inputs.filter(i => ['asset', 'builder', 'retired'].includes(i.kind))
  // Known manifests include executable animation timing. Such changes are not
  // static metadata: they are recorded as runtime manifest changes, which this
  // logic gate covers only because every PR and push runs the Full suite, and
  // the dependent build/smoke jobs require this gate.
  const runtimeManifestChanges = []
  for (const input of assets.filter(i => i.status === 'M' && i.file.endsWith('/manifest.json'))) {
    const old = JSON.parse(execFileSync('git', ['show', evidence.baseSha + ':' + input.file], { cwd: root, encoding: 'utf8' }))
    const next = JSON.parse(host.read(input.file).toString('utf8'))
    const fields = runtimeManifestFields(old, next, input.asset?.family)
    if (fields.length) runtimeManifestChanges.push({ file: input.file, fields })
  }
  const result = assets.length ? validateAssets(assets, host, runtimeContracts()) : { result: 'not-needed', files: [] }
  if (host.glbs?.some(a => a.document.extensionsUsed?.includes('EXT_meshopt_compression'))) {
    const { decodeMeshoptGlb } = await import('../../tools/lib/meshopt-glb.mjs')
    for (const asset of host.glbs) await decodeMeshoptGlb(asset)
  }
  return { ...result, runtimeManifestChanges, checkoutSha: evidence.checkoutSha, baseSha: evidence.baseSha, headSha: evidence.headSha,
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
  for (const change of report.runtimeManifestChanges ?? []) console.log('Runtime manifest change (Full logic, build and smoke required): ' + change.file + ' — ' + change.fields.join(', '))
})().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { run }
