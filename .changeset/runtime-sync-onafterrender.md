---
'@aihu/runtime': minor
---

Sync the in-tree `@aihu/runtime` with the published `aihu-runtime` satellite's 6.2.0 release, which had drifted ahead of core's copy (aihu#927): adds `onAfterRender(fn)` for component-scoped callbacks after Arbor commits a DOM patch (including initial render), and passes the runtime's light-DOM slot projector into Arbor's top-level hydration hook so adopted server templates project their original light children after hydration. Requires `@aihu/arbor` 4.2.0 or newer.
