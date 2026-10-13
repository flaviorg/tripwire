import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'tripwire',
  component: 'Pane',
  requestId: 'tripwire',
  viewport: { columns: 100, rows: 30 },
  props: { title: 'Tripwire', isFocused: true, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

// Registers the stubs every guard test needs. `answer` is what the dialog returns.
function stubs(on: any, answer: string | { deny: string }, processRun: any = () => ({ value: { exitCode: 0, stdout: 'a\nb\n', stderr: '' } })) {
  const calls = { open: 0, close: 0, toasts: [] as string[] }
  on('process.run', processRun)
  on('ui.open', () => { calls.open++; return { value: { isPlaced: true } } })
  on('ui.close', () => { calls.close++; return { value: undefined } })
  on('ui.toast', ($: any, e: any) => { calls.toasts.push(e.text); return { value: undefined } })
  on('command.register', () => ({ value: undefined }))
  on('tool.call', ($: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ran' }
    if (typeof answer !== 'string') return answer
    return { result: { answers: { [e.questions[0].question]: answer } } }
  })
  return calls
}

test('a safe command runs without a hold', async ($, on) => {
  const calls = stubs(on, 'Proceed')
  const out = await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  expect(out).toEqual({ result: 'ran' })
  expect(calls.open).toBe(0)
})

test('rm -rf is held and runs on Proceed', async ($, on) => {
  const calls = stubs(on, 'Proceed')
  const out = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(out).toEqual({ result: 'ran' })
  expect(calls.open).toBe(1)
  expect(calls.close).toBe(1)
  expect(calls.toasts).toEqual(['proceeding'])
})

test('rm -rf is denied on Cancel', async ($, on) => {
  const calls = stubs(on, 'Cancel')
  const out: any = await $.tool.call({ tool: 'Bash', command: 'git push -f origin main' })
  expect(out.deny).toMatch(/cancelled/)
  expect(calls.toasts).toEqual(['cancelled · command not run'])
})

test('a dismissed dialog denies', async ($, on) => {
  stubs(on, { deny: 'dismissed' })
  const out: any = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(out.deny).toMatch(/cancelled/)
})

test('a failed preview still asks', async ($, on) => {
  const calls = stubs(on, 'Proceed', () => ({ deny: 'boom' }))
  const out = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(out).toEqual({ result: 'ran' })
  expect(calls.open).toBe(1)
})

test('the pane shows the held command on both surfaces', async ($, on) => {
  stubs(on, 'Cancel')
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /◆ tripwire · Recursive delete/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 paths .*would be deleted/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/tripwire lists the rules and the session log', async ($, on) => {
  stubs(on, 'Cancel')
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  const answer = await $.command.run({ command: 'tripwire', args: '' })
  expect(answer.text).toMatch(/Recursive delete/)
  expect(answer.text).toMatch(/✗ cancelled · rm -rf build/)
})
