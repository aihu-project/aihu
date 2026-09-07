# `popover` — accessibility (non-modal disclosure)

Headless implementation of a **non-modal popover**: the trigger follows the
WAI-ARIA APG
[Disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) button
wiring (`aria-expanded` + `aria-controls`), and the panel carries the
[Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) role WITHOUT
`aria-modal` — the pattern APG describes as a non-modal dialog. Ships no CSS;
every piece reflects `data-state="open"|"closed"`.

## Roles & ARIA

| Piece | Attribute | Behavior |
|---|---|---|
| `popover-trigger` | `aria-haspopup="dialog"` | Set on connect — the panel is a small dialog-like surface, not a menu |
| `popover-trigger` | `aria-expanded` | Reflects `open` (`"true"`/`"false"`) |
| `popover-trigger` | `aria-controls` | The content's id (`contentId`) |
| `popover-trigger` | `role="button"` / `tabindex="0"` | Set on connect unless the consumer supplied them — the trigger is an autonomous custom element, never a native `<button>` |
| `popover-trigger` | `aria-disabled="true"` | Set on connect when the trigger carries `disabled` |
| `popover-content` | `role="dialog"` | Set on connect unless the consumer supplied a role |
| `popover-content` | **no `aria-modal`** | Deliberate — see "Not a dialog" below |
| `popover-content` | `aria-labelledby` | Falls back to the trigger's id (minted if absent) when the consumer supplied neither `aria-label` nor `aria-labelledby` |
| `popover-content` | `data-placement` | The placement the positioning shim actually resolved (post viewport-collision flip) |

## Keyboard

| Key | On | Behavior |
|---|---|---|
| `Enter` | trigger | Toggles open — handled only when the trigger host itself is the event target. A native `<button>` NESTED inside the trigger already synthesizes a click that bubbles up and toggles, so handling the bubbled keydown too would toggle twice and land back where it started |
| `Space` | trigger | Same as `Enter`, `preventDefault()`ed to suppress page scroll |
| `Escape` | trigger or content | Closes the popover **and returns focus to the trigger** |
| `Tab` | anywhere | Moves normally — focus is **not** trapped (see below) |

Set `data-dismissable-escape="false"` on the content to opt out of Escape
dismissal (same escape hatch `dialog-content` uses).

## Pointer

- Click on the trigger toggles (`disabled` / `aria-disabled="true"` suppresses
  it entirely — no toggle, no event).
- A `pointerdown` anywhere OUTSIDE both the trigger and the content closes the
  popover. The listener is document-level, capture-phase, added when `open`
  flips true and removed when it flips false or the root disconnects.
  Containment is checked against `composedPath()` (shadow-DOM correct) with
  `Node.contains` as the fallback.
- Outside-dismissal does **not** restore focus to the trigger: the pointer is
  already moving focus somewhere deliberately. Only `Escape` restores focus.

## Positioning

Placement REUSES Arbor's dependency-free `position()` utility
(`@aihu/arbor/progressive`) with the trigger as anchor — the same utility
`tooltip` uses. Popover contains no positioning math of its own and adds
no `@floating-ui/dom` dependency. While open, the content re-positions on
capture-phase `scroll` and on `resize`; the listeners are removed on close and
on disconnect.

The resolved `{ x, y, placement }` is published on the root's `coords` signal
(and mirrored on the content's `data-placement`) so a consumer can position an
arrow without recomputing anything.

## Exit timing (`presence-gate`)

Wrap the content in `<aihu-presence-gate>` and the **root** drives the gate's
`present` attribute from `open`, so a closing popover holds its content mounted
until the CSS exit transition/animation ends:

```html
<aihu-popover-root>
  <aihu-popover-trigger>Open</aihu-popover-trigger>
  <aihu-presence-gate>
    <aihu-popover-content>…</aihu-popover-content>
  </aihu-presence-gate>
</aihu-popover-root>
```

The gate is OPTIONAL — without one the content stays mounted and only flips
`data-state`. The root (not the content) drives the gate on purpose: the gate
unmounts its own children on exit, so content-driven wiring would tear out the
very element that has to re-arm presence on the next open.

## State & events

- `open` attribute: two-way reflected (dialog open-attr pattern).
- `setOpen(next)`: signal + attribute write. Does NOT emit.
- `open-change` (detail `{ open: boolean }`, bubbles, composed) is dispatched
  on USER-driven changes only — trigger click/Enter/Space, Escape, outside
  pointerdown. Mirrors switch's `checked-change` / slider's `value-change`.

## Not a dialog — what popover deliberately does NOT do

- **Does NOT trap focus.** No `createFocusTrap`, no Tab wrapping. A popover is
  non-modal: the rest of the page stays reachable by keyboard, and focus
  leaving the panel is legitimate. Focus-trapping is `dialog`'s job — use
  `dialog` when the surface must be modal.
- **Does NOT move focus into the content on open.** The trigger keeps focus;
  the panel's own focusables are reached by Tab. (Only `Escape` moves focus, and
  only back to the trigger.)
- **Has NO backdrop element.** There is no `popover-backdrop` piece and nothing
  is rendered behind the panel — outside dismissal rides a document-level
  `pointerdown` listener instead of a click target. Nothing under the popover
  is inerted or `aria-hidden`.
- **Sets no `aria-modal`.** Announcing a non-modal surface as modal would lie to
  assistive tech about whether the rest of the page is available.
- **No title/description pieces.** Popover panels are small; the accessible name
  falls back to the trigger. Consumers wanting richer semantics set
  `aria-label`/`aria-labelledby` themselves.
- **"Only one popover open at a time"** is a consumer concern and is not
  enforced here (same stance as `tooltip`).
