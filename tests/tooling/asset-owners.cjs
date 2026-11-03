const { posix } = require('node:path')
const { dependencyChain } = require('./dependencies.cjs')

// Offline pixels/skin are audited in the builder/browser, not loaded by logic
// tests. These are the existing production loader/action/collision contracts,
// shared by every delivery in the corresponding runtime asset family.
const families = [
  { root: 'public/models/characters/v2', owners: ['tests/assets/HumanoidAssetPreload.test.ts', 'tests/combat/CommanderWeaponSwitching.test.ts'] },
  { root: 'public/models/weapons', owners: ['tests/combat/CommanderWeaponSwitching.test.ts', 'tests/combat/CombatAttribution.test.ts'] },
]

function assetOwnerTests(file, inventory, tree = {}, runtimeGraph = new Map()) {
  const available = new Set(inventory.map(item => item.file))
  const matched = new Set(families.filter(family => file.startsWith(family.root + '/')))
  if (file.startsWith('tools/') && tree.texts) {
    const graph = new Map(runtimeGraph)
    const builders = []
    for (const [entry, source] of tree.texts) {
      if (!/^tools\/.*\.(?:[cm]?js|py)$/.test(entry)) continue
      const deps = new Set(graph.get(entry) ?? [])
      // Literal subprocess operands supplement normal JS imports. Python's
      // with_name is the existing local-helper loading boundary. Do not guess
      // computed paths or relate every file in the tools directory.
      for (const match of source.matchAll(/['"`](tools\/[\w./-]+\.(?:[cm]?js|py))['"`]/g)) {
        if (tree.files?.has(match[1])) deps.add(match[1])
      }
      for (const match of source.matchAll(/\.with_name\(['"]([\w.-]+\.py)['"]\)/g)) {
        const target = posix.join(posix.dirname(entry), match[1])
        if (tree.files?.has(target)) deps.add(target)
      }
      graph.set(entry, [...deps])
      // Only a literal published output directory establishes a family. An
      // unrelated or unresolved tool remains unmapped and fails closed.
      const roots = families.filter(family => new RegExp('[\'"`]' + family.root + '(?:/|[\'"`])').test(source))
      if (roots.length) builders.push({ entry, roots })
    }
    for (const builder of builders) if (dependencyChain(graph, builder.entry, file)) {
      for (const family of builder.roots) matched.add(family)
    }
  }
  return new Set([...matched].flatMap(family => family.owners).filter(owner => available.has(owner)))
}

module.exports = { assetOwnerTests }
