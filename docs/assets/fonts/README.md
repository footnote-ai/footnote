# Footnote typography assets

These are unmodified, open-licensed font files kept with Footnote's design
assets for reproducible previews and future UI work. This change does not load
them into the web application, so it does not alter the current
Footnote/jordanmakes.dev presentation.

| Family            | File                          | Intended role                                              |
| ----------------- | ----------------------------- | ---------------------------------------------------------- |
| Barlow Condensed  | `BarlowCondensed-Regular.ttf` | UI/display substitute for Avenir Next Condensed            |
| Libre Baskerville | `LibreBaskerville-wght.ttf`   | Content/body substitute for Baskerville or Iowan Old Style |
| IBM Plex Mono     | `IBMPlexMono-Regular.ttf`     | Code and technical text                                    |
| JetBrains Mono    | `JetBrainsMono-wght.ttf`      | Optional monospace fallback                                |

The matching `OFL-*.txt` files must remain with the font assets when they are
copied or redistributed. The font files are not currently referenced by
`packages/web/src/styles`; a future runtime adoption should add explicit
`@font-face` rules and focused visual verification rather than changing the
existing fallback stacks implicitly.

Sources:

- [Barlow](https://github.com/jpt/barlow)
- [Libre Baskerville](https://github.com/impallari/Libre-Baskerville)
- [IBM Plex](https://github.com/IBM/plex)
- [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)
