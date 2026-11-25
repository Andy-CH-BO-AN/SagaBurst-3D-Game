'use strict'
// Fails CI when AI-facing markdown points at files that no longer exist. Scans CLAUDE.md,
// tests/AGENTS.md and every *.md under ai_share/, .agents/ and .codex/ (symlinked directories are
// followed; each real file is checked once). Fenced code blocks are ignored. Two checks:
//   A. markdown links `[text](target)` to relative paths, resolved from the file's directory
//      (a leading `/` means repository root);
//   B. inline-code repository paths such as `src/foo.ts:12` rooted at a known top-level directory.
// Output: one `file:line: <kind> <target>` line per problem, then a summary. Exit 1 on any problem.
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const EXPLICIT_FILES = ['CLAUDE.md', 'tests/AGENTS.md']
const SCAN_DIRS = ['ai_share', '.agents', '.codex']
const SKIP_DIRS = new Set(['node_modules'])
const REPO_PREFIXES = ['src/', 'tools/', 'tests/', 'public/', 'electron/', 'docs/', 'ai_share/', '.github/']
// Paths that docs intentionally describe before they exist (created lazily by a skill on first use).
const LAZY_PATHS = new Set(['docs/adr'])
// Patterns and placeholders in inline code, e.g. `src/*.ts`, `src/{a,b}`, `tests/<name>`, `docs/...`.
const NOT_A_PATH = /[*{}<>|\s]|\.\.\.|…/
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const INLINE_CODE = /`([^`\n]+)`/g
const LINK = /\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

const toRel = abs => path.relative(ROOT, abs).split(path.sep).join('/')

/** Blank out inline code spans so link syntax inside them is not checked; keeps column layout. */
function maskInlineCode(line) {
  return line.replace(INLINE_CODE, span => ' '.repeat(span.length))
}

/** Strip trailing `/ : , . )` and `:<line>[:<col>]` suffixes from an inline-code path. */
function normalizeCodePath(content) {
  let p = content
  let prev
  do {
    prev = p
    p = p.replace(/:\d+(?::\d+)?$/, '').replace(/[/:,.)]+$/, '')
  } while (p !== prev)
  return p
}

/** Problems in one markdown file's text: `{ line, kind, target }`. `root` is the repository root. */
function checkText(text, fileDir, root = ROOT) {
  const problems = []
  let fence = null
  let links = 0
  let paths = 0
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1
    const fenceMatch = FENCE.exec(raw)
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && raw.trim() === fenceMatch[1]) fence = null
      return
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      return
    }
    for (const m of maskInlineCode(raw).matchAll(LINK)) {
      const target = m[2]
      if (target.startsWith('#') || SCHEME.test(target)) continue
      const bare = target.replace(/[#?].*$/, '')
      if (!bare) continue
      links++
      let decoded = bare
      try { decoded = decodeURI(bare) } catch { /* keep the raw target */ }
      const resolved = decoded.startsWith('/') ? path.join(root, decoded) : path.resolve(fileDir, decoded)
      if (!fs.existsSync(resolved)) problems.push({ line, kind: 'broken-link', target })
    }
    for (const m of raw.matchAll(INLINE_CODE)) {
      const content = m[1]
      if (!REPO_PREFIXES.some(prefix => content.startsWith(prefix))) continue
      if (NOT_A_PATH.test(content)) continue
      const target = normalizeCodePath(content)
      if (!target || LAZY_PATHS.has(target)) continue
      paths++
      if (!fs.existsSync(path.join(root, target))) problems.push({ line, kind: 'missing-path', target })
    }
  })
  return { problems, links, paths }
}

/** Markdown files to scan, as absolute paths, each real file once. Broken `*.md` symlinks are returned separately. */
function collectFiles(root = ROOT) {
  const files = []
  const broken = []
  const seenDirs = new Set()
  const seenFiles = new Set()

  function addFile(abs) {
    const real = fs.realpathSync(abs)
    if (seenFiles.has(real)) return
    seenFiles.add(real)
    files.push(abs)
  }

  function walk(dir) {
    const real = fs.realpathSync(dir)
    if (seenDirs.has(real)) return
    seenDirs.add(real)
    for (const name of fs.readdirSync(dir).sort()) {
      if (SKIP_DIRS.has(name)) continue
      const abs = path.join(dir, name)
      let stat
      try {
        stat = fs.statSync(abs)
      } catch {
        if (name.endsWith('.md') && fs.lstatSync(abs).isSymbolicLink()) broken.push(abs)
        continue
      }
      if (stat.isDirectory()) walk(abs)
      else if (stat.isFile() && name.endsWith('.md')) addFile(abs)
    }
  }

  for (const rel of EXPLICIT_FILES) {
    const abs = path.join(root, rel)
    if (fs.existsSync(abs)) addFile(abs)
  }
  for (const rel of SCAN_DIRS) {
    const abs = path.join(root, rel)
    if (fs.existsSync(abs)) walk(abs)
  }
  return { files, broken }
}

function main() {
  const { files, broken } = collectFiles()
  const found = broken.map(abs => ({ file: toRel(abs), line: 1, kind: 'broken-symlink', target: fs.readlinkSync(abs) }))
  let links = 0
  let paths = 0
  for (const abs of files) {
    const result = checkText(fs.readFileSync(abs, 'utf8'), path.dirname(abs))
    links += result.links
    paths += result.paths
    for (const p of result.problems) found.push({ file: toRel(abs), ...p })
  }
  if (!found.length) {
    console.log(`lint-doc-links: OK. ${files.length} file(s), ${links} link(s), ${paths} repo path(s) checked.`)
    return
  }
  for (const { file, line, kind, target } of found) console.error(`${file}:${line}: ${kind} ${target}`)
  const docs = new Set(found.map(f => f.file)).size
  console.error(`lint-doc-links: ${found.length} broken reference(s) in ${docs} file(s) (${files.length} file(s) scanned).`)
  process.exitCode = 1
}

if (require.main === module) main()

module.exports = { checkText, collectFiles, normalizeCodePath, maskInlineCode }
