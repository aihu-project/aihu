---
'@aihu/cli': patch
'@aihu/ui': patch
---

Expose the UI registry catalog types from `@aihu/ui/registry` and make the CLI
consume that public contract instead of importing the UI package's source tree.
