import type { ITheme } from '@xterm/xterm'
import type { Line } from './api.ts'
import { tokens, type Kind } from './bash.ts'

/**
 * A trial's terminal, written as xterm.js text: each history line as bash
 * echoes it typed (`$ `, its code in the website's syntax colours, a row
 * that goes on with it behind `> `), then what it wrote and a nonzero exit.
 * The colours are styles.css's tokens over the terminal's surface.
 */

const SURFACE = '#faf8f2'
const INK = '#3a3a38'

export const THEME: ITheme = {
  background: SURFACE,
  foreground: INK,
  cursor: '#0a0a0a',
  cursorAccent: SURFACE,
  selectionBackground: 'rgba(201, 160, 62, 0.3)',
}

const COLOURS: Record<Kind, string> = {
  cmd: '#8250df',
  kw: '#0550ae',
  str: '#0a3069',
  var: '#953800',
  flag: INK,
  op: '#8e8d8a',
  com: '#a6a5a1',
  text: INK,
}

const RESET = '\x1b[0m'

function paint(hex: string, text: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return `\x1b[38;2;${r};${g};${b}m${text}${RESET}`
}

export const PROMPT = paint('#047857', '$ ')
const MORE = paint('#8e8d8a', '> ')

/** What a terminal shows of a line's command: its code, less comments and blank lines. */
export function code(command: string): string {
  return command
    .split('\n')
    .filter((l) => l.trim() && !/^\s*#/.test(l))
    .join('\n')
}

/** A command's code a character at a time, each in its colour, as a replay types it. */
export function typed(command: string): string[] {
  const out: string[] = []
  for (const [kind, part] of tokens(code(command)))
    for (const char of part) out.push(char === '\n' ? `\n${MORE}` : paint(COLOURS[kind], char))
  return out
}

/** What a finished line wrote, then a nonzero exit, each ending its row. */
export function output(line: Line): string {
  const ended = (text: string) => (text.endsWith('\n') ? text : `${text}\n`)
  return (
    (line.stdout ? paint('#464544', ended(line.stdout)) : '') +
    (line.stderr ? paint('#b91c1c', ended(line.stderr)) : '') +
    (line.exit !== null && line.exit !== 0 ? paint('#b91c1c', `exit ${line.exit}\n`) : '')
  )
}

/** What a live terminal wrote: its first prompt, and each line by when it started and what it ran, typed or ended. */
export interface Written {
  prompted: boolean
  lines: Map<string, 'typed' | 'ended'>
}

export function unwritten(): Written {
  return { prompted: false, lines: new Map() }
}

/**
 * What a live terminal writes of `lines` since it last looked: its prompt
 * once, each new line typed, and a line's output and the next prompt once
 * it ends.
 */
export function next(lines: Line[], written: Written): string {
  let text = written.prompted ? '' : PROMPT
  written.prompted = true
  for (const line of lines) {
    const key = `${line.at} ${line.command}`
    const was = written.lines.get(key)
    if (was === undefined) text += typed(line.command).join('') + '\n'
    if (line.exit !== null && was !== 'ended') {
      text += output(line) + PROMPT
      written.lines.set(key, 'ended')
    } else if (was === undefined) written.lines.set(key, 'typed')
  }
  return text
}

/**
 * A replay plays a trial's lines on their own clock, from what Mirage
 * recorded, without running anything: the wait before each line (the agent
 * thinking) and its run, each cut to a cap, its command typed out.
 */
export const REPLAY = { first: 300, idle: 1200, run: 1500, perChar: 12, type: 900 }

export interface Beat {
  line: Line
  /** When, in ms from the replay's start, the line starts, is typed out and ends. */
  start: number
  typed: number
  done: number
}

export function beats(lines: Line[]): Beat[] {
  let t = 0
  let ended: number | null = null
  return lines.map((line) => {
    const start = t + (ended === null ? REPLAY.first : Math.min(Math.max(line.at - ended, 0), REPLAY.idle))
    const done = start + Math.min(code(line.command).length * REPLAY.perChar, REPLAY.type)
    t = done + Math.min(line.ms ?? 0, REPLAY.run)
    ended = line.at + (line.ms ?? 0)
    return { line, start, typed: done, done: t }
  })
}
