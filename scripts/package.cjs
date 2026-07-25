const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
const { getAppVersion } = require('./version.cjs')

const projectRoot = resolve(__dirname, '..')
const builderCli = require.resolve('electron-builder/out/cli/cli.js')
const version = getAppVersion(projectRoot)
const hasMacSigningIdentity = Boolean(
  process.env.CSC_LINK?.trim() ||
    process.env.CSC_NAME?.trim() ||
    process.env.CSC_KEYCHAIN?.trim() ||
    process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'true'
)
const hasMacNotarizationCredentials =
  Boolean(process.env.APPLE_ID?.trim()) &&
  Boolean(process.env.APPLE_APP_SPECIFIC_PASSWORD?.trim()) &&
  Boolean(process.env.APPLE_TEAM_ID?.trim())
const fallbackMacSigningArgs =
  process.platform === 'darwin' && !hasMacSigningIdentity
    ? [
        '--config.mac.identity=-',
        '--config.mac.entitlements=build/entitlements.mac.plist',
        '--config.mac.entitlementsInherit=build/entitlements.mac.plist'
      ]
    : []
const macNotarizationArgs =
  process.platform === 'darwin' &&
  hasMacSigningIdentity &&
  hasMacNotarizationCredentials
    ? ['--config.mac.notarize=true']
    : []
const result = spawnSync(
  process.execPath,
  [
    builderCli,
    '--publish',
    'never',
    `--config.extraMetadata.version=${version}`,
    ...fallbackMacSigningArgs,
    ...macNotarizationArgs,
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
