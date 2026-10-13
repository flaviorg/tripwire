import { expect, test } from 'claude-code/testing'
import { findMatch } from '../hooks/rules.ts'
import { formatPreview, previewPlan } from '../hooks/preview.ts'

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })

test('rm plan uses find and du on the first path with the segment cwd', async () => {
  const { match, segment } = findMatch('cd app && rm -rf build src')!
  expect(previewPlan(match, segment.cwd)).toEqual([
    { argv: ['find', 'build', '-maxdepth', '3'], cwd: 'app' },
    { argv: ['du', '-sh', 'build'], cwd: 'app' },
  ])
})

test('force push plan uses the upstream when the branch is unknown', async () => {
  const { match } = findMatch('git push --force')!
  expect(previewPlan(match)[0].argv).toEqual(['git', 'log', '--oneline', 'HEAD..@{upstream}'])
  const named = findMatch('git push -f origin main')!.match
  expect(previewPlan(named)[0].argv).toEqual(['git', 'log', '--oneline', 'HEAD..origin/main'])
})

test('formatPreview counts find output and reads the du size', async () => {
  const { match } = findMatch('rm -rf build')!
  const p = formatPreview(match, 'rm -rf build', [ok('build\nbuild/a.js\nbuild/b.js\n'), ok('2.1M\tbuild\n')])
  expect(p.hit).toBe('3 paths · 2.1M would be deleted')
  expect(p.lines).toEqual(['build', 'build/a.js', 'build/b.js'])
  expect(p.summary[0]).toBe(p.hit)
})

test('formatPreview reads the macOS du size, which has a leading space', async () => {
  const { match } = findMatch('rm -rf build')!
  const p = formatPreview(match, 'rm -rf build', [ok('build\nbuild/a.js\n'), ok(' 56K\tbuild\n')])
  expect(p.hit).toBe('2 paths · 56K would be deleted')
})

test('a failed measurement says could not measure', async () => {
  const { match } = findMatch('rm -rf build')!
  expect(formatPreview(match, 'rm -rf build', [null, null]).hit).toBe('could not measure — review the command')
})

test('force push counts the remote commits that would vanish', async () => {
  const { match } = findMatch('git push -f origin main')!
  const p = formatPreview(match, 'git push -f origin main', [ok('abc fix\ndef docs\n'), ok('123 wip\n')])
  expect(p.hit).toBe('2 remote commits would be overwritten')
  expect(p.lines).toEqual(['− abc fix', '− def docs', '+ 123 wip'])
})

test('lines are capped at 30', async () => {
  const { match } = findMatch('git reset --hard')!
  const many = Array.from({ length: 40 }, (_, i) => ` M file${i}.ts`).join('\n')
  const p = formatPreview(match, 'git reset --hard', [ok(many)])
  expect(p.lines.length).toBe(31)
  expect(p.lines[30]).toBe('… 10 more')
  expect(p.hit).toBe('40 changed files would be discarded')
})
