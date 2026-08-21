/* Runs in the PAGE context so it can read YouTube's JS globals
 * (content scripts are isolated and can't see window.ytInitialPlayerResponse).
 * It posts the current video's streaming data back to the content script. */
(() => {
  "use strict";

  function collect() {
    try {
      const pr = window.ytInitialPlayerResponse;
      let playerUrl =
        (window.ytcfg && window.ytcfg.get && window.ytcfg.get("PLAYER_JS_URL")) ||
        null;
      if (playerUrl && playerUrl.startsWith("/")) {
        playerUrl = location.origin + playerUrl;
      }
      if (pr && pr.streamingData && pr.videoDetails) {
        window.postMessage(
          {
            source: "YTLS_INJECT",
            payload: {
              videoId: pr.videoDetails.videoId,
              title: pr.videoDetails.title,
              streamingData: pr.streamingData,
              playerUrl: playerUrl,
            },
          },
          "*"
        );
      }
    } catch (e) {
      /* ignore */
    }
  }

  collect();
  const reGrab = () => setTimeout(collect, 600);
  window.addEventListener("yt-navigate-finish", reGrab, true);
  document.addEventListener("yt-page-data-updated", reGrab, true);
  window.addEventListener("load", reGrab, true);

  // The quality picker asks for a fresh read right before it opens — the
  // page's own player response can gain higher-bitrate / Premium variants
  // after the initial SSR snapshot, so re-grab live instead of relying only
  // on the cached copy from page load.
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "YTLS_REQUEST_GRAB") return;
    collect();
  });
})();
