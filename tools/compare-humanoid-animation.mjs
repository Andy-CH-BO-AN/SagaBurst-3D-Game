/**
 * Compare two outputs from tools/profile-npc-subphases.mjs.
 *
 * All deltas in the report are calculated here from raw JSON. A phase is only
 * compared when its baseline and candidate alive/dead population matches
 * exactly; otherwise the report says "not directly comparable".
 */

import fs from 'fs'
import path from 'path'

const BASELINE_FILE = process.argv[2] || 'output/profile/humanoid-animation-baseline.json'
const CANDIDATE_FILE = process.argv[3] || 'output/profile/humanoid-animation-results.json'
const OUT_DIR = path.resolve('output/profile')

const BASELINE_GAMEPLAY_SHA = '524c52e051ff28159e4f09102100443dd62718da'
const BASELINE_PROFILING_SHA = 'eb85ed95a399afa3782e973c3df0fd7e5c4dcc59'
const INTERNAL_PHASES = [
  ['Mixer / clip update', 'mixerUpdate'],
  ['Locomotion state', 'locomotionState'],
  ['Procedural pose', 'proceduralPose'],
  ['Equipment state', 'equipmentState'],
  ['Bow / lance pose', 'bowLancePose'],
  ['Rig / bone application', 'rigBoneApplication'],
]

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function statValue(data, metric) {
  const snapshot = data?.snapshot
  if (!snapshot) return null
  if (metric === 'fps') return snapshot.fps
  if (metric === 'cpuFrame') return snapshot.cpuFrame?.avg ?? null
  if (metric === 'npcUpdate') return snapshot.npcUpdate?.avg ?? null
  if (metric === 'humanoidAnim') return data.subphaseSnapshot?.humanoidAnim?.avg ?? null
  if (metric === 'rendererSubmit') return snapshot.renderSubmit?.avg ?? null
  if (metric === 'drawCalls') return data.drawCalls ?? null
  if (metric === 'triangles') return data.triangles ?? null
  const internal = data.subphaseSnapshot?.humanoidBreakdown
  return internal?.[metric]?.avg ?? null
}

function population(data) {
  return { alive: data?.alive ?? null, dead: data?.dead ?? null }
}

function samePopulation(left, right) {
  return left.alive === right.alive && left.dead === right.dead
}

function metricDelta(baseline, candidate, comparable) {
  if (!comparable || baseline == null || candidate == null) {
    return { baseline, candidate, delta: null, percent: null, status: 'not directly comparable' }
  }
  const delta = candidate - baseline
  return {
    baseline,
    candidate,
    delta,
    percent: baseline === 0 ? null : (delta / baseline) * 100,
    status: 'comparable',
  }
}

function fmt(value) {
  return value == null ? '--' : value.toFixed(2)
}

function fmtDelta(result) {
  if (result.status !== 'comparable') return 'not directly comparable'
  const direction = result.delta > 0 ? '+' : ''
  const pct = result.percent == null ? '--' : `${result.percent > 0 ? '+' : ''}${result.percent.toFixed(1)}%`
  return `${direction}${result.delta.toFixed(2)} (${pct})`
}

function main() {
  const baseline = readJson(BASELINE_FILE)
  const candidate = readJson(CANDIDATE_FILE)
  const scenarios = ['b', 'd', 'e']
  const phases = [
    ['Before Contact', 'beforeContact'],
    ['During Combat', 'duringCombat'],
  ]
  const metrics = [
    ['FPS', 'fps'],
    ['CPU Frame avg (ms)', 'cpuFrame'],
    ['NPC Update avg (ms)', 'npcUpdate'],
    ['Humanoid Animation avg (ms)', 'humanoidAnim'],
    ...INTERNAL_PHASES.map(([label, key]) => [`Humanoid: ${label} (ms)`, key]),
    ['Renderer Submit avg (ms)', 'rendererSubmit'],
    ['Draw Calls', 'drawCalls'],
    ['Triangles', 'triangles'],
  ]

  const comparisons = []
  for (const scenario of scenarios) {
    for (const [phaseLabel, phaseKey] of phases) {
      const bData = baseline.results?.[scenario]?.on?.[phaseKey]
      const cData = candidate.results?.[scenario]?.on?.[phaseKey]
      const bPopulation = population(bData)
      const cPopulation = population(cData)
      const comparable = samePopulation(bPopulation, cPopulation)
      const row = {
        scenario,
        phase: phaseKey,
        phaseLabel,
        baselinePopulation: bPopulation,
        candidatePopulation: cPopulation,
        comparable,
        metrics: {},
      }
      for (const [, metric] of metrics) {
        row.metrics[metric] = metricDelta(statValue(bData, metric), statValue(cData, metric), comparable)
      }
      comparisons.push(row)
    }
  }

  const metadata = {
    baselineGameplaySha: BASELINE_GAMEPLAY_SHA,
    baselineProfilingSha: BASELINE_PROFILING_SHA,
    baselineSourceFile: path.resolve(BASELINE_FILE),
    candidateSourceSha: candidate.metadata?.sourceSha ?? 'unknown',
    candidateSourceFile: path.resolve(CANDIDATE_FILE),
    comparisonRule: 'exact alive/dead population match; otherwise not directly comparable',
    cohort: 8,
    reportingWindowMs: 1000,
  }
  const output = { metadata, comparisons }

  const lines = []
  lines.push('# Humanoid Animation Baseline vs Candidate')
  lines.push('')
  lines.push(`- Gameplay baseline SHA (#45): \`${metadata.baselineGameplaySha}\``)
  lines.push(`- Profiling baseline SHA (#46): \`${metadata.baselineProfilingSha}\``)
  lines.push(`- Candidate source SHA: \`${metadata.candidateSourceSha}\``)
  lines.push('- Cohort: deterministic 8-frame / 8-NPC slices; no manual /8.')
  lines.push('- Windows: RuntimeProfiler-aligned ~1 second; Before Contact uses live simulation.')
  lines.push('- Comparison rule: exact alive/dead match only; mismatches are reported without a delta.')
  lines.push('')

  for (const row of comparisons) {
    const title = `${row.scenario.toUpperCase()} ${row.phaseLabel}`
    const bPop = `${row.baselinePopulation.alive}/${row.baselinePopulation.dead}`
    const cPop = `${row.candidatePopulation.alive}/${row.candidatePopulation.dead}`
    lines.push(`## ${title}`)
    lines.push('')
    lines.push(`Population baseline/candidate: ${bPop} / ${cPop} — ${row.comparable ? 'comparable' : 'not directly comparable'}`)
    lines.push('')
    lines.push('| Metric | Baseline | Candidate | Candidate - Baseline |')
    lines.push('| :--- | ---: | ---: | :--- |')
    for (const [label, metric] of metrics) {
      const result = row.metrics[metric]
      lines.push(`| ${label} | ${fmt(result.baseline)} | ${fmt(result.candidate)} | ${fmtDelta(result)} |`)
    }
    lines.push('')
  }

  lines.push('## Machine-readable comparison')
  lines.push('')
  lines.push('The JSON next to this report contains every raw value and calculated delta; no numbers in this report were manually selected or recomputed.')

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const jsonPath = path.join(OUT_DIR, 'humanoid-animation-ab-results.json')
  const mdPath = path.join(OUT_DIR, 'humanoid-animation-ab-table.md')
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2))
  fs.writeFileSync(mdPath, lines.join('\n'))
  console.log(`JSON → ${jsonPath}`)
  console.log(`MD   → ${mdPath}`)
  console.log(lines.join('\n'))
}

main()
