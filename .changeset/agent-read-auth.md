---
'@aihu/agent-service': patch
'@aihu/agent-server': patch
---

Require host authorization before serving agent state reads, resolve tenant actors from live host lookups, and bind browser bridge sessions to one-use nonces with per-invocation reauthorization.
