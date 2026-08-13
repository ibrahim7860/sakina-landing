'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------
// The landing page ships the App Store conversion path for the whole
// release and had ZERO instrumentation — no page view, no Store CTA, no
// redirect outcome. The escape system in app-redirect.js can fail
// silently in an in-app browser and nobody would ever know, because the
// only signal was App Store installs with no denominator.
//
// This pins the pure half: the event payload shape. Transport is a
// sendBeacon call the browser makes; what matters for correctness is
// that we never put anything unbounded or identifying in properties.
// ---------------------------------------------------------------------

function freshModule() {
  delete require.cache[require.resolve('../src/landing-analytics.js')];
  return require('../src/landing-analytics.js');
}

test('buildEvent produces a Mixpanel /track payload', () => {
  const A = freshModule();
  const payload = A.buildEvent('landing_viewed', {}, {
    token: 'tok',
    distinctId: 'anon-1',
    now: 1700000000000
  });

  assert.equal(payload.event, 'landing_viewed');
  assert.equal(payload.properties.token, 'tok');
  assert.equal(payload.properties.distinct_id, 'anon-1');
  assert.equal(payload.properties.time, 1700000000000);
});

test('every shipped event name is one the audit asked for', () => {
  const A = freshModule();
  // Named explicitly so a typo at a call site cannot invent a new event
  // that then never shows up in a funnel anyone built.
  assert.deepEqual(A.EVENTS, {
    viewed: 'landing_viewed',
    storeCta: 'landing_store_cta_tapped',
    redirectAttempted: 'landing_redirect_attempted',
    redirectFailed: 'landing_redirect_failed',
    waitlist: 'landing_waitlist_tapped'
  });
});

test('properties are bounded — unknown keys are dropped', () => {
  const A = freshModule();
  const payload = A.buildEvent('landing_store_cta_tapped', {
    platform: 'ios',
    in_app_browser: 'instagram',
    channel: 'hero',
    outcome: 'opened',
    // Everything below must NOT survive: free text and anything that
    // could carry a person.
    email: 'someone@example.com',
    referrerUrl: 'https://example.com/?utm_content=a-very-long-string',
    note: 'whatever the caller felt like sending'
  }, { token: 'tok', distinctId: 'anon-1', now: 1 });

  assert.equal(payload.properties.platform, 'ios');
  assert.equal(payload.properties.in_app_browser, 'instagram');
  assert.equal(payload.properties.channel, 'hero');
  assert.equal(payload.properties.outcome, 'opened');
  assert.equal(payload.properties.email, undefined);
  assert.equal(payload.properties.referrerUrl, undefined);
  assert.equal(payload.properties.note, undefined);
});

test('property VALUES are clamped, so a hostile query string cannot bloat a payload', () => {
  const A = freshModule();
  const payload = A.buildEvent('landing_viewed', {
    channel: 'x'.repeat(500)
  }, { token: 'tok', distinctId: 'anon-1', now: 1 });

  assert.ok(
    payload.properties.channel.length <= 64,
    'a bounded key with an unbounded value is still unbounded'
  );
});

test('a missing token yields no payload rather than a junk one', () => {
  const A = freshModule();
  // GitHub Pages serving the page without the token substituted must not
  // fire events that Mixpanel silently drops — better to send nothing.
  assert.equal(
    A.buildEvent('landing_viewed', {}, { token: '', distinctId: 'a', now: 1 }),
    null
  );
});

test('track is a no-op without a transport, and never throws', () => {
  const A = freshModule();
  // The page must render identically for a visitor with a blocker or an
  // ancient browser. Analytics is never allowed to break the Store link.
  assert.doesNotThrow(() => {
    A.track('landing_viewed', {}, { token: 'tok', distinctId: 'a', now: 1, send: null });
  });
});

test('track hands the encoded payload to the transport exactly once', () => {
  const A = freshModule();
  const calls = [];
  A.track('landing_store_cta_tapped', { platform: 'ios' }, {
    token: 'tok',
    distinctId: 'anon-9',
    now: 42,
    send: (url, body) => { calls.push({ url, body }); return true; }
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\.mixpanel\.com\/track/);
  const decoded = JSON.parse(
    Buffer.from(decodeURIComponent(calls[0].body).replace(/^data=/, ''), 'base64').toString()
  );
  assert.equal(decoded[0].event, 'landing_store_cta_tapped');
  assert.equal(decoded[0].properties.platform, 'ios');
});
