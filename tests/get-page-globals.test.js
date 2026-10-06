'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The /get/ page's inline glue is invisible to every require()-based suite,
// the same blind spot landing-globals.test.js closes for index.html. A
// mismatched global name here would silently disable per-reel attribution
// while every other test stayed green.

const page = fs.readFileSync(path.join(__dirname, '..', 'get', 'index.html'), 'utf8');
const moduleSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'campaign-link.js'), 'utf8');

test('/get/ loads campaign-link.js before its inline glue', () => {
  const tag = page.indexOf('<script src="../src/campaign-link.js"></script>');
  const glue = page.indexOf('<script>\n');
  assert.ok(tag > -1, 'campaign-link.js script tag missing');
  assert.ok(glue > tag, 'campaign-link.js must load before the inline script');
});

test('/get/ reaches the module by the name it publishes', () => {
  assert.match(moduleSrc, /root\.SakinaCampaignLink = factory\(\)/);
  assert.match(page, /window\.SakinaCampaignLink/);
});

test('/get/ tags every escape event with the reel', () => {
  const tagged = page.match(/reel: REEL_ID \|\| 'none'/g) || [];
  assert.equal(tagged.length, 3, 'landing_viewed, the onEvent enrichment, and the fallback redirect_failed');
});

// Instagram's "open an app outside of Instagram?" sheet suppresses every
// visibility signal, so a short timer reads a working escape as a failure and
// paints the manual steps behind the sheet (2026-10-06, real iPhone). These pin
// the grace period and that the visitor is told which button to tap.
test('/get/ gives the Instagram escape a reading-length grace, not 1.8s', () => {
  const m = page.match(/var IG_PROMPT_GRACE_MS = (\d+);/);
  assert.ok(m, 'IG_PROMPT_GRACE_MS missing');
  assert.ok(Number(m[1]) >= 8000, 'grace must leave time to read the sheet: ' + m[1]);
  assert.match(page, /armFallbackTimer\(IOS_STORE_URL, IG_PROMPT_GRACE_MS\);/);
  assert.doesNotMatch(page, /armFallbackTimer\(IOS_STORE_URL, 1800\)/);
});

test('/get/ tells Instagram visitors to tap Open before escaping, and stretches the button retry too', () => {
  const branch = page.slice(page.indexOf('if (AppRedirect.isIOS() && AppRedirect.isInstagramInApp())'));
  const prompt = branch.indexOf('showOpenPrompt(IOS_STORE_URL);');
  const escape = branch.indexOf("location.href = 'instagram://extbrowser/");
  assert.ok(prompt > -1 && escape > prompt, 'the "Tap Open" text must be on screen before the escape fires');
  assert.match(page, /Tap \\u201cOpen\\u201d to continue to the App Store\./);
  assert.match(branch.slice(0, escape), /AppRedirect\.CONFIG\.escapeTimeoutMs = Math\.max\(AppRedirect\.CONFIG\.escapeTimeoutMs, IG_PROMPT_GRACE_MS\)/);
});
