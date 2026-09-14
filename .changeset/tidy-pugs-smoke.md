---
'@aihu/css-engine': patch
---

Fix: a comment inside `@theme { … }` no longer discards the project theme.

`extract_theme_blocks` and `parse_theme_declarations` in `aihu-css-core`'s
`theme.rs` located `@theme` and matched its braces by scanning raw text, so a
`/* … */` inside the block could desync the brace-depth counter (a `}` in a
comment closed the block early) or glue onto the following declaration's name
(comments are not `;`-terminated). Either way tokens — or the entire theme —
were dropped.

The failure was silent, which is what made it expensive: the build still exited
0 with no warning, and every token fell back to the built-in `aihu-default`
palette, so the page rendered a complete, coherent design that simply was not
the configured one. Grouping brand tokens with comments is the most natural
thing a theme author does.

`mask_comments` now blanks comment spans to same-length spaces before any
structural scan, so a brace or keyword inside a comment cannot affect parsing
while real content keeps its exact byte offsets. Covers the stray-brace case,
the comment-above-a-declaration case, and prose mentioning `@theme` being taken
for the directive.

Reported from the `agent` scaffold template, which worked around it by keeping
its generated `src/theme.css` free of comments inside the block.
