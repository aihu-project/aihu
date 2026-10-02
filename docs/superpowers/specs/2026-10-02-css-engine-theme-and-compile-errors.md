# CSS engine theme parsing and compile failures

`@theme { ... }` blocks accept CSS comments. Comments do not contribute braces,
`@theme` keywords, or declaration text when the compiler locates blocks and
parses custom properties. A standalone `:root { --token: value; }` block in a
component style or project theme is rejected with an error that names the
expected `@theme { ... }` wrapper. Compound selectors such as `:root.dark`
remain authored CSS, and bare custom property declaration lists remain valid
project themes.

The CSS engine passes compiler payloads through a temporary file argument, so
the child does not depend on a parent pipe delivering stdin EOF. Every native
compile remains bounded by the configured timeout. A failure includes the
component path when one was supplied to `compileSfc()`.
