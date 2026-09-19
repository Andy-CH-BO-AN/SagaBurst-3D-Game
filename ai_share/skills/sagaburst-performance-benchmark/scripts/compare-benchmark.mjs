import fs from 'node:fs'
import path from 'node:path'

const valueOf = (name) => {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

const normalPath = valueOf('normal')
const noShadowPath = valueOf('no-shadow')
const halfResPath = valueOf('half-resolution')
const simpleMatPath = valueOf('simple-material')

const baselinePath = valueOf('baseline')
const candidatePath = valueOf('candidate')
const scenario = (valueOf('scenario') ?? 'F').toUpperCase()

const read = (file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

const findMedian = (report, sc = scenario) => {
  const rows = report.rows.filter((row) => (row.scenario === sc || !row.scenario) && row.status === 'ok')
  if (rows.length === 0) throw new Error(`${report.tag ?? 'report'} 沒有成功的 ${sc} run`)
  const keys = Object.keys(rows[0].metrics)
  return Object.fromEntries(keys.map((key) => [
    key,
    median(rows.map((row) => row.metrics[key]).filter((value) => typeof value === 'number')),
  ]))
}

// ── Multi-probe Renderer Cost Isolation Mode ──
if (normalPath || noShadowPath || halfResPath || simpleMatPath) {
  const probeConfigs = [
    { label: 'Normal', path: normalPath, key: 'normal' },
    { label: 'Shadow OFF', path: noShadowPath, key: 'no-shadow' },
    { label: 'Half Resolution', path: halfResPath, key: 'half-resolution' },
    { label: 'Simple Material', path: simpleMatPath, key: 'simple-material' },
  ].filter((p) => Boolean(p.path))

  const probeResults = probeConfigs.map((probe) => {
    const data = read(probe.path)
    const metrics = findMedian(data)
    return {
      probe: probe.label,
      key: probe.key,
      file: path.resolve(probe.path),
      tag: data.tag,
      metrics,
    }
  })

  const normalMetrics = probeResults.find((p) => p.key === 'normal')?.metrics

  const tableRows = probeResults.map((p) => {
    const m = p.metrics
    const submit = m.renderSubmitMs
    let submitDeltaStr = '--'
    if (typeof submit === 'number' && typeof normalMetrics?.renderSubmitMs === 'number') {
      const diff = submit - normalMetrics.renderSubmitMs
      const pct = normalMetrics.renderSubmitMs > 0 ? (diff / normalMetrics.renderSubmitMs) * 100 : 0
      submitDeltaStr = diff === 0 ? 'baseline' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)}ms (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`
    }
    return {
      Probe: p.probe,
      FPS: typeof m.fps === 'number' ? m.fps.toFixed(1) : '--',
      'CPU Frame': typeof m.cpuFrameMs === 'number' ? `${m.cpuFrameMs.toFixed(1)}ms` : '--',
      'Renderer Submit': typeof m.renderSubmitMs === 'number' ? `${m.renderSubmitMs.toFixed(1)}ms` : '--',
      'Submit Delta': submitDeltaStr,
      'Main Calls': typeof m.drawCalls === 'number' ? Math.round(m.drawCalls) : '--',
      Triangles: typeof m.triangles === 'number' ? Math.round(m.triangles) : '--',
      'Alive/Dead': m.alive !== undefined && m.dead !== undefined ? `${Math.round(m.alive)}/${Math.round(m.dead)}` : '--',
      'Active Attack': typeof m.activeAttack === 'number' ? Math.round(m.activeAttack) : '--',
      Arrows: typeof m.arrowCount === 'number' ? Math.round(m.arrowCount) : '--',
    }
  })

  // Format Markdown table
  const headers = ['Probe', 'FPS', 'CPU Frame', 'Renderer Submit', 'Submit Delta', 'Main Calls', 'Triangles', 'Alive/Dead', 'Active Attack', 'Arrows']
  const colWidths = headers.map((h) => Math.max(h.length, ...tableRows.map((r) => String(r[h] ?? '').length)))

  const formatLine = (items) => '| ' + items.map((item, i) => String(item).padEnd(colWidths[i])).join(' | ') + ' |'
  const separatorLine = '| ' + headers.map((h, i) => (h === 'Probe' ? ':---'.padEnd(colWidths[i], '-') : '---:'.padStart(colWidths[i], '-'))).join(' | ') + ' |'

  const mdTable = [
    formatLine(headers),
    separatorLine,
    ...tableRows.map((r) => formatLine(headers.map((h) => r[h]))),
  ].join('\n')

  const report = {
    generatedAt: new Date().toISOString(),
    scenario,
    mode: 'renderer-cost-isolation',
    probes: probeResults,
    tableRows,
  }

  const outputPath = path.resolve(valueOf('out') ?? `output/local-diagnostics/renderer-isolation-comparison-${scenario}.json`)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)

  console.log('\n### Renderer Cost Isolation Comparison — Scenario ' + scenario + '\n')
  console.log(mdTable)
  console.log('\nJSON saved to: ' + outputPath + '\n')
  process.exit(0)
}

// ── Standard 2-run Baseline vs Candidate Comparison ──
if (!baselinePath || !candidatePath) {
  throw new Error('需要 --baseline=PATH 與 --candidate=PATH，或使用 --normal=... --no-shadow=... 等 probe 參數')
}

const baseline = read(baselinePath)
const candidate = read(candidatePath)

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

const base = findMedian(baseline, scenario)
const next = findMedian(candidate, scenario)
const metricKeys = [
  ['FPS', 'fps'],
  ['CPU Frame', 'cpuFrameMs'],
  ['NPC Update', 'npcUpdateMs'],
  ['Mount Update', 'mountUpdatePhaseMs'],
  ['最大 Mount subphase', 'maxMountSubphase'],
  ['Renderer Submit', 'renderSubmitMs'],
  ['Draw Calls', 'drawCalls'],
  ['Triangles', 'triangles'],
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
