# AiCAD

AiCAD 是 Windows 免安装应用程序，结合 AI 图纸生成与本地 2D CAD 编辑工作区。

[English](README.md) | [繁體中文](README.zh-Hant.md) | **简体中文**

## 徽章

[![Release](https://img.shields.io/github/v/release/2mf-hermes/AiCAD)](https://github.com/2mf-hermes/AiCAD/releases)
[![MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Windows](https://img.shields.io/badge/Windows-10%2F11%20x64-blue)

## 特色功能

- 根据描述、尺寸、参考图片与文本文档生成图纸影像。
- 草稿优先流程：文字模型先产生经安全处理的 SVG 几何，辅助生图；草稿失败时回到原有生成流程。
- 文字、视觉、生图与局部重绘模型可分别选择，取决于 Provider 支持的能力。
- 标题栏与自定义字段可由程序绘制、生图模型产生，或以文字模型辅助后期叠加。
- 本地 CAD 工作区提供图层、对象捕捉、尺寸标注、编辑命令、撤销与项目保存。
- 单一 EXE，内嵌前端与 Windows 图标，限制单实例。
- 使用 GitHub Releases 更新，安装前强制验证 SHA-256，保留本地清单与环境变量覆盖。

**限制：** AI 输出并非经过验证的工程图；生成图片不会自动转换成可编辑 CAD 图元。使用前须人工检查尺寸与几何。AI 功能需要配置 Provider、联网，并可能产生 API 费用；提示与附件会发送至所选 Provider。

## 安装与环境需求

### 直接运行

从 [Releases](https://github.com/2mf-hermes/AiCAD/releases) 下载 `AiCad.exe` 与 `SHA256SUMS.txt`。需要 Windows 10/11 x64 与 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)；若缺少 WebView2 请先安装。运行 EXE 不需要 Node.js 或 Go。

```powershell
Get-FileHash .\AiCad.exe -Algorithm SHA256
# 与 SHA256SUMS.txt 比对后运行
.\AiCad.exe
```

### 源代码构建

需要 Windows x64、Node.js 22 LTS、Go 1.23.5 或兼容新版、PowerShell 5.1+；不需要 C 编译器。

```powershell
git clone https://github.com/2mf-hermes/AiCAD.git
cd AiCAD
npm ci
powershell -ExecutionPolicy Bypass -File build.ps1
```

输出：`dist-exe\AiCad.exe`。构建会复制前端资源到 `web\` 供 Go 内嵌；全新下载的源代码须先构建，再运行 Go 测试。

## 使用方式

1. 启动 EXE，打开 Provider 设置。
2. 设置端点、API 密钥与支持的文字、视觉、生图、局部重绘模型。
3. 选择图纸类型、尺寸、线条风格与文字模式，按需添加参考文件。
4. 生成并检查结果，编辑本地 CAD 对象，保存项目。

输入示例：

```text
法兰正视图，中央内孔 40 mm，四个螺栓孔。
使用黑色工程线条与程序绘制的标题栏。
```

预期输出：

```text
画布显示生成的图纸影像与设置的标题栏。
几何与标签因模型而异，须人工检查。
```

开发与验证：

```powershell
npm run dev       # 前端预览；桌面宿主功能须使用 EXE
npm test
npm run typecheck
npm run build
powershell -ExecutionPolicy Bypass -File build.ps1 -SkipWeb
go test ./...
```

### 更新与发布

在“设置 → 更新”检查新版。来源顺序：明确配置的 `AICAD_UPDATE_FEED`；已有本地清单；官方 `https://api.github.com/repos/2mf-hermes/AiCAD/releases`。Stable 排除预发布与草稿。Release 必须包含 `AiCad.exe`，以及有效的附件 SHA-256 digest 或 `SHA256SUMS.txt`。

维护者确认代码已审查并提交、GitHub CLI 已登录后，可运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.2.0
```

脚本构建 EXE、生成校验码并上传附件。每次发布使用新版本号。校验码可检测损坏，但不代替代码签名或 GitHub 账号的可信度。

## 贡献指南与授权

欢迎在 [Issues](https://github.com/2mf-hermes/AiCAD/issues) 提供复现步骤、预期与实际结果、OS 与 Provider 信息。勿附 API 密钥或私人项目。创建主题分支、补充回归测试，再向 `main` 提交 Pull Request；提交前运行前端测试、Windows 构建与 Go 测试。

请保持存档兼容性、Provider 路由、参考素材处理、变更状态、单实例与校验码验证。

项目代码采用 [MIT 授权](LICENSE)。依赖保留各自授权；npm 清单见 [`dependency-licenses.json`](dependency-licenses.json)，Go 依赖见 [`go.mod`](go.mod)。
