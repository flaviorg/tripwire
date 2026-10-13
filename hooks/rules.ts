// The destructive-command rules. Pure: no mods API here.
import { splitSegments, type Segment } from './segments.ts'

export type Severity = 'high' | 'medium'

export type Match = {
  ruleId: string
  label: string
  severity: Severity
  /** Paths the command targets (rm, chmod), if any. */
  paths: string[]
  branch?: string
  remote?: string
  /** The flag letters seen (e.g. "rf", "fd"). */
  flags: string
}

type Hit = Omit<Match, 'ruleId' | 'label' | 'severity'>

export type Rule = {
  id: string
  label: string
  severity: Severity
  test(segment: string): Hit | null
}

function words(segment: string): string[] {
  return segment.split(/\s+/).filter(Boolean)
}

function flagLetters(ws: string[]): string {
  return ws
    .filter((w) => /^-[A-Za-z]+$/.test(w))
    .map((w) => w.slice(1))
    .join('')
}

function positional(ws: string[], skip: number): string[] {
  return ws.slice(skip).filter((w) => !w.startsWith('-'))
}

export const RULES: Rule[] = [
  {
    id: 'rm',
    label: 'Recursive delete',
    severity: 'high',
    test(segment) {
      const ws = words(segment)
      if (ws[0] !== 'rm') return null
      const flags = flagLetters(ws)
      const paths = positional(ws, 1)
      const recursive = /r/i.test(flags) || ws.includes('--recursive')
      const glob = paths.some((p) => p.includes('*'))
      if (!recursive && !glob) return null
      return { paths, flags }
    },
  },
  {
    id: 'git-force-push',
    label: 'Force push',
    severity: 'high',
    test(segment) {
      const ws = words(segment)
      if (ws[0] !== 'git' || ws[1] !== 'push') return null
      const forced = ws.some((w) => w === '-f' || w === '--force' || w.startsWith('--force-with-lease') || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(w))
      if (!forced) return null
      const [remote, branch] = positional(ws, 2)
      return { paths: [], flags: flagLetters(ws), remote: remote ?? 'origin', branch: branch?.split(':')[0] }
    },
  },
  {
    id: 'git-reset-hard',
    label: 'Hard reset',
    severity: 'high',
    test(segment) {
      const ws = words(segment)
      if (ws[0] !== 'git' || ws[1] !== 'reset' || !ws.includes('--hard')) return null
      return { paths: [], flags: '' }
    },
  },
  {
    id: 'git-clean',
    label: 'Git clean',
    severity: 'medium',
    test(segment) {
      const ws = words(segment)
      if (ws[0] !== 'git' || ws[1] !== 'clean') return null
      const flags = flagLetters(ws)
      if (!/f/.test(flags) && !ws.includes('--force')) return null
      if (/n/.test(flags) || ws.includes('--dry-run')) return null
      return { paths: [], flags }
    },
  },
  {
    id: 'git-branch-delete',
    label: 'Force-delete branch',
    severity: 'medium',
    test(segment) {
      const ws = words(segment)
      if (ws[0] !== 'git' || ws[1] !== 'branch') return null
      const forced = ws.includes('-D') || (ws.includes('--delete') && ws.includes('--force')) || (ws.includes('-d') && ws.includes('-f'))
      if (!forced) return null
      const branch = positional(ws, 2)[0]
      return { paths: [], flags: flagLetters(ws), branch }
    },
  },
  {
    id: 'git-checkout-discard',
    label: 'Discard working changes',
    severity: 'high',
    test(segment) {
      const ws = words(segment)
      if (ws[0] !== 'git') return null
      if (ws[1] === 'checkout' && ws[2] === '--' && ws[3] === '.') return { paths: ['.'], flags: '' }
      if (ws[1] === 'restore' && positional(ws, 2).includes('.')) return { paths: ['.'], flags: flagLetters(ws) }
      return null
    },
  },
  {
    id: 'sql-drop',
    label: 'Destructive SQL',
    severity: 'high',
    test(segment) {
      return /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE(\s+TABLE)?)\b/i.test(segment) ? { paths: [], flags: '' } : null
    },
  },
  {
    id: 'chmod-777',
    label: 'World-writable permissions',
    severity: 'medium',
    test(segment) {
      const ws = words(segment)
      if (ws[0] !== 'chmod' || !ws.includes('777')) return null
      return { paths: positional(ws, 1).filter((w) => w !== '777'), flags: flagLetters(ws) }
    },
  },
]

/** Comma-separated regex sources → medium-severity rules. Invalid patterns are skipped. */
export function customRules(patterns: string): Rule[] {
  return patterns
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((source, i) => {
      try {
        const re = new RegExp(source, 'i')
        return [{ id: `custom-${i + 1}`, label: source, severity: 'medium' as const, test: (s: string) => (re.test(s) ? { paths: [], flags: '' } : null) }]
      } catch {
        return []
      }
    })
}

export type FindOptions = { extraPatterns?: string; allowPaths?: string }

function isAllowed(hit: Hit, allow: string[]): boolean {
  if (allow.length === 0 || hit.paths.length === 0) return false
  return hit.paths.every((p) => allow.includes(p.replace(/\/+$/, '').split('/').pop() ?? p))
}

/** The first destructive segment of a command, or null. */
export function findMatch(command: string, options: FindOptions = {}): { match: Match; segment: Segment } | null {
  const rules = [...RULES, ...customRules(options.extraPatterns ?? '')]
  const allow = (options.allowPaths ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  for (const segment of splitSegments(command)) {
    for (const rule of rules) {
      const hit = rule.test(segment.text)
      if (!hit) continue
      if (rule.id === 'rm' && isAllowed(hit, allow)) continue
      return { match: { ruleId: rule.id, label: rule.label, severity: rule.severity, ...hit }, segment }
    }
  }
  return null
}
