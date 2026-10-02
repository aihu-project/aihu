# Agent security boundaries

Agent data reads require a host authorization decision against a verified principal before the server returns state. The host may restrict returned object fields with a projection; projections are applied before serialization. An absent, denying, or failing resolver denies the read. Caller-provided tenant identifiers are never authoritative.

Tenant actors are derived only from a verified principal and a current host lookup. Missing lookup results deny tenant-scoped reads. Actor data is returned only from the explicit authorization surface and is excluded from agent metadata and browser bundles.

Browser bridge handshakes require a server-issued one-use nonce and a host-verified session. A channel is bound to the verified session and grant version. The host reauthorizes every invocation; denial or lookup failure prevents forwarding. Origin allowlisting remains an independent control and is not identity proof.
