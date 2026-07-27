import type {
  DesktopApi,
  ImportPreview,
  ProfilerSnapshot,
  ServerModel,
  ServerRecord
} from '@shared/types'

const now = Date.now()
const ago = (minutes: number): string => new Date(now - minutes * 60_000).toISOString()

function benchmark(
  id: string,
  tokensPerSecond: number,
  minutesAgo: number,
  ttftMs: number,
  loadDurationMs: number
): ServerModel['benchmarks'][number] {
  return {
    id,
    status: 'success',
    startedAt: ago(minutesAgo + 1),
    finishedAt: ago(minutesAgo),
    tokensPerSecond,
    ttftMs,
    clientTotalMs: 4_842,
    evalCount: 64,
    evalDurationNs: Math.round((64 * 1_000_000_000) / tokensPerSecond),
    loadDurationNs: loadDurationMs * 1_000_000,
    totalDurationNs: 4_612_000_000,
    doneReason: 'stop'
  }
}

function model(
  id: string,
  name: string,
  family: string,
  parameterSize: string,
  quantization: string,
  speed?: number,
  minutesAgo = 45
): ServerModel {
  return {
    id,
    name,
    digest: `${id}66bb90e8d3b9c0d25dcd4c93f2c6a`,
    family,
    parameterSize,
    quantization,
    sizeBytes: 5_200_000_000,
    capabilities: speed === undefined ? ['embedding'] : ['completion', 'tools'],
    installed: true,
    firstSeenAt: ago(14_400),
    lastSeenAt: ago(12),
    benchmarks:
      speed === undefined ? [] : [benchmark(`${id}-bench`, speed, minutesAgo, 183, 612)]
  }
}

const servers: ServerRecord[] = [
  {
    id: 'sg-lab-01',
    endpoint: 'http://192.168.17.20:11434',
    source: 'manual',
    discoverySources: ['manual', 'lan-scan'],
    ip: '192.168.17.20',
    country: 'Singapore',
    city: 'Singapore',
    organization: 'Local lab',
    status: 'online',
    ollamaVersion: '0.12.3',
    failureCount: 0,
    benchmarkApproved: true,
    firstDiscoveredAt: ago(43_200),
    lastDiscoveredAt: ago(12),
    lastCheckedAt: ago(12),
    lastOnlineAt: ago(12),
    models: [
      model('qwen3-32b', 'qwen3:32b', 'qwen3', '32.8B', 'Q4_K_M', 74.6, 38),
      model('llama31-8b', 'llama3.1:8b', 'llama', '8.0B', 'Q6_K', 126.4, 64),
      model('nomic', 'nomic-embed-text:latest', 'nomic-bert', '137M', 'F16')
    ]
  },
  {
    id: 'tokyo-gpu-02',
    endpoint: 'https://ollama-tokyo.example.net:443',
    source: 'shodan-file',
    ip: '203.0.113.42',
    country: 'Japan',
    city: 'Tokyo',
    organization: 'GPU workshop',
    status: 'online',
    ollamaVersion: '0.12.3',
    failureCount: 0,
    benchmarkApproved: true,
    firstDiscoveredAt: ago(21_600),
    lastDiscoveredAt: ago(18),
    lastCheckedAt: ago(18),
    lastOnlineAt: ago(18),
    models: [
      model('gemma3-12b', 'gemma3:12b', 'gemma3', '12.2B', 'Q4_K_M', 158.2, 24),
      model('qwen25-coder', 'qwen2.5-coder:14b', 'qwen2', '14.8B', 'Q4_K_M', 112.7, 81)
    ]
  },
  {
    id: 'sydney-node-03',
    endpoint: 'http://10.42.0.18:11434',
    source: 'fofa-file',
    discoverySources: ['fofa-file', 'lan-scan'],
    ip: '10.42.0.18',
    country: 'Australia',
    city: 'Sydney',
    organization: 'Edge cluster',
    status: 'online',
    ollamaVersion: '0.11.11',
    failureCount: 0,
    benchmarkApproved: false,
    firstDiscoveredAt: ago(10_080),
    lastDiscoveredAt: ago(31),
    lastCheckedAt: ago(31),
    lastOnlineAt: ago(31),
    models: [
      model('deepseek-r1', 'deepseek-r1:14b', 'qwen2', '14.8B', 'Q4_K_M'),
      model('llama31-8b-b', 'llama3.1:8b', 'llama', '8.0B', 'Q4_K_M'),
      {
        ...model('kimi-cloud', 'kimi-k2.7-code:cloud', 'cloud', 'Remote', 'Cloud'),
        capabilities: ['completion'],
        benchmarks: []
      }
    ]
  },
  {
    id: 'frankfurt-04',
    endpoint: 'https://ollama-fra.example.org:11434',
    source: 'shodan-file',
    ip: '198.51.100.73',
    country: 'Germany',
    city: 'Frankfurt',
    organization: 'Research node',
    status: 'offline',
    ollamaVersion: '0.11.8',
    failureCount: 3,
    benchmarkApproved: false,
    firstDiscoveredAt: ago(43_200),
    lastDiscoveredAt: ago(2_880),
    lastCheckedAt: ago(820),
    lastOnlineAt: ago(2_950),
    lastErrorCode: 'CONNECT_TIMEOUT',
    lastErrorMessage: 'Connection timed out after 5 seconds',
    models: [model('mistral-small', 'mistral-small:24b', 'mistral', '24.0B', 'Q4_K_M')]
  }
]

const snapshot: ProfilerSnapshot = {
  servers,
  jobs: [
    {
      id: 'job-scan',
      kind: 'scan',
      status: 'completed',
      label: 'Scanned 4 servers',
      completed: 4,
      total: 4,
      createdAt: ago(34),
      updatedAt: ago(31)
    },
    {
      id: 'job-benchmark',
      kind: 'benchmark',
      status: 'completed',
      label: 'Benchmarked Tokyo GPU node',
      completed: 2,
      total: 2,
      createdAt: ago(86),
      updatedAt: ago(81)
    },
    {
      id: 'job-import',
      kind: 'import',
      status: 'completed',
      label: 'Imported Shodan export',
      completed: 4,
      total: 4,
      createdAt: ago(1_445),
      updatedAt: ago(1_440)
    }
  ],
  settings: {
    scanConcurrency: 8,
    benchmarkConcurrency: 8,
    connectTimeoutMs: 5_000,
    requestTimeoutMs: 15_000,
    benchmarkTimeoutMs: 120_000,
    maxResponseBytes: 1_048_576,
    benchmarkPrompt: 'Reply with one concise sentence about distributed systems.',
    benchmarkNumPredict: 64,
    benchmarkMinTokens: 8,
    allowPrivateNetworks: true
  },
  updatedAt: ago(12)
}

const preview: ImportPreview = {
  id: 'preview',
  filename: 'ollama-results.json.gz',
  provider: 'shodan',
  totalRows: 4,
  validRows: 4,
  duplicateRows: 0,
  invalidRows: 0,
  candidates: servers.map(({ endpoint, source, ip, country, city, organization }) => ({
    endpoint,
    source,
    ip,
    country,
    city,
    organization
  })),
  issues: []
}

export function createPreviewApi(): DesktopApi {
  return {
    platform: 'darwin',
    getSnapshot: async () => snapshot,
    subscribe: () => () => undefined,
    subscribeToNavigation: () => () => undefined,
    selectImportFile: async () => preview,
    previewText: async () => preview,
    commitImport: async () => ({ added: 0, updated: 4 }),
    testLocalhost: async () => 'preview-localhost-job',
    scanLocalNetwork: async () => 'preview-lan-job',
    profileAllServers: async () => 'preview-profile-job',
    setBenchmarkApproval: async () => undefined,
    updateSettings: async (settings) => ({ ...snapshot.settings, ...settings }),
    removeServer: async () => undefined,
    removeServers: async () => undefined,
    exportServers: async (options) => ({
      filePath: 'Ollama Profiler preview.csv',
      count: options.serverIds.length
    }),
    chatModels: async ({ targets }) => ({
      results: targets.map((target, index) => {
        const server = servers.find(({ id }) => id === target.serverId)
        return {
          ...target,
          endpoint: server?.endpoint ?? 'Unavailable server',
          elapsedMs: 1_240 + index * 380,
          content:
            index === 0
              ? 'A stateless chat request contains only the message you just sent.'
              : 'This response ran independently on a different Ollama server.'
        }
      })
    })
  }
}
