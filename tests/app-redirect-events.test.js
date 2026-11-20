'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------
// The in-app-browser escape is the riskiest part of the landing page: it
// can fail silently and strand a visitor who came from an Instagram or
// TikTok link on a page with a dead button. Without an outcome signal
// the only evidence is App Store installs — a numerator with no
// denominator, and no way to tell a bad escape from a bad ad.
//
// `CONFIG.onEvent` is the seam. It must fire on ATTEMPT and on FAILURE,
// carry only bounded context, and never break the escape when it throws.
// ---------------------------------------------------------------------

function setNavigator(props) {
  Object.defineProperty(globalThis, 'navigator', {
    value: Object.assign({ userAgent: '', platform: '', maxTouchPoints: 0 }, props),
    configurable: true,
    writable: true
  });
}

function setBrowserGlobals() {
  const listeners = {};
  Object.defineProperty(globalThis, 'window', {
    value: {
      open() {},
      addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
      removeEventListener() {},
      location: { href: '' }
    },
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'document', {
    value: {
      addEventListener() {},
      removeEventListener() {},
      // showFallbackModal builds DOM; give it enough to not throw.
      body: { appendChild() {}, removeChild() {} },
      head: { appendChild() {} },
      getElementById() { return null; },
      createElement() {
        const node = {
          style: {},
          classList: { add() {} },
          appendChild() {},
          addEventListener() {},
          setAttribute() {},
          remove() {},
          querySelector() { return node; },
          querySelectorAll() { return []; }
        };
        return node;
      },
      querySelectorAll() { return []; },
      querySelector() { return null; }
    },
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'location', {
    value: { href: '' },
    configurable: true,
    writable: true
  });
  return listeners;
}

function freshModule() {
  delete require.cache[require.resolve('../src/app-redirect.js')];
  return require('../src/app-redirect.js');
}

const IG_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Instagram 302.0.0.23.114';

const STORE = 'https://apps.apple.com/us/app/x/id1';

function fakeEvent() {
  return { preventDefault() { this.defaultPrevented = true; }, defaultPrevented: false };
}

test('an escape attempt in an in-app browser reports itself', () => {
  setBrowserGlobals();
  setNavigator({ userAgent: IG_UA });
  const R = freshModule();

  const events = [];
  R.CONFIG.onEvent = (name, props) => events.push({ name, props });

  R.handleStoreClick(fakeEvent(), STORE);

  const attempted = events.find((e) => e.name === 'redirect_attempted');
  assert.ok(attempted, 'an escape that fires must say so');
  assert.equal(attempted.props.in_app_browser, 'instagram');
  assert.equal(attempted.props.platform, 'ios');
});

test('a normal browser reports nothing — there is no escape to measure', () => {
  setBrowserGlobals();
  setNavigator({ userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Safari' });
  const R = freshModule();

  const events = [];
  R.CONFIG.onEvent = (name) => events.push(name);

  R.handleStoreClick(fakeEvent(), STORE);

  assert.deepEqual(events, [],
    'the plain href navigates; instrumenting it here would double-count the CTA');
});

test('a silent escape failure is reported when the fallback fires', async () => {
  setBrowserGlobals();
  setNavigator({ userAgent: IG_UA });
  const R = freshModule();
  R.CONFIG.escapeTimeoutMs = 5;

  const events = [];
  R.CONFIG.onEvent = (name, props) => events.push({ name, props });

  R.handleStoreClick(fakeEvent(), STORE);
  await new Promise((r) => setTimeout(r, 30));

  const failed = events.find((e) => e.name === 'redirect_failed');
  assert.ok(failed, 'the modal appearing IS the failure signal — it must be sent');
  assert.equal(failed.props.in_app_browser, 'instagram');
});

test('a throwing reporter never breaks the escape', () => {
  setBrowserGlobals();
  setNavigator({ userAgent: IG_UA });
  const R = freshModule();

  R.CONFIG.onEvent = () => { throw new Error('blocker ate it'); };

  const ev = fakeEvent();
  assert.doesNotThrow(() => R.handleStoreClick(ev, STORE));
  assert.equal(ev.defaultPrevented, true,
    'the escape still took over the click, which is the behaviour that matters');
});

// TikTok's iOS webview blocks the store and every escape (131 of 133 x-safari-
// taps failed), so a store tap there goes straight to the manual steps: the
// tap must not navigate, must not "attempt" anything, and the sheet must not
// offer a "Try again" that repeats the blocked escape.
// Yawm's page (getyawm.com/get/, same design as ours) opens the App Store from
// TikTok with a plain navigation to the plain listing URL. Ours was blocked
// navigating to a Campaign Link (/app/apple-store/id…?pt=&ct=&mt=8). So a
// TikTok tap navigates to the plain listing, in the tap's own gesture, and
// only if nothing leaves does the sheet appear — with no "Try again", since
// retrying is just tapping the button again.
test('an iOS TikTok store tap goes to the plain listing, then the steps if it stays', async () => {
  setBrowserGlobals();
  const html = [];
  const realCreate = document.createElement;
  document.createElement = () => {
    const node = realCreate();
    Object.defineProperty(node, 'innerHTML', { set(v) { html.push(v); }, get() { return html.join(''); } });
    node.querySelector = (sel) => (sel.indexOf('retry') > -1 ? null : node);
    return node;
  };
  setNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 musical_ly_34.1.0 BytedanceWebview/d8a21c6' });
  let opened = null;
  window.open = (url) => { opened = url; };
  const R = freshModule();
  R.CONFIG.escapeTimeoutMs = 5;
  const events = [];
  R.CONFIG.onEvent = (name, props) => events.push({ name, props });
  const e = fakeEvent();
  R.handleStoreClick(e, 'https://apps.apple.com/app/apple-store/id1?pt=1&ct=tiktok&mt=8');
  assert.equal(location.href, R.CONFIG.ios.storeUrl, 'the plain listing, never a Campaign Link');
  assert.equal(opened, null, 'x-safari- failed 131 of 133 times in TikTok');
  assert.equal(e.defaultPrevented, true);
  assert.equal(html.join(''), '', 'no sheet before the navigation has had its chance');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(events.map((x) => x.name), ['redirect_attempted', 'redirect_failed']);
  assert.equal(events[0].props.in_app_browser, 'tiktok');
  const sheet = html.join('');
  assert.match(sheet, /Open in browser/);
  assert.doesNotMatch(sheet, /Try again/);
  assert.match(sheet, /Sakina Islamic Wellness/);
});

test('Android TikTok with no Play package keeps the plain link', () => {
  setBrowserGlobals();
  setNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36 trill_340104 AppName/musical_ly BytedanceWebview/d8a21c6' });
  const R = freshModule();
  const events = [];
  R.CONFIG.onEvent = (name) => events.push(name);
  const e = fakeEvent();
  R.handleStoreClick(e, STORE);
  assert.equal(e.defaultPrevented, false, 'no escape exists yet, so the tap must navigate');
  assert.deepEqual(events, []);
});
