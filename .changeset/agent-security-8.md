---
'@aihu/agent-server': minor
---

Add admission limits for the entire bridge call path: `maxInFlightBridgeCalls` defaults to 1,024 server-wide, and `maxInFlightBridgeCallsPerTenant` defaults to 64 per verified actor organization. Excess calls return 503 `BRIDGE_OVERLOADED`; the server-wide limit rejects before any authorization hook, handshake waiter, or timer is created. Calls without a verified actor share one tenant bucket. Pending-call caps remain in force, with one slot reserved for another tenant when capacity permits.

Migration: hosts expecting more concurrency should raise these new limits, along with `maxPendingBridgeCalls` and `maxPendingBridgeCallsTotal` where needed. Configure a pending cap above one to allow simultaneous cross-tenant forwarding. An upstream rate limit is still recommended.
