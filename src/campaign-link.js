/**
 * campaign-link.js
 * -----------------------------------------------------------------------
 * The per-reel App Store Campaign Link. Zero dependencies, UMD.
 *
 * A reel's DM link is /get/?src=ig_dm&r=<instagram media id>. This turns
 * `r` into an App Store URL carrying pt (our provider token) and ct (the
 * reel), so App Analytics reports first-time downloads per reel. Apple's
 * campaign generator only ever builds this same string. A link with no reel
 * (a bio, Facebook, cutt.ly) gets its channel as the ct instead.
 *
 * It is still a direct apps.apple.com link, not a tracking redirect, so the
 * Instagram extbrowser escape keeps its zero-prompt path.
 *
 * Anything invalid returns null, and the page falls back to the plain store
 * link: attribution is allowed to be missing, never allowed to break a tap.
 *
 * Android's equivalent is playStoreUrl(): the Play listing with the channel
 * and the reel in `referrer`, which the app reads once on first open through
 * the Play Install Referrer API (lib/services/play_install_referrer_service.dart
 * in the app repo). Apple counts per-reel downloads for us; on Android that
 * referrer is the only per-reel signal there is.
 * -----------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SakinaCampaignLink = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var APP_ID = '6762153820';

  // Public by design: it appears in every campaign link Apple generates.
  var PROVIDER_TOKEN = '128715313';

  // Apple caps a campaign token at 40 characters. Letters, digits and '-'
  // only: a strict subset of what Apple accepts, so nothing here ever needs
  // escaping. Instagram media ids are all digits.
  var REEL_ID = /^[A-Za-z0-9-]{1,40}$/;

  function reelIdFrom(search) {
    try {
      var value = new URLSearchParams(search || '').get('r');
      return value && REEL_ID.test(value) ? value : null;
    } catch (e) {
      return null;
    }
  }

  // `src` values are ours (ig_dm, bio_getsakina, boost). Same shape as a reel
  // id plus '_', so a referrer never needs more than one level of escaping.
  var CHANNEL = /^[A-Za-z0-9_-]{1,40}$/;

  // A Java package name. Anchored, so nothing can ride along into the query.
  var PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

  /**
   * The campaign a visit belongs to: the reel when `r` is a valid media id,
   * otherwise the channel in `src` (bio_getsakina, fb_samiespeaks, …), so a
   * bio or Facebook install is its own campaign rather than part of the
   * organic remainder. A reel is the finer grain, so it wins. 'none' is the
   * pages' own placeholder for "no channel" and never becomes a campaign.
   */
  function campaignTokenFrom(search) {
    var reel = reelIdFrom(search);
    if (reel) return reel;
    try {
      var channel = new URLSearchParams(search || '').get('src');
      return channel && channel.toLowerCase() !== 'none' && CHANNEL.test(channel) ? channel : null;
    } catch (e) {
      return null;
    }
  }

  // A campaign is a reel id or a channel, so the token is the union of both
  // shapes. '_' is URL-safe, so the link still needs no escaping.
  var CAMPAIGN = /^[A-Za-z0-9_-]{1,40}$/;

  function campaignStoreUrl(token, providerToken) {
    var pt = providerToken === undefined ? PROVIDER_TOKEN : providerToken;
    if (!token || !CAMPAIGN.test(token) || !/^[0-9]+$/.test(pt || '')) return null;
    return 'https://apps.apple.com/app/apple-store/id' + APP_ID +
      '?pt=' + pt + '&ct=' + token + '&mt=8';
  }

  /**
   * The Play listing for `pkg`, carrying `utm_source=<channel>`,
   * `utm_medium=landing` and, when there is one, `utm_content=<reel id>` as a
   * single percent-encoded `referrer` (Play's documented format). An unsafe
   * channel becomes 'none' and an unsafe reel is left out, so a bad link still
   * reaches the store; only a missing or malformed package returns null.
   */
  function playStoreUrl(pkg, channel, reelId) {
    if (!pkg || !PACKAGE.test(pkg)) return null;
    var parts = [
      'utm_source=' + (channel && CHANNEL.test(channel) ? channel : 'none'),
      'utm_medium=landing'
    ];
    if (reelId && REEL_ID.test(reelId)) parts.push('utm_content=' + reelId);
    return 'https://play.google.com/store/apps/details?id=' + pkg +
      '&referrer=' + encodeURIComponent(parts.join('&'));
  }

  return {
    APP_ID: APP_ID,
    PROVIDER_TOKEN: PROVIDER_TOKEN,
    reelIdFrom: reelIdFrom,
    campaignTokenFrom: campaignTokenFrom,
    campaignStoreUrl: campaignStoreUrl,
    playStoreUrl: playStoreUrl
  };
});
