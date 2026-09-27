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
