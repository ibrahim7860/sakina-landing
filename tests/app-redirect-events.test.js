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
