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
| `assets/` | Logo, mark, store badges, and the link-preview card |
| `assets/screens/` | Real 1.3.0 app captures used by the "See it in action" row |
| `tools/og-image.html` | Source for `assets/og-image.png` — see below |

## App screenshots

`assets/screens/*.webp` are real device captures from the 1.3.0 build, exported
from `screenshots-app/public/screenshots/` in the app repo (that directory is
gitignored there, so these committed copies are the only ones under version
control).

They are the **raw** captures, deliberately — not the finished App Store slides.
Those have their eyebrow and headline baked into the pixels, which would put a
second set of marketing copy on a page that already has headings, and would be
unselectable, unindexable, and untranslatable. Captions here live in HTML.

Resized to 560px wide and converted to WebP, which took the set from 904KB to
88KB with no visible loss at these dimensions. WebP needs Safari 14+; the app's
own floor is iOS 15, so anyone who can install Sakina can see them.

To replace one, re-export at 560px wide and convert:

```bash
python3 -c "from PIL import Image; im=Image.open('in.png').convert('RGB'); im.save('assets/screens/out.webp','WEBP',quality=82,method=6)"
```

Keep the `width`/`height` attributes in `index.html` in step with the real pixel
dimensions — they reserve the space that stops the row jumping as images load.

## Store badges

Both badges are committed rather than hotlinked from Apple's and Google's CDNs,
so the hero's primary CTA cannot break because a vendor moves a file.

Google ships its badge inside 41px of transparent clear space. Left in, that
clear space renders the Play pill smaller than Apple's and floats it above the
row; the committed copy is the same artwork trimmed to its bounding box, with
the clear space restored by the row gap and the hero's padding. Neither mark is
recoloured or redrawn — the Play badge's grey state is a CSS filter.

The Play badge is a `div`, not a link. There is no Android build to point at,
and a live-looking button would send people nowhere.

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
