// Runs inside the console document. The native app supplies the visibility
// of its own surface, including WebViews retained behind native screens.
export const INSTALL_TOPBAR_ACTIVITY = String.raw`(function (scan, closeMenu, attributeFilter) {
  var active = false;
  var frame = null;
  var timer = null;
  var route = location.pathname;
  var onRoute = function () {
    if (!active) return;
    route = location.pathname;
    closeMenu();
    scan();
  };
  var isInsideMain = function (node) {
    var cur = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    while (cur) {
      if (cur.tagName === 'MAIN') return true;
      cur = cur.parentElement;
    }
    return false;
  };
  var observer = new MutationObserver(function (records) {
    if (!active || frame !== null) return;
    // Ignore streaming chat mutations inside <main>; topbar anchors live outside <main>.
    var relevant = false;
    for (var i = 0; i < records.length; i++) {
      if (!isInsideMain(records[i].target)) {
        relevant = true;
        break;
      }
    }
    if (!relevant) return;
    frame = requestAnimationFrame(function () {
      frame = null;
      if (active) scan();
    });
  });
  var setActive = function (next) {
    if (active === next) return;
    active = next;
    if (!active) {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      clearInterval(timer);
      timer = null;
      closeMenu();
      return;
    }
    route = location.pathname;
    observer.observe(document, {
      childList: true, characterData: true, subtree: true, attributes: true,
      attributeFilter: attributeFilter
    });
    timer = setInterval(function () {
      if (location.pathname !== route) onRoute();
      else scan();
    }, 1200);
    scan(true);
  };
  try {
    var wrap = function (name) {
      var original = history[name];
      if (typeof original !== 'function') return;
      history[name] = function () {
        var out = original.apply(this, arguments);
        try { onRoute(); } catch (_) {}
        return out;
      };
    };
    wrap('pushState');
    wrap('replaceState');
  } catch (_) { /* The visible-only timer also checks the current route. */ }
  window.addEventListener('popstate', onRoute);
  window.addEventListener('resize', function () { if (active) scan(); });
  window.__zshellSetTopbarActive = setActive;
  setActive(window.__zshellTopbarActive !== false);
  return function () { if (active) scan(true); };
})`;
