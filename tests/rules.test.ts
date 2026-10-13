import { expect, test } from 'claude-code/testing'
import { findMatch } from '../hooks/rules.ts'

const id = (cmd: string, opts = {}) => findMatch(cmd, opts)?.match.ruleId ?? null

test('rm needs a recursive flag or a glob', async () => {
  expect(id('rm -rf build')).toBe('rm')
  expect(id('rm -r build')).toBe('rm')
  expect(id('rm -fr build')).toBe('rm')
  expect(id('rm -r *')).toBe('rm')
  expect(id('rm file.txt')).toBe(null)
  expect(findMatch('rm -rf build src')?.match.paths).toEqual(['build', 'src'])
})

test('force push in its spellings', async () => {
  expect(id('git push -f origin main')).toBe('git-force-push')
  expect(id('git push --force')).toBe('git-force-push')
  expect(id('git push --force-with-lease origin feat')).toBe('git-force-push')
  expect(id('git push')).toBe(null)
  const m = findMatch('git push -f origin main')?.match
  expect(m?.remote).toBe('origin')
  expect(m?.branch).toBe('main')
})

test('git reset, clean, branch, checkout and restore', async () => {
  expect(id('git reset --hard HEAD~1')).toBe('git-reset-hard')
  expect(id('git reset --soft HEAD~1')).toBe(null)
  expect(id('git clean -fd')).toBe('git-clean')
  expect(id('git clean -n')).toBe(null)
  expect(id('git clean -fdn')).toBe(null)
  expect(id('git branch -D feat')).toBe('git-branch-delete')
  expect(findMatch('git branch -D feat')?.match.branch).toBe('feat')
  expect(id('git branch -d feat')).toBe(null)
  expect(id('git checkout -- .')).toBe('git-checkout-discard')
  expect(id('git restore .')).toBe('git-checkout-discard')
  expect(id('git checkout main')).toBe(null)
})

test('sql and chmod', async () => {
  expect(id('psql -c "DROP TABLE users"')).toBe('sql-drop')
  expect(id('mysql -e "truncate table logs"')).toBe('sql-drop')
  expect(id('psql -c "SELECT 1"')).toBe(null)
  expect(id('chmod -R 777 /srv')).toBe('chmod-777')
  expect(id('chmod 644 f')).toBe(null)
})

test('allowPaths skips rm on listed folders only', async () => {
  expect(id('rm -rf build', { allowPaths: 'dist,build' })).toBe(null)
  expect(id('rm -rf ./build/', { allowPaths: 'build' })).toBe(null)
  expect(id('rm -rf src', { allowPaths: 'dist,build' })).toBe('rm')
  expect(id('rm -rf build src', { allowPaths: 'build' })).toBe('rm')
})

test('extraPatterns add custom rules and bad regexes are ignored', async () => {
  expect(id('terraform destroy -auto-approve', { extraPatterns: 'terraform destroy' })).toBe('custom-1')
  expect(id('ls', { extraPatterns: '(' })).toBe(null)
})

test('a hit inside a chain keeps its cwd', async () => {
  const found = findMatch('cd app && rm -rf build')
  expect(found?.match.ruleId).toBe('rm')
  expect(found?.segment).toEqual({ text: 'rm -rf build', cwd: 'app' })
})
