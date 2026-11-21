# AiCAD 0.4.0 engineering preview

AiCAD now opens an editable geometry workspace. Choose 3D or 2D, configure unified or separate text-model roles, provide a prompt and references, and generate a structured document validated locally before it enters project history.

- Added OpenCascade WASM solids, parameter formulas, rectangular/circular extrusion, booleans, translation, all-edge fillet/chamfer, suppression, undo/redo and STEP/STL export.
- Added editable 2D entities, layers, move/arrays, hidden-line projection, SVG/DXF, physical-size sheets and 1:1 cutting export.
- Preserved the legacy workspace, project storage, provider settings and Windows single-EXE host.
- Added bounded repair attempts, cancellation checks, mutation guards and source geometry preservation on failed projection.

This is a prerelease. The attached design guides describe capabilities beyond this preview. Full sketch constraint solving, advanced assembly/kinematics, freeform/SubD modeling, revolve/sweep/shell, DWG/IGES/Parasolid, PDF, full drafting-standard automation and complete engineering UI localization are not implemented. Fillets/chamfers currently apply to all edges of their input body. Projection curves may be discretized. Review drawings and dimensions before manufacturing.

Validation: 23 frontend test files / 216 tests passed; production TypeScript/Vite build passed; real OpenCascade kernel regressions passed; Windows Go tests passed; EXE launch and native icon handles passed. Browser checks covered solid creation, dimension changes, projection into 24 editable vectors, move/array/undo and project save/reopen across the implementation. Live credentialed AI-provider end-to-end tests were not performed. The EXE embedded HTTP assets were also tested in Chromium: a box computed 38,400 mm³ / 103.68 g and projected into 24 editable vectors. Native WebView2 interaction, desktop close prompts and updater behavior require further runtime coverage.

Dependencies retain their own licenses. Geometry license texts and replacement/rebuild instructions are embedded under /licenses/.
