const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

const UNUSED_MAC_USAGE_KEYS = [
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription'
]

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const infoPlist = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Info.plist'
  )
  for (const key of UNUSED_MAC_USAGE_KEYS) {
    try {
      execFileSync('/usr/bin/plutil', ['-remove', key, infoPlist])
    } catch {
      // Electron versions differ in which optional usage strings they include.
    }
  }
}
