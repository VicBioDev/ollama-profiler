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

  it('requires signed updater artifacts from the GitHub release feed', async () => {
    const tauriConfig = JSON.parse(
      await readFile(resolve(projectRoot, 'src-tauri/tauri.conf.json'), 'utf8')
    )
    const capabilities = JSON.parse(
      await readFile(
        resolve(projectRoot, 'src-tauri/capabilities/default.json'),
        'utf8'
      )
    )

    expect(tauriConfig.bundle.createUpdaterArtifacts).toBe(true)
    expect(tauriConfig.plugins.updater.pubkey).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(tauriConfig.plugins.updater.endpoints).toEqual([
      'https://github.com/VicBioDev/ollama-profiler/releases/latest/download/latest.json'
    ])
    expect(capabilities.permissions).toContain('updater:default')
    expect(capabilities.permissions).toContain('process:allow-restart')
  })

  it('publishes each successful main build without a manual tag push', async () => {
    const workflow = await readFile(
      resolve(projectRoot, '.github/workflows/build.yml'),
      'utf8'
    )

    expect(workflow).toContain("github.ref == 'refs/heads/main'")
    expect(workflow).toContain('tauri-apps/tauri-action@v1')
    expect(workflow).toContain('tagName: v${{ needs.test.outputs.version }}')
    expect(workflow).toContain('TAURI_SIGNING_PRIVATE_KEY')
    expect(workflow).toContain('releaseDraft: true')
    expect(workflow).toContain('gh release edit')
    expect(workflow).toContain('--draft=false')
    expect(workflow).not.toContain('tags:')
  })
})
