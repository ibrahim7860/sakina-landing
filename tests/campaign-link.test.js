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
