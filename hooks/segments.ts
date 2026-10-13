// Splits a shell command into the segments the guard inspects.
// Pure: no mods API here.

export type Segment = {
  /** The segment's text, without a leading sudo/env prefix. */
  text: string
  /** The directory a preceding `cd` moved into, relative to the session's cwd. */
  cwd?: string
}

const OPERATORS = ['&&', '||', ';', '|', '\n']

/** Splits on &&, ||, ;, | and newlines outside quotes. */
function splitRaw(command: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      current += ch
      if (ch === quote && command[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    const op = OPERATORS.find((o) => command.startsWith(o, i))
    if (op) {
      out.push(current)
      current = ''
      i += op.length - 1
      continue
    }
    current += ch
  }
  out.push(current)
  return out.map((s) => s.trim()).filter(Boolean)
}

/** Drops a leading `sudo [flags]`, `env`, and `VAR=value` words. */
function stripPrefixes(text: string): string {
  const words = text.split(/\s+/)
  let i = 0
  while (i < words.length) {
    const w = words[i]
    if (w === 'sudo' || w === 'env') {
      i++
      while (i < words.length && words[i].startsWith('-') && words[i - 1] === 'sudo') i++
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      i++
      continue
    }
    break
  }
  return words.slice(i).join(' ')
}

function joinCwd(base: string | undefined, dir: string): string | undefined {
  const clean = dir.replace(/^["']|["']$/g, '')
  if (clean === '' || clean === '~' || clean.startsWith('~/')) return undefined
  if (clean.startsWith('/')) return clean
  return base ? `${base}/${clean}` : clean
}

export function splitSegments(command: string): Segment[] {
  const segments: Segment[] = []
  let cwd: string | undefined
  for (const raw of splitRaw(command)) {
    const text = stripPrefixes(raw)
    const cd = /^cd(?:\s+(\S+))?\s*$/.exec(text)
    if (cd) {
      cwd = cd[1] === undefined ? undefined : joinCwd(cwd, cd[1])
      continue
    }
    if (!text) continue
    segments.push(cwd ? { text, cwd } : { text })
  }
  return segments
}
