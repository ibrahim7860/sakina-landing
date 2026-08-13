'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------
// The "Notify Me" form used to be a `mailto:` link — it opened a draft
// and stored nothing, so every visitor who did not then hit send in
// their own mail client was lost silently. It now writes to Supabase.
//
// What is worth pinning here is everything that happens BEFORE the
// network: normalization (the table's unique index depends on it),
// the request shape (a wrong header is a 401 nobody would see until a
// real visitor hit it), and — most of all — that a failing or blocked
// request surfaces as a message instead of an exception. This form
// sits at the bottom of the page that carries the App Store path.
// ---------------------------------------------------------------------

function freshModule() {
  delete require.cache[require.resolve('../src/waitlist.js')];
  return require('../src/waitlist.js');
}

const CTX = { url: 'https://proj.supabase.co', key: 'anon-key' };

test('normalize lowercases and trims — the unique index depends on it', () => {
  const W = freshModule();
  assert.equal(W.normalize('  Someone@Example.COM '), 'someone@example.com');
  assert.equal(W.normalize(null), '');
  assert.equal(W.normalize(undefined), '');
});

test('isValid accepts real-world addresses, not just the simple ones', () => {
  const W = freshModule();
  assert.ok(W.isValid('a@b.co'));
  assert.ok(W.isValid('user+tag@sub.domain.co.uk'));
  assert.ok(W.isValid('  User@Example.com  '), 'validates after normalizing');
});

test('isValid rejects what the server would reject', () => {
  const W = freshModule();
  // Each of these also violates a CHECK on waitlist_signups; catching them
  // on the page turns a 400 into an inline message.
  assert.equal(W.isValid(''), false);
  assert.equal(W.isValid('someone'), false, 'no @');
  assert.equal(W.isValid('someone@example'), false, 'no dot in domain');
  assert.equal(W.isValid('a b@example.com'), false, 'whitespace');
  assert.equal(W.isValid('@example.com'), false, 'no local part');
  assert.equal(W.isValid('a@b.c'), false, 'under the 6-char floor');
  assert.equal(W.isValid('a'.repeat(250) + '@example.com'), false, 'over 254');
});

test('buildRequest targets the RPC with both auth headers', () => {
  const W = freshModule();
  const req = W.buildRequest('  Someone@Example.com ', CTX);

  assert.equal(req.url, 'https://proj.supabase.co/rest/v1/rpc/join_waitlist');
  assert.equal(req.options.method, 'POST');
  // apikey alone works through the Supabase gateway; the bearer is what makes
  // it work against PostgREST directly too. supabase-js sends both.
  assert.equal(req.options.headers.apikey, 'anon-key');
  assert.equal(req.options.headers.Authorization, 'Bearer anon-key');
  assert.equal(req.options.headers['Content-Type'], 'application/json');

  assert.deepEqual(JSON.parse(req.options.body), {
    p_email: 'someone@example.com',
    p_source: 'landing_android'
  });
});

test('buildRequest tolerates a trailing slash on the project url', () => {
  const W = freshModule();
  const req = W.buildRequest('a@b.co', { url: 'https://proj.supabase.co/', key: 'k' });
  assert.equal(req.url, 'https://proj.supabase.co/rest/v1/rpc/join_waitlist');
});

test('submit posts once and reports joined', async () => {
  const W = freshModule();
  const calls = [];
  const outcome = await W.submit('someone@example.com', {
    ...CTX,
    fetch: (url, options) => {
      calls.push({ url, options });
      return Promise.resolve({ ok: true, status: 200 });
    }
  });

  assert.equal(outcome, 'joined');
  assert.equal(calls.length, 1);
});

test('submit rejects a bad address without touching the network', async () => {
  const W = freshModule();
  let called = false;
  const outcome = await W.submit('not-an-email', {
    ...CTX,
    fetch: () => { called = true; return Promise.resolve({ ok: true }); }
  });

  assert.equal(outcome, 'invalid');
  assert.equal(called, false);
});

test('an already-listed address still reads as joined', async () => {
  const W = freshModule();
  // The RPC swallows the conflict and returns true precisely so this page
  // cannot be used to test whether a given person signed up.
  const outcome = await W.submit('someone@example.com', {
    ...CTX,
    fetch: () => Promise.resolve({ ok: true, status: 200 })
  });
  assert.equal(outcome, 'joined');
});

test('a server error reports error, never throws', async () => {
  const W = freshModule();
  const outcome = await W.submit('someone@example.com', {
    ...CTX,
    fetch: () => Promise.resolve({ ok: false, status: 500 })
  });
  assert.equal(outcome, 'error');
});

test('a rejected fetch reports error, never throws', async () => {
  const W = freshModule();
  // The realistic case: a blocker, an offline visitor, or a CORS failure.
  const outcome = await W.submit('someone@example.com', {
    ...CTX,
    fetch: () => Promise.reject(new Error('network down'))
  });
  assert.equal(outcome, 'error');
});

test('a fetch that throws synchronously reports error, never throws', async () => {
  const W = freshModule();
  const outcome = await W.submit('someone@example.com', {
    ...CTX,
    fetch: () => { throw new Error('blocked'); }
  });
  assert.equal(outcome, 'error');
});

test('an unconfigured page reports error instead of posting nowhere', async () => {
  const W = freshModule();
  // Served without the url/key substituted. Firing anyway would give the
  // visitor a confirmation for an address that went into the void.
  let called = false;
  const outcome = await W.submit('someone@example.com', {
    url: '',
    key: '',
    fetch: () => { called = true; return Promise.resolve({ ok: true }); }
  });

  assert.equal(outcome, 'error');
  assert.equal(called, false);
});

test('init supplies the config that submit falls back to', async () => {
  const W = freshModule();
  W.init({ url: 'https://proj.supabase.co', key: 'anon-key' });

  let seen = null;
  const outcome = await W.submit('someone@example.com', {
    fetch: (url, options) => {
      seen = { url, options };
      return Promise.resolve({ ok: true, status: 200 });
    }
  });

  assert.equal(outcome, 'joined');
  assert.equal(seen.url, 'https://proj.supabase.co/rest/v1/rpc/join_waitlist');
  assert.equal(seen.options.headers.apikey, 'anon-key');
});

test('the email never reaches the analytics payload', () => {
  const A = require('../src/landing-analytics.js');
  // The waitlist call site is the one place on this page that HAS a person's
  // address, so it is the one place the allow-list actually has to hold.
  const payload = A.buildEvent('landing_waitlist_tapped', {
    channel: 'android_note',
    outcome: 'joined',
    email: 'someone@example.com'
  }, { token: 'tok', distinctId: 'anon-1', now: 1 });

  assert.equal(payload.properties.email, undefined);
  assert.equal(payload.properties.channel, 'android_note');
  assert.equal(payload.properties.outcome, 'joined');
});
