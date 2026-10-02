---
'@aihu/agent-service': patch
'@aihu/agent-server': patch
---

Fail closed on untrusted proxy prototype chains, preserve revocation bindings when the bounded store is full, and close duplicate-hello peers with bounded diagnostics. Migration note: deployments that reach `bridgeRevocationMaxEntries` now refuse new bridge handshakes with `BRIDGE_REVOCATION_STORE_FULL` until revocations expire; size the cap and TTL for expected revocation volume. Existing verified, unrevoked bridge sessions remain available.
