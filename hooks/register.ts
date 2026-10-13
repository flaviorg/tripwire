// tripwire — holds a destructive Bash command, shows what it would destroy, asks you.
// This is the only file that touches the mods API ($).
import { findMatch, RULES, type Match } from './rules.ts'
import { formatPreview, previewPlan, type PlanStep, type Preview, type RunResult } from './preview.ts'
import type { Segment } from './segments.ts'

const PANE = 'tripwire'

type Options = { mode: 'ask' | 'deny' | 'off'; extraPatterns: string; allowPaths: string }

type Held = { command: string; segment: Segment; match: Match; preview: Preview }
type LogEntry = { at: number; command: string; ruleId: string; decision: 'proceeded' | 'cancelled' | 'denied' }

// The last held command, for the pane and /tripwire; the session's decisions.
let last: Held | null = null
const log: LogEntry[] = []

const DENY_CANCELLED = 'The user cancelled this command because it is destructive (tripwire). Ask before trying an alternative.'
const DENY_MODE = 'tripwire blocked this destructive command (mode: deny). Ask the user before trying an alternative.'

// Runs each preview step with a short timeout; a failure becomes null, never a throw.
async function runPlan($: any, plan: PlanStep[]): Promise<RunResult[]> {
  const results: RunResult[] = []
  for (const step of plan.slice(0, 2)) {
    try {
      const r = await $.process.run(step.argv, { timeoutMs: 2000, ...(step.cwd ? { cwd: step.cwd } : {}) })
      results.push({ exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr })
    } catch {
      results.push(null)
    }
  }
  return results
}

// Shows the pane, asks in the dialog, closes the pane. The wait lives inside $.ui.ask.
async function holdAndAsk($: any, held: Held): Promise<'proceed' | 'cancel'> {
  let placed = false
  try {
    const opened = await $.ui.open({ id: PANE, title: 'Tripwire', holdToasts: true })
    placed = opened?.isPlaced === true
  } catch {}
  const question = [`tripwire · ${held.preview.hit}`, held.segment.text, ...(placed ? [] : held.preview.summary.slice(1))].join('\n')
  let answer = 'Cancel'
  try {
    answer = await $.ui.ask(question, ['Cancel', 'Proceed'])
  } catch {}
  try {
    await $.ui.close({ id: PANE })
  } catch {}
  return answer === 'Proceed' ? 'proceed' : 'cancel'
}

function remember(held: Held, decision: LogEntry['decision'], at: number) {
  log.push({ at, command: held.command, ruleId: held.match.ruleId, decision })
}

export function register(on: any, options: Options) {
  const mode = options?.mode ?? 'ask'
  const findOptions = { extraPatterns: options?.extraPatterns ?? '', allowPaths: options?.allowPaths ?? '' }

  on('session.start', async ($: any, e: any, next: any) => {
    try {
      await $.command.register({ name: 'tripwire', description: 'What tripwire guards, and what it held this session', immediate: true })
    } catch {}
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($: any, e: any, next: any) => {
    if (mode === 'off') return next(e)
    const found = findMatch(e.command, findOptions)
    if (!found) return next(e)
    const held: Held = { command: e.command, segment: found.segment, match: found.match, preview: formatPreview(found.match, found.segment.text, []) }
    if (mode === 'deny') {
      last = held
      remember(held, 'denied', Date.now())
      return { deny: DENY_MODE }
    }
    const results = await runPlan($, previewPlan(found.match, found.segment.cwd))
    held.preview = formatPreview(found.match, found.segment.text, results)
    last = held
    const decision = await holdAndAsk($, held)
    if (decision === 'proceed') {
      remember(held, 'proceeded', Date.now())
      $.ui.toast('tripwire: proceeding')
      return next(e)
    }
    remember(held, 'cancelled', Date.now())
    $.ui.toast('tripwire: cancelled')
    return { deny: DENY_CANCELLED }
  }).catch(async ($: any, e: any, next: any) => {
    if (next.called) return next(e)
    return { deny: 'tripwire failed before deciding, so this command was not run: ' + next.error.kind }
  })

  on('ui.render', { component: 'Pane' }, async ($: any, e: any, next: any) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Code } = $.ui.resolve(e)
    const width = Math.max(20, (e.props?.bodyColumns ?? 80) - 2)
    const cut = (s: string) => (s.length > width ? s.slice(0, width - 1) + '…' : s)
    if (!last) {
      return Box({
        flexDirection: 'column',
        children: [
          Text({ bold: true, children: ['◆ tripwire'] }),
          Text({ dimColor: true, children: ['No command held yet. Tripwire holds rm -rf, force pushes, hard resets and more.'] }),
        ],
      })
    }
    const { preview, segment } = last
    return Box({
      flexDirection: 'column',
      children: [
        Text({ bold: true, children: ['◆ tripwire · ' + preview.title] }),
        Code({ source: segment.text, language: 'bash' }),
        Text({ color: 'red', bold: true, children: [cut(preview.hit)] }),
        ...preview.lines.map((line) => Text({ dimColor: true, children: [cut('  ' + line)] })),
        Text({ children: [' '] }),
        Text({ dimColor: true, children: ['Answer in the dialog below · Cancel is the default'] }),
      ],
    })
  })

  on('command.run', { command: 'tripwire' }, async () => {
    const rules = RULES.map((r) => `  ${r.severity === 'high' ? '●' : '○'} ${r.label}`).join('\n')
    const history = log.length === 0
      ? 'No commands held yet.'
      : log.map((l) => `  ${l.decision === 'proceeded' ? '✓' : '✗'} ${l.decision} · ${l.command}`).join('\n')
    return { text: `Tripwire holds:\n${rules}\n\nThis session:\n${history}` }
  })
}
