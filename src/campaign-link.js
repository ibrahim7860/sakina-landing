/**
 * campaign-link.js
 * -----------------------------------------------------------------------
 * The per-reel App Store Campaign Link. Zero dependencies, UMD.
 *
 * A reel's DM link is /get/?src=ig_dm&r=<instagram media id>. This turns
 * `r` into an App Store URL carrying pt (our provider token) and ct (the
 * reel), so App Analytics reports first-time downloads per reel. Apple's
 * campaign generator only ever builds this same string.
 *
 * It is still a direct apps.apple.com link, not a tracking redirect, so the
 * Instagram extbrowser escape keeps its zero-prompt path.
 *
 * Anything invalid returns null, and the page falls back to the plain store
 * link: attribution is allowed to be missing, never allowed to break a tap.
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
  var PROVIDER_TOKEN = 'PASTE_PT_FROM_TASK_0';

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

  function campaignStoreUrl(reelId, providerToken) {
    var pt = providerToken === undefined ? PROVIDER_TOKEN : providerToken;
    if (!reelId || !REEL_ID.test(reelId) || !/^[0-9]+$/.test(pt || '')) return null;
    return 'https://apps.apple.com/app/apple-store/id' + APP_ID +
      '?pt=' + pt + '&ct=' + reelId + '&mt=8';
  }

  return {
    APP_ID: APP_ID,
    PROVIDER_TOKEN: PROVIDER_TOKEN,
    reelIdFrom: reelIdFrom,
    campaignStoreUrl: campaignStoreUrl
  };
});
