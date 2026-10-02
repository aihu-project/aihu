---
"@aihu/router": patch
---

Resolve route, layout, and component directories from Vite's project root, and preserve native link behavior for modified, targeted, downloaded, external, and same-page fragment clicks. SPA fragment navigation now scrolls to and focuses its destination, while active links expose `aria-current="page"` and the `active` class. Router plugin options are also exposed through the aihu module config contract.
