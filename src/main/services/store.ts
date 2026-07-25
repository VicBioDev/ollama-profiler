import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProfilerSnapshot } from '@shared/types.js'
import { createEmptySnapshot, DEFAULT_SETTINGS } from '../defaults.js'

interface PersistedDocument {
  schemaVersion: 1
  snapshot: ProfilerSnapshot
}

export class ProfilerStore {
  private snapshot: ProfilerSnapshot = createEmptySnapshot()
  private saveChain: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async load(): Promise<ProfilerSnapshot> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const document = JSON.parse(raw) as Partial<PersistedDocument>
      if (document.schemaVersion !== 1 || !document.snapshot) {
        throw new Error('Unsupported database schema')
      }
      const {
        secretStatus: _legacySecretStatus,
        ...persistedSnapshot
      } = document.snapshot as ProfilerSnapshot & { secretStatus?: unknown }
      this.snapshot = {
        ...createEmptySnapshot(),
        ...persistedSnapshot,
        settings: {
          ...DEFAULT_SETTINGS,
          ...persistedSnapshot.settings
        },
        jobs: (persistedSnapshot.jobs ?? []).slice(0, 50).map((job) => {
          const wasInterrupted =
            job.status === 'queued' ||
            job.status === 'running' ||
            (job.status === 'failed' &&
              job.errorMessage === 'Interrupted when the app closed')
          return wasInterrupted
            ? {
                ...job,
                status: 'cancelled',
                updatedAt: new Date().toISOString(),
                summary: 'Cancelled because the application closed.',
                errorMessage: undefined
              }
            : job
        })
      }
      this.pruneHistory()
      await this.save()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      await this.save()
    }
    return this.get()
  }

  get(): ProfilerSnapshot {
    return structuredClone(this.snapshot)
  }

  async mutate(mutator: (snapshot: ProfilerSnapshot) => void): Promise<ProfilerSnapshot> {
    mutator(this.snapshot)
    this.snapshot.updatedAt = new Date().toISOString()
    await this.save()
    return this.get()
  }

  private pruneHistory(): void {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
    for (const server of this.snapshot.servers) {
      for (const model of server.models) {
        model.benchmarks = model.benchmarks.filter(
          (result) => Date.parse(result.finishedAt) >= cutoff
        )
      }
    }
  }

  private async save(): Promise<void> {
    const document: PersistedDocument = {
      schemaVersion: 1,
      snapshot: this.snapshot
    }
    const contents = `${JSON.stringify(document, null, 2)}\n`
    this.saveChain = this.saveChain.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, this.filePath)
    })
    return this.saveChain
  }
}
