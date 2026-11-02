const { existsSync, realpathSync, readFileSync } = require('node:fs')
const { resolve, relative, basename, dirname } = require('node:path')

// A finite effect summary, not a shell executor. Words, substitutions, function
// scopes and redirections are inspected; unsupported syntax retains a frontier.
// Native utilities have argument contracts, separately from script-byte origin.
function shellEffects(script, { env = {}, cwd = '.', repositoryRoot = process.cwd() } = {}) {
  const UNKNOWN = '\u0000', inputs = [], frontiers = [], commands = []
  const fail = (reason, expression) => frontiers.push({ reason, expression })
  let offset = 0
  function tokenize(until) {
    const tokens = []; let word = [], literal = '', quote = null, depth = 0
    let glob = false
    const flushLiteral = () => { if (literal) { word.push({ literal }); literal = '' } }
    const flush = () => { flushLiteral(); if (word.length) { tokens.push({ word, glob }); word = []; glob = false } }
    while (offset < script.length) {
      const ch = script[offset++]
      if (!quote && ch === ')' && until && depth === 0) { flush(); return tokens }
      if (ch === '\\' && quote !== "'") { literal += script[offset++] ?? ''; continue }
      if (quote === "'") { if (ch === "'") quote = null; else literal += ch; continue }
      if (ch === '"') { if (quote === '"') quote = null; else quote = '"'; continue }
      if (!quote && ch === "'") { quote = "'"; continue }
      if (ch === '$') {
        flushLiteral()
        if (script[offset] === '(') {
          offset++; word.push({ substitution: tokenize(')') }); continue
        }
        if (script[offset] === '{') {
          offset++; let expression = '', nesting = 1
          while (offset < script.length && nesting) {
            const next = script[offset++]
            if (next === '{') nesting++
            if (next === '}') nesting--
            if (nesting) expression += next
          }
          if (nesting || expression.includes('$(') || expression.includes('`')) fail('Parameter protocol or substitution is unsupported', expression)
          word.push({ variable: /^[A-Za-z_][\w]*$/.test(expression) ? expression : null, quoted: !!quote }); continue
        }
        const variable = /^(?:[A-Za-z_]\w*|\d+|[?@*#!$-])/.exec(script.slice(offset))
        if (variable) { offset += variable[0].length; word.push({ variable: variable[0], quoted: !!quote }); continue }
        if (script[offset] === "'") {
          offset++; let value = ''
          while (offset < script.length && script[offset] !== "'") value += script[offset++]
          offset++; word.push({ literal: value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\'/g, "'").replace(/\\\\/g, '\\') }); continue
        }
        literal += '$'; continue
      }
      if (ch === '`') { fail('Backtick substitution is unsupported', script.slice(offset - 1, offset + 120)); literal += UNKNOWN; continue }
      if (!quote && /\s/.test(ch)) { flush(); if (ch === '\n') tokens.push({ op: ';' }); continue }
      if (!quote && ch === '#' && !word.length && !literal) { while (offset < script.length && script[offset] !== '\n') offset++; continue }
      if (!quote && ';|&<>(){}'.includes(ch)) {
        flush()
        let op = ch
        if (script[offset] === ch && ['|', '&', '>', '<'].includes(ch)) op += script[offset++]
        if (ch === '(') depth++
        if (ch === ')') depth--
        tokens.push({ op }); continue
      }
      if (!quote && (ch === '*' || ch === '?' || ch === '[' && /^[^\s]*\]/.test(script.slice(offset)))) glob = true
      literal += ch
    }
    flush()
    if (quote || until) fail('Unclosed shell quotation or group', until ?? quote)
    return tokens
  }
  function nativeUtility(name, state) {
    if (!['cat', 'tee'].includes(name)) return null
    const path = state.env.PATH
    if (typeof path !== 'string' || path.includes(UNKNOWN)) return null
    const executable = path.split(':').map(dir => resolve(repositoryRoot, state.cwd, dir || '.', name)).find(existsSync)
    if (!executable) return null
    const canonical = realpathSync(executable)
    if (!['/bin', '/usr/bin'].includes(dirname(canonical))) return null
    let magic
    try { magic = readFileSync(canonical).subarray(0, 4).toString('hex') } catch { return null }
    // Shell/JS wrappers remain unknown. This boundary trusts the platform's
    // installed POSIX binary, like the analyzer's native Node provider contracts.
    if (basename(canonical) !== name || !['7f454c46', 'cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca'].includes(magic)) return null
    return { name, executable: canonical, contract: name === 'cat' ? 'POSIX file operands or stdin' : 'POSIX output operands and stdin' }
  }
  function input(value, kind, state) {
    if (!value || value === '-' || ['/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr'].includes(value)) return
    if (value.includes(UNKNOWN) || /[*?[]/.test(value)) { fail('Shell pathname is not finite', value); return }
    const absolute = resolve(repositoryRoot, state.cwd, value), file = relative(repositoryRoot, absolute).replaceAll('\\', '/')
    if (!file.startsWith('../') && file !== '..') inputs.push({ file, kind, operand: value })
  }
  function wordValue(token, state) {
    if (!token?.word) { fail('Expected a finite shell word', JSON.stringify(token)); return UNKNOWN }
    if (token.glob) fail('Shell glob membership is outside the finite word contract', JSON.stringify(token))
    const assignment = /^[A-Za-z_]\w*=/.test(token.word[0]?.literal ?? '')
    return token.word.map(part => {
      if ('literal' in part) return part.literal
      if (part.substitution) { analyze(part.substitution, { ...state, env: { ...state.env }, functions: new Map(state.functions) }); return UNKNOWN }
      const raw = part.variable == null ? UNKNOWN : state.env[part.variable] ?? ''
      const value = typeof raw === 'string' ? raw : UNKNOWN
      if (value.includes(UNKNOWN) && !part.quoted && !assignment) fail('Unquoted expansion may split or enumerate filenames', part.variable)
      return value
    }).join('')
  }
  function execute(words, state) {
    if (!words.length) return
    let values = words.map(word => wordValue(word, state))
    while (/^[A-Za-z_]\w*=/.test(values[0] ?? '')) {
      const value = values.shift(), split = value.indexOf('='); state.env[value.slice(0, split)] = state.conditional ? UNKNOWN : value.slice(split + 1)
    }
    if (!values.length) return
    const [name, ...args] = values
    if (name.includes(UNKNOWN)) { fail('Shell command identity is unresolved', name); return }
    const fn = state.functions.get(name)
    if (fn) {
      if (state.active.has(fn)) { fail('Recursive shell function effects are unresolved', name); return }
      const environment = { ...state.env }
      args.forEach((arg, i) => { environment[String(i + 1)] = arg })
      environment['@'] = environment['*'] = args.length ? UNKNOWN : ''; environment['#'] = String(args.length)
      analyze(fn, { ...state, env: environment, active: new Set(state.active).add(fn) })
      for (const [key, value] of Object.entries(environment)) if (!/^(?:\d+|[@*#])$/.test(key) && state.env[key] !== value) state.env[key] = UNKNOWN
      return
    }
    if (name === 'export') {
      for (const arg of args) {
        const index = arg.indexOf('=')
        if (index >= 0 && /^[A-Za-z_]\w*$/.test(arg.slice(0, index))) state.env[arg.slice(0, index)] = state.conditional ? UNKNOWN : arg.slice(index + 1)
        else if (!/^[A-Za-z_]\w*$/.test(arg)) fail('Export binding is unresolved', arg)
      }
      return
    }
    if (['echo', ':', 'true', 'false'].includes(name)) return
    if (name === 'printf') {
      if (!args.length || args[0].includes(UNKNOWN) || args[0].startsWith('-') || /%(?:[0-9$.*+-]*n|\()/.test(args[0])) fail('Printf format or variable assignment is unresolved', args[0])
      return
    }
    if (name === 'return' || name === 'exit') {
      if (args.some(arg => !/^\d+$/.test(arg))) fail('Exit operand protocol is unresolved', args.join(' '))
      return
    }
    if (name === 'set') {
      if (args.some(arg => !/^(?:-[euox]+|pipefail)$/.test(arg))) fail('Shell configuration is unresolved', args.join(' '))
      return
    }
    if (name === 'read') {
      if (args.some(arg => arg.startsWith('-') && !['-r'].includes(arg))) fail('Read descriptor or input operation is unresolved', args.join(' '))
      for (const arg of args.filter(arg => !arg.startsWith('-'))) state.env[arg] = UNKNOWN
      if (args.filter(arg => !arg.startsWith('-')).some(arg => !/^[A-Za-z_]\w*$/.test(arg))) fail('Read target may execute an array-subscript protocol', args.join(' '))
      return
    }
    if (name === 'test' || name === '[') {
      const operands = name === '[' && args.at(-1) === ']' ? args.slice(0, -1) : args
      if (operands.length === 2 && ['-n', '-z'].includes(operands[0]) || operands.length === 3 && ['=', '!='].includes(operands[1])) return
      if (operands.length === 2 && ['-f', '-e', '-d', '-s', '-r', '-w', '-x', '-L', '-h'].includes(operands[0])) { input(operands[1], 'metadata', state); return }
      fail('Conditional operand effects are outside the finite contract', operands.join(' ')); return
    }
    const contract = nativeUtility(name, state)
    if (contract) {
      commands.push(contract)
      if (name === 'cat') for (const arg of args) {
        if (arg.startsWith('-') && arg !== '-') fail('Native utility option effects are unresolved', arg)
        else input(arg, 'read', state)
      }
      if (name === 'tee') for (const arg of args) {
        if (arg === '-a' || arg === '--append') continue
        if (arg.startsWith('-')) fail('Native utility option effects are unresolved', arg)
        else input(arg, 'write', state)
      }
      return
    }
    fail('Shell command has no verified function or native effect contract', values.join(' '))
  }
  function analyze(tokens, state) {
    let words = [], conditionalDepth = 0, guarded = false
    const groups = []
    const flush = () => { execute(words, { ...state, conditional: state.conditional || conditionalDepth > 0 || guarded || groups.some(Boolean) }); words = [] }
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]
      const name = token.word?.length === 1 && token.word[0].literal
      if (!words.length && name && tokens[index + 1]?.op === '(' && tokens[index + 2]?.op === ')' && tokens[index + 3]?.op === '{') {
        if (conditionalDepth || guarded || groups.some(Boolean)) fail('Conditional function replacement requires alternative lifetime evidence', name)
        let end = index + 4, depth = 1
        for (; end < tokens.length; end++) { if (tokens[end].op === '{') depth++; if (tokens[end].op === '}' && --depth === 0) break }
        if (depth) { fail('Unclosed shell function', name); return }
        state.functions.set(name, tokens.slice(index + 4, end)); index = end; continue
      }
      if (!words.length && ['if', 'then', 'else', 'fi', '!'].includes(name)) {
        if (name === 'if') conditionalDepth++
        if (name === 'fi') conditionalDepth--
        continue
      }
      if (!words.length && ['for', 'while', 'until', 'case', 'select', 'function', '[['].includes(name)) { fail('Shell control effects are unsupported', name); return }
      if (token.op) {
        if (['>', '>>', '<'].includes(token.op)) {
          input(wordValue(tokens[++index], state), token.op === '<' ? 'read' : 'write', state); continue
        }
        flush()
        if (token.op === '{') groups.push(guarded)
        if (token.op === '}') groups.pop()
        guarded = ['&&', '||'].includes(token.op)
        if (![';', '&&', '||', '|', '{', '}'].includes(token.op)) fail('Shell operator effects are unsupported', token.op)
      } else words.push(token)
    }
    flush()
  }
  const tokens = tokenize()
  if (Object.keys(env).some(key => /^(?:BASH_ENV|ENV|BASH_FUNC_|SHELLOPTS|BASHOPTS|LD_|DYLD_)/.test(key) && env[key])) fail('Shell startup effects are unresolved', 'launch environment')
  const shellEnv = Object.fromEntries(['?', '$', '!', '-', 'RANDOM', 'SECONDS', 'LINENO', 'UID', 'EUID', 'PPID', 'BASHPID', 'BASH_VERSION', '_'].map(key => [key, UNKNOWN]))
  analyze(tokens, { env: { ...shellEnv, '0': 'bash', '@': '', '*': '', '#': '0', PWD: resolve(repositoryRoot, cwd), ...env }, cwd, functions: new Map(), active: new Set() })
  return { inputs, frontiers, commands, complete: frontiers.length === 0 }
}
module.exports = { shellEffects }
