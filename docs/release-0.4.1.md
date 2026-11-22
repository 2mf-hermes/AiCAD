# AiCAD 0.4.1 engineering preview

- Added numerical contour offsets for lines, circles, arcs and rectangles. Offsets create editable copies and preserve the source geometry.
- Added rotation about a configurable point and horizontal/vertical mirroring. Rotated rectangles become four connected editable lines. Mirrored arcs preserve the reflected sweep.
- Invalid or collapsed offsets retain the existing document and show an error. Text transformations are explicitly rejected.
- Undo and redo now clear stale selections and previous error messages.

Validation: TypeScript checking and 220 frontend regression tests passed, including real OpenCascade geometry and project compatibility tests. Source text uses CRLF.

This remains an engineering preview. Full sketch constraints, assemblies/kinematics, freeform surface editing and several advanced drawing/export features from the design remain incomplete. No credentialed live AI-provider end-to-end test is claimed.
