# Codex Desktop Rebuild

基于 OpenAI 官方 Codex Desktop 安装包进行重构和增强的非官方项目，提供 Windows 构建、自动更新，以及 macOS、Linux 的本地构建支持。

- 仓库：[AnLifeX/CodexDesktop-Rebuild](https://github.com/AnLifeX/CodexDesktop-Rebuild)
- 下载：[GitHub Releases](https://github.com/AnLifeX/CodexDesktop-Rebuild/releases/latest)
- Windows 更新源：[windows-update-feed](https://github.com/AnLifeX/CodexDesktop-Rebuild/releases/tag/windows-update-feed)

## 核心优化

- **独立 Windows 自动更新**：使用本仓库自己的更新源，支持断点续传、下载校验和代理加速。
- **智能残差更新**：在查询阶段规划完整残差链，仅当链路完整且总大小小于完整包时使用，否则直接选择完整包。
- **中文本地化**：启用中文界面，补充缺失翻译，并汉化原生菜单与硬编码标题。
- **Windows 10 兼容**：修复 Computer Use 截图接口兼容问题，并提供截图回退方案。
- **客户端功能增强**：改善 Fast 模式、插件、内置浏览器及 Computer Use 的本地可用性判断。
- **会话管理增强**：支持在侧边栏和归档列表中永久删除会话，并修复旧本地会话被隐藏的问题。

> [!IMPORTANT]
> 本项目不是 OpenAI 官方发行版，也不隶属于 OpenAI。构建过程会下载官方应用资源和官方 Codex CLI，再对桌面端代码进行补丁和重新打包。项目不会赋予账号额外的云端权限、模型权限或额度。

## 项目定位

本项目尽量跟随官方 Codex Desktop 的新版本，不重新实现整个客户端，而是在官方资源基础上完成以下工作：

1. 同步并解包官方应用。
2. 通过严格的结构匹配应用本项目补丁。
3. 重新打包为适合目标平台使用的产物。
4. 对补丁结果执行后置校验，避免上游结构变化后静默生成错误安装包。
5. Windows 新版本通过 GitHub Actions 自动构建、验证并发布。

## 相对官方版的主要改动

### 中文本地化

- 强制启用应用内置的国际化功能，避免远端功能开关关闭中文界面。
- 补充官方 `zh-CN` 语言包中缺失的中文文案，并修正已经确认的错误翻译。
- 汉化 Electron 原生菜单、右键菜单、命令菜单和部分硬编码标题。
- 关于页面显示 `© OpenAI · Rebuilt by AnLifeX`。

### Fast 模式与插件可用性

- 允许 API Key 登录方式进入 Fast 模式的本地判断流程，最终是否显示仍由当前模型和服务层级决定。
- 移除插件功能仅允许 ChatGPT 登录的本地限制。
- 放开内置浏览器、Computer Use 等功能的客户端可用性和远端灰度开关限制。
- 保留官方协议和服务端校验；补丁只改变本地客户端的入口与判断，不代表所有账号、模型或 API 服务都一定支持相关能力。

### 会话管理

- 在归档列表中增加永久删除按钮。
- 在主侧边栏会话行中增加永久删除操作。
- 删除操作使用行内二次确认，避免误触；确认后会调用官方 `thread/delete` 协议，同时删除数据库记录和对应会话文件，此操作不可恢复。
- 修正切换登录方式、提供商或本地主机标识后，旧的本地会话可能被错误隐藏的问题；明确配置的远程主机和远程项目仍按原逻辑处理。

### Windows 兼容性

- 修正 Squirrel.Windows 解包时原生模块路径过深的问题。
- 兼容 Windows 10 上 Computer Use 截图接口缺少可选 COM 接口时的情况。
- 为 Windows.Graphics.Capture 无法返回首帧等情况增加 GDI/PrintWindow 截图回退。

### 独立 Windows 更新器

- 禁用官方 Sparkle/MSIX 更新入口，防止重构版本被更新回官方商店版。
- 接入本仓库自己的 Squirrel.Windows 更新源和应用内更新窗口。
- 下载内容先写入 `.partial` 缓存，网络中断或应用重启后可通过 HTTP Range 继续下载。
- 下载完成后必须通过 `RELEASES` 中记录的文件大小和 SHA1 校验，代理下载也不会跳过校验。
- 校验后的包通过仅监听本机的临时更新源交给 Squirrel，避免安装阶段再次下载同一文件。
- 支持在更新窗口中填写 GitHub 加速前缀，也支持通过环境变量统一配置镜像和代理顺序。

#### 完整包与残差包的选择

Windows 更新源始终保留最新完整包，并最多保留 5 个连续版本的残差包；`delta-chain.json` 记录每个残差包准确的起始版本和目标版本。

客户端会在查询更新阶段先完成整条路径规划，只有同时满足以下条件才选择残差包：

1. 从当前已安装版本到最新版之间的残差链完整连续。
2. 链上的每个残差包及版本关系都有效。
3. 所需残差包的总大小小于最新版完整包。

只要缺少任意中间版本、当前版本早于保留窗口、清单无效，或残差包总和不再划算，客户端就会在开始下载前直接选择完整包。

可用的环境变量：

```powershell
# 使用自定义的完整更新源
$env:CODEX_REBUILD_UPDATE_URL = "https://mirror.example/windows-update-feed"

# 覆盖 GitHub 加速前缀；设置为空字符串可关闭代理回退
$env:CODEX_REBUILD_UPDATE_PROXY_PREFIXES = "https://ghfast.top/;https://gh-proxy.com/"

# 优先尝试代理，再尝试 GitHub 直连
$env:CODEX_REBUILD_UPDATE_PROXY_FIRST = "1"
```

## 支持情况

| 平台 | 架构 | 本地构建 | 自动发布 | 项目内更新器 |
| --- | --- | --- | --- | --- |
| Windows | x64 | 支持 | 支持，当前主线 | 支持 |
| macOS | x64、arm64 | 支持 | 仅手动流程 | 不提供 |
| Linux | x64、arm64 | 支持 | 不提供 | 不提供 |

当前 CI/CD 主线只自动跟踪和发布 Windows x64。macOS 和 Linux 构建脚本仍保留，但需要在对应环境中自行准备签名、打包工具和其他平台依赖。

## 下载与安装

进入 [最新版本下载页](https://github.com/AnLifeX/CodexDesktop-Rebuild/releases/latest)，Windows 发布通常包含两种文件：

- `CodexSetup-win-x64-<版本>.zip`：安装版。解压后运行其中的安装程序，推荐日常使用，并由项目内更新器管理后续升级。
- `Codex-win-x64-<版本>.zip`：便携构建。解压后直接运行，适合临时使用和排查问题。

> [!WARNING]
> Windows 构建不是 OpenAI 官方签名版本，系统可能显示 SmartScreen 或来源未知提示。请只从本仓库 Releases 下载，并自行判断是否继续运行。

从旧版本升级时，更新器会自动根据当前版本、残差链完整性和下载大小选择最合适的包，无需手动逐版安装。

## 本地构建

建议使用 Node.js 24，并先安装 Git、平台编译工具及对应的打包依赖。

### Windows x64

```powershell
git clone https://github.com/AnLifeX/CodexDesktop-Rebuild.git
cd CodexDesktop-Rebuild
npm ci

# 只同步 Windows 官方资源
node scripts/sync-upstream.js --skip-mac

# 构建便携包和 Squirrel 安装包
npm run build:win-all
```

产物会写入 `out/`。同步得到的 `src/`、构建产物和下载缓存都不会提交到 Git。

### 其他构建命令

```bash
# macOS
npm run build:mac-arm64
npm run build:mac-x64

# Linux
npm run build:linux-x64
npm run build:linux-arm64

# 已经同步资源时，仅应用或检查补丁
npm run patch:win
node scripts/patch-all.js win --check

# 开发模式
npm run dev
```

macOS 正式分发需要自行配置 Apple 签名与公证信息；没有正式证书时，脚本只能进行本地或 ad-hoc 签名构建。

## 自动构建与发布

GitHub Actions 每天 `08:30 UTC`（北京时间 `16:30`）检查一次官方 Windows 新版本。检测到版本变化后会：

1. 下载并校验官方 Windows MSIX。
2. 读取官方内部版本和其中捆绑的 Codex CLI 版本。
3. 应用全部补丁并执行严格的结果验证。
4. 构建便携包、Squirrel 安装包、完整更新包和残差更新包。
5. 验证发布元数据、更新源和残差链。
6. 发布 GitHub Release 与 Windows 更新源，并把新版本元数据提交回 `master`。

仓库还提供手动构建、残差包测试以及 Windows/macOS 发布提升工作流。Windows 发布流程共用同一个并发锁，避免两个任务同时改写 Windows 更新源；其他独立流程也分别限制并发执行。

## 项目结构

```text
├── .github/workflows/       # 自动同步、构建、测试和发布流程
├── resources/               # 图标、声音等重构资源
├── scripts/                 # 同步、补丁、验证、打包和发布脚本
│   └── assets/              # Windows 兼容性补丁所需资源
├── src/                     # 同步后生成的官方资源，不提交到 Git
├── out/                     # 本地构建产物，不提交到 Git
├── forge.config.js          # Electron Forge 打包配置
└── package.json             # 项目版本、命令和依赖
```

补丁脚本采用 AST、结构签名或精确二进制锚点定位目标，并尽量保持幂等。当官方版本改变关键结构、目标缺失或出现多个歧义目标时，构建会失败并等待适配，而不是继续发布未经验证的包。

## 注意事项

- 永久删除会话不可撤销，请确认后再操作。
- 插件、Fast 模式、浏览器和 Computer Use 的实际能力仍受服务端、账号、模型及 API 提供商限制。
- 项目跟随官方应用更新，官方代码结构变化时，补丁可能需要重新适配。
- 自建镜像或代理必须完整提供更新源文件；客户端仍会依据官方发布清单校验下载包。
- 请勿把第三方构建误认为 OpenAI 官方客户端或官方技术支持渠道。

## 致谢

- [OpenAI Codex](https://github.com/openai/codex)：Codex CLI 及官方应用基础。
- [Electron Forge](https://www.electronforge.io/)：Electron 打包工具链。

## 许可与上游内容

OpenAI Codex CLI 依据其上游仓库声明采用 Apache-2.0 许可证。官方 Codex Desktop 应用资源、第三方依赖及其他内容分别受其各自许可和条款约束；使用、修改或分发本项目构建产物前，请自行确认适用的许可与服务条款。
