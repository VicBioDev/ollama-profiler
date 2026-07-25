import { execFileSync, spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const versionScript = resolve(projectRoot, 'scripts/version.cjs')

describe('automatic application version', () => {
  it('keeps A.B from package.json and uses the numeric build override as C', () => {
    const version = execFileSync(process.execPath, [versionScript], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        OLLAMA_PROFILER_BUILD_NUMBER: '37'
      }
    }).trim()

    expect(version).toBe('0.1.37')
  })

  it('accepts only a tag that exactly matches the generated version', () => {
    const environment = {
      ...process.env,
      OLLAMA_PROFILER_BUILD_NUMBER: '37'
    }
    const accepted = spawnSync(
      process.execPath,
      [versionScript, '--check-tag', 'v0.1.37'],
      { cwd: projectRoot, encoding: 'utf8', env: environment }
    )
    const rejected = spawnSync(
      process.execPath,
      [versionScript, '--check-tag', 'v0.1.36'],
      { cwd: projectRoot, encoding: 'utf8', env: environment }
    )

    expect(accepted.status).toBe(0)
    expect(accepted.stdout.trim()).toBe('v0.1.37')
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain('must equal v0.1.37')
  })

  it('keeps an editable SVG master icon in the repository', async () => {
    const svg = await readFile(resolve(projectRoot, 'build/icon.svg'), 'utf8')

    expect(svg).toContain('viewBox="0 0 1024 1024"')
    expect(svg).toContain('<title id="title">Ollama Profiler</title>')
    expect(svg).toContain('fill="#b8f44a"')
    expect(svg).not.toContain('data:image/')
  })

  it('provides the maintainer metadata required by Linux packages', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, 'package.json'), 'utf8')
    )

    expect(packageJson.author).toEqual({
      name: 'VicBioDev',
      email: 'VicBioDev@users.noreply.github.com'
    })
  })

  it('ad-hoc signs complete macOS bundles when release credentials are absent', async () => {
    const packageScript = await readFile(
      resolve(projectRoot, 'scripts/package.cjs'),
      'utf8'
    )
    const entitlements = await readFile(
      resolve(projectRoot, 'build/entitlements.mac.plist'),
      'utf8'
    )

    expect(packageScript).toContain("'--config.mac.identity=-'")
    expect(packageScript).toContain('CSC_LINK')
    expect(packageScript).toContain('CSC_IDENTITY_AUTO_DISCOVERY')
    expect(packageScript).toContain("'--config.mac.notarize=true'")
    expect(packageScript).toContain('APPLE_APP_SPECIFIC_PASSWORD')
    expect(entitlements).toContain('com.apple.security.cs.allow-jit')
    expect(entitlements).toContain(
      'com.apple.security.cs.disable-library-validation'
    )
  })

  it('publishes each successful main build without a manual tag push', async () => {
    const workflow = await readFile(
      resolve(projectRoot, '.github/workflows/build.yml'),
      'utf8'
    )

    expect(workflow).toContain("github.ref == 'refs/heads/main'")
    expect(workflow).toContain('tag="v${{ needs.test.outputs.version }}"')
    expect(workflow).toContain('gh release create "$tag"')
    expect(workflow).toContain('-R "$GITHUB_REPOSITORY"')
    expect(workflow).toContain('--target "$GITHUB_SHA"')
    expect(workflow).not.toContain('tags:')
  })
})
