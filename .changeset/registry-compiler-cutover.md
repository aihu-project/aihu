---
'@aihu/app': patch
'@aihu/css-engine': patch
'@aihu/tsc': patch
'@aihu/language-server': patch
---

Resolve compiler integrations through the published `@aihu/compiler` package instead of the monorepo source tree. `@aihu/app` now declares the compiler as a runtime dependency so its public Vite integration installs correctly for consumers.
