const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
const { getAppVersion } = require('./version.cjs')

const projectRoot = resolve(__dirname, '..')
const builderCli = require.resolve('electron-builder/out/cli/cli.js')
const version = getAppVersion(projectRoot)
const result = spawnSync(
  process.execPath,
  [
    builderCli,
    '--publish',
    'never',
    `--config.extraMetadata.version=${version}`,
    ...process.argv.slice(2)
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY:
        process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? 'false',
      OLLAMA_PROFILER_VERSION: version
    },
    stdio: 'inherit'
  }
)

if (result.error) throw result.error
process.exitCode = result.status ?? 1
