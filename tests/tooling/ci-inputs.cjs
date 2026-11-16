'use strict'
// Classification only. Asset admission still requires the independent validator.
const CHARACTER_ROOT = /^public\/models\/characters\/v2\/([a-z0-9-]+)\/([^/]+)$/
const SHIELD_ROOT = 'public/models/weapons/faction-shields/'
// Mount packages, architecture ornaments and per-file-provenance weapons (paladin, Maki bow).
// v1 holds the schema-2 horse packages (KTX2 maps beside the GLB); v2 the other quadrupeds.
const MOUNT_ROOT = /^public\/models\/mounts\/v[12]\/([a-z0-9-]+)\/((?:textures\/)?[^/]+)$/
const MOUNT_FILES = /^(?:[a-z0-9-]+\.glb|manifest\.json|(?:audit|asset-report|animation-source|bone-map|rig-mapping)\.json|CREDITS\.md|textures\/[a-z0-9-]+\.ktx2)$/
const ORNAMENT_FILE = /^public\/models\/architecture\/(?:[a-z0-9-]+\.glb|(?:ornaments|statues)-sources\.json|SOURCES\.md)$/
const PROVENANCE_WEAPON = /^public\/models\/weapons\/(paladin|maki-ranger-bow)\/(?:[a-z0-9-]+\.(?:glb|json)|ATTRIBUTION\.md)$/
// Audited build measurements are retained package metadata, never runtime inputs.
const CHARACTER_FILES = /^(lod[012]\.glb|manifest\.json|(?:[a-z0-9-]*audit|bone-map|attribution-evidence|animation-donor-manifest|blender-measurements|source-verification)\.json|ATTRIBUTION\.md|[a-z0-9-]+-attribution\.txt|[a-z0-9._-]+\.(?:png|jpe?g|webp))$/
// Reviewed offline entry points; never execute them in CI. Each output names the
// validator family that proves the shipped files it produces. The Python shield
// builders also emit FactionShieldGeometry.ts, checked against shipped metadata.
const builder = (...outputs) => ({ outputs: outputs.map(([family, ...ids]) => ({ family, ids })) })
const BUILDERS = {
  'tools/build-meshy-faction-heroes.mjs': builder(['humanoid', 'roman-centurion-t4', 'roman-hero-t4', 'viking-hero-t4']),
  'tools/build-viking-heavy-heroes.mjs': builder(['humanoid', 'viking-heavy-hero-t4', 'viking-heavy-hero-t5']),
  'tools/build-byzantine-cataphract.mjs': builder(['humanoid', 'byzantine-cataphract-t5']),
  'tools/build-tiered-faction-soldiers.py': builder(['humanoid', 'roman-t1', 'roman-t2', 'viking-t1', 'viking-t2']),
  'tools/build-paladin.py': builder(['humanoid', 'roman-hero-t4'],
    ['provenance-weapon', 'models/weapons/paladin/sword.glb', 'models/weapons/paladin/shield.glb']),
  'tools/build-t4-battle-axe.py': builder(['provenance-weapon', 'models/weapons/paladin/axe.glb']),
  'tools/build-meshy-weapons.py': builder(['provenance-weapon', 'models/weapons/maki-ranger-bow/bow.glb'], ['weapon', 'models/weapons/t5/lance.glb']),
  'tools/build-byzantine-equipment.py': builder(['weapon', 'models/weapons/byzantine/standard-lance.glb'],
    ['shield', 'models/weapons/faction-shields/byzantine-eagle.glb']),
  'tools/build-faction-meshy-equipment.py': builder(['shield', 'models/weapons/high-tier/spear.glb', 'models/weapons/t5/axe.glb',
    'models/weapons/faction-shields/roman-officer.glb', 'models/weapons/faction-shields/viking-berserker.glb']),
  'tools/build-centurion-shield.py': builder(['shield', 'models/weapons/faction-shields/centurion-aquila.glb']),
  'tools/build-dragonward-shield.py': builder(['shield', 'models/weapons/faction-shields/viking-dragonward.glb']),
  'tools/build-town-ornaments.py': builder(['ornament', 'architecture']),
  'tools/build-architecture-statues.py': builder(['ornament', 'architecture']),
}
function assetInput(file) {
  const character = CHARACTER_ROOT.exec(file)
  if (character && CHARACTER_FILES.test(character[2])) return { family: 'humanoid', id: character[1], root: file.slice(0, file.lastIndexOf('/')) }
  const mount = MOUNT_ROOT.exec(file)
  if (mount && MOUNT_FILES.test(mount[2])) return { family: 'mount', id: mount[1], root: file.slice(0, file.length - mount[2].length - 1) }
  if (ORNAMENT_FILE.test(file)) return { family: 'ornament', id: 'architecture', root: 'public/models/architecture' }
  const weapon = PROVENANCE_WEAPON.exec(file)
  if (weapon) return { family: 'provenance-weapon', id: weapon[1], root: 'public/models/weapons/' + weapon[1] }
  if (/^public\/models\/weapons\/(?:faction-shields|high-tier|t5|byzantine)\/[a-z0-9-]+\.glb$/.test(file) ||
      /^public\/models\/weapons\/(?:faction-shields|high-tier|t5|byzantine)\/(?:sources\.json|ATTRIBUTION\.md)$/.test(file)) {
    return { family: file.startsWith(SHIELD_ROOT) ? 'shield' : 'weapon', id: file.slice('public/'.length), root: SHIELD_ROOT.slice(0, -1) }
  }
  return null
}
// Narrow proof for this web entry: exactly one real <style> in <head>, before
// any raw-text/foreign/template content. Everything outside its text is byte exact.
// New CSS resource references and legacy executable CSS are not style-only proof.
function htmlStyleOnly(before, after) {
  const split = text => {
    const match = /<style>([\s\S]*?)<\/style>/i.exec(text)
    if (!match || (text.match(/<\/?style\b/gi) || []).length !== 2) return null
    const prefix = text.slice(0, match.index)
    if (!/<head\s*>/i.test(prefix) || /<!--|<\/?(?:script|template|svg|math|textarea)|<\/head|<title\b/i.test(prefix.replace(/<title>[^<]*<\/title>/gi, ''))) return null
    const outside = prefix + '<style></style>' + text.slice(match.index + match[0].length)
    const css = match[1]
    if (/@import\b|expression\s*\(|(?:^|[;{\s])(?:behavior|-moz-binding)\s*:/i.test(css)) return null
    return { outside, resources: JSON.stringify(css.match(/url\s*\([^)]*\)/gi) || []) }
  }
  const a = split(before), b = split(after)
  return !!a && !!b && a.outside === b.outside && a.resources === b.resources
}
function classifyInputs(changed, { regular, read, docsOnly, safeSpecial }) {
  return changed.map(change => {
    const { file, status } = change
    const item = { ...change, kind: 'unknown', reason: 'Unrecognized input or lifecycle' }
    // A removed model or builder is admitted only through the validator's no-consumer proof.
    if (status === 'D' && !change.oldFile && (file.startsWith('public/models/') || /^tools\/build-/.test(file))) {
      return { ...item, kind: 'retired', reason: 'Removed asset or builder; requires proof that nothing still references it' }
    }
    if (!/^(A|M)$/.test(status) || change.oldFile) return item
    if (safeSpecial?.(change)) return { ...item, kind: 'docs', reason: 'Verified agent-only configuration' }
    if (!regular('head', file) || (status === 'M' && !regular('base', file))) return { ...item, reason: 'Non-regular tracked input' }
    const asset = assetInput(file)
    if (asset) return { ...item, kind: 'asset', reason: 'Family contract and references require asset validation', asset }
    if (BUILDERS[file]) return { ...item, kind: 'builder', reason: 'Reviewed offline producer; syntax, consumers and generated outputs require validation', builder: BUILDERS[file] }
    if (file === 'index.html') return { ...item, kind: status === 'M' && htmlStyleOnly(read('base', file), read('head', file)) ? 'html-style' : 'unknown', reason: 'HTML admits only proven inline style text with unchanged DOM, scripts and resource references' }
    if (/^src\/ui\/[\w/-]+\.css$/.test(file)) return { ...item, kind: 'css', reason: 'Stylesheet; Web build required' }
    if (docsOnly(file)) return { ...item, kind: 'docs', reason: 'Strict documentation policy' }
    if (/^src\/.*\.[cm]?[jt]sx?$/.test(file) || /^tests\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) || /^docs\/releases\/.*\.md$/.test(file) ||
        /^(tests\/(?:tooling|helpers|release)\/|\.github\/workflows\/)/.test(file) ||
        /^(package(?:-lock)?\.json|tsconfig(?:\.[-\w]+)?\.json|vite\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s)$/.test(file)) {
      return { ...item, kind: 'runtime', reason: 'Full logic test suite and runtime policy' }
    }
    return item
  })
}
module.exports = { assetInput, BUILDERS, SHIELD_ROOT, htmlStyleOnly, classifyInputs }
