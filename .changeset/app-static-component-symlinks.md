---
"@aihu/app": patch
---

`output: 'static'` component discovery no longer treats a symlink as escaping the components directory when it resolves into another configured `dir.components` entry, or into a directory Vite's `server.fs.allow` already permits serving. A workspace that shares components across apps via symlinks previously got those components prerendered as empty elements, diverging from the client-rendered DOM.
