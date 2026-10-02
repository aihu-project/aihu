---
'@aihu/agent-service': minor
'@aihu/agent-server': minor
---

Require host authorization before serving agent state reads, resolve tenant actors from live host lookups, recursively project results, and bind browser bridge sessions to one-use connection nonces with per-invocation reauthorization. Migration: bridge clients must speak protocol v2 and send `nonce`, `sessionToken`, `sessionIdentity`, and the verified `grantVersion` in `hello`; hosts must return `{ identity, grantVersion? }` from both `verifyBridgeSession` and `reauthorizeBridgeInvoke`, and supply `actorResolver` and `authorizeDataRead` for protected state reads. `securityHookTimeoutMs` and `bridgeCallTimeoutMs` configure bounded hook/call waits (5000ms defaults).
