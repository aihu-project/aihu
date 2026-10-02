---
'@aihu/agent-service': patch
'@aihu/agent-server': patch
---

Bound projection work for Proxy records by reading only requested own properties and rejecting oversized whole-record key sets before describing their entries.

Keep malformed bridge hello objects out of host diagnostics, and pin the per-attachment diagnostic callback cap with a regression.
