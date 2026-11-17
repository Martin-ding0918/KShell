// Compact Kimi Code console topbar.
//
// Observed header: `.app.mobile > .topbar` holding `.tb-main` (title line) and
// a trailing icon button. Version 0.0.1.9 only styled it when the route
// matched /^\/devices\// and the header carried both that icon button and a
// `.tb-main .tb-line`; a session created inside the console changes the route
// and rebuilds the topbar, so the patch dropped `data-zshell-compact` and the
// page's own full-height title bar stayed on screen (known issue of 0.0.1.9).
//
// Rules learned from that:
//  - The route is irrelevant: any `.app.mobile > .topbar` rooted in
//    `.tb-main` is a session header and gets compacted.
//  - The status pill goes after the title block, before the trailing icon
//    button when one exists, else appended with margin-left:auto.
//  - The page is a SPA: route changes go through history.pushState /
//    replaceState and are caught, plus a cheap sanity timer.
//  - Text truncation is enforced on every descendant of `.tb-main`, not on
//    assumed class names, so renamed internals still cannot overflow.
//
// The same script is injected twice (`beforeContentLoaded` and after load);
// the second run reuses the first observer through `__zshellRefreshKimiTopbar`.
export const KIMI_TOPBAR_PATCH = String.raw`(function () {
  'use strict';
  try {
    if (!/^code-rc\.kimi\.(com|ai)$/.test(location.hostname)) return;
    if (window.__zshellRefreshKimiTopbar) {
      window.__zshellRefreshKimiTopbar();
      return;
    }
    var post = function (event) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(event);
    };
    var host = '.app.mobile > .topbar';
    var sel = host + '[data-zshell-compact]';
    var style = document.createElement('style');
    style.textContent = [
      host + '{display:flex!important;gap:6px;padding:0 8px 0 12px!important;height:48px!important;min-height:48px!important;max-height:48px!important;align-items:center;overflow:hidden}',
      sel + ' > .tb-main{flex:0 1 auto;min-width:0;width:auto;height:44px!important;padding:0!important;justify-content:flex-start;text-align:left;overflow:hidden}',
      sel + ' .tb-main *{min-width:0}',
      sel + ' > .tb-main .tb-line{min-width:0;width:100%;font-size:13px!important;display:flex;align-items:center;gap:4px;overflow:hidden}',
      sel + ' .tb-line:has(.tt) .dir{display:none}',
      sel + ' .dir, ' + sel + ' .tt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      sel + ' .tt{font-size:inherit!important}',
      sel + ' > .tb-main .sl{display:none}',
      sel + ' .cv{flex:none;width:11px}',
      sel + ' > .ui-icon-button{flex:none;width:40px!important;height:40px!important}',
      sel + ' > .zshell-status{flex:none;display:flex;align-items:center;gap:4px;height:30px;padding:0 8px;border:1px solid var(--color-line,currentColor);border-radius:999px;background:var(--color-surface,transparent);color:inherit;font:inherit;font-size:11px;white-space:nowrap;cursor:pointer}',
      sel + ' > .zshell-status[data-tail]{margin-left:auto}',
      '.zshell-status i{width:6px;height:6px;border-radius:50%;flex:none;background:var(--zshell-dot,#888)}',
      '.zshell-menu{position:fixed;top:52px;right:8px;z-index:2147483000;display:flex;flex-direction:column;min-width:148px;padding:5px;border:1px solid var(--color-line,rgba(127,127,127,.28));border-radius:12px;background:var(--color-bg-elevated,var(--color-surface,#fff));box-shadow:0 10px 28px rgba(0,0,0,.2);font:inherit}',
      '.zshell-menu button{all:unset;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:9px 10px;border-radius:8px;font-size:13px;cursor:pointer;color:inherit}',
      '.zshell-menu button:active{background:rgba(127,127,127,.16)}',
      '.zshell-menu small{font-size:11px;opacity:.55}',
      '@media(max-width:310px){' + sel + ' > .zshell-status{padding-inline:5px}' + sel + ' > .ui-icon-button{width:34px!important}.zshell-status span{display:none}}'
    ].join('\n');
    var active = null, dot = null, label = null, current = null, menu = null;
    var render = function () {
      if (!dot || !current) return;
      dot.style.setProperty('--zshell-dot', current.color);
      if (label && label.textContent !== current.short) label.textContent = current.short;
      dot.setAttribute('aria-label', current.label + ' · KShell');
      dot.title = current.label;
    };
    window.__zshellUpdateKimiStatus = function (value) { current = value; render(); };
    var closeMenu = function () {
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
      menu = null;
    };
    var openMenu = function () {
      closeMenu();
      var m = document.createElement('div');
      m.className = 'zshell-menu';
      m.setAttribute('role', 'menu');
      var item = function (text, hint, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        var t = document.createElement('span');
        t.textContent = text;
        var h = document.createElement('small');
        h.textContent = hint;
        b.appendChild(t);
        b.appendChild(h);
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          closeMenu();
          fn();
        });
        m.appendChild(b);
      };
      item('返回列表', '结束当前视图', function () { post('zshell:kimi-back'); });
      item('下载管理', '', function () { post('zshell:kimi-downloads'); });
      item('重新加载', '', function () { post('zshell:kimi-reload'); });
      document.body.appendChild(m);
      menu = m;
      setTimeout(function () {
        var dismiss = function (e) {
          if (menu && !m.contains(e.target) && e.target !== dot) {
            closeMenu();
            document.removeEventListener('click', dismiss, true);
          }
        };
        document.addEventListener('click', dismiss, true);
      }, 0);
    };
    var forget = function () {
      closeMenu();
      if (active) active.removeAttribute('data-zshell-compact');
      if (dot && dot.parentNode) dot.parentNode.removeChild(dot);
      active = null;
    };
    var scan = function (announce) {
      try {
        var header = document.querySelector(host);
        if (header) {
          var main = header.querySelector(':scope > .tb-main');
          if (!main || header.querySelector('.tb-line') == null) header = null;
        }
        var anchor = header && header.querySelector(':scope > .ui-icon-button');
        if (header === active && (!header || (dot.parentElement === header &&
            (anchor ? dot.nextElementSibling === anchor : dot.nextElementSibling == null)))) {
          if (announce) post(header ? 'zshell:kimi-header-on' : 'zshell:kimi-header-off');
          return;
        }
        forget();
        active = header || null;
        if (!active) { post('zshell:kimi-header-off'); return; }
        if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
        dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'zshell-status';
        dot.appendChild(document.createElement('i'));
        label = dot.appendChild(document.createElement('span'));
        dot.addEventListener('click', function (e) {
          e.stopPropagation();
          if (menu) closeMenu();
          else openMenu();
        });
        if (anchor) {
          active.insertBefore(dot, anchor);
        } else {
          active.appendChild(dot);
          dot.setAttribute('data-tail', '');
        }
        active.setAttribute('data-zshell-compact', '');
        render();
        post('zshell:kimi-header-on');
      } catch (_) { /* Leave the original controls available. */ }
    };
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; scan(); });
    }).observe(document, {childList:true,subtree:true});
    window.__zshellRefreshKimiTopbar = function () { scan(true); };
    // SPA route changes: the page swaps headers without a reload, so a route
    // change must re-scan even when MutationObserver misses the timing.
    var route = location.pathname;
    var onRoute = function () { route = location.pathname; closeMenu(); scan(); };
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
    } catch (_) { /* history may be locked down; the timer below covers it */ }
    window.addEventListener('popstate', onRoute);
    // Cheap sanity pass: catches a header replaced at the same route without
    // visible DOM churn, and re-attaches after the page re-renders the bar
    // from a cached tree (no mutation events observed).
    setInterval(function () {
      if (location.pathname !== route) onRoute();
      else scan();
    }, 1200);
    window.addEventListener('resize', function () { scan(); });
    scan();
  } catch (_) { /* Leave the original controls available. */ }
})();`;
