/**
 * app-redirect.js
 * -----------------------------------------------------------------------
 * One-click "go to app store" system that survives Instagram / Facebook /
 * Messenger / Threads in-app browsers, plus Android webviews.
 *
 * Zero dependencies. Works as a plain <script> tag or an ES module.
 *
 * WHAT TO EDIT BEFORE SHIPPING
 *   See the CONFIG block below. Two things are placeholders on purpose:
 *     - CONFIG.android.packageName -> null (no Android app yet)
 *     - CONFIG.attribution         -> {} (no OneLink/Branch links given)
 *   Both degrade safely (see comments) and can be filled in later without
 *   touching any other logic.
 * -----------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AppRedirect = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ======================================================================
  // CONFIG — the only section you should need to touch per-project.
  // ======================================================================
  var CONFIG = {
    ios: {
      // Raw store URL. Must stay a *direct* apps.apple.com link (not a
      // tracking/OneLink redirect) so the extbrowser escape lands on the
      // zero-prompt path described in the background notes.
      storeUrl: 'https://apps.apple.com/us/app/sakina-islamic-wellness/id6762153820'
    },
    android: {
      // TODO: fill in once the Android build ships (e.g. "tech.belan.sakina").
      // Everything below checks this before doing anything Android-specific,
      // so leaving it null just quietly disables the Android path instead
      // of producing a broken link.
      packageName: null
    },
    // Optional per-channel attribution links (AppsFlyer OneLink, Branch, etc).
    // Populate as { instagram: 'https://xxx.onelink.me/abc/ig', tiktok: '...' }
    // when you have them. Left empty here (none were provided) — every path
    // below falls back to the raw store URL and simply skips the beacon,
    // exactly as specified.
    attribution: {},
    // How long (ms) to wait for a visibilitychange/pagehide/blur signal
    // after firing an escape before assuming it failed and showing the
    // fallback UI.
    escapeTimeoutMs: 1500,
    // Optional telemetry seam: `(name, props) => void`, wired by index.html to
    // landing-analytics.js. Null by default so this file stays dependency-free
    // and testable on its own.
    //
    // This escape is the riskiest thing on the page — it can fail silently and
    // leave a visitor who arrived from an Instagram link on a dead button. The
    // only prior evidence was App Store installs: a numerator with no
    // denominator, and no way to distinguish a broken escape from a bad ad.
    onEvent: null
  };

  /**
   * Report an escape lifecycle event. Swallows everything: a blocked or
   * throwing reporter must never break the escape it is only observing.
   */
  function report(name, props) {
    try {
      if (typeof CONFIG.onEvent === 'function') CONFIG.onEvent(name, props);
    } catch (_) {
      /* telemetry is never load-bearing */
    }
  }

  /** Bounded context for the escape events. */
  function escapeContext() {
    return {
      platform: isIOS() ? 'ios' : isAndroid() ? 'android' : 'other',
      in_app_browser: isInstagramInApp()
        ? 'instagram'
        : isFacebookInApp()
          ? 'facebook'
          : 'none'
    };
  }

  // ======================================================================
  // UA helpers
  // ======================================================================

  function getUA() {
    return (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  }

  function isIOS() {
    var ua = getUA();
    // Covers iPhone/iPad/iPod UAs, and iPadOS 13+ which reports as Mac
    // but exposes touch points.
    var classicIOS = /iP(hone|od|ad)/.test(ua);
    var iPadOS13Plus =
      typeof navigator !== 'undefined' &&
      navigator.platform === 'MacIntel' &&
      typeof navigator.maxTouchPoints === 'number' &&
      navigator.maxTouchPoints > 1;
    return classicIOS || !!iPadOS13Plus;
  }

  function isAndroid() {
    return /Android/.test(getUA());
  }

  function isInstagramInApp() {
    var ua = getUA();
    // "Instagram" = IG app itself. "Barcelona" = Threads' internal UA token.
    return /Instagram/i.test(ua) || /Barcelona/i.test(ua);
  }

  function isFacebookInApp() {
    var ua = getUA();
    return /FBAN|FBAV|FB_IAB|Messenger/i.test(ua);
  }

  function isInAppBrowser() {
    return isInstagramInApp() || isFacebookInApp();
  }

  // ======================================================================
  // Escape logic
  // ======================================================================

  /**
   * Fires the correct synchronous escape for the current environment.
   * MUST be called synchronously inside a user-gesture handler (click) —
   * iOS silently drops custom-scheme navigation queued after an
   * await/setTimeout.
   *
   * @param {string} targetUrl Raw store URL to escape to.
   * @returns {boolean} true if an escape was attempted, false if this
   *   environment doesn't need one (caller should just let the normal
   *   href/navigation happen).
   */
  function fireEscape(targetUrl) {
    if (isIOS() && isInstagramInApp()) {
      // Works from page load AND from click handlers. Do NOT use
      // x-safari- via location.href here — IG silently drops it.
      location.href = 'instagram://extbrowser/?url=' + encodeURIComponent(targetUrl);
      return true;
    }

    if (isIOS() && isFacebookInApp()) {
      // Only works inside a user-gesture. Caller is responsible for
      // ensuring this runs synchronously inside a click handler.
      window.open('x-safari-' + targetUrl, '_blank');
      return true;
    }

    if (isAndroid()) {
      var androidPkg = CONFIG.android.packageName;
      if (androidPkg) {
        // intent:// is honored by every Android webview, including
        // in-app browsers, and is harmless in normal Chrome too.
        var host = targetUrl.replace(/^https?:\/\//, '');
        location.href = 'intent://' + host + '#Intent;scheme=https;end';
      } else {
        // No Android app yet — fall through to the real href
        // (iOS store link isn't useful on Android, so let the normal
        // click proceed to whatever href the CTA has, e.g. a
        // "coming soon" anchor or the iOS link as a placeholder).
        return false;
      }
      return true;
    }

    return false;
  }

  // ======================================================================
  // Fallback modal
  // ======================================================================

  var MODAL_ID = 'app-redirect-fallback-modal';
  var modalStylesInjected = false;

  function injectModalStyles() {
    if (modalStylesInjected) return;
    modalStylesInjected = true;
    var style = document.createElement('style');
    style.textContent =
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:2147483000;display:flex;' +
      'align-items:flex-end;justify-content:center;background:rgba(20,24,20,0.55);' +
      'font-family:"Lora",Georgia,serif;}' +
      '#' + MODAL_ID + ' .ar-sheet{width:100%;max-width:440px;background:#F7F3E9;' +
      'color:#1B2420;border-radius:20px 20px 0 0;padding:28px 24px 32px;' +
      'box-shadow:0 -8px 30px rgba(0,0,0,0.25);animation:ar-slide-up .25s ease-out;}' +
      '@media(min-width:480px){#' + MODAL_ID + '{align-items:center;}' +
      '#' + MODAL_ID + ' .ar-sheet{border-radius:20px;}}' +
      '@keyframes ar-slide-up{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}' +
      '#' + MODAL_ID + ' h2{margin:0 0 8px;font-family:"Aref Ruqaa","Amiri",Georgia,serif;' +
      'font-size:22px;color:#0F5B41;}' +
      '#' + MODAL_ID + ' p{margin:0 0 16px;font-size:15px;line-height:1.5;color:#3A3F3A;}' +
      '#' + MODAL_ID + ' ol{margin:0 0 20px;padding-left:20px;font-size:14px;' +
      'line-height:1.6;color:#3A3F3A;}' +
      '#' + MODAL_ID + ' .ar-btn{display:block;width:100%;text-align:center;' +
      'padding:13px 18px;border-radius:12px;border:none;font-size:15px;' +
      'font-family:inherit;font-weight:600;cursor:pointer;margin-bottom:10px;' +
      'text-decoration:none;box-sizing:border-box;}' +
      '#' + MODAL_ID + ' .ar-btn-primary{background:#0F5B41;color:#F7F3E9;}' +
      '#' + MODAL_ID + ' .ar-btn-secondary{background:transparent;color:#0F5B41;' +
      'border:1.5px solid #C7A248;}' +
      '#' + MODAL_ID + ' .ar-close{position:absolute;top:14px;right:16px;' +
      'background:none;border:none;font-size:20px;color:#8A8F87;cursor:pointer;' +
      'line-height:1;padding:4px;}';
    document.head.appendChild(style);
  }

  /**
   * @param {object} opts
   * @param {string} opts.targetUrl
   * @param {() => void} opts.onRetry
   */
  function showFallbackModal(opts) {
    injectModalStyles();
    var existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Open in App Store');

    var manualSteps = isIOS() && isInstagramInApp()
      ? 'Tap the \u2022\u2022\u2022 menu at the top right, then choose \u201cOpen in external browser.\u201d'
      : isIOS() && isFacebookInApp()
        ? 'Tap the \u2022\u2022\u2022 menu at the top right, then choose \u201cOpen in Safari.\u201d'
        : 'Tap your browser\u2019s menu, then choose \u201cOpen in browser.\u201d';

    overlay.innerHTML =
      '<div class="ar-sheet">' +
      '<button class="ar-close" type="button" aria-label="Close">\u00d7</button>' +
      '<h2>Almost there</h2>' +
      '<p>This app can\u2019t open the App Store directly from here. Try again, or follow these steps:</p>' +
      '<ol><li>' + manualSteps + '</li><li>Tap the download button again from your browser.</li></ol>' +
      '<button class="ar-btn ar-btn-primary" type="button" data-ar-action="retry">Try again</button>' +
      '<a class="ar-btn ar-btn-secondary" data-ar-action="copy" href="' + opts.targetUrl + '" target="_blank" rel="noopener">Copy link</a>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.querySelector('.ar-close').addEventListener('click', function () {
      overlay.remove();
    });
    overlay.querySelector('[data-ar-action="retry"]').addEventListener('click', function () {
      overlay.remove();
      opts.onRetry();
    });
    overlay.querySelector('[data-ar-action="copy"]').addEventListener('click', function (e) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        e.preventDefault();
        navigator.clipboard.writeText(opts.targetUrl).then(function () {
          var btn = overlay.querySelector('[data-ar-action="copy"]');
          var original = btn.textContent;
          btn.textContent = 'Link copied';
          setTimeout(function () {
            btn.textContent = original;
          }, 1500);
        }).catch(function () {
          // Clipboard API blocked (common inside in-app browsers) — the
          // anchor's real href still lets the tap open the link normally.
        });
      }
    });
  }

  // ======================================================================
  // Click-to-store binding
  // ======================================================================

  /**
   * Runs the escape-and-fallback flow for a single click event.
   * Exported so callers can wire up custom elements, not just <a> tags.
   *
   * @param {MouseEvent} event
   * @param {string} targetUrl Raw store URL.
   */
  function handleStoreClick(event, targetUrl) {
    if (!isInAppBrowser() && !(isAndroid() && CONFIG.android.packageName)) {
      // Normal browser (or Android with no app yet): let the real href
      // navigate as usual. Nothing to intercept.
      return;
    }

    var attempted = fireEscape(targetUrl);
    if (!attempted) {
      return; // let default navigation happen
    }

    event.preventDefault();
    report('redirect_attempted', escapeContext());

    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      cleanup();
      // The modal appearing IS the failure signal: no visibilitychange,
      // pagehide or blur arrived, so the escape never left the webview.
      report('redirect_failed', escapeContext());
      showFallbackModal({
        targetUrl: targetUrl,
        onRetry: function () {
          fireEscape(targetUrl);
        }
      });
    }, CONFIG.escapeTimeoutMs);

    function onSignal() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
    }

    function cleanup() {
      document.removeEventListener('visibilitychange', onSignal);
      window.removeEventListener('pagehide', onSignal);
      window.removeEventListener('blur', onSignal);
    }

    document.addEventListener('visibilitychange', onSignal);
    window.addEventListener('pagehide', onSignal);
    window.addEventListener('blur', onSignal);
  }

  /** @type {WeakSet<Element>} */
  var boundElements = new WeakSet();

  /**
   * Binds a single <a> element as a store CTA.
   * @param {HTMLAnchorElement} el
   */
  function bindElement(el) {
    if (boundElements.has(el)) return;
    boundElements.add(el);
    el.addEventListener('click', function (event) {
      var targetUrl = el.getAttribute('data-store-url') || CONFIG.ios.storeUrl;
      handleStoreClick(event, targetUrl);
    });
  }

  /**
   * Auto-discovers and binds every download CTA on the page: any <a> whose
   * href points at the App Store or Play Store, or that carries
   * data-store-cta. No per-page markup changes required — drop the script
   * in and every existing badge/button on the site is upgraded in place.
   *
   * @param {Document|Element} [root_]
   */
  function bindDownloadCTAs(root_) {
    var scope = root_ || document;
    var selector =
      'a[href*="apps.apple.com"], a[href*="play.google.com"], a[data-store-cta]';
    var links = scope.querySelectorAll(selector);
    for (var i = 0; i < links.length; i++) {
      bindElement(/** @type {HTMLAnchorElement} */ (links[i]));
    }
  }

  function autoInit() {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        bindDownloadCTAs();
      });
    } else {
      bindDownloadCTAs();
    }
  }

  // Auto-run in real browser environments; skip in Node/test contexts.
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    autoInit();
  }

  return {
    CONFIG: CONFIG,
    isIOS: isIOS,
    isAndroid: isAndroid,
    isInstagramInApp: isInstagramInApp,
    isFacebookInApp: isFacebookInApp,
    isInAppBrowser: isInAppBrowser,
    fireEscape: fireEscape,
    handleStoreClick: handleStoreClick,
    bindElement: bindElement,
    bindDownloadCTAs: bindDownloadCTAs,
    showFallbackModal: showFallbackModal
  };
});
