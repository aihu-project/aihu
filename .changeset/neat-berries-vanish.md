---
'@aihu/css-engine': patch
'@aihu/primitives': patch
---

Move dependency-free progressive positioning to `@aihu/arbor/progressive` so
headless primitives no longer depend on the CSS provider. The CSS provider
continues to export its existing positioning API as a compatibility façade.
