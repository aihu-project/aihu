---
"@aihu/router": patch
"@aihu/app": patch
---

A push navigation (a clicked link, or `navigate()` without `replace`) now scrolls the new page to its `#fragment` target, or to the top when there is none, instead of leaving it at the previous page's scroll offset. Replace navigations keep the scroll position, and back/forward keep the browser's own scroll restoration.
