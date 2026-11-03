/**
 * Bash cut into the tokens a terminal colours (term.ts).
 * A highlighter, not a parser: it knows words, quotes, expansions,
 * operators, comments and heredocs, which is enough to color what an agent
 * or a solution script runs.
 */
export type Kind = 'cmd' | 'kw' | 'str' | 'var' | 'flag' | 'op' | 'com' | 'text'

const KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'select', 'in', 'do', 'done', 'while', 'until',
  'case', 'esac', 'function', 'return', 'break', 'continue', 'time', '!',
])
// Keywords after which the next word is a command again.
const LEADS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', 'time', '!'])
// Operators after which the next word is a command.
const SEPARATORS = new Set(['|', '||', '&&', ';', ';;', '&', '(', '{', '`'])
const OPERATOR = /^(?:\d?>>|\d?>&\d|&>|\d?>|<|\|\||\||&&|;;|;|&|\(|\)|`)/
const WORD = /^[^\s|&;<>()"'`$\\]+/

export function tokens(source: string): [Kind, string][] {
  const out: [Kind, string][] = []
  const push = (kind: Kind, text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last[0] === kind) last[1] += text
    else out.push([kind, text])
  }
  // A `$name`, `${...}` or `$(` at `at`, pushed; where scanning goes on.
  const expansion = (at: number): number => {
    const sub = /^\$\(\(?/.exec(source.slice(at))
    if (sub) {
      push('var', sub[0])
      command = true
      return at + sub[0].length
    }
    const braced = /^\$\{[^}\n]*\}?/.exec(source.slice(at))
    if (braced) {
      push('var', braced[0])
      return at + braced[0].length
    }
    const named = /^\$(?:[A-Za-z_]\w*|[0-9?#@*$!-])/.exec(source.slice(at))
    push(named ? 'var' : 'text', named ? named[0] : '$')
    return at + (named ? named[0].length : 1)
  }
  let i = 0
  let command = true
  let expectIn = false
  const heredocs: string[] = []
  while (i < source.length) {
    const c = source[i]
    const rest = source.slice(i)
    if (c === '\n') {
      push('text', c)
      i++
      command = true
      // A heredoc's body, every line up to its terminator, is a string.
      while (heredocs.length && i < source.length) {
        const end = source.indexOf('\n', i)
        const line = source.slice(i, end < 0 ? undefined : end)
        const done = line.trim() === heredocs[0]
        push(done ? 'op' : 'str', line)
        if (done) heredocs.shift()
        if (end < 0) i = source.length
        else {
          push('text', '\n')
          i = end + 1
        }
      }
      continue
    }
    if (c === ' ' || c === '\t') {
      push('text', c)
      i++
    } else if (c === '\\') {
      push('text', source.slice(i, i + 2))
      i += 2
    } else if (c === '#' && (i === 0 || /\s/.test(source[i - 1]))) {
      const end = source.indexOf('\n', i)
      push('com', source.slice(i, end < 0 ? undefined : end))
      i = end < 0 ? source.length : end
    } else if (c === "'") {
      const end = source.indexOf("'", i + 1)
      push('str', source.slice(i, end < 0 ? undefined : end + 1))
      i = end < 0 ? source.length : end + 1
      command = false
    } else if (c === '"') {
      push('str', c)
      i++
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') {
          push('str', source.slice(i, i + 2))
          i += 2
        } else if (source[i] === '$') i = expansion(i)
        else {
          push('str', source[i])
          i++
        }
      }
      push('str', source.slice(i, i + 1))
      i++
      command = false
    } else if (c === '$') {
      i = expansion(i)
    } else if (rest.startsWith('<<') && !rest.startsWith('<<<')) {
      const heredoc = /^<<-?\s*(['"]?)([\w.-]+)\1/.exec(rest)
      const text = heredoc ? heredoc[0] : '<<'
      if (heredoc) heredocs.push(heredoc[2])
      push('op', text)
      i += text.length
    } else if (OPERATOR.test(rest)) {
      const op = OPERATOR.exec(rest)![0]
      push('op', op)
      i += op.length
      if (SEPARATORS.has(op)) command = true
    } else {
      const word = WORD.exec(rest)?.[0] ?? c
      i += word.length
      const assignment = /^([A-Za-z_]\w*)=/.exec(word)
      if (command && (word === '{' || word === '}')) push('op', word)
      else if (command && assignment) {
        push('var', assignment[1])
        push('op', '=')
        push('text', word.slice(assignment[0].length))
      } else if (command || (expectIn && word === 'in')) {
        const keyword = KEYWORDS.has(word)
        push(keyword ? 'kw' : 'cmd', word)
        command = keyword && LEADS.has(word)
        expectIn = word === 'for' || word === 'select' || word === 'case'
      } else push(word.startsWith('-') ? 'flag' : 'text', word)
    }
  }
  return out
}
