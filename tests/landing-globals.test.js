'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------
// The glue in index.html is the one part of the landing page no other
// test can see.
//
// Every other suite in this directory `require()`s a module directly, so
// they exercise the UMD *Node* branch and never touch the browser branch
// or the inline <script> that wires the modules together. That blind spot
// shipped a real bug: the analytics glue read `window.SakinaAppRedirect`
// while app-redirect.js registers itself as `window.AppRedirect`. `R` was
// undefined for every visitor, so `landing_redirect_attempted` and
// `landing_redirect_failed` — the two events added specifically to catch a
// silently-failing App Store escape out of Instagram and Threads — could
// never fire, and every visitor was reported as platform `other`.
//
// 45 green tests said nothing about it. These assertions are cheap and
// close exactly that gap: the names the page reaches for must be names the
// modules actually publish.
// ---------------------------------------------------------------------

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** The identifier a UMD module attaches to `root` in its browser branch. */
function browserGlobalOf(relPath) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const m = src.match(/root\.([A-Za-z0-9_$]+)\s*=\s*factory\(\)/);
  assert.ok(m, `${relPath} has no UMD browser-branch registration`);
  return m[1];
}

/** Every `window.X` the page reads. */
function windowGlobalsReadBy(source) {
  const found = new Set();
  const re = /window\.([A-Za-z0-9_$]+)/g;
  let m;
  while ((m = re.exec(source)) !== null) found.add(m[1]);
  return found;
}

/**
 * Every local module the page loads, discovered from the page itself rather
 * than hardcoded — otherwise adding a script silently escapes these checks,
 * which is the whole failure mode being guarded against.
 */
function localScriptsLoadedBy(source) {
  const found = [];
  const re = /<script src="(src\/[^"]+)">/g;
  let m;
  while ((m = re.exec(source)) !== null) found.push(m[1]);
  return found;
}

test('index.html reads app-redirect.js by the name it actually publishes', () => {
  const published = browserGlobalOf('src/app-redirect.js');
  assert.ok(
    windowGlobalsReadBy(html).has(published),
    `index.html never reads window.${published} — the escape telemetry is dead code`
  );
});

test('index.html reads landing-analytics.js by the name it actually publishes', () => {
  const published = browserGlobalOf('src/landing-analytics.js');
  assert.ok(
    windowGlobalsReadBy(html).has(published),
    `index.html never reads window.${published} — no landing events fire at all`
  );
});

test('every module global the page reads is published by some loaded module', () => {
  // Catches the inverse typo: a name the page reaches for that nothing
  // defines. Browser built-ins the page legitimately uses are exempt.
  const BUILTINS = new Set(['location', 'open', 'addEventListener', 'scrollTo']);
  const published = new Set(localScriptsLoadedBy(html).map(browserGlobalOf));

  for (const name of windowGlobalsReadBy(html)) {
    if (BUILTINS.has(name)) continue;
    assert.ok(
      published.has(name),
      `index.html reads window.${name}, which no loaded module publishes`
    );
  }
});

test('every loaded module is actually reached by the page', () => {
  // A module that loads but is never read is dead weight at best and, more
  // often, a rename that only half landed.
  const read = windowGlobalsReadBy(html);
  for (const rel of localScriptsLoadedBy(html)) {
    const name = browserGlobalOf(rel);
    assert.ok(
      read.has(name),
      `${rel} publishes window.${name}, which index.html never reads`
    );
  }
});

test('both modules are actually included by the page', () => {
  // A correct name against a script that was never loaded fails the same way.
  for (const src of ['src/app-redirect.js', 'src/landing-analytics.js']) {
    assert.ok(
      html.includes(`<script src="${src}">`),
      `${src} is never loaded by index.html`
    );
  }
});
