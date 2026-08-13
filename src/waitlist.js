/**
 * Android waitlist capture.
 *
 * The form at the bottom of the landing page used to be a `mailto:` link. It
 * opened a pre-filled draft to hello@sakina.app and stored nothing at all, so
 * the only people who ever reached us were the ones who typed an address, got
 * bounced into their mail client, and then remembered to hit send — which on
 * mobile, where `mailto:` often lands on an unconfigured Mail app, is close to
 * nobody. This module writes the address to Supabase instead.
 *
 * Design rules, all enforced by tests/waitlist.test.js:
 *
 *  - **Normalize on the way out.** `waitlist_signups` has a unique index on a
 *    lowercase email and a CHECK that the stored value equals its own
 *    lowercase. Sending `Someone@Example.com` would be a 400.
 *  - **Validate before the network.** The same shape rules as the table's
 *    CHECKs, so a typo is an inline message rather than a failed request.
 *  - **Never throw.** A blocker, an offline visitor, or a CORS failure has to
 *    come back as an outcome string. This form sits on the page that carries
 *    the App Store conversion path; nothing here may take the page down with
 *    it.
 *  - **No config, no send.** If the page is served without the project URL and
 *    key substituted, report an error rather than showing someone a
 *    confirmation for an address that went nowhere.
 *
 * The anon key this posts with is public by design — it is the same key already
 * shipped inside every IPA, and `waitlist_signups` has RLS on with no policies
 * and no grants, so the key can call `join_waitlist` and cannot read a single
 * row back. (This repo is public — that is the whole reason it exists, so Pages
 * can serve it. Never put the service-role key anywhere near this file.)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SakinaWaitlist = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RPC_PATH = '/rest/v1/rpc/join_waitlist';

  /** The only source this page captures from. Server-validated too. */
  var SOURCE = 'landing_android';

  /**
   * Mirrors `waitlist_signups_email_shape`. Deliberately loose: a regex is not
   * an email validator — delivery is — so this only rejects the
   * obviously-not-an-address and lets `user+tag@sub.domain.co.uk` through.
   */
  var SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  /** Mirrors `waitlist_signups_email_len`. 254 is the RFC 5321 ceiling. */
  var MIN_CHARS = 6;
  var MAX_CHARS = 254;

  /** Lowercase + trim. The unique index on the table depends on this. */
  function normalize(email) {
    if (email === null || email === undefined) return '';
    return String(email).trim().toLowerCase();
  }

  function isValid(email) {
    var e = normalize(email);
    if (e.length < MIN_CHARS || e.length > MAX_CHARS) return false;
    return SHAPE.test(e);
  }

  /**
   * Build the PostgREST call. Pure — this is the half worth testing, because a
   * wrong header is a 401 that nobody notices until a real visitor hits it.
   */
  function buildRequest(email, ctx) {
    ctx = ctx || {};
    var base = String(ctx.url || '').replace(/\/+$/, '');
    return {
      url: base + RPC_PATH,
      options: {
        method: 'POST',
        headers: {
          // `apikey` is what the Supabase gateway reads; the bearer is what
          // makes the same request work against PostgREST directly. supabase-js
          // sends both, and so do we — there is no client library on this page.
          apikey: ctx.key,
          Authorization: 'Bearer ' + ctx.key,
          'Content-Type': 'application/json',
          // Nothing to read back. The RPC returns a bare `true` whose only
          // purpose is to have a body at all.
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          p_email: normalize(email),
          p_source: ctx.source || SOURCE
        })
      }
    };
  }

  /**
   * Submit an address.
   *
   * Resolves to one of:
   *   'joined'  — stored, or already present (the RPC will not say which)
   *   'invalid' — failed the shape check; never left the browser
   *   'error'   — unconfigured page, network failure, or a non-2xx
   *
   * Never rejects.
   */
  function submit(email, ctx) {
    ctx = ctx || {};
    var url = ctx.url !== undefined ? ctx.url : config.url;
    var key = ctx.key !== undefined ? ctx.key : config.key;
    var doFetch =
      ctx.fetch || (typeof fetch === 'function' ? fetch.bind(null) : null);

    if (!isValid(email)) return Promise.resolve('invalid');
    if (!url || !key || !doFetch) return Promise.resolve('error');

    var req = buildRequest(email, { url: url, key: key, source: ctx.source });

    try {
      return Promise.resolve(doFetch(req.url, req.options))
        .then(function (res) {
          return res && res.ok ? 'joined' : 'error';
        })
        .catch(function () {
          return 'error';
        });
    } catch (_) {
      // A `fetch` replaced by an extension can throw synchronously.
      return Promise.resolve('error');
    }
  }

  var config = { url: '', key: '' };

  /** Called once by the page with the injected project URL and anon key. */
  function init(cfg) {
    cfg = cfg || {};
    config = { url: cfg.url || '', key: cfg.key || '' };
  }

  return {
    SOURCE: SOURCE,
    normalize: normalize,
    isValid: isValid,
    buildRequest: buildRequest,
    submit: submit,
    init: init
  };
});
