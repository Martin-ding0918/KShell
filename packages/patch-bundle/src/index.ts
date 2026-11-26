export const PATCH_VERSION = '0.1.0';

/**
 * Patch P-1: enter inserts newline instead of submitting.
 *
 * Symptom: on some mobile browsers the Enter key submits the composer instead
 * of inserting a newline on the official remote console. The console treats a
 * viewport as "mobile text input" only when this exact media query matches:
 *   (max-width: 767px) and (hover: none) and (pointer: coarse)
 * Browsers that mis-report hover/pointer (or run in desktop mode, or have an
 * external mouse attached) fail the query, which turns Enter into Submit.
 *
 * Patch: wrap window.matchMedia so that EXACT query string reports
 * matches=true. The wrapper only affects this precise query string, so the
 * blast radius is limited to the mobile-viewport check. Side benefit: with
 * the submit shortcut disabled, IME composition Enter (compositionend-before-
 * keydown edge) can no longer accidentally submit either.
 *
 * Probes (self-retiring):
 *  - if the environment already reports the query as matching -> patch inactive;
 *  - any thrown error -> patch aborts silently (never break the page).
 */
export const MATCHMEDIA_PATCH_SOURCE = String.raw`(function () {
  'use strict';
  var FLAG = '__zshellPatchApplied';
  var TARGET_QUERY = '(max-width: 767px) and (hover: none) and (pointer: coarse)';
  try {
    if (typeof window === 'undefined' || window[FLAG]) { return; }
    var nativeMatchMedia = window.matchMedia;
    if (typeof nativeMatchMedia !== 'function') { return; }
    if (nativeMatchMedia.call(window, TARGET_QUERY).matches) {
      window[FLAG] = 'probe:no-op';
      return;
    }
    function ShimMediaQueryList(media, matches) {
      this.media = media;
      this.matches = matches;
      this.onchange = null;
    }
    ShimMediaQueryList.prototype.addListener = function () {};
    ShimMediaQueryList.prototype.removeListener = function () {};
    ShimMediaQueryList.prototype.addEventListener = function () {};
    ShimMediaQueryList.prototype.removeEventListener = function () {};
    ShimMediaQueryList.prototype.dispatchEvent = function () { return false; };
    window.matchMedia = function (query) {
      if (query === TARGET_QUERY) {
        return new ShimMediaQueryList(TARGET_QUERY, true);
      }
      return nativeMatchMedia.call(window, query);
    };
    window[FLAG] = 'matchmedia:v1';
  } catch (e) { /* patches must never break the page */ }
})();`;

/**
 * Patch P-2: relay WebSocket observer.
 *
 * The official console page owns its relay WebSocket. This patch wraps the
 * WebSocket constructor (document-start, before page scripts run) and
 * passively reports connection lifecycle + interesting payload signals to
 * the host app via the WebView message bridge:
 *   ws-open / ws-connected / ws-closed / ws-error  — connection lifecycle
 *   pair-status {waiting|matched}                  — desktop pairing state
 *   kicked                                         — another terminal took over
 *   approval-waiting                               — permission/elicitation request seen
 *   network-online / network-offline               — device connectivity
 *
 * It only reads traffic the page already receives; it never sends anything.
 * Fully self-guarding: any error aborts without touching page behavior.
 */
export const WS_OBSERVER_PATCH_SOURCE = String.raw`(function () {
  'use strict';
  var FLAG = '__zshellWsObserver';
  try {
    if (typeof window === 'undefined' || window[FLAG]) { return; }
    if (typeof location === 'undefined' || location.protocol !== 'https:' ||
        !/^(code-rc\.kimi\.(com|ai)|zcode\.z\.ai|zcode\.chatglm\.site)$/i.test(location.hostname)) {
      window[FLAG] = 'probe:no-op';
      return;
    }
    var NativeWS = window.WebSocket;
    if (typeof NativeWS !== 'function') { return; }
    var post = function (type, detail) {
      try {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            source: 'zshell', type: type, detail: detail || null
          }));
        }
      } catch (e) { /* never break the page */ }
    };
    function isPlainObject(v) {
      return typeof v === 'object' && v !== null && !Array.isArray(v);
    }
    function isKickedObj(o) {
      return o.type === 'KICKED' || o.event === 'KICKED' || o.code === 'KICKED' || o.error === 'KICKED';
    }
    function pairStatusOf(o) {
      if (typeof o.pair_status === 'string') { return o.pair_status; }
      if (o.type === 'pair_status' && typeof o.status === 'string') { return o.status; }
      return null;
    }
    function isApprovalObj(o) {
      return o.type === 'permission_request' || o.type === 'elicitation_request' ||
        o.method === 'permission_request' || o.method === 'elicitation_request' ||
        o.event === 'permission_request' || o.event === 'elicitation_request';
    }
    // Signals must come from structured protocol fields in JSON object frames,
    // never from chat text or arbitrary JSON arrays. Returns true when a
    // recognized control signal was observed (used to identify the primary socket).
    function signalFromMessage(data) {
      try {
        if (typeof data !== 'string' || data.length === 0) { return false; }
        var msg = JSON.parse(data);
        if (!isPlainObject(msg)) { return false; }
        var nested = isPlainObject(msg.payload) ? msg.payload : (isPlainObject(msg.data) ? msg.data : null);
        if (isKickedObj(msg) || (nested && isKickedObj(nested))) {
          post('kicked', {});
          return true;
        }
        var seen = false;
        var ps = pairStatusOf(msg) || (nested ? pairStatusOf(nested) : null);
        if (ps) {
          post('pair-status', { status: ps });
          seen = true;
        }
        if (isApprovalObj(msg) || (nested && isApprovalObj(nested))) {
          post('approval-waiting', {});
          seen = true;
        }
        return seen;
      } catch (e) { return false; /* ignore malformed frames */ }
    }
    var openSockets = [];
    var primaryWs = null;
    function addOpen(ws) {
      if (openSockets.indexOf(ws) === -1) { openSockets.push(ws); }
    }
    function removeOpen(ws) {
      var idx = openSockets.indexOf(ws);
      if (idx !== -1) { openSockets.splice(idx, 1); }
    }
    function WrappedWS(url, protocols) {
      var ws = (protocols === undefined)
        ? new NativeWS(url)
        : new NativeWS(url, protocols);
      // Relay candidates: ZCode relay sockets carry /ws in the path (or dial
      // the official console hosts directly); Kimi Code remote-control pages
      // tunnel through wss://code-rc.kimi.com|ai hosts.
      // Read-only observer — widening the match has no page-visible effect.
      var urlStr = typeof url === 'string'
        ? url
        : (url && typeof url.href === 'string' ? url.href : '');
      var isRelay = urlStr.length > 0 &&
        (urlStr.indexOf('/ws') !== -1 ||
          /^wss?:\/\/code-rc\.kimi\.(com|ai)\//i.test(urlStr) ||
          /^wss?:\/\/(zcode\.z\.ai|zcode\.chatglm\.site)\//i.test(urlStr));
      if (isRelay) {
        if (openSockets.length === 0) {
          post('ws-open', {});
        }
        ws.addEventListener('open', function () {
          addOpen(ws);
          if (primaryWs === null || primaryWs === ws) {
            post('ws-connected', {});
          }
        });
        ws.addEventListener('close', function (ev) {
          removeOpen(ws);
          var wasPrimary = (primaryWs === ws);
          if (wasPrimary) { primaryWs = null; }
          if ((wasPrimary && openSockets.length === 0) ||
              (wasPrimary && openSockets.length > 0 && !ws.__zshellSuperseded) ||
              (!wasPrimary && primaryWs === null && openSockets.length === 0)) {
            post('ws-closed', { code: ev.code });
          }
        });
        ws.addEventListener('error', function () {
          if (primaryWs === ws || (primaryWs === null && openSockets.length === 0)) {
            post('ws-error', {});
          }
        });
        ws.addEventListener('message', function (ev) {
          if (signalFromMessage(ev.data)) {
            if (primaryWs !== null && primaryWs !== ws) {
              primaryWs.__zshellSuperseded = true;
            }
            primaryWs = ws;
          }
        });
      }
      return ws;
    }
    try {
      WrappedWS.prototype = NativeWS.prototype;
      WrappedWS.CONNECTING = NativeWS.CONNECTING;
      WrappedWS.OPEN = NativeWS.OPEN;
      WrappedWS.CLOSING = NativeWS.CLOSING;
      WrappedWS.CLOSED = NativeWS.CLOSED;
    } catch (e) { /* constants are best-effort */ }
    window.WebSocket = WrappedWS;
    window[FLAG] = 'ws-observer:v5';
    window.addEventListener('online', function () { post('network-online', {}); });
    window.addEventListener('offline', function () { post('network-offline', {}); });
  } catch (e) { /* patches must never break the page */ }
})();`;

/**
 * Patch P-3: polyfill AbortSignal.any for older WebView runtimes.
 *
 * Observed: the Kimi Code login page's OAuth transport composes request
 * timeouts with AbortSignal.any(), which shipped in Chrome 116. Emulators
 * and containers often carry a frozen older system WebView (e.g. Chrome
 * 110 without store updates), where that call throws synchronously and the
 * login start dies with a generic "check your connection" error before any
 * request leaves the page.
 *
 * Patch: standard-semantics polyfill — the composite signal aborts with the
 * reason of the first aborted input. Probes (self-retiring):
 *  - AbortSignal.any already present (native or prior polyfill) -> no-op;
 *  - any thrown error -> patch aborts silently (never break the page).
 */
export const ABORT_SIGNAL_PATCH_SOURCE = String.raw`(function () {
  'use strict';
  var FLAG = '__zshellAbortAny';
  try {
    if (typeof window === 'undefined' || typeof AbortSignal === 'undefined') { return; }
    if (typeof AbortSignal.any === 'function' || window[FLAG]) { return; }
    AbortSignal.any = function (signals) {
      var controller = new AbortController();
      var list = Array.from(signals);
      var cleanups = [];
      var cleanup = function () {
        for (var j = 0; j < cleanups.length; j++) {
          cleanups[j]();
        }
        cleanups.length = 0;
      };
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (s == null || typeof s.addEventListener !== 'function') { continue; }
        if (s.aborted) {
          cleanup();
          controller.abort(s.reason);
          return controller.signal;
        }
        (function (sig) {
          var onAbort = function () {
            cleanup();
            controller.abort(sig.reason);
          };
          sig.addEventListener('abort', onAbort, { once: true });
          cleanups.push(function () {
            sig.removeEventListener('abort', onAbort);
          });
        })(s);
      }
      return controller.signal;
    };
    window[FLAG] = 'abort-any:v2';
  } catch (e) { /* patches must never break the page */ }
})();`;

/**
 * Full document-start payload for the WebView host.
 * Each entry is self-guarding; combine defensively.
 */
/**
 * Patch P-4: polyfill Promise.withResolvers for older WebView runtimes.
 *
 * Shipped in Chrome 119; older WebView engines may not provide it.
 *
 * Patch: standard-semantics polyfill (per the TC39 proposal). Probes
 * (self-retiring):
 *  - Promise.withResolvers already present (native or prior polyfill) -> no-op;
 *  - any thrown error -> patch aborts silently (never break the page).
 */
export const PROMISE_WITHRESOLVERS_PATCH_SOURCE = String.raw`(function () {
  'use strict';
  var FLAG = '__zshellPromiseWithResolvers';
  try {
    if (typeof window === 'undefined' || typeof Promise === 'undefined') { return; }
    if (typeof Promise.withResolvers === 'function' || window[FLAG]) { return; }
    Promise.withResolvers = function () {
      if (typeof this !== 'function') {
        throw new TypeError('Promise.withResolvers called on non-constructor');
      }
      var Ctor = this;
      var out = {};
      out.promise = new Ctor(function (resolve, reject) {
        out.resolve = resolve;
        out.reject = reject;
      });
      return out;
    };
    window[FLAG] = 'promise-withresolvers:v2';
  } catch (e) { /* patches must never break the page */ }
})();`;

export function buildPatchSource(): string {
  return (
    MATCHMEDIA_PATCH_SOURCE +
    '\n' +
    WS_OBSERVER_PATCH_SOURCE +
    '\n' +
    ABORT_SIGNAL_PATCH_SOURCE +
    '\n' +
    PROMISE_WITHRESOLVERS_PATCH_SOURCE
  );
}
