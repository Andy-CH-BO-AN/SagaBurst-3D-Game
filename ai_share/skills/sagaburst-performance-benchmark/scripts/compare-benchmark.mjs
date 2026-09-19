import fs from 'node:fs'
import path from 'node:path'

const valueOf = (name) => {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}
const baselinePath = valueOf('baseline')
const candidatePath = valueOf('candidate')
const scenario = (valueOf('scenario') ?? 'D').toUpperCase()
if (!baselinePath || !candidatePath) {
  throw new Error('需要 --baseline=PATH 與 --candidate=PATH')
}

const read = (file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
const baseline = read(baselinePath)
const candidate = read(candidatePath)
const findMedian = (report) => {
  const rows = report.rows.filter((row) => row.scenario === scenario && row.status === 'ok')
  if (rows.length === 0) throw new Error(`${report.tag} 沒有成功的 ${scenario} run`)
  const keys = Object.keys(rows[0].metrics)
  return Object.fromEntries(keys.map((key) => [
    key,
    median(rows.map((row) => row.metrics[key]).filter((value) => typeof value === 'number')),
  ]))
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}
const delta = (base, next) => {
  if (typeof base !== 'number' || typeof next !== 'number') {
    return { baseline: base ?? null, candidate: next ?? null, delta: null, percent: null }
  }
  return {
    baseline: base,
    candidate: next,
    delta: next - base,
    percent: base === 0 ? null : ((next - base) / base) * 100,
  }
}

const base = findMedian(baseline)
const next = findMedian(candidate)
const metricKeys = [
  ['FPS', 'fps'],
  ['CPU Frame', 'cpuFrameMs'],
  ['NPC Update', 'npcUpdateMs'],
  ['Mount Update', 'mountUpdatePhaseMs'],
  ['最大 Mount subphase', 'maxMountSubphase'],
  ['Renderer Submit', 'renderSubmitMs'],
]
const report = {
  generatedAt: new Date().toISOString(),
  scenario,
  baseline: { tag: baseline.tag, source: path.resolve(baselinePath) },
  candidate: { tag: candidate.tag, source: path.resolve(candidatePath) },
  rows: metricKeys.map(([metric, key]) => ({ metric, ...delta(base[key], next[key]) })),
}
const outputPath = path.resolve(valueOf('out') ?? `output/local-diagnostics/mount-ab-comparison-${scenario}.json`)
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ outputPath, ...report }, null, 2))
