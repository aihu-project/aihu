---
"@aihu/app": patch
---

The app's delegated link handler now defers to `@aihu/router`'s `shouldInterceptLinkClick`, so Ctrl/Cmd/Shift/Alt and middle clicks, `target`/`download` links, other origins and same-page fragments stay native instead of navigating the current tab. A second `createApp()` on the same document (dev HMR re-running the entry) now replaces the previous app's document listeners instead of stacking them.
