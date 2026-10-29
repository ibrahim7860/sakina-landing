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
  // One shared context() builds every payload, so the reel is set in one place
  // and no track call on this page may build its own props by hand.
  const tagged = page.match(/reel: REEL_ID \|\| 'none'/g) || [];
  assert.equal(tagged.length, 1, 'only context() should spell out the reel');
  const calls = page.match(/track\(A && A\.EVENTS\.\w+, [^)]*\)/g) || [];
  assert.ok(calls.length >= 5, 'expected viewed, attempted x2, failed x2, left: ' + calls.length);
  for (const call of calls) {
    assert.match(call, /, (context\(|enriched|viewedProps)/, 'payload not built by context(): ' + call);
  }
});

// Until 2026-10-14 the automatic escape logged its failure but never its
// attempt, and nothing logged success: 493 failures against 30 attempts in
// Mixpanel, with no way to tell a lost visitor from a slow one.
test('/get/ reports the automatic attempt before firing either escape', () => {
  const run = page.slice(page.indexOf('function run()'));
  const ig = run.slice(run.indexOf('if (AppRedirect.isIOS() && AppRedirect.isInstagramInApp())'));
  assert.ok(ig.indexOf('reportAutoAttempt();') > -1 &&
    ig.indexOf('reportAutoAttempt();') < ig.indexOf("location.href = 'instagram://extbrowser/"),
    'Instagram branch must report the attempt before escaping');
  const plain = run.slice(run.lastIndexOf('reportAutoAttempt();'));
  assert.ok(plain.indexOf('window.location.replace(attributionLink)') > -1,
    'plain-navigation branch must report the attempt before navigating');
  assert.match(page, /track\(A && A\.EVENTS\.redirectAttempted, context\('auto'\)\)/);
});

test('/get/ reports leaving, and whether the fallback had already been shown', () => {
  assert.match(page, /track\(A && A\.EVENTS\.redirectLeft, context\(fallbackShown \? 'after_fallback' : 'before_fallback'\)\)/);
  const timer = page.slice(page.indexOf('function armFallbackTimer'));
  assert.ok(timer.indexOf('fallbackShown = true;') > -1 &&
    timer.indexOf('fallbackShown = true;') < timer.indexOf('showManualFallback(targetUrl);'),
    'the flag must flip before the fallback is painted');
  // blur is deliberately not a leave signal: Instagram's sheet can take focus.
  const watch = page.slice(page.indexOf('function watchForLeave'), page.indexOf('function reportAutoAttempt'));
  assert.doesNotMatch(watch, /'blur'/);
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

// The bug this pins (found 2026-10-17): the Android branch only checked that a
// package name existed, then fell through to the plain branch, whose link is
// attributionLinkFor() and whose default is the iOS store URL. Filling in the
// package would have sent every Android visitor to the App Store.
test('/get/ sends Android to Google Play, never to the App Store link', () => {
  const run = page.slice(page.indexOf('function run()'));
  const android = run.slice(run.indexOf('if (AppRedirect.isAndroid())'));
  const branch = android.slice(0, android.indexOf('\n      }\n') + 8);
  assert.ok(branch.length > 20, 'Android branch missing from run()');
  assert.match(branch, /C\.playStoreUrl\(pkg, channel, REEL_ID\)/);
  assert.doesNotMatch(branch, /attributionLink|IOS_STORE_URL/);
  assert.match(branch, /window\.location\.replace\(homeWithAttribution\(channel\)\)/,
    'with no package (no public listing yet) Android must still go to the waitlist');
  assert.match(branch, /reportAutoAttempt\(\);/);
  assert.match(branch, /return;\s*}$/, 'the Android branch must end the run');
  assert.ok(run.indexOf('if (AppRedirect.isAndroid())') <
    run.indexOf('window.location.replace(attributionLink)'),
    'the Android branch must come before the plain-navigation branch');
});

test('/get/ names Google Play, not the App Store, to Android visitors', () => {
  assert.match(page, /storeName\('Google Play'\)/);
  assert.match(page, /'Open ' \+ name/);
});

// /get/ hands desktop visitors (and Android ones with no Play link) to the
// homepage. Until 2026-10-29 it carried ?src= but dropped ?r=, so a DM tap
// that landed on the homepage could no longer say which reel it came from.
function homeHandOff() {
  const start = page.indexOf('function homeWithAttribution(');
  assert.ok(start > -1, 'homeWithAttribution missing from /get/');
  let depth = 0;
  let end = page.indexOf('{', start);
  for (; end < page.length; end++) {
    if (page[end] === '{') depth++;
    if (page[end] === '}' && --depth === 0) break;
  }
  const src = page.slice(start, end + 1);
  return (reelId) => new Function('HOMEPAGE_URL', 'REEL_ID',
    src + '\nreturn homeWithAttribution;')('https://home.test/', reelId);
}

test('/get/ carries the reel to the homepage, not just the channel', () => {
  const url = new URL(homeHandOff()('18114548159510182')('ig_dm'));
  assert.equal(url.searchParams.get('src'), 'ig_dm');
  assert.equal(url.searchParams.get('r'), '18114548159510182');
});

test('/get/ hands off to the bare homepage when there is nothing to carry', () => {
  assert.equal(homeHandOff()(null)(null), 'https://home.test/');
  assert.equal(homeHandOff()(null)('bio_getsakina'), 'https://home.test/?src=bio_getsakina');
  assert.equal(homeHandOff()('123')(null), 'https://home.test/?r=123');
});

test('every homepage hand-off on /get/ goes through homeWithAttribution', () => {
  assert.doesNotMatch(page, /homeWithChannel/);
  assert.doesNotMatch(page, /location\.replace\(HOMEPAGE_URL\)/);
});

test('/get/ builds its store link from the reel or, failing that, the channel', () => {
  assert.match(page, /var IOS_STORE_URL = \(C && C\.campaignStoreUrl\(C\.campaignTokenFrom\(window\.location\.search\)\)\) \|\| AppRedirect\.CONFIG\.ios\.storeUrl;/);
  // REEL_ID stays the reel alone: it is what the events and Play referrer carry.
  assert.match(page, /var REEL_ID = C \? C\.reelIdFrom\(window\.location\.search\) : null;/);
});
