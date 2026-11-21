from pathlib import Path
out = Path('public/licenses')
out.mkdir(parents=True, exist_ok=True)
for package in ['replicad', 'replicad-opencascadejs', 'three']:
 (out / (package + '-LICENSE.txt')).write_bytes((Path('node_modules') / package / 'LICENSE').read_bytes())
(out / 'README.txt').write_text('AiCAD third-party geometry components\n\nreplicad 1.2.1: MIT, copyright QuaroTech Sarl.\nthree 0.183.2: MIT.\nreplicad-opencascadejs 1.2.1: LGPL-2.1-only, OpenCascade WASM build.\nThese libraries are distributed without modifications. License texts accompany this file.\n\nAiCAD source and rebuild instructions: https://github.com/2mf-hermes/AiCAD\nInstall the locked dependencies with npm ci. A modified compatible geometry library can replace the corresponding node_modules package, followed by npm run build and build.ps1. AiCAD does not prohibit reverse engineering for debugging modifications to LGPL components.\nUpstream geometry build source: https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs\nPackage source revision: 5e4ad9bb5a35bb9ae0571e91c25fa1897ba0570c\nOpenCascade: https://dev.opencascade.org/resources/download/overview\n', encoding='utf-8')
