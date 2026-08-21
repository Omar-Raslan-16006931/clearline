/* Runs on every site. Cosmetically hides common display-ad containers that the
 * network rules leave behind (empty slots, ad iframes, adsbygoogle units).
 * Gated by the shared "blockAds" setting. */
(() => {
  "use strict";

  const STYLE_ID = "ytls-webads";
  const CSS = `
    ins.adsbygoogle, .adsbygoogle,
    iframe[src*="doubleclick"], iframe[src*="googlesyndication"],
    iframe[src*="googleadservices"], iframe[src*="adservice."],
    iframe[src*="/ads/"], iframe[id^="google_ads_"],
    iframe[id^="aswift_"], [id^="google_ads_iframe_"],
    [id^="div-gpt-ad"], [id*="div-gpt-ad"], [data-google-query-id],
    [data-ad-slot], [data-ad-client],
    .ad-banner, .ad-container, .ad-wrapper, .ad-slot, .ads-wrapper,
    .advertisement, .adsbox, ins.adsbygoogle,
    [aria-label="Advertisement"], [aria-label="Ads"], [aria-label="advertisement"] {
      display: none !important;
    }
  `;

  function inject() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  function remove() {
    const e = document.getElementById(STYLE_ID);
    if (e) e.remove();
  }
  function apply(on) {
    if (on) inject();
    else remove();
  }

  try {
    chrome.storage.sync.get({ blockAds: true }, (s) => apply(s.blockAds !== false));
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === "sync" && c.blockAds) apply(c.blockAds.newValue !== false);
    });
  } catch (_) {
    inject();
  }
})();
