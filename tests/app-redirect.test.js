'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------
// Minimal DOM/BOM shims so app-redirect.js's UMD wrapper picks the
// Node (module.exports) branch, and so escape functions have somewhere
// to write without throwing. We rebuild + re-require the module fresh
// per test so navigator/location state never leaks between cases.
// ---------------------------------------------------------------------

function setNavigator(props) {
  Object.defineProperty(globalThis, 'navigator', {
    value: Object.assign({ userAgent: '', platform: '', maxTouchPoints: 0 }, props),
    configurable: true,
    writable: true
  });
}

function setLocation() {
  const loc = { href: '', replaced: [] };
  Object.defineProperty(globalThis, 'location', {
    value: new Proxy(loc, {
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    }),
    configurable: true,
    writable: true
  });
  return loc;
}

function freshModule() {
  delete require.cache[require.resolve('../src/app-redirect.js')];
  return require('../src/app-redirect.js');
}

const UA = {
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15',
  iosInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Instagram 302.0.0.23.114',
  iosThreads:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Barcelona 285.0',
  iosFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/460.0.0]',
  iosMessenger:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Messenger',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36',
  androidInstagram:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Instagram 302.0.0.23.114',
  desktopChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0 Safari/537.36'
};

// ---------------------------------------------------------------------
// isIOS / isAndroid
// ---------------------------------------------------------------------

test('isIOS true for iPhone UA', () => {
  setNavigator({ userAgent: UA.iosSafari });
  const AR = freshModule();
  assert.equal(AR.isIOS(), true);
});

test('isIOS true for iPadOS 13+ masquerading as Mac', () => {
  setNavigator({ userAgent: UA.desktopChrome, platform: 'MacIntel', maxTouchPoints: 5 });
  const AR = freshModule();
  assert.equal(AR.isIOS(), true);
});

test('isIOS false for real desktop Mac', () => {
  setNavigator({ userAgent: UA.desktopChrome, platform: 'MacIntel', maxTouchPoints: 0 });
  const AR = freshModule();
  assert.equal(AR.isIOS(), false);
});

test('isAndroid true for Android UA', () => {
  setNavigator({ userAgent: UA.androidChrome });
  const AR = freshModule();
  assert.equal(AR.isAndroid(), true);
});

test('isAndroid false for iOS UA', () => {
  setNavigator({ userAgent: UA.iosSafari });
  const AR = freshModule();
  assert.equal(AR.isAndroid(), false);
});

// ---------------------------------------------------------------------
// isInstagramInApp / isFacebookInApp / isInAppBrowser
// ---------------------------------------------------------------------

test('isInstagramInApp true for Instagram token', () => {
  setNavigator({ userAgent: UA.iosInstagram });
  const AR = freshModule();
  assert.equal(AR.isInstagramInApp(), true);
});

test('isInstagramInApp true for Threads (Barcelona token)', () => {
  setNavigator({ userAgent: UA.iosThreads });
  const AR = freshModule();
  assert.equal(AR.isInstagramInApp(), true);
});

test('isFacebookInApp true for FBAN/FBAV token', () => {
  setNavigator({ userAgent: UA.iosFacebook });
  const AR = freshModule();
  assert.equal(AR.isFacebookInApp(), true);
});

test('isFacebookInApp true for Messenger token', () => {
  setNavigator({ userAgent: UA.iosMessenger });
  const AR = freshModule();
  assert.equal(AR.isFacebookInApp(), true);
});

test('isInAppBrowser false for plain mobile Safari', () => {
  setNavigator({ userAgent: UA.iosSafari });
  const AR = freshModule();
  assert.equal(AR.isInAppBrowser(), false);
});

test('isInAppBrowser true for Android Instagram', () => {
  setNavigator({ userAgent: UA.androidInstagram });
  const AR = freshModule();
  assert.equal(AR.isInAppBrowser(), true);
});

// ---------------------------------------------------------------------
// fireEscape — verifies the exact escape scheme per environment
// ---------------------------------------------------------------------

test('fireEscape uses instagram://extbrowser on iOS Instagram, with raw url encoded', () => {
  setNavigator({ userAgent: UA.iosInstagram });
  const loc = setLocation();
  const AR = freshModule();
  const target = 'https://apps.apple.com/us/app/sakina-islamic-wellness/id6762153820';
  const attempted = AR.fireEscape(target);
  assert.equal(attempted, true);
  assert.equal(loc.href, 'instagram://extbrowser/?url=' + encodeURIComponent(target));
});

test('fireEscape uses instagram://extbrowser on iOS Threads too', () => {
  setNavigator({ userAgent: UA.iosThreads });
  const loc = setLocation();
  const AR = freshModule();
  const target = 'https://apps.apple.com/us/app/sakina-islamic-wellness/id6762153820';
  AR.fireEscape(target);
  assert.match(loc.href, /^instagram:\/\/extbrowser\/\?url=/);
});

test('fireEscape uses window.open("x-safari-...") on iOS Facebook', () => {
  setNavigator({ userAgent: UA.iosFacebook });
  setLocation();
  const AR = freshModule();
  let openedUrl = null;
  global.window = { open: (url) => { openedUrl = url; } };
  const target = 'https://apps.apple.com/us/app/sakina-islamic-wellness/id6762153820';
  const attempted = AR.fireEscape(target);
  assert.equal(attempted, true);
  assert.equal(openedUrl, 'x-safari-' + target);
  delete global.window;
});

test('fireEscape does NOT use x-safari- via location.href on Instagram (regression guard)', () => {
  setNavigator({ userAgent: UA.iosInstagram });
  const loc = setLocation();
  const AR = freshModule();
  AR.fireEscape('https://apps.apple.com/us/app/x/id1');
  assert.doesNotMatch(loc.href, /^x-safari-/);
});

test('fireEscape uses intent:// on Android when package is configured', () => {
  setNavigator({ userAgent: UA.androidInstagram });
  const loc = setLocation();
  const AR = freshModule();
  AR.CONFIG.android.packageName = 'com.example.sakina';
  const target = 'https://play.google.com/store/apps/details?id=com.example.sakina';
  const attempted = AR.fireEscape(target);
  assert.equal(attempted, true);
  assert.equal(
    loc.href,
    'intent://play.google.com/store/apps/details?id=com.example.sakina#Intent;scheme=https;end'
  );
});

test('fireEscape is a no-op on Android when no package is configured (no Android app yet)', () => {
  setNavigator({ userAgent: UA.androidInstagram });
  setLocation();
  const AR = freshModule();
  AR.CONFIG.android.packageName = null;
  const attempted = AR.fireEscape('https://apps.apple.com/us/app/x/id1');
  assert.equal(attempted, false);
});

test('fireEscape is a no-op on plain desktop (nothing to escape)', () => {
  setNavigator({ userAgent: UA.desktopChrome, platform: 'MacIntel', maxTouchPoints: 0 });
  setLocation();
  const AR = freshModule();
  const attempted = AR.fireEscape('https://apps.apple.com/us/app/x/id1');
  assert.equal(attempted, false);
});

// ---------------------------------------------------------------------
// CONFIG defaults reflect the "no android app / no attribution links yet"
// state described by the user, so nothing ships half-wired.
// ---------------------------------------------------------------------

test('CONFIG defaults: android package is null, attribution map is empty', () => {
  setNavigator({ userAgent: UA.desktopChrome });
  const AR = freshModule();
  assert.equal(AR.CONFIG.android.packageName, null);
  assert.deepEqual(AR.CONFIG.attribution, {});
});

test('CONFIG default: iOS store url is the raw apps.apple.com link, not a tracking redirect', () => {
  setNavigator({ userAgent: UA.desktopChrome });
  const AR = freshModule();
  assert.match(AR.CONFIG.ios.storeUrl, /^https:\/\/apps\.apple\.com\//);
});
