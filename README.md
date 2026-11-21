# AiCAD

AiCAD is a portable Windows application for AI-assisted editable 3D modeling and 2D CAD drafting.

**English** | [繁體中文](README.zh-Hant.md) | [简体中文](README.zh-Hans.md)

## Badges

[![Release](https://img.shields.io/github/v/release/2mf-hermes/AiCAD)](https://github.com/2mf-hermes/AiCAD/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/Windows-10%2F11%20x64-blue)

## Features


- Choose 3D or 2D, describe the design, attach references and optionally refine the prompt.
- AI produces a structured feature document; local OpenCascade WASM builds editable solids. Invalid output can receive up to three repair attempts.
- Edit parameters and formulas, select features for local AI changes, suppress features, and undo or redo document edits.
- Solid operations: boxes, cylinders, spheres, rectangular/circular extrusion, booleans, translation and all-edge fillets/chamfers.
- Editable lines, rectangles, circles, arcs and text, with layers, move and bounded arrays. Project solids into front/top/right vectors with visible, hidden and center lines.
- Export STEP/STL/JSON or SVG/DXF, physical-size drawing sheets and 1:1 cutting DXF.
- Unified AI model or separate refinement, 3D, 2D and reference-vision roles; existing providers and project storage remain available.
- Legacy image/CAD workspace, Windows icons, single-instance handling and verified GitHub updates remain available.

**Scope:** The engineering workspace supports the operations listed above. Full sketch constraint solving, assemblies, SubD, sweep/revolve/shell, DWG/IGES/Parasolid and vector PDF are not implemented. ISO/JIS/ASME/CNS selections record drawing metadata; they do not certify compliance. Review generated dimensions before manufacturing. AI requires a configured provider; prompts and references are sent to it.

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


1. Choose **3D model** or **2D drawing**.
2. Configure a text-capable provider in Settings, then select unified or separate engineering model roles.
3. Enter the prompt and optional references, adjust engineering settings, and generate. Prompt refinement is optional.
4. Edit parameters, select objects for local AI instructions, and save the project. Use **Old drawings** to access existing image projects.
5. Export solids as STEP/STL, or project to 2D and export SVG/DXF. Cutting DXF uses actual 1:1 coordinates.

Example: `Create an 80 × 40 × 12 mm plate with two radius-6 mm through-holes.`

Expected result: an editable feature document and locally computed solid; actual feature choices depend on the configured model.


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
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.4.0
```

This builds the EXE, writes its checksum and uploads both as release assets. Use a new version number for each release. Checksums detect corruption; they are not a substitute for code signing or a trusted GitHub account.

## Contributing & License

Open an [issue](https://github.com/2mf-hermes/AiCAD/issues) with reproduction steps, expected/actual behavior and OS/provider details. Never include API keys or private project files. Create a topic branch, add regression tests and submit a pull request against `main`. Run frontend tests, the Windows build and Go tests before submitting.

Keep saved-project compatibility, provider routing, reference handling, dirty-state semantics, single-instance behavior and checksum verification intact.

Project code is under the [MIT License](LICENSE). Dependencies retain their own licenses; see [`dependency-licenses.json`](dependency-licenses.json) for the generated npm inventory and [`go.mod`](go.mod) for Go dependencies.
