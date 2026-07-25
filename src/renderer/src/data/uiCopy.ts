import {
  Gauge,
  Import,
  LayoutDashboard,
  Server,
  Settings
} from 'lucide-react'

export const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'servers', label: 'Servers', icon: Server },
  { id: 'imports', label: 'Import', icon: Import },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'local', label: 'Localhost', icon: Server }
] as const

export const APP_COPY = {
  name: 'Ollama Profiler',
  eyebrow: 'LOCAL FLEET PROFILING',
  emptyServersTitle: 'No Ollama servers yet',
  emptyServersBody: 'Import a FOFA or Shodan export, or paste an endpoint list.',
  safetyTitle: 'Benchmark permission',
  safetyBody:
    'Inventory scans are read-only. Generation benchmarks run only on servers you explicitly mark as owned or authorized.',
  mark: Gauge
}

export const LOCAL_COPY = {
  eyebrow: 'LOCAL DISCOVERY',
  title: 'Test nearby Ollama.',
  body:
    'Start with Ollama on this machine, or look for Ollama on port 11434 across connected private IPv4 networks.',
  localhostAction: 'Test localhost',
  lanAction: 'Scan local network',
  safety:
    'Discovery sends only a read-only version request. Each connected network is capped to the local /24 and public addresses are never scanned.',
  settingsRequired: 'LAN and localhost access is disabled in Settings.',
  localhostScanningTitle: 'Testing localhost.',
  localhostScanningBody: 'Checking loopback addresses for a valid Ollama version response.',
  lanScanningTitle: 'Scanning the local network.',
  lanScanningBody: 'Checking port 11434 across bounded private IPv4 ranges.',
  progressLabel: 'checked',
  settingsAction: 'Open Settings',
  resultsTitle: 'Local servers',
  resultsBody: 'Servers discovered on this device and connected private networks.',
  retestAction: 'Test localhost',
  rescanAction: 'Scan network',
  discoveredEyebrow: 'DISCOVERED',
  endpointsTitle: 'Ollama endpoints',
  localCountLabel: 'local'
} as const
