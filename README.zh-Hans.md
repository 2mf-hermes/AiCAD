# AiCAD

AiCAD 是 Windows 免安装的 AI 可编辑 3D 建模与 2D CAD 制图程序。

[English](README.md) | [繁體中文](README.zh-Hant.md) | **简体中文**

## 徽章

[![Release](https://img.shields.io/github/v/release/2mf-hermes/AiCAD)](https://github.com/2mf-hermes/AiCAD/releases)
[![MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Windows](https://img.shields.io/badge/Windows-10%2F11%20x64-blue)

## 特色功能


- 先选 3D 或 2D，再输入需求、加入参考文件与选择性精炼提示词。
- AI 生成结构化特征文档，由本地 OpenCascade WASM 建立实体；无效结果最多自动修复三轮。
- 支持参数与公式、选取特征后局部 AI 修改、特征抑制、撤销与重做。
- 实体支持方体、圆柱、球体、矩形／圆形拉伸、布尔、平移与全边圆角／倒角。
- 向量支持直线、矩形、圆、圆弧、文字、图层、移动与有上限的阵列；实体可投影为前／俯／右视图，分离可见线、隐藏线及中心线。
- 导出 STEP／STL／JSON、SVG／DXF、实际纸张尺寸图纸与 1:1 切割 DXF。
- AI 可统一模型或分别设置精炼、3D、2D、参考图识别角色，沿用现有 Provider 与项目存储。
- 保留旧生图／CAD 工作区、Windows 图标、单实例及 GitHub 校验更新。

**支持范围：** 工程工作区提供上述操作；完整草图约束求解、装配体、SubD、扫掠／旋转／抽壳、DWG／IGES／Parasolid 与向量 PDF 尚未实现。ISO／JIS／ASME／CNS 选项记录制图信息，不代表符合标准认证。制造前请核对尺寸。AI 需要设置 Provider，提示词与参考文件会发送至该供应商。

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


1. 选择 **3D 模型** 或 **2D 图纸**。
2. 在设置中添加支持文字模型的 Provider，再选统一模型或工程角色分工。
3. 输入需求与参考文件，调整工程设置后生成；可以先精炼提示词。
4. 修改参数，或选取对象下达局部 AI 指令后保存。现有影像项目从“旧图面”打开。
5. 实体可导出 STEP／STL，投影后可导出 SVG／DXF；切割 DXF 使用实际 1:1 坐标。

示例：`建立 80 × 40 × 12 mm 板件，含两个半径 6 mm 的贯穿孔。`

预期结果：可编辑的特征文档与本地计算的实体；具体特征安排取决于所选模型。


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
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.4.0
```

脚本构建 EXE、生成校验码并上传附件。每次发布使用新版本号。校验码可检测损坏，但不代替代码签名或 GitHub 账号的可信度。

## 贡献指南与授权

欢迎在 [Issues](https://github.com/2mf-hermes/AiCAD/issues) 提供复现步骤、预期与实际结果、OS 与 Provider 信息。勿附 API 密钥或私人项目。创建主题分支、补充回归测试，再向 `main` 提交 Pull Request；提交前运行前端测试、Windows 构建与 Go 测试。

请保持存档兼容性、Provider 路由、参考素材处理、变更状态、单实例与校验码验证。

项目代码采用 [MIT 授权](LICENSE)。依赖保留各自授权；npm 清单见 [`dependency-licenses.json`](dependency-licenses.json)，Go 依赖见 [`go.mod`](go.mod)。
