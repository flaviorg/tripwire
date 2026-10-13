// Which read-only commands measure a hit, and how their output reads. Pure.
import type { Match } from './rules.ts'

export type RunResult = { exitCode: number; stdout: string; stderr: string } | null

export type PlanStep = { argv: string[]; cwd?: string }

export type Preview = {
  title: string
  /** One sentence with the count in it. */
  hit: string
  /** Up to 30 dim rows. */
  lines: string[]
  /** `hit` plus the first rows, for the dialog when the pane can't place. */
  summary: string[]
}

const MAX_LINES = 30

/** At most two read-only commands that show what the hit would destroy. */
export function previewPlan(match: Match, cwd?: string): PlanStep[] {
  const at = (argv: string[]): PlanStep => (cwd ? { argv, cwd } : { argv })
  switch (match.ruleId) {
    case 'rm': {
      const p = match.paths[0]
      return p ? [at(['find', p, '-maxdepth', '3']), at(['du', '-sh', p])] : []
    }
    case 'git-force-push': {
      const ref = match.branch ? `${match.remote ?? 'origin'}/${match.branch}` : '@{upstream}'
      return [at(['git', 'log', '--oneline', `HEAD..${ref}`]), at(['git', 'log', '--oneline', `${ref}..HEAD`])]
    }
    case 'git-reset-hard':
    case 'git-checkout-discard':
      return [at(['git', 'status', '--porcelain'])]
    case 'git-clean':
      return [at(['git', 'clean', '-n', ...(match.flags.includes('d') ? ['-d'] : [])])]
    case 'git-branch-delete':
      return match.branch ? [at(['git', 'log', '--oneline', `main..${match.branch}`])] : []
    default:
      return []
  }
}

function rows(result: RunResult): string[] {
  return (result?.stdout ?? '').split('\n').map((l) => l.trimEnd()).filter(Boolean)
}

export function formatPreview(match: Match, segmentText: string, results: RunResult[]): Preview {
  const title = match.label
  let hit = 'nothing measurable — review the command'
  let lines: string[] = []
  const failed = results.length > 0 && results.some((r) => r === null || r.exitCode !== 0)

  switch (match.ruleId) {
    case 'rm': {
      const found = rows(results[0])
      const size = rows(results[1])[0]?.split(/\s+/)[0]
      lines = found
      hit = failed ? 'could not measure — review the command' : `${found.length} path${found.length === 1 ? '' : 's'}${size ? ` · ${size}` : ''} would be deleted`
      break
    }
    case 'git-force-push': {
      const lost = rows(results[0])
      const pushed = rows(results[1])
      lines = [...lost.map((l) => `− ${l}`), ...pushed.slice(0, 5).map((l) => `+ ${l}`)]
      hit = failed ? 'could not measure — review the command' : lost.length === 0 ? 'no remote commits would be lost' : `${lost.length} remote commit${lost.length === 1 ? '' : 's'} would be overwritten`
      break
    }
    case 'git-reset-hard':
    case 'git-checkout-discard': {
      const changed = rows(results[0])
      lines = changed
      hit = failed ? 'could not measure — review the command' : `${changed.length} changed file${changed.length === 1 ? '' : 's'} would be discarded`
      break
    }
    case 'git-clean': {
      const removed = rows(results[0]).map((l) => l.replace(/^Would remove\s+/, ''))
      lines = removed
      hit = failed ? 'could not measure — review the command' : `${removed.length} untracked path${removed.length === 1 ? '' : 's'} would be removed`
      break
    }
    case 'git-branch-delete': {
      const commits = rows(results[0])
      lines = commits
      hit = failed ? 'could not measure — review the command' : `${commits.length} unmerged commit${commits.length === 1 ? '' : 's'} on ${match.branch ?? 'the branch'} would be lost`
      break
    }
    case 'sql-drop':
      hit = 'this SQL destroys data'
      lines = [segmentText]
      break
    case 'chmod-777':
      hit = `${match.paths.join(', ') || 'the path'} would become world-writable`
      break
    default:
      hit = `matches ${match.label}`
      lines = [segmentText]
  }

  if (lines.length > MAX_LINES) lines = [...lines.slice(0, MAX_LINES), `… ${lines.length - MAX_LINES} more`]
  return { title, hit, lines, summary: [hit, ...lines.slice(0, 4)] }
}
