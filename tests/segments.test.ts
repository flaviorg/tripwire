import { expect, test } from 'claude-code/testing'
import { splitSegments } from '../hooks/segments.ts'

test('splits on operators and newlines', async () => {
  const s = splitSegments('npm run build && rm -rf dist; ls | wc -l\necho done')
  expect(s.map((x) => x.text)).toEqual(['npm run build', 'rm -rf dist', 'ls', 'wc -l', 'echo done'])
})

test('ignores operators inside quotes', async () => {
  const s = splitSegments('echo "a && b" && rm -rf x')
  expect(s.map((x) => x.text)).toEqual(['echo "a && b"', 'rm -rf x'])
})

test('strips sudo and env prefixes', async () => {
  expect(splitSegments('sudo -E rm -rf /tmp/x')[0].text).toBe('rm -rf /tmp/x')
  expect(splitSegments('FOO=1 env BAR=2 git push -f')[0].text).toBe('git push -f')
})

test('cd sets cwd for later segments and is dropped', async () => {
  expect(splitSegments('cd app && rm -rf build')).toEqual([{ text: 'rm -rf build', cwd: 'app' }])
})

test('cd chains and resets', async () => {
  expect(splitSegments('cd a && cd b && ls')).toEqual([{ text: 'ls', cwd: 'a/b' }])
  expect(splitSegments('cd a && cd && ls')).toEqual([{ text: 'ls' }])
  expect(splitSegments('cd /srv && ls')).toEqual([{ text: 'ls', cwd: '/srv' }])
})
