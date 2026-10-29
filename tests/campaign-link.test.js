'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------
// A reel's DM link is /get/?src=ig_dm&r=<instagram media id>. This module
// turns `r` into the App Store Campaign Link that lets App Analytics count
// first-time downloads per reel. The failure worth pinning is the silent
// one: a bad `r` or an unset provider token must fall back to the plain
// store link (null here), never to a malformed Apple URL.
// ---------------------------------------------------------------------

function fresh() {
  delete require.cache[require.resolve('../src/campaign-link.js')];
  return require('../src/campaign-link.js');
}

test('reelIdFrom reads a media id from the query string', () => {
  const C = fresh();
  assert.equal(C.reelIdFrom('?src=ig_dm&r=17947645578337196'), '17947645578337196');
  assert.equal(C.reelIdFrom('?r=abc-123'), 'abc-123');
});

test('reelIdFrom refuses anything that is not a short token', () => {
  const C = fresh();
  assert.equal(C.reelIdFrom(''), null);
  assert.equal(C.reelIdFrom('?src=ig_dm'), null);
  assert.equal(C.reelIdFrom('?r='), null);
  assert.equal(C.reelIdFrom('?r=has space'), null);
  assert.equal(C.reelIdFrom('?r=under_score'), null);
  assert.equal(C.reelIdFrom('?r=%3Cscript%3E'), null);
  assert.equal(C.reelIdFrom('?r=' + '1'.repeat(41)), null);
  assert.equal(C.reelIdFrom('?r=' + '1'.repeat(40)), '1'.repeat(40));
});

test('campaignStoreUrl builds Apple\'s campaign link exactly', () => {
  const C = fresh();
  assert.equal(
    C.campaignStoreUrl('17947645578337196', '118000000'),
    'https://apps.apple.com/app/apple-store/id6762153820?pt=118000000&ct=17947645578337196&mt=8'
  );
});

test('campaignStoreUrl returns null rather than a broken link', () => {
  const C = fresh();
  assert.equal(C.campaignStoreUrl(null, '118000000'), null);
  assert.equal(C.campaignStoreUrl('', '118000000'), null);
  assert.equal(C.campaignStoreUrl('bad id', '118000000'), null);
  assert.equal(C.campaignStoreUrl('179', ''), null);
  assert.equal(C.campaignStoreUrl('179', 'UNSET'), null);
});

test('the shipped provider token is a real one, so the default path attributes', () => {
  // Fails until Task 1 Step 3 pastes the pt from Task 0. That is the point:
  // this PR must not merge with attribution silently disabled.
  const C = fresh();
  assert.match(C.PROVIDER_TOKEN, /^[0-9]+$/);
  assert.notEqual(C.campaignStoreUrl('179'), null);
});

// ---------------------------------------------------------------------
// Android. Google Play carries attribution in `referrer`, which the app reads
// once through the Play Install Referrer API on first open. The referrer is
// itself a query string, so it must arrive percent-encoded as ONE parameter:
// unencoded, Play would read utm_content as its own argument and drop it.
// ---------------------------------------------------------------------

test('playStoreUrl carries channel and reel in one encoded referrer', () => {
  const C = fresh();
  const url = C.playStoreUrl('com.sakina.app.sakina', 'ig_dm', '18104074904002924');
  assert.equal(
    url,
    'https://play.google.com/store/apps/details?id=com.sakina.app.sakina&referrer=' +
      'utm_source%3Dig_dm%26utm_medium%3Dlanding%26utm_content%3D18104074904002924'
  );
  const referrer = new URL(url).searchParams.get('referrer');
  assert.equal(new URLSearchParams(referrer).get('utm_content'), '18104074904002924');
});

test('playStoreUrl still links to Play when channel or reel is missing or unsafe', () => {
  const C = fresh();
  const ref = (u) => new URLSearchParams(new URL(u).searchParams.get('referrer'));
  assert.equal(ref(C.playStoreUrl('com.sakina.app.sakina', null, null)).get('utm_source'), 'none');
  assert.equal(ref(C.playStoreUrl('com.sakina.app.sakina', 'a&b=c', 'bad id')).get('utm_source'), 'none');
  assert.equal(ref(C.playStoreUrl('com.sakina.app.sakina', 'bio_getsakina', 'bad id')).get('utm_content'), null);
});

test('playStoreUrl returns null without a valid package, never a broken link', () => {
  const C = fresh();
  assert.equal(C.playStoreUrl(null, 'ig_dm', '179'), null);
  assert.equal(C.playStoreUrl('', 'ig_dm', '179'), null);
  assert.equal(C.playStoreUrl('not a package', 'ig_dm', '179'), null);
  assert.equal(C.playStoreUrl('com.sakina.app.sakina&x=1', 'ig_dm', '179'), null);
});

// ---------------------------------------------------------------------
// Per-channel campaigns (2026-10-29). Only DM links carried a ct, so bio,
// Facebook and cutt.ly installs were one anonymous lump in App Analytics. A
// reel still wins; with no reel, the channel itself becomes the campaign. A
// channel is ~10-100x a single reel's traffic, so it clears Apple's
// 5-download floor where most reels never do.
// ---------------------------------------------------------------------

test('campaignTokenFrom prefers the reel, then the channel', () => {
  const C = fresh();
  assert.equal(C.campaignTokenFrom('?src=ig_dm&r=17947645578337196'), '17947645578337196');
  assert.equal(C.campaignTokenFrom('?src=bio_getsakina'), 'bio_getsakina');
  assert.equal(C.campaignTokenFrom('?src=fb_samiespeaks&r=bad%20id'), 'fb_samiespeaks');
});

test('campaignTokenFrom gives no campaign for a missing, placeholder or unsafe channel', () => {
  const C = fresh();
  assert.equal(C.campaignTokenFrom(''), null);
  assert.equal(C.campaignTokenFrom('?src='), null);
  assert.equal(C.campaignTokenFrom('?src=none'), null);
  assert.equal(C.campaignTokenFrom('?src=None'), null);
  assert.equal(C.campaignTokenFrom('?src=a%26b%3Dc'), null);
  assert.equal(C.campaignTokenFrom('?src=' + 'a'.repeat(41)), null);
  assert.equal(C.campaignTokenFrom('?src=' + 'a'.repeat(40)), 'a'.repeat(40));
});

test('campaignStoreUrl accepts a channel token as the campaign', () => {
  const C = fresh();
  assert.equal(
    C.campaignStoreUrl('bio_getsakina', '118000000'),
    'https://apps.apple.com/app/apple-store/id6762153820?pt=118000000&ct=bio_getsakina&mt=8'
  );
  assert.equal(C.campaignStoreUrl('a&b=c', '118000000'), null);
  assert.equal(C.campaignStoreUrl('a'.repeat(41), '118000000'), null);
});
