---
"@aihu/plugin": patch
"@aihu/server": patch
"@aihu/cli": patch
---

Reconcile `@aihu/plugin`'s source version with npm (0.1.1 was published from a source that recorded 0.1.0). Deprecate `@aihu/server`'s duplicate `AihuConfig` type and `defineAihuConfig` helper in favor of `@aihu/app`'s `AihuConfig` and `defineConfig`; both remain exported for compatibility.
