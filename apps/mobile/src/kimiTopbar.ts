import type {ColorScheme} from './theme';
import {INSTALL_TOPBAR_ACTIVITY} from './topbarActivity.ts';

// Android installs only this marked prelude at true document start.
export function buildKimiThemePrelude(scheme: ColorScheme, colors: Record<ColorScheme, string>): string {
  if (!Object.values(colors).every(color => /^#[0-9a-f]{6}$/i.test(color))) return '';
  return String.raw`// kshell-kimi-document-theme:${colors[scheme]}
(function () {
  'use strict';
  try {
    if (window.top !== window || !/^code-rc\.kimi\.(com|ai)$/.test(location.hostname) ||
        location.protocol !== 'https:' || !location.pathname.startsWith('/devices/')) return;
    var apply = function () {
      var root = document.documentElement;
      if (!root || !document.head) return false;
      if (document.getElementById('kshell-kimi-document-theme')) return true;
      if (root.getAttribute('data-color-scheme') !== 'system') return true;
      var stored;
      try { stored = localStorage.getItem('kimi-web.color-scheme'); } catch (_) {}
      var explicit = stored === 'light' || stored === 'dark';
      if (explicit) root.setAttribute('data-color-scheme', stored);
      var scheme = explicit ? stored : ${JSON.stringify(scheme)};
      var background = ${JSON.stringify(colors)}[scheme];
      var style = document.createElement('style');
      style.id = 'kshell-kimi-document-theme';
      // The official stylesheet and later user theme changes retain priority.
      style.textContent = ':where(html){color-scheme:' + scheme +
        ';background-color:var(--color-bg,' + background + ')}';
      document.head.appendChild(style);
      // Diagnostic: proves on-device that the document-start pin actually ran
      // (visible in the diag timeline; every earlier fix shipped unverifiable).
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage('zshell:kimi-theme:' + scheme);
      }
      return true;
    };
    if (apply()) return;
    var observer = new MutationObserver(function () {
      if (apply()) observer.disconnect();
    });
    observer.observe(document, {childList: true, subtree: true});
    window.addEventListener('DOMContentLoaded', function () { observer.disconnect(); }, {once: true});
  } catch (_) { /* Keep the official theme initialization as the fallback. */ }
})();
// kshell-kimi-theme-end
`;
}

// Compact Kimi Code console topbar.
//
// Session transitions can leave an empty header or mount its replacement
// before removing the previous one. Only the current header owns a status pill.
//
// The same script is injected twice (`beforeContentLoaded` and after load);
// the second run reuses the first observer through `__zshellRefreshKimiTopbar`.
export const KIMI_TOPBAR_PATCH = String.raw`(function () {
  'use strict';
  try {
    if (!/^code-rc\.kimi\.(com|ai)$/.test(location.hostname)) return;
    var post = function (event) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(event);
    };
    if (window.__zshellRefreshKimiTopbar) {
      window.__zshellRefreshKimiTopbar();
      post('zshell:topbar-activity-ready');
      return;
    }
    var host = '.app.mobile > .topbar';
    var compact = 'data-zshell-compact';
    var hidden = 'data-zshell-header-hidden';
    var trailing = 'data-zshell-trailing';
    var sel = host + '[' + compact + ']';
    var style = document.createElement('style');
    style.textContent = [
      sel + '{display:flex!important;justify-content:flex-start!important;gap:6px;padding:0 8px 0 12px!important;height:48px!important;min-height:48px!important;max-height:48px!important;align-items:center;overflow:hidden}',
      host + '[' + hidden + ']{display:none!important}',
      sel + ' > .tb-main{flex:0 1 auto;min-width:0;width:auto;height:44px!important;padding:0!important;justify-content:flex-start;text-align:left;overflow:hidden}',
      sel + ' .tb-main *{min-width:0}',
      sel + ' > .tb-main .tb-line{min-width:0;width:100%;font-size:13px!important;display:flex;align-items:center;gap:4px;overflow:hidden}',
      sel + ' .tb-line:has(.tt) .dir{display:none}',
      sel + ' .dir, ' + sel + ' .tt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      sel + ' .tt{font-size:inherit!important}',
      sel + ' > .tb-main .sl{display:none}',
      sel + ' .cv{flex:none;width:11px}',
      sel + ' > .ui-icon-button{flex:none;width:40px!important;height:40px!important}',
      sel + ' > [' + trailing + ']{margin-inline-start:auto!important}',
      sel + ' > .zshell-status{flex:none;display:flex;align-items:center;gap:4px;height:30px;margin:0;padding:0 8px;border:1px solid var(--color-line,currentColor);border-radius:999px;background:var(--color-surface,transparent);color:inherit;font:inherit;font-size:11px;white-space:nowrap;cursor:pointer}',
      '.zshell-status i{width:6px;height:6px;border-radius:50%;flex:none;background:var(--zshell-dot,#888)}',
      '.zshell-menu{position:fixed;top:52px;right:8px;z-index:2147483000;display:flex;flex-direction:column;min-width:148px;padding:5px;border:1px solid var(--color-line,rgba(127,127,127,.28));border-radius:12px;background:var(--color-bg-elevated,var(--color-surface,#fff));box-shadow:0 10px 28px rgba(0,0,0,.2);font:inherit}',
      '.zshell-menu button{all:unset;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:9px 10px;border-radius:8px;font-size:13px;cursor:pointer;color:inherit}',
      '.zshell-menu button:active{background:rgba(127,127,127,.16)}',
      '.zshell-menu small{font-size:11px;opacity:.55}',
      '@media(max-width:310px){' + sel + ' > .zshell-status{padding-inline:5px}' + sel + ' > .ui-icon-button{width:34px!important}.zshell-status span{display:none}}'
    ].join('\n');
    var active = null, action = null, dot = null, label = null, current = null, menu = null;
    var render = function () {
      if (!dot || !current) return;
      dot.style.setProperty('--zshell-dot', current.color);
      if (label && label.textContent !== current.short) label.textContent = current.short;
      dot.setAttribute('aria-label', current.label + ' · KShell');
      dot.title = current.label;
    };
    window.__zshellUpdateKimiStatus = function (value) { current = value; render(); };
    var dismissMenu = function (e) {
      if (menu && !menu.contains(e.target) && !dot.contains(e.target)) closeMenu();
    };
    var closeMenu = function () {
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
      menu = null;
      document.removeEventListener('click', dismissMenu, true);
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
      document.addEventListener('click', dismissMenu, true);
    };
    var forget = function () {
      closeMenu();
      if (active) active.removeAttribute(compact);
      if (action) action.removeAttribute(trailing);
      if (dot && dot.parentNode) dot.parentNode.removeChild(dot);
      active = null;
      action = null;
      dot = null;
      label = null;
    };
    var visible = function (node) {
      return !node.hidden && node.getAttribute('aria-hidden') !== 'true' && node.style.display !== 'none';
    };
    var scan = function (announce) {
      try {
        var headers = Array.from(document.querySelectorAll(host)).filter(function (candidate) {
          return visible(candidate) && visible(candidate.parentElement);
        });
        var header = headers[headers.length - 1] || null;
        var main = header && header.querySelector(':scope > .tb-main');
        if (main && !visible(main)) main = null;
        var buttons = header ? Array.from(header.querySelectorAll(':scope > .ui-icon-button')).filter(visible) : [];
        var anchor = buttons[buttons.length - 1] || null;

        if (header && !style.isConnected) (document.head || document.documentElement).appendChild(style);
        headers.forEach(function (candidate) {
          if (candidate.parentElement !== header.parentElement) {
            candidate.removeAttribute(hidden);
            return;
          }
          // A shell with no title or controls should not reserve a toolbar row.
          // Ignore our own pill when deciding whether the page still needs it.
          var content = Array.from(candidate.childNodes).some(function (child) {
            if (child.nodeType === 3) return child.textContent.trim() !== '';
            if (child.nodeType !== 1 || child === dot || !visible(child)) return false;
            if (child.textContent.trim() !== '') return true;
            if (child.matches('.tb-main')) return child.querySelector('.cv') !== null;
            return child.matches('.ui-icon-button, button, a[href], [role="button"]') ||
              child.querySelector('button, a[href], [role="button"]') !== null;
          });
          candidate.toggleAttribute(hidden, candidate !== header || !content);
        });
        if (header && (header.hasAttribute(hidden) || (!main && !anchor))) header = null;
        if (!header) anchor = null;
        if (header === active && action === anchor && (!header || (dot.parentElement === header &&
            (main ? dot.previousElementSibling === main : dot.nextElementSibling === anchor)))) {
          if (announce) post(header ? 'zshell:kimi-header-on' : 'zshell:kimi-header-off');
          return;
        }
        forget();
        if (!header) { post('zshell:kimi-header-off'); return; }
        active = header;
        action = anchor;
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
        active.insertBefore(dot, main ? main.nextSibling : action);
        if (action) action.setAttribute(trailing, '');
        active.setAttribute(compact, '');
        render();
        post('zshell:kimi-header-on');
      } catch (_) { /* Leave the original controls available. */ }
    };
    window.__zshellRefreshKimiTopbar = ${INSTALL_TOPBAR_ACTIVITY}(
      scan, closeMenu, ['class', 'hidden', 'aria-hidden', 'style']);
    post('zshell:topbar-activity-ready');
  } catch (_) { /* Leave the original controls available. */ }
})();`;
