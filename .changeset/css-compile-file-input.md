---
'@aihu/css-engine': patch
---

Pass compiler input as a temporary file instead of piping it through stdin, which could stall for the full timeout under load. CSS compile errors now name the component path.
