# Ollama Profiler

[English](README.md) | **简体中文**

<img src="build/icon.svg" alt="Ollama Profiler icon" width="96" height="96">

Ollama Profiler 是一个开源、跨平台的桌面应用，用来批量扫描和测试你拥有或获准
使用的 Ollama 服务器。应用支持 macOS、Windows 和 Linux，所有数据与任务
都保存在本机，不需要 Docker、数据库服务或后台 Web 服务。

## 当前能力

- 导入 FOFA CSV/JSON，以及 Shodan `.json.gz`、JSON、CSV 导出
- 可直接粘贴一行一个的 Ollama 地址，不需要先创建文件
- 一键测试本机 `localhost:11434`，并可发现当前私有局域网中的 Ollama
- 调用 `/api/version`、`/api/tags`、`/api/show` 同步版本和完整模型能力；同一服务器
  复用绑定到已验证 IP 的安全 HTTP 会话，版本与模型 digest 未变化时复用已有详情，
  不重复调用 `/api/show`
- 每次打开应用时立即检查所有已保存服务器；如果启动扫描尚未结束就请求全量测速，
  会复用本轮扫描结果，等扫描完成后直接开始测速，不会重复扫描；大规模扫描会分批
  更新界面并建立本地检查点，避免阻塞应用中的其他操作
- 测速结果分批持久化，并只向界面发送变化的服务器与任务补丁，不再每完成一个模型就
  重写并广播完整本地快照
- 对明确获准的服务器，使用流式 `/api/generate` 测量：
  - 正式生成速度 `eval_count × 1e9 / eval_duration`
  - 首 token 延迟（TTFT）
  - 客户端总耗时、模型加载时间及 Ollama 原始性能字段
- 每轮会遍历服务器上所有已安装、支持生成且非 Cloud 的本地模型；同一服务器严格
  串行，扫描和任何模型测速不会重叠
- 不同服务器并行：清单扫描和测速均默认 8 台；两组任务都可在设置中选择
  8、16、32、64 或 128 个并行任务，旧版自定义数值会迁移到最接近的档位；选择
  64 或 128 时会显示系统压力警告，并提供“资源节省”预设（32 扫描、8 测速、
  32 个生成 token）
- 并行数量修改后立即作用于正在运行的扫描和测速：调高会马上补充任务；调低不会
  中断已发出的请求，而是在这些请求结束后按新上限继续
- 可在设置中自定义统一的测速 prompt；同一轮对所有模型使用相同 prompt，便于比较结果
- 所有平台都可直接从固定的左侧菜单栏进入设置
- 扫描或测速任务积累足够的近期进度后，会实时显示预计剩余时间
- 顶部工具栏按当前页面明确操作范围：概览只保留全量扫描，服务器列表可对所有
  已授权且在线的节点运行测速，单台详情可扫描该服务器或重新运行测速
- 启动与手动扫描只刷新版本与模型清单，不会隐式启动测速；测速使用独立按钮明确触发
- 最近失败不会覆盖最近成功速度；测速历史在本机保留 90 天，每个模型最多 100 条
- 服务器页支持模型名搜索与自动建议，并可按状态和国家级 Region 筛选；选择精确
  模型后，速度列会显示该模型名，并只展示与排序该模型在各服务器上的最近成功速度；
  应用保持打开时，切换页面会保留搜索词、筛选条件和结果页码，退出应用后会重置
- 无状态 Chat 的模型选择器支持按名称搜索；可用模型按已安装该模型的合格服务器数量
  排序，数量相同时按模型名称排序；应用保持打开时，切换页面会保留当前测试状态，但
  prompt 与回复不会写入磁盘，退出应用后会清空
- 服务器列表支持逐项多选或全选当前筛选结果，并可批量删除或导出 CSV；CSV 包含
  Endpoint、城市/国家 Region 和 TPS，精确模型筛选时导出该模型速度，否则导出每台
  服务器的最高速度
- 任意服务器列表和服务器详情页都可通过系统原生剪贴板复制服务器地址，并明确显示
  成功或失败反馈；鼠标悬停或键盘聚焦列表中的模型数量时，会显示该服务器全部已安装
  模型的名称；悬停或聚焦最快速度时，会显示产生该结果的模型名称
- 服务器列表固定每页 50 台；翻页不会丢失选择状态，“全选”覆盖完整筛选结果而不只
  是当前页
- 导出文件默认命名为 `Ollama Profiler - 模型名 - YYYY-MM-DD.csv`；未选择精确
  模型时省略模型名
- `:cloud`、`*-cloud` 等 Ollama Cloud 模型会明确标记并跳过，只测速由目标
  Ollama 服务器本地运行的生成模型
- 健康服务器每小时自动刷新清单，后台扫描最多并行 16 台；无法连接的服务器按
  1/6/24/72 小时退避。成功测速结果 24 小时后重测，失败测速同样按该节奏退避
- 同类 Scan/Benchmark 任务会自动去重；正常关闭应用时，运行中任务记录为取消，
  不会误报成普通测速失败；下次启动时，可选择继续、重新开始或取消，取消只关闭提示，
  不会排队恢复测速，正常的启动清单检查仍会独立继续
- 界面按当前状态渐进显示：未导入时只引导添加服务器，尚未测速时不显示空指标

## 安全原则

- 文件导入和模型清单扫描只使用 Ollama 的只读接口。
- 生成测速必须由用户对每台服务器明确授权。
- 不调用 `pull`、`create`、`delete`、`copy` 等修改远端状态的接口。
- 禁止 HTTP 重定向，并阻止云元数据、链路本地、组播和未指定地址。
- LAN 与 localhost 默认允许，因为本项目面向用户自有服务器；可以在设置中关闭。
- 局域网发现只请求 `11434/api/version`，仅扫描活动 RFC1918 IPv4 接口所在的
  有界网段；每个接口最多扫描本机所在 `/24`，最多选择 4 个网段、1,024 个地址。
- 发现阶段可以跨不同 IP 并行；发现后的模型同步复用每服务器串行队列。发现节点
  默认不获得生成测速授权。
- FOFA 与 Shodan 仅作为本地导出文件格式支持；应用不连接它们的搜索、地图或其他 API。
- 本地状态使用紧凑流式 JSON 写入；扫描和测速采用有界检查点并在任务结束时最终落盘，
  不会为每条增量结果重写整份快照。

请勿测试不属于你或未授权你使用的服务器。公网可访问不代表允许消耗其算力。

## 开发

要求 Node.js 22 或更高版本，以及 Rust stable 工具链。Linux 还需要
Tauri 官方列出的 WebKitGTK 4.1 等系统依赖。

```bash
npm install
npm run dev
```

常用检查：

```bash
npm run typecheck
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

生成当前平台安装包：

```bash
npm run dist
```

Tauri 会在 `src-tauri/target/release/bundle/` 下生成当前平台的安装包及更新产物。
macOS、Windows 与 Linux 安装包应分别在对应操作系统构建；GitHub Actions 的发布
矩阵也遵循这一约束。

## 版本与发布

应用版本使用 `A.B.C`：

- `A.B` 从 `package.json` 手动维护。调整时运行
  `npm version A.B.0 --no-git-tag-version`，它会同时更新 lockfile。
- `C` 自动使用当前 Git HEAD 的可达提交总数。同一 commit 在本地和 GitHub Actions
  中会得到相同版本；仓库还没有首个 commit 时为 `0`。

查看当前完整版本：

```bash
npm run version:current
```

推送到 `main` 或手动运行工作流时，GitHub Actions 会先运行 TypeScript、React 和
Rust 检查，再在 macOS Apple Silicon、macOS Intel、Windows x64 和 Linux x64 上
并行构建。四个平台全部成功后，工作流会自动发布匹配版本（例如 `v0.1.37`）的
GitHub Release，并附带 Tauri 的 `latest.json`、安装包和签名；不需要手动创建 tag。
Pull Request 只运行检查，不发布 Release。

应用启动后会自动检查上述 GitHub Release，也可以点击左下角当前版本右侧的“检查
更新”手动重新检查。找到更高版本后，界面会提示可用版本；点击更新会先显示版本号和
GitHub Release 升级内容，用户确认后才下载、校验并安装签名更新。安装完成后应用不会
自动重启，而是提供“现在重启”按钮，由用户决定何时进入新版本。为了确保 Release
永远能被客户端安全验证，发布前必须配置：

- `TAURI_SIGNING_PRIVATE_KEY`：与 `src-tauri/tauri.conf.json` 中公钥配对的私钥
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：私钥密码；无密码密钥可留空

私钥不得提交到仓库。当前维护者生成的本机密钥默认位于
`~/.tauri/ollama-profiler.key`，应另做安全备份。

配置以下 GitHub Secrets 后，同一工作流也会使用 Developer ID 签名并提交 Apple
notarization；未配置时仍可构建，但首次打开可能被 Gatekeeper 拦截：

- `MAC_CSC_LINK`：Developer ID Application `.p12` 的 Base64 内容
- `MAC_CSC_KEY_PASSWORD`：证书导出密码
- `APPLE_ID`：Apple Developer 账号
- `APPLE_APP_SPECIFIC_PASSWORD`：Apple ID 专用密码
- `APPLE_TEAM_ID`：10 位 Team ID

Windows 安装包目前未做 Authenticode 签名，SmartScreen 可能显示未知发布者。

可编辑的主图标位于 `build/icon.svg`，Tauri 打包图标位于 `src-tauri/icons/`。

## 导入格式

Shodan CLI 的压缩 NDJSON 文件可直接导入，无需解压：

```bash
shodan download --limit 1000 ollama 'port:11434 "Ollama is running"'
```

FOFA/通用表格可使用以下任一字段：

- 地址：`endpoint`、`link`、`url`、`host`、`hostname`、`domain`、`ip`
- 连接：`port`、`protocol`、`scheme`
- 元数据：`country_name`、`region`、`city`、`asn`、`org`、`organization`

导入前会显示有效、重复、无效行和地址样本；确认后才写入本机数据文件并开始并行扫描。

## 架构

- Tauri/Rust 核心：文件访问、Ollama 网络请求、本地持久化与任务调度
- Tauri commands 与 capabilities：受限的类型化 IPC，渲染器没有 Node.js 权限
- React/TypeScript：桌面界面、筛选、导入预览和性能历史
- JSON 文档存储：原子写入应用用户目录，避免原生数据库扩展的跨平台打包负担
- Tauri updater：从 GitHub Release 读取 `latest.json`，只安装签名匹配的更新

项目的第一目标是可靠的本地 profiling。公网资产来源只通过用户主动选择的导出文件
导入，不在应用内连接搜索或地图 API。

## License

MIT
