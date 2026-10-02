---
'@aihu/agent-server': minor
'@aihu/agent-service': patch
---

Add configurable per-attachment (`maxPendingBridgeCalls`, default 64) and per-server (`maxPendingBridgeCallsTotal`, default 1024) bridge concurrency limits. Calls above either limit return 503 `BRIDGE_OVERLOADED` before a bridge timer or invoke frame is created. Hosts that need higher concurrency can raise both limits; invalid limits are rejected at server creation.

Reject oversized whole-record projections before any descriptor lookup, and document that hosts must normalize untrusted Proxy or exotic values into plain data before registering them.
