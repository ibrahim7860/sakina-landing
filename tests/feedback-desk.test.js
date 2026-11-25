'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDocument, findAll, byClass, byText } = require('./helpers/fake-dom.js');

// ---------------------------------------------------------------------
// The founders' reply page (Section 3b P2b). This repo is PUBLIC, so the
// page's code is too: all the security lives in the database (the
// founder_* RPCs refuse anyone not in feedback_admins). What the page
// must get right, and what is pinned here:
//   - a signed-in non-admin sees "Not available." and nothing else;
//   - the list: pinned (looks-wrong, unanswered > 48 h) on top, flagged;
//   - reply and status call the right RPCs with the founder's own token;
//   - every word a user typed renders as TEXT — never parsed as markup.
// ---------------------------------------------------------------------

const ROOT = path.join(__dirname, '..');
const PAGE_DIR = path.join(ROOT, 'n', 'q7rk2m9xw4');
const PAGE_URL = 'https://ibrahim7860.github.io/sakina-landing/n/q7rk2m9xw4/';
const API = 'https://proj.supabase.co';

function freshModule() {
  delete require.cache[require.resolve('../src/feedback-desk.js')];
  return require('../src/feedback-desk.js');
}

function memoryStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    map: m
  };
}

function jsonResponse(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body))
  });
}

/** A fake fetch routed by URL substring; records every call. */
function fakeFetch(routes) {
  const calls = [];
  const fn = (url, options) => {
    const body = options && options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, options, body });
    for (const [match, reply] of routes) {
      if (url.includes(match)) return typeof reply === 'function' ? reply(url, body) : reply();
    }
    return jsonResponse(404, { message: 'no route' });
  };
  fn.calls = calls;
  return fn;
}

const SESSION = {
  access_token: 'user-jwt',
  refresh_token: 'refresh-1',
  expires_at: 4102444800 // 2100-01-01
};

function note(over) {
  return Object.assign(
    {
      id: 'n-1',
      kind: 'idea',
      chips: [],
      words: 'A note',
      target: null,
      status: 'sent',
      created_at: '2026-11-25T10:00:00Z',
      has_screenshot: false,
      pinned: false,
      message_count: 0,
      last_author: null
    },
    over
  );
}

function env(over) {
  const doc = createDocument();
  const root = doc.createElement('main');
  return Object.assign(
    {
      document: doc,
      root,
      url: API,
      key: 'anon-key',
      storage: memoryStorage({ sakina_desk_session: JSON.stringify(SESSION) }),
      hash: '',
      pageUrl: PAGE_URL,
      replaceHash: () => {},
      now: () => Date.parse('2026-11-25T12:00:00Z')
    },
    over
  );
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// ── Not available ─────────────────────────────────────────────────────

test('a signed-in non-admin sees "Not available." and nothing else', async () => {
  const D = freshModule();
  const fetch = fakeFetch([
    ['/rest/v1/rpc/founder_list_feedback', () => jsonResponse(403, { code: '42501', message: 'founders only' })]
  ]);
  const e = env({ fetch });
  await D.start(e);
  assert.equal(e.root.textContent, 'Not available.');
  assert.equal(e.root.childNodes.length, 1);
  assert.equal(findAll(e.root, () => true).length, 1, 'no buttons, no form, no list');
  assert.deepEqual(fetch.calls.map((c) => c.url), [API + '/rest/v1/rpc/founder_list_feedback']);
});

test('the list call uses the founder\'s own token, never only the anon key', async () => {
  const D = freshModule();
  const fetch = fakeFetch([['founder_list_feedback', () => jsonResponse(200, { pinned: [], notes: [] })]]);
  await D.start(env({ fetch }));
  const h = fetch.calls[0].options.headers;
  assert.equal(h.apikey, 'anon-key');
  assert.equal(h.Authorization, 'Bearer user-jwt');
});

test('no session → the sign-in form; it asks for a magic link and never creates an account', async () => {
  const D = freshModule();
  const fetch = fakeFetch([['/auth/v1/otp', () => jsonResponse(400, { msg: 'Signups not allowed for otp' })]]);
  const e = env({ fetch, storage: memoryStorage(), hash: '#note=n-7' });
  await D.start(e);
  assert.equal(fetch.calls.length, 0, 'nothing is called before they ask');
  const input = findAll(e.root, (x) => x.tagName === 'INPUT')[0];
  const form = findAll(e.root, (x) => x.tagName === 'FORM')[0];
  input.value = '  Founder@Example.com ';
  form.dispatch('submit');
  await flush();
  await flush();
  const call = fetch.calls[0];
  assert.equal(call.url, API + '/auth/v1/otp?redirect_to=' + encodeURIComponent(PAGE_URL));
  assert.deepEqual(call.body, { email: 'founder@example.com', create_user: false });
  assert.equal(call.options.headers.apikey, 'anon-key');
  // The same line whether or not the address is a founder's (no allowlist leak).
  assert.ok(e.root.textContent.includes('If that address can sign in here, a link is on its way.'));
  assert.equal(e.storage.getItem('sakina_desk_open_note'), 'n-7', 'the note to open survives the email round trip');
});

test('the magic link\'s return is stored as the session and the tokens leave the address bar', async () => {
  const D = freshModule();
  const replaced = [];
  const fetch = fakeFetch([['founder_list_feedback', () => jsonResponse(200, { pinned: [], notes: [] })]]);
  const e = env({
    fetch,
    storage: memoryStorage(),
    hash: '#access_token=tok-9&refresh_token=ref-9&expires_in=3600&token_type=bearer&type=magiclink',
    replaceHash: (h) => replaced.push(h)
  });
  await D.start(e);
  const s = JSON.parse(e.storage.getItem('sakina_desk_session'));
  assert.equal(s.access_token, 'tok-9');
  assert.equal(s.refresh_token, 'ref-9');
  assert.equal(s.expires_at, Date.parse('2026-11-25T12:00:00Z') / 1000 + 3600);
  assert.deepEqual(replaced, ['']);
  assert.equal(fetch.calls[0].options.headers.Authorization, 'Bearer tok-9');
});

// ── The list ──────────────────────────────────────────────────────────

test('an admin\'s list: pinned notes on top with a flag, then newest first', () => {
  const D = freshModule();
  const ordered = D.orderNotes({
    pinned: [note({ id: 'old-wrong', kind: 'wrong', created_at: '2026-11-20T10:00:00Z', pinned: true })],
    notes: [
      note({ id: 'newest', created_at: '2026-11-25T10:00:00Z' }),
      note({ id: 'middle', created_at: '2026-11-24T10:00:00Z' }),
      note({ id: 'old-wrong', kind: 'wrong', created_at: '2026-11-20T10:00:00Z', pinned: true })
    ]
  });
  assert.deepEqual(ordered.map((n) => [n.id, n.pinned]), [
    ['old-wrong', true],
    ['newest', false],
    ['middle', false]
  ]);
});

test('the rendered list draws the pin flag and opens a note on tap', async () => {
  const D = freshModule();
  const fetch = fakeFetch([
    [
      'founder_list_feedback',
      () =>
        jsonResponse(200, {
          pinned: [note({ id: 'w', kind: 'wrong', words: 'Old wrong', pinned: true })],
          notes: [note({ id: 'i', words: 'Fresh idea' }), note({ id: 'w', kind: 'wrong', words: 'Old wrong', pinned: true })]
        })
    ],
    ['founder_get_feedback', (_u, b) => jsonResponse(200, Object.assign(note({ id: b.p_note_id }), { messages: [] }))]
  ]);
  const e = env({ fetch });
  await D.start(e);
  const rows = byClass(e.root, 'desk-row');
  assert.equal(rows.length, 2);
  assert.ok(rows[0].textContent.includes('Waiting over 48 h'));
  assert.ok(rows[0].textContent.includes('Old wrong'));
  assert.ok(!rows[1].textContent.includes('Waiting over 48 h'));
  rows[1].dispatch('click');
  await flush();
  await flush();
  const last = fetch.calls[fetch.calls.length - 1];
  assert.equal(last.url, API + '/rest/v1/rpc/founder_get_feedback');
  assert.deepEqual(last.body, { p_note_id: 'i' });
});

// ── One note ──────────────────────────────────────────────────────────

const FULL = {
  id: 'n-1',
  kind: 'wrong',
  chips: ['arabic', 'source'],
  words: 'The last word differs.',
  target: 'dua',
  target_id: 'd-1',
  dua_words: 'Allahumma ...',
  diag: { version: '1.9.0', device: 'iPhone 15' },
  screenshot_path: 'u-1/c-1.jpg',
  screenshot_expired: false,
  status: 'sent',
  created_at: '2026-11-25T10:00:00Z',
  pinned: false,
  messages: [
    { id: 'm1', author: 'founder', founder_name: 'Ibrahim', body: 'Looking now.', created_at: '2026-11-25T11:00:00Z' },
    { id: 'm2', author: 'user', founder_name: null, body: 'Thanks!', created_at: '2026-11-25T11:30:00Z' }
  ]
};

function noteEnv(noteBody, extraRoutes) {
  const fetch = fakeFetch(
    (extraRoutes || []).concat([
      ['founder_get_feedback', () => jsonResponse(200, noteBody)],
      ['/storage/v1/object/sign/', () => jsonResponse(200, { signedURL: '/object/sign/feedback-screenshots/u-1/c-1.jpg?token=t' })],
      ['founder_list_feedback', () => jsonResponse(200, { pinned: [], notes: [note({ id: noteBody.id })] })]
    ])
  );
  return env({ fetch, hash: '#note=' + noteBody.id });
}

test('a note opens with its kind, chips, target, words, du‘ā words, diagnostics and thread', async () => {
  const D = freshModule();
  const e = noteEnv(FULL);
  await D.start(e);
  await flush();
  const t = e.root.textContent;
  for (const s of [
    'Something looks wrong',
    'arabic',
    'source',
    'dua',
    'The last word differs.',
    'Allahumma ...',
    '1.9.0',
    'iPhone 15',
    'Ibrahim · Sakina',
    'Looking now.',
    'Thanks!'
  ]) {
    assert.ok(t.includes(s), 'missing ' + s);
  }
});

test('the screenshot comes through a short-lived signed URL', async () => {
  const D = freshModule();
  const e = noteEnv(FULL);
  await D.start(e);
  await flush();
  const sign = e.fetch.calls.find((c) => c.url.includes('/storage/v1/object/sign/'));
  assert.equal(sign.url, API + '/storage/v1/object/sign/feedback-screenshots/u-1/c-1.jpg');
  assert.ok(sign.body.expiresIn > 0 && sign.body.expiresIn <= 300);
  assert.equal(sign.options.headers.Authorization, 'Bearer user-jwt');
  const img = findAll(e.root, (x) => x.tagName === 'IMG')[0];
  assert.equal(img.src, API + '/storage/v1/object/sign/feedback-screenshots/u-1/c-1.jpg?token=t');
});

test('an expired screenshot is said in words, and never signed', async () => {
  const D = freshModule();
  const e = noteEnv(Object.assign({}, FULL, { screenshot_expired: true }));
  await D.start(e);
  await flush();
  assert.ok(e.root.textContent.includes('Screenshot deleted (over 90 days old).'));
  assert.equal(e.fetch.calls.filter((c) => c.url.includes('/object/sign/')).length, 0);
});

test('reply calls founder_reply with the note id and the words', async () => {
  const D = freshModule();
  const e = noteEnv(FULL, [['founder_reply', () => jsonResponse(200, 'm3')]]);
  await D.start(e);
  await flush();
  const box = findAll(e.root, (x) => x.tagName === 'TEXTAREA')[0];
  box.value = '  JazakAllah khair, fixed in the next build.  ';
  byText(e.root, 'button', 'Send reply')[0].dispatch('click');
  await flush();
  await flush();
  const call = e.fetch.calls.find((c) => c.url.endsWith('/rest/v1/rpc/founder_reply'));
  assert.deepEqual(call.body, { p_note_id: 'n-1', p_body: 'JazakAllah khair, fixed in the next build.' });
  assert.equal(call.options.headers.Authorization, 'Bearer user-jwt');
});

test('an empty reply sends nothing', async () => {
  const D = freshModule();
  const e = noteEnv(FULL);
  await D.start(e);
  await flush();
  findAll(e.root, (x) => x.tagName === 'TEXTAREA')[0].value = '   ';
  byText(e.root, 'button', 'Send reply')[0].dispatch('click');
  await flush();
  assert.equal(e.fetch.calls.filter((c) => c.url.includes('founder_reply')).length, 0);
});

test('"Looking" and "Fixed" call founder_set_status', async () => {
  const D = freshModule();
  const e = noteEnv(FULL, [['founder_set_status', () => jsonResponse(204, null)]]);
  await D.start(e);
  await flush();
  byText(e.root, 'button', 'Mark looking')[0].dispatch('click');
  await flush();
  await flush();
  byText(e.root, 'button', 'Mark fixed')[0].dispatch('click');
  await flush();
  await flush();
  const calls = e.fetch.calls.filter((c) => c.url.endsWith('/rest/v1/rpc/founder_set_status'));
  assert.deepEqual(calls.map((c) => c.body), [
    { p_note_id: 'n-1', p_status: 'looking' },
    { p_note_id: 'n-1', p_status: 'fixed' }
  ]);
});

test('setStatus refuses anything but looking or fixed', async () => {
  const D = freshModule();
  const fetch = fakeFetch([]);
  const api = D.createApi({ url: API, key: 'k', fetch, token: () => 't' });
  await assert.rejects(api.setStatus('n-1', 'wrote_back'));
  assert.equal(fetch.calls.length, 0);
});

// ── Escaping ──────────────────────────────────────────────────────────

test('a note containing <script> renders inert, as plain text', async () => {
  const D = freshModule();
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const e = noteEnv(
    Object.assign({}, FULL, {
      words: evil,
      dua_words: evil,
      chips: [evil],
      target: evil,
      diag: { version: evil },
      screenshot_path: null,
      messages: [{ id: 'm1', author: 'founder', founder_name: evil, body: evil, created_at: '2026-11-25T11:00:00Z' }]
    })
  );
  await D.start(e);
  await flush();
  // Every element the desk ever made is one it chose; none came from the note.
  const tags = new Set(e.document.created.map((x) => x.tagName));
  assert.ok(!tags.has('SCRIPT'), 'a <script> element was created');
  assert.ok(!tags.has('IMG'), 'an <img> from the note was created');
  assert.ok(e.root.textContent.includes(evil), 'the words are shown, verbatim, as text');
});

test('the list renders a <script> note as text too', async () => {
  const D = freshModule();
  const evil = '<script>alert(1)</script>';
  const fetch = fakeFetch([['founder_list_feedback', () => jsonResponse(200, { pinned: [], notes: [note({ words: evil })] })]]);
  const e = env({ fetch });
  await D.start(e);
  assert.ok(!e.document.created.some((x) => x.tagName === 'SCRIPT'));
  assert.ok(e.root.textContent.includes(evil));
});

test('no markup-parsing API appears in the desk module or the page', () => {
  const sources = [
    fs.readFileSync(path.join(ROOT, 'src', 'feedback-desk.js'), 'utf8'),
    fs.readFileSync(path.join(PAGE_DIR, 'index.html'), 'utf8')
  ];
  for (const src of sources) {
    for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) {
      assert.ok(!src.includes(bad), 'found ' + bad);
    }
  }
});

// ── The page ──────────────────────────────────────────────────────────

test('the page is hidden from search, loads the module it reads, and embeds only the anon key', () => {
  const html = fs.readFileSync(path.join(PAGE_DIR, 'index.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  const m = html.match(/<script src="([^"]+feedback-desk\.js)"><\/script>/);
  assert.ok(m, 'loads feedback-desk.js');
  assert.ok(fs.existsSync(path.join(PAGE_DIR, m[1])), m[1] + ' resolves from the page');
  const published = fs
    .readFileSync(path.join(ROOT, 'src', 'feedback-desk.js'), 'utf8')
    .match(/root\.([A-Za-z0-9_$]+)\s*=\s*factory\(\)/)[1];
  assert.ok(html.includes('window.' + published), 'the page reads window.' + published);
  assert.ok(!/service_role/.test(html));
  const jwts = html.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
  assert.equal(jwts.length, 1, 'exactly one key in the page');
  const payload = JSON.parse(Buffer.from(jwts[0].split('.')[1], 'base64url').toString('utf8'));
  assert.equal(payload.role, 'anon');
});

test('the home page never links to the reply page', () => {
  const home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(!home.includes('q7rk2m9xw4'));
});
