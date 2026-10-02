---
'@aihu/css-engine': patch
---

Comments inside `@theme { }` no longer drop the whole project theme. A bare `:root { --token: value }` block used in place of `@theme` is now a compile error that points to `@theme`. Compound selectors such as `:root.dark` remain ordinary CSS.
