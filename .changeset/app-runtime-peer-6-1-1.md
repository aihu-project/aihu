---
'@aihu/app': patch
---

Fix the `@aihu/runtime` peer pin. `@aihu/app` 10.1.0 imports `@aihu/runtime/app` but pinned `@aihu/runtime` to 6.1.0, which predates that export, so installing the declared peers failed to resolve the import. The workspace runtime version now matches the published 6.1.1 that provides `./app`, so this release pins `@aihu/runtime` 6.1.1 (#843).
