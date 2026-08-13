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
| `assets/` | Logo, mark, the two illustration SVGs, and the link-preview card |
| `tools/og-image.html` | Source for `assets/og-image.png` — see below |

## Regenerating the link-preview image

`assets/og-image.png` is what unfurls when the site is pasted into Instagram,
iMessage, or Slack. It is a committed 1200x630 PNG, not generated at request
time, because the page has no build step.

If the headline or subline in `index.html` changes, the card goes stale — it
holds its own copy of that text. Edit `tools/og-image.html` to match, then
re-render it at exactly 1200x630:

```bash
B=~/.claude/skills/gstack/browse/dist/browse
$B viewport 1200x630
$B goto file://$PWD/tools/og-image.html
$B wait --networkidle          # the Outfit webfont must land before the shot
$B screenshot assets/og-image.png --selector .og
```

Any headless browser works; the size and the font wait are the parts that
matter. Confirm the result is 1200x630 — social crawlers letterbox anything
else, and Twitter drops `summary_large_image` for cards under 300px wide.

The `og:image` URLs in `index.html` and `get/index.html` are absolute, because
crawlers do not resolve relative paths. They must be updated by hand if this
site ever moves to a custom domain.

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
