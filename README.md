# Ollama Profiler

**English** | [简体中文](README.zh-CN.md)

<img src="build/icon.svg" alt="Ollama Profiler icon" width="96" height="96">

Ollama Profiler is an open-source, cross-platform desktop application for
scanning and benchmarking Ollama servers that you own or are authorized to use.
It supports macOS, Windows, and Linux. All data and jobs stay on your device,
with no Docker, database service, or background web service required.

## Features

- Import FOFA CSV/JSON and Shodan `.json.gz`, JSON, or CSV exports
- Paste Ollama endpoints directly, one per line, without creating a file first
- Test `localhost:11434` with one click and discover Ollama instances on the
  current private LAN
- Sync versions and complete model capabilities through `/api/version`,
  `/api/tags`, and `/api/show`
- For explicitly authorized servers, benchmark the streaming `/api/generate`
  endpoint and measure:
  - Generation speed using `eval_count × 1e9 / eval_duration`
  - Time to first token (TTFT)
  - Total client time, model load time, and Ollama's original performance fields
- In each run, benchmark every installed, generation-capable, non-Cloud local
  model on a server; jobs on the same server are strictly sequential, so scans
  and model benchmarks never overlap
- Process different servers concurrently: inventory scans default to 8 servers
  and benchmarks to 4; Settings offers 2, 4, 8, 16, or 32 workers for each task
- Apply concurrency changes to active scans and benchmarks immediately; increases
  fill new slots at once, while decreases let in-flight requests finish and then
  enforce the lower limit
- Customize the shared benchmark prompt in Settings while keeping the same prompt
  across every model in a run for comparable results
- Open Settings directly from the persistent left navigation on every platform
- Show a live remaining-time estimate for active scans and benchmarks once
  enough recent progress is available
- Keep the top toolbar scoped to the current page: Overview offers only a full
  scan, the server list can benchmark all authorized online nodes, and a server
  detail page can scan or re-benchmark that server
- Keep scanning and benchmarking explicit: a manual scan refreshes only the
  version and model inventory, while a separate button starts benchmarks
- Preserve the latest successful speed when a newer benchmark fails; keep
  benchmark history locally for 90 days
- Search models with suggestions and filter servers by status and country-level
  region; after selecting an exact model, the speed column shows its name and
  displays and sorts only that model's latest successful speed
- Search the stateless Chat model picker by name; available models are ranked by
  how many eligible servers have them installed, with alphabetical tie-breaking
- Select servers individually or select all current filtered results, then
  delete them in bulk or export CSV; exports include Endpoint, city/country
  Region, and TPS, using the selected model's speed when an exact model is
  filtered or each server's highest speed otherwise
- Copy a server endpoint directly from any server list or its detail page, and
  hover or focus a list's model count to inspect every installed model name
- Paginate the server list at 50 servers per page while preserving selection
  across pages; Select All covers the complete filtered result set, not only the
  current page
- Name exports `Ollama Profiler - Model Name - YYYY-MM-DD.csv` by default,
  omitting the model name when no exact model is selected
- Clearly label and skip Ollama Cloud models such as `:cloud` and `*-cloud`,
  benchmarking only generation models that run locally on the target server
- Refresh inventory every hour, re-benchmark successful results after 24 hours,
  and retry failures with 1/6/24/72-hour backoff
- Deduplicate Scan and Benchmark jobs of the same type; on a normal application
  exit, mark running jobs as canceled instead of ordinary benchmark failures;
  on the next launch, offer to continue unfinished benchmarks from the previous
  run or start over
- Reveal the interface progressively: before import, show only guidance for
  adding servers; before benchmarking, do not display empty metrics

## Safety Principles

- File imports and model inventory scans use only Ollama's read-only endpoints.
- Generation benchmarks require explicit user authorization for every server.
- The application never calls remote-state mutation endpoints such as `pull`,
  `create`, `delete`, or `copy`.
- HTTP redirects are disabled, and cloud metadata, link-local, multicast, and
  unspecified addresses are blocked.
- LAN and localhost access are enabled by default because this project targets
  servers owned by the user; both can be disabled in Settings.
- LAN discovery requests only `11434/api/version` and scans bounded subnets for
  active RFC1918 IPv4 interfaces. Each interface is limited to the local `/24`,
  with at most 4 subnets and 1,024 addresses total.
- Discovery can run concurrently across IP addresses; subsequent model syncs
  reuse the per-server sequential queue. Discovered nodes are not authorized
  for generation benchmarks by default.
- FOFA and Shodan are supported only as local export file formats; the
  application does not connect to their search, map, or other APIs.

Do not test servers that you do not own or are not authorized to use. Public
accessibility does not imply permission to consume a server's compute resources.

## Development

Requires Node.js 22 or later and the stable Rust toolchain. Linux also requires
the WebKitGTK 4.1 and other system dependencies listed by Tauri.

```bash
npm install
npm run dev
```

Common checks:

```bash
npm run typecheck
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Build an installer for the current platform:

```bash
npm run dist
```

Tauri writes installers and updater artifacts for the current platform to
`src-tauri/target/release/bundle/`. macOS, Windows, and Linux packages should be
built on their respective operating systems; the GitHub Actions release matrix
follows the same constraint.

## Versioning and Releases

The application version follows `A.B.C`:

- Maintain `A.B` manually in `package.json`. When changing it, run
  `npm version A.B.0 --no-git-tag-version` to update the lockfile at the same
  time.
- `C` is generated automatically from the number of commits reachable from the
  current Git HEAD. The same commit produces the same version locally and in
  GitHub Actions; repositories without an initial commit use `0`.

Display the current full version:

```bash
npm run version:current
```

On a push to `main` or a manually triggered workflow, GitHub Actions first runs
the TypeScript, React, and Rust checks, then builds in parallel for macOS Apple
Silicon, macOS Intel, Windows x64, and Linux x64. After all four platforms
succeed, the workflow automatically publishes a matching GitHub Release (for
example, `v0.1.37`) with Tauri's `latest.json`, installers, and signatures. No
manual tag is required. Pull Requests run checks without publishing a Release.

The application checks these GitHub Releases on startup. Clicking the current
version in the lower-left corner checks again without modifying the application.
When a newer version is available, it appears to the right of the current version.
Only clicking that new version downloads the update, verifies its Tauri signature,
replaces the current installation, and restarts. To ensure every Release can be
safely verified by clients, configure the following before publishing:

- `TAURI_SIGNING_PRIVATE_KEY`: the private key paired with the public key in
  `src-tauri/tauri.conf.json`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the private key password; leave it empty
  for a key without a password

Never commit the private key. The current maintainer's locally generated key is
stored at `~/.tauri/ollama-profiler.key` by default and should be backed up
separately.

With the following GitHub Secrets configured, the same workflow also signs with
a Developer ID and submits the application for Apple notarization. Builds still
succeed without them, but Gatekeeper may block the application the first time
it is opened:

- `MAC_CSC_LINK`: Base64 content of the Developer ID Application `.p12`
- `MAC_CSC_KEY_PASSWORD`: password used to export the certificate
- `APPLE_ID`: Apple Developer account
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for the Apple ID
- `APPLE_TEAM_ID`: 10-character Team ID

Windows installers are not currently Authenticode-signed, so SmartScreen may
show an unknown publisher warning.

The editable source icon is at `build/icon.svg`; Tauri packaging icons are in
`src-tauri/icons/`.

## Import Formats

Compressed NDJSON files from the Shodan CLI can be imported without
decompression:

```bash
shodan download --limit 1000 ollama 'port:11434 "Ollama is running"'
```

FOFA and generic tables may use any of the following fields:

- Address: `endpoint`, `link`, `url`, `host`, `hostname`, `domain`, `ip`
- Connection: `port`, `protocol`, `scheme`
- Metadata: `country_name`, `region`, `city`, `asn`, `org`, `organization`

Before importing, the application shows valid, duplicate, and invalid row
counts together with endpoint samples. Data is written to the local data file
and the concurrent scan begins only after confirmation.

## Architecture

- Tauri/Rust core: file access, Ollama network requests, local persistence, and
  job scheduling
- Tauri commands and capabilities: restricted, typed IPC with no Node.js access
  in the renderer
- React/TypeScript: desktop interface, filtering, import preview, and
  performance history
- JSON document storage: atomic writes in the application user directory,
  avoiding the cross-platform packaging burden of native database extensions
- Tauri updater: reads `latest.json` from GitHub Releases and installs only
  updates with matching signatures

The project's primary goal is reliable local profiling. Public asset sources
are supported only through export files explicitly selected by the user; the
application does not connect to search or map APIs.

## License

MIT
