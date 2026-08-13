# Sakina — landing page

The public marketing site for [Sakina](https://apps.apple.com/us/app/sakina-islamic-wellness/id6762153820),
served by GitHub Pages at **https://ibrahim7860.github.io/sakina-landing/**.

This repo is public only so GitHub Pages can serve it. The app itself lives in
the private `SamieBelal/Sakina` repo; nothing here is imported by the app at
runtime.

## Layout

| Path | What it is |
|---|---|
| `index.html` | The whole landing page — markup, styles, and the inline glue script |
| `get/index.html` | Share link target (`/get/`). Escapes Instagram / Threads / Facebook in-app browsers straight to the App Store |
| `src/app-redirect.js` | The escape system itself. Zero dependencies, UMD |
| `src/landing-analytics.js` | Mixpanel `/track` calls for landing + redirect events |
| `src/waitlist.js` | Android waitlist signup, posted to Supabase PostgREST |
| `tests/` | `node:test` suites over `src/` and the `index.html` glue |
| `assets/` | Logo, mark, and the two illustration SVGs |

## Running the tests

No install step — `node:test` is built into Node, and the page has no
dependencies.

```bash
node --test tests/*.test.js
```

Use the explicit glob, not the bare `tests/` directory: Node 22 treats a
directory argument as a single file to execute and reports a false "1 test, 1
fail" without running the suite.

## Deploying

Push to `master`. GitHub Pages serves the repository root — there is no build
step and no framework.

## Keys in the page

`index.html` embeds the Supabase **anon** key and the Mixpanel **project**
token. Both are write-only/public by design and are already shipped inside
every IPA. No server-only secret belongs in this repo.
