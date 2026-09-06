# `tooltip` — accessibility (WAI-ARIA APG Tooltip)

Headless implementation of the WAI-ARIA APG
[Tooltip](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/) pattern. Ships no
CSS; pieces reflect `data-state="open"|"closed"`.

## Conformance mapping

| APG requirement | How `tooltip` satisfies it |
|---|---|
| Tooltip content has `role="tooltip"` | `tooltip-content` sets it on connect |
| The trigger is **described by** the tooltip (not labelled by) | `tooltip-trigger` sets `aria-describedby={contentId}` |
| Tooltip is not focusable | `tooltip-content` sets no `tabindex` and is never focused |
| Appears on hover and on keyboard focus | `tooltip-trigger` opens on `mouseenter` / `focus` (after `open-delay`) |
| Dismisses on `Escape` without moving focus | `Escape` on the trigger (or content) calls `dismiss()` |
| Persists on hover, hides on leave/blur | open/close honor `open-delay` (700 ms) / `close-delay` (300 ms) |

## Positioning

Placement is computed by **reusing** Arbor's dependency-free `position()` utility
(`@aihu/arbor/progressive`) with the trigger as anchor. The tooltip
contains no positioning math of its own and adds no `@floating-ui/dom`
dependency — consistent with aihu's dependency-free thesis.

"Only one tooltip open at a time" is a consumer concern and is not enforced here.
