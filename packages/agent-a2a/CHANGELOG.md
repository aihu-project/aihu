# @aihu/agent-a2a

## 1.0.2

### Patch Changes

- Updated dependencies [[`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f), [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f), [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f), [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f), [`cf6c68c`](https://github.com/aihu-project/aihu/commit/cf6c68c60811890b643479085fbff7f98eeb875f)]:
  - @aihu/agent-service@0.5.0

## 1.0.1

### Patch Changes

- Updated dependencies [[`ac47af2`](https://github.com/fellwork/aihu/commit/ac47af2431dde2ccb7fbde98955f74552eeabe88)]:
  - @aihu/agent-service@0.4.0

## 1.0.0

### Major Changes

- [#455](https://github.com/fellwork/aihu/pull/455) [`5b2f3c7`](https://github.com/fellwork/aihu/commit/5b2f3c7d95c3e8075b53137eb7f87f436d5fcb28) Thanks [@srmcguirt](https://github.com/srmcguirt)! - Conform to the Agent2Agent (A2A) Protocol Specification v1.0.1
  (https://a2a-protocol.org/v1.0.1/specification), JSON-RPC 2.0 binding ([#428](https://github.com/fellwork/aihu/issues/428)).
  The 0.1.x wire was a shim that implemented neither the old nor the new spec;
  it is removed entirely — this is a breaking wire change.

  **New wire:**

  - `GET {prefix}/.well-known/agent-card.json` — real AgentCard (spec §4.4.1):
    `supportedInterfaces` (`JSONRPC`, protocol version `1.0`), `capabilities`
    (`streaming: true` is now real, `pushNotifications: false`), and `skills`
    with the REQUIRED `id`/`name`/`description`/`tags` fields.
  - `POST {prefix}/a2a` — JSON-RPC 2.0 endpoint with the spec's PascalCase
    methods: `SendMessage`, `SendStreamingMessage` (SSE), `GetTask`, `ListTasks`,
    `CancelTask`, `SubscribeToTask`; push-notification config methods answer
    `-32003`, `GetExtendedAgentCard` answers `-32007`. Standard and A2A-specific
    error codes per spec §5.4/§9.5 (`-32700`…`-32603`, `-32001` TaskNotFound,
    `-32002` TaskNotCancelable, `-32004` UnsupportedOperation).
  - Typed `Message`/`Part` model (camelCase JSON, ProtoJSON enums like
    `ROLE_USER`, `TASK_STATE_COMPLETED`). Skill addressing replaces the
    `body.message === "tag/action"` string hack: a data part
    `{ "data": { "skill": "<tag>/<action>", "params": { … } } }` or a text part
    containing the skill id.
  - A `TaskStore` (in-memory default, injectable via `options.taskStore`) makes
    `GetTask`/`ListTasks`/`CancelTask` implementable; `SendMessage` on a
    non-terminal task id continues that task.
  - Real SSE streaming: each frame is a full JSON-RPC response wrapping a
    `StreamResponse` (`task` → `statusUpdate` → `artifactUpdate` → terminal
    `statusUpdate`). The pre-rendered `[DONE]` sentinel (an OpenAI convention,
    never A2A) is gone — terminality is the task state.
  - AT1 tier-0 attribution is preserved: `options.resolveAuth` threads a
    `RequestContext` into every dispatch; gate verdicts map onto task states
    (401 → `TASK_STATE_AUTH_REQUIRED`, resumable; 403 → `TASK_STATE_REJECTED`)
    with the full gate envelope in a status-message data part for audit.

  **Removed (breaking):** `GET /.well-known/agent.json`, `POST /a2a/tasks/send`,
  `POST /a2a/tasks/sendSubscribe`, the string `message` field, `body.taskId`,
  and the `{ taskId, status, result | error }` response shape. The ~249 lines of
  tests that validated that invented shape were deleted and replaced with
  spec-fixture conformance tests.

### Patch Changes

- Updated dependencies [[`889830d`](https://github.com/fellwork/aihu/commit/889830d907e83b7d74dc8e64503d8bb4b4711812), [`549448c`](https://github.com/fellwork/aihu/commit/549448cd042ba89b94ddb291be741f015c3d0d9c), [`e01f19d`](https://github.com/fellwork/aihu/commit/e01f19d70eabe867b8b8c310a6928b9576461cf0)]:
  - @aihu/agent-service@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`a54ca1b`](https://github.com/fellwork/aihu/commit/a54ca1b8874583a0301e84c91f2d25713908e41f)]:
  - @aihu/agent-service@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`eacba9c`](https://github.com/fellwork/aihu/commit/eacba9c66145c1f208e108cea642e75b2d788185)]:
  - @aihu/agent-service@0.1.3
