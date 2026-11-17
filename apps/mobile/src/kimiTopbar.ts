// Only the observed Kimi mobile session header is eligible for this layout.
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
    var style = document.createElement('style');
    style.textContent = [
      '.app.mobile > .topbar[data-zshell-compact]{display:flex!important;gap:6px;padding:0 8px 0 12px!important;height:48px!important;min-height:48px!important;align-items:center}',
      '.topbar[data-zshell-compact] > .tb-main{flex:1 1 0;min-width:0;width:auto;height:44px!important;padding:0!important;justify-content:flex-start;text-align:left;overflow:hidden}',
      '.topbar[data-zshell-compact] .tb-line{min-width:0;width:100%;font-size:13px!important;display:flex;align-items:center;gap:4px;overflow:hidden}',
      '.topbar[data-zshell-compact] .tb-line:has(.tt) .dir{display:none}',
      '.topbar[data-zshell-compact] .dir{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.topbar[data-zshell-compact] .sl{display:none}',
      '.topbar[data-zshell-compact] .tt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:inherit!important}',
      '.topbar[data-zshell-compact] .cv{flex:none;width:11px}',
      '.topbar[data-zshell-compact] > .ui-icon-button{flex:none;width:40px!important;height:40px!important}',
      '.topbar[data-zshell-compact] > .zshell-status{flex:none;display:flex;align-items:center;gap:4px;height:30px;padding:0 8px;border:1px solid var(--color-line,currentColor);border-radius:999px;background:var(--color-surface,transparent);color:inherit;font:inherit;font-size:11px;white-space:nowrap;cursor:pointer}',
      '.zshell-status i{width:6px;height:6px;border-radius:50%;flex:none;background:var(--zshell-dot,#888)}',
      '@media(max-width:310px){.topbar[data-zshell-compact] > .zshell-status{padding-inline:5px}.topbar[data-zshell-compact] > .ui-icon-button{width:34px!important}.zshell-status span{display:none}}'
    ].join('\n');
    var active = null, dot = null, label = null, current = null;
    var render = function () {
      if (!dot || !current) return;
      dot.style.setProperty('--zshell-dot', current.color);
      if (label.textContent !== current.short) label.textContent = current.short;
      dot.setAttribute('aria-label', current.label + ' · KShell');
    };
    window.__zshellUpdateKimiStatus = function (value) { current = value; render(); };
    var scan = function (announce) {
      try {
        var header = /^\/devices\//.test(location.pathname)
          ? document.querySelector('.app.mobile > .topbar') : null;
        var settings = header && header.querySelector(':scope > button.ui-icon-button');
        if (!settings || !header.querySelector(':scope > .tb-main .tb-line')) header = null;
        if (header === active && (!header || (dot.parentElement === header &&
            dot.nextElementSibling === settings))) {
          if (announce) post(header ? 'zshell:kimi-header-on' : 'zshell:kimi-header-off');
          return;
        }
        if (active) { active.removeAttribute('data-zshell-compact'); dot.remove(); }
        active = header || null;
        if (!active) { post('zshell:kimi-header-off'); return; }
        if (!style.isConnected) document.head.appendChild(style);
        dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'zshell-status';
        dot.appendChild(document.createElement('i'));
        label = dot.appendChild(document.createElement('span'));
        dot.addEventListener('click', function () { post('zshell:kimi-menu'); });
        active.insertBefore(dot, settings);
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
    window.addEventListener('resize', function () { scan(); });
    scan();
  } catch (_) { /* Leave the original controls available. */ }
})();`;
