/**
 * Landing-page telemetry.
 *
 * The landing page carries the App Store conversion path for the whole
 * release and shipped with no instrumentation at all: no page view, no Store
 * CTA, no redirect outcome. That matters more here than on a normal marketing
 * page, because `app-redirect.js` exists to escape in-app browsers (Instagram,
 * Threads, TikTok) and CAN fail silently — leaving the visitor on a dead page
 * with nobody the wiser. Installs alone give a numerator with no denominator.
 *
 * Design rules, all enforced by tests/landing-analytics.test.js:
 *
 *  - **Bounded properties only.** An allow-list of keys, and every value
 *    clamped. A page can be reached with any query string a stranger invents;
 *    forwarding that verbatim is how a marketing page becomes a PII incident.
 *  - **Never break the page.** Every entry point swallows its own errors. A
 *    visitor with a blocker, an ancient browser, or no `sendBeacon` gets a
 *    fully working Store button and no events. Analytics is not allowed to
 *    stand between anyone and the App Store.
 *  - **No token, no send.** If the page is served without the token
 *    substituted, fire nothing rather than payloads Mixpanel silently drops.
 *
 * The Mixpanel project token is write-only and public by design — the same one
 * already shipped inside every IPA via `--dart-define`. It is not a secret, but
 * it IS a value someone can spam, which is the other reason for the allow-list.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SakinaLandingAnalytics = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TRACK_URL = 'https://api.mixpanel.com/track';

  /** Every event this page may emit. Call sites index into this. */
  var EVENTS = {
    viewed: 'landing_viewed',
    storeCta: 'landing_store_cta_tapped',
    redirectAttempted: 'landing_redirect_attempted',
    redirectFailed: 'landing_redirect_failed',
    waitlist: 'landing_waitlist_tapped'
  };

  /**
   * The allow-list. Anything not named here is dropped, so a call site cannot
   * quietly widen the payload later.
   *
   *  platform        — 'ios' | 'android' | 'desktop' | 'other'
   *  in_app_browser  — which in-app webview, or 'none'
   *  channel         — which surface on the page (hero, footer, …)
   *  outcome         — what happened ('opened', 'blocked', 'timeout', …)
   *  reel            — the Instagram media id from /get/?r=, or 'none'
   */
  var ALLOWED_PROPS = ['platform', 'in_app_browser', 'channel', 'outcome', 'reel'];

  /** A bounded key with an unbounded value is still unbounded. */
  var MAX_VALUE_CHARS = 64;

  function clamp(value) {
    var s = String(value);
    return s.length > MAX_VALUE_CHARS ? s.slice(0, MAX_VALUE_CHARS) : s;
  }

  function pickProps(props) {
    var out = {};
    if (!props) return out;
    for (var i = 0; i < ALLOWED_PROPS.length; i++) {
      var key = ALLOWED_PROPS[i];
      if (props[key] !== undefined && props[key] !== null) {
        out[key] = clamp(props[key]);
      }
    }
    return out;
  }

  /**
   * Build the Mixpanel `/track` payload, or null when there is no token.
   * Pure — this is the half worth testing.
   */
  function buildEvent(name, props, ctx) {
    ctx = ctx || {};
    if (!ctx.token) return null;
    var properties = pickProps(props);
    properties.token = ctx.token;
    properties.distinct_id = ctx.distinctId;
    properties.time = ctx.now;
    return { event: name, properties: properties };
  }

  function encode(payload) {
    var json = JSON.stringify([payload]);
    var b64 =
      typeof btoa === 'function'
        ? btoa(json)
        : Buffer.from(json).toString('base64');
    return 'data=' + encodeURIComponent(b64);
  }

  /**
   * Fire an event. Never throws, never blocks navigation.
   *
   * `ctx.send(url, body)` is the transport seam — the browser default is
   * `sendBeacon`, which is the only thing that reliably survives the page
   * being torn down by a Store redirect one millisecond later.
   */
  function track(name, props, ctx) {
    try {
      ctx = ctx || {};
      var send = ctx.send === undefined ? defaultSend : ctx.send;
      if (!send) return;
      var payload = buildEvent(name, props, {
        token: ctx.token !== undefined ? ctx.token : currentToken,
        distinctId: ctx.distinctId !== undefined ? ctx.distinctId : distinctId(),
        now: ctx.now !== undefined ? ctx.now : Date.now()
      });
      if (!payload) return;
      send(TRACK_URL, encode(payload));
    } catch (_) {
      /* analytics must never break the page */
    }
  }

  function defaultSend(url, body) {
    try {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        return navigator.sendBeacon(url, body);
      }
      if (typeof fetch === 'function') {
        fetch(url, { method: 'POST', body: body, keepalive: true, mode: 'no-cors' });
        return true;
      }
    } catch (_) {
      /* fall through */
    }
    return false;
  }

  // ── Anonymous identity ────────────────────────────────────────────────────
  // A random id in localStorage. No fingerprinting, nothing derived from the
  // visitor. Its only job is to let `landing_viewed → landing_store_cta_tapped`
  // be a funnel rather than two unrelated counters. A visitor with storage
  // disabled gets a per-pageview id, which degrades the funnel and breaks
  // nothing.
  var STORAGE_KEY = 'sakina_landing_did';
  var cachedId = null;

  function distinctId() {
    if (cachedId) return cachedId;
    try {
      var existing = localStorage.getItem(STORAGE_KEY);
      if (existing) {
        cachedId = existing;
        return cachedId;
      }
    } catch (_) {
      /* storage blocked — fall through to an ephemeral id */
    }
    cachedId =
      'anon-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try {
      localStorage.setItem(STORAGE_KEY, cachedId);
    } catch (_) {
      /* ephemeral is fine */
    }
    return cachedId;
  }

  var currentToken = '';

  /** Called once by the page with the injected project token. */
  function init(token) {
    currentToken = token || '';
  }

  return {
    EVENTS: EVENTS,
    buildEvent: buildEvent,
    track: track,
    init: init,
    _distinctId: distinctId
  };
});
