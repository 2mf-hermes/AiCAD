# AiCAD

AiCAD is a portable Windows application for AI-assisted drawing generation and local 2D CAD editing.

**English** | [繁體中文](README.zh-Hant.md) | [简体中文](README.zh-Hans.md)

## Badges

[![Release](https://img.shields.io/github/v/release/2mf-hermes/AiCAD)](https://github.com/2mf-hermes/AiCAD/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/Windows-10%2F11%20x64-blue)

## Features

- Generate drawing images from descriptions, dimensions, reference images and text documents.
- Draft-first pipeline: a text model produces sanitized SVG geometry to guide image generation. Draft failure falls back to the original generation flow.
- Separate text, vision, image-generation and inpainting model selections, subject to provider capabilities.
- Application-rendered title blocks and custom fields, image-model text, or text-model-assisted overlays.
- Local CAD workspace with layers, object snapping, dimensions and editing commands; project persistence and undo history.
- Portable single EXE with embedded frontend, Windows icons and single-instance handling.
- GitHub Releases update source with mandatory SHA-256 verification before installation; local manifest and environment-variable overrides remain available.

**Limits:** AI-generated output is not a validated engineering drawing. Generated images are not automatically converted into editable CAD entities. Review dimensions and geometry before use. AI features require a configured provider, network access and potentially paid API usage. Prompts and attachments are sent to the selected provider.

## Installation & Prerequisites

### Run the application

Download `AiCad.exe` and `SHA256SUMS.txt` from [Releases](https://github.com/2mf-hermes/AiCAD/releases). Windows 10/11 x64 and the [Microsoft WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) are required. Install WebView2 if it is missing; Node.js and Go are not required to run the EXE.

```powershell
Get-FileHash .\AiCad.exe -Algorithm SHA256
# Compare the hash with SHA256SUMS.txt, then launch:
.\AiCad.exe
```

### Build from source

Use Windows x64, Node.js 22 LTS, Go 1.23.5 or a compatible newer version, and PowerShell 5.1+. No C compiler is required.

```powershell
git clone https://github.com/2mf-hermes/AiCAD.git
cd AiCAD
npm ci
powershell -ExecutionPolicy Bypass -File build.ps1
```

Output: `dist-exe\AiCad.exe`. The build copies frontend assets to `web\` for Go embedding. A clean checkout must build these assets before running Go tests.

## Usage

1. Launch the EXE and open provider settings.
2. Configure the endpoint/API key and select supported text, vision, image-generation and inpainting models.
3. Choose the drawing type, dimensions, line style and text-rendering mode. Optionally attach reference files.
4. Generate, inspect the result, edit local CAD objects and save the project.

Example drawing description:

```text
Front view of a flange with a 40 mm central bore and four bolt holes.
Use black technical lines and an application-rendered title block.
```

Expected result:

```text
A generated drawing image in the canvas, with the configured title block.
Geometry and labels vary by model and require manual review.
```

Development and validation:

```powershell
npm run dev       # Frontend preview; desktop host functions need the EXE
npm test
npm run typecheck
npm run build
powershell -ExecutionPolicy Bypass -File build.ps1 -SkipWeb
go test ./...
```

### Updates and publishing

Use Settings → Update to check for a new version. Source precedence is: explicit `AICAD_UPDATE_FEED` override; existing local manifests; official `https://api.github.com/repos/2mf-hermes/AiCAD/releases`. Stable excludes prereleases and drafts. Releases must include `AiCad.exe` and a valid SHA-256 asset digest or `SHA256SUMS.txt`.

Maintainers with an authenticated GitHub CLI can publish from a reviewed, committed checkout:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.2.0
```

This builds the EXE, writes its checksum and uploads both as release assets. Use a new version number for each release. Checksums detect corruption; they are not a substitute for code signing or a trusted GitHub account.

## Contributing & License

Open an [issue](https://github.com/2mf-hermes/AiCAD/issues) with reproduction steps, expected/actual behavior and OS/provider details. Never include API keys or private project files. Create a topic branch, add regression tests and submit a pull request against `main`. Run frontend tests, the Windows build and Go tests before submitting.

Keep saved-project compatibility, provider routing, reference handling, dirty-state semantics, single-instance behavior and checksum verification intact.

Project code is under the [MIT License](LICENSE). Dependencies retain their own licenses; see [`dependency-licenses.json`](dependency-licenses.json) for the generated npm inventory and [`go.mod`](go.mod) for Go dependencies.
