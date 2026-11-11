'use strict'
// Classification only. Asset admission still requires the independent validator.
const CHARACTER_ROOT = /^public\/models\/characters\/v2\/([a-z0-9-]+)\/([^/]+)$/
const SHIELD_ROOT = 'public/models/weapons/faction-shields/'
const CHARACTER_FILES = /^(lod[012]\.glb|manifest\.json|(?:[a-z0-9-]*audit|bone-map|attribution-evidence|animation-donor-manifest)\.json|ATTRIBUTION\.md|[a-z0-9-]+-attribution\.txt|[a-z0-9._-]+\.(?:png|jpe?g|webp))$/
// Reviewed offline entry points; never execute them in CI. The Python shield
// builders also emit FactionShieldGeometry.ts, checked against shipped metadata.
const BUILDERS = {
  'tools/build-meshy-faction-heroes.mjs': { family: 'humanoid', ids: ['roman-centurion-t4', 'roman-hero-t4', 'viking-hero-t4'] },
  'tools/build-viking-heavy-heroes.mjs': { family: 'humanoid', ids: ['viking-heavy-hero-t4', 'viking-heavy-hero-t5'] },
  'tools/build-centurion-shield.py': { family: 'shield', ids: ['models/weapons/faction-shields/centurion-aquila.glb'] },
  'tools/build-dragonward-shield.py': { family: 'shield', ids: ['models/weapons/faction-shields/viking-dragonward.glb'] },
}
function assetInput(file) {
  const character = CHARACTER_ROOT.exec(file)
  if (character && CHARACTER_FILES.test(character[2])) return { family: 'humanoid', id: character[1], root: file.slice(0, file.lastIndexOf('/')) }
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
      return { ...item, kind: 'runtime', reason: 'Supercov native Related and direct test-file policy' }
    }
    return item
  })
}
module.exports = { assetInput, BUILDERS, SHIELD_ROOT, htmlStyleOnly, classifyInputs }
