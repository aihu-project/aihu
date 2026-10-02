---
"@aihu/app": patch
---

A popstate that changes only the URL hash (a native same-page `#fragment` link, or back/forward between fragments of one page) no longer re-renders the route. The re-render replaced the outlet's DOM and dropped the focus the browser or the page had just moved, which broke skip links and in-page focus targets.
