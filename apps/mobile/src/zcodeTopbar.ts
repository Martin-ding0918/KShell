import type {ConsoleStatus} from '@zshell/core-shell';
import type {ColorScheme, Palette} from './theme';
import {INSTALL_TOPBAR_ACTIVITY} from './topbarActivity.ts';

export type ZcodePage = 'other' | 'home' | 'chat';

export function shouldShowZcodeFooter(_page: ZcodePage, _status: ConsoleStatus, loadFailed: boolean): boolean {
  return loadFailed;
}

// Compact ZCode console topbar: merges the four stacked toolbars (the shell's
// native bars plus the page's own mobile header and workspace header) into one
// row under the system status bar.
//
// Row layout (flex order, DOM nodes are never moved):
//   ‹ web-back | session title | status pill | sidebar
// The title group stays left; the sidebar is pinned to the right edge
// (margin-inline-start:auto). The status pill is the single menu entry (same
// interaction as the Kimi topbar): tapping it toggles the floating menu
// (返回列表 / 切换机器 / 所有会话 / 下载管理 / 重新加载 / 会话操作 / 工作区信息 / 主题),
// while a dead connection turns the tap into a direct 重连.
//
// Anchors are stable product attributes only (`data-mobile-page`,
// `data-testid`), never button text or coordinates. Any missed anchor restores
// the original layout (forget()), announces header-off, and reports a compact
// diagnostic anchor name so upstream page changes are easy to pinpoint.
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function buildZcodeTopbarPatch(
  colors: Record<ColorScheme, Pick<Palette, 'consoleBg' | 'consoleHeaderBg'>>,
): string {
  const {light, dark} = colors;
  if (
    !HEX_COLOR_RE.test(light.consoleBg) ||
    !HEX_COLOR_RE.test(light.consoleHeaderBg) ||
    !HEX_COLOR_RE.test(dark.consoleBg) ||
    !HEX_COLOR_RE.test(dark.consoleHeaderBg)
  ) {
    return '';
  }
  return String.raw`(function () {
  'use strict';
  try {
    if (!/^(zcode\.z\.ai|zcode\.chatglm\.site)$/.test(location.hostname)) return;
    var post = function (event) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(event);
    };
    if (window.__zshellRefreshZcodeTopbar) {
      window.__zshellRefreshZcodeTopbar();
      post('zshell:topbar-activity-ready');
      return;
    }
    var chatSection = 'section[data-mobile-page="chat"]';
    var wsHeader = 'header[data-testid="workspace-header"]';
    var wsTitle = '[data-testid="workspace-title"]';
    var wsMore = '[data-testid="workspace-more-button"]';
    var wsPath = '[data-testid="workspace-path"]';
    var sideToggle = '[data-testid="side-pane-toggle"]';
    var paneOverlay = '[data-mobile-side-pane-overlay]';
    var style = document.createElement('style');
    style.textContent = [
      // Match Kimi's rendered surfaces while following ZCode's own color-scheme
      // (with static fallbacks for WebView < Chrome 123 where light-dark() is absent).
      'html[data-zshell-zcode-topbar] ' + chatSection + '{background-color:${light.consoleBg};background-color:light-dark(${light.consoleBg},${dark.consoleBg})}',
      'html.dark[data-zshell-zcode-topbar] ' + chatSection + '{background-color:${dark.consoleBg};background-color:light-dark(${light.consoleBg},${dark.consoleBg})}',
      'html[data-zshell-zcode-topbar] ' + chatSection + ' > [data-zshell-zc-row]{background-color:${light.consoleHeaderBg};background-color:light-dark(${light.consoleHeaderBg},${dark.consoleHeaderBg})}',
      'html.dark[data-zshell-zcode-topbar] ' + chatSection + ' > [data-zshell-zc-row]{background-color:${dark.consoleHeaderBg};background-color:light-dark(${light.consoleHeaderBg},${dark.consoleHeaderBg})}',
      // The page's own h-11 mobile header row becomes the single 48px row.
      '[data-zshell-zc-row]{position:relative;justify-content:flex-start;gap:4px;padding:0 8px 0 12px!important;height:48px!important;min-height:48px!important;max-height:48px!important;overflow:hidden}',
      '[data-zshell-zc-row] > [data-zshell-zc-hide]{display:none!important}',
      '[data-zshell-zc-row] > [data-zshell-zc-themebtn]{order:9;position:absolute;right:0;top:0;height:100%;width:0!important;min-width:0!important;padding:0!important;margin:0!important;border:0!important;overflow:hidden;visibility:hidden}',
      '[data-zshell-zc-row] > [data-zshell-zc-back]{order:0}',
      '[data-zshell-zc-row] > [data-zshell-zc-title]{order:1;flex:0 1 auto;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit}',
      '[data-zshell-zc-row] > .zshell-status{order:2}',
      '[data-zshell-zc-row] > [data-zshell-zc-sidebar]{order:5;margin-inline-start:auto!important}',
      '[data-zshell-zc-back],[data-zshell-zc-sidebar]{flex:none;display:flex;align-items:center;justify-content:center;width:34px;height:40px;margin:0;padding:0;border:0;background:transparent;color:inherit;cursor:pointer}',
      '[data-zshell-zc-back][data-zshell-zc-nav-dead]{opacity:.35}',
      // Plan A soft-filled connection pill (single menu entry).
      '.zshell-status{flex:none;display:flex;align-items:center;gap:5px;height:28px;margin:0;padding:0 10px;border:0;border-radius:999px;background:rgba(127,127,127,.13);color:inherit;font:inherit;font-size:11px;font-weight:600;white-space:nowrap;cursor:pointer;transition:background-color .15s}',
      '.zshell-status[data-zshell-reconnect]{background:rgba(248,113,113,.16);color:#f87171}',
      '.zshell-status i{width:7px;height:7px;border-radius:50%;flex:none;background:var(--zshell-dot,#888)}',
      'html[data-zshell-zcode-topbar] header[data-testid="workspace-header"]{height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;border-bottom-width:0!important;visibility:hidden!important}',
      // Plan A floating menu.
      '.zshell-menu{position:fixed;top:52px;right:10px;z-index:2147483000;display:flex;flex-direction:column;min-width:184px;padding:6px;border:1px solid rgba(127,127,127,.22);border-radius:16px;background:var(--zshell-zc-bg,#fff);box-shadow:0 12px 32px rgba(0,0,0,.26);font:inherit;color:var(--zshell-zc-fg,#111);gap:2px}',
      '.zshell-menu button{all:unset;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 12px;border-radius:11px;font-size:13px;font-weight:500;cursor:pointer;color:inherit}',
      '.zshell-menu button:active{background:rgba(127,127,127,.16)}',
      '.zshell-menu .zm-left{display:flex;align-items:center;gap:9px}',
      '.zshell-menu svg{flex:none;opacity:.75}',
      '.zshell-menu small{font-size:11px;opacity:.52;font-weight:400}',
      '.zshell-menu .zm-div{height:1px;background:rgba(127,127,127,.18);margin:4px 6px}',
      '@media(max-width:310px){[data-zshell-zc-row] > .zshell-status{padding-inline:6px}[data-zshell-zc-row] > .zshell-status span{display:none}}'
    ].join('\n');
    var active = null, row = null, back = null, title = null, dot = null, label = null,
        sidebar = null, staticTitle = null, themeBtn = null, homeBtn = null,
        menu = null, current = null, navDead = false, pageState = null, lastSkinKey = '',
        lastReportedMiss = '';
    var ICON_BACK = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10.5 3 5.5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var ICON_SIDEBAR = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="10" y1="2.5" x2="10" y2="13.5" stroke="currentColor" stroke-width="1.4"/></svg>';
    var ICO_BACK = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8 10 12.5"/></svg>';
    var ICO_SWITCH = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="9" rx="2"/><path d="M5.5 7 7 8.5 5.5 10"/><path d="M8.5 10h2"/></svg>';
    var ICO_LIST = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4.5h10M3 8h10M3 11.5h7"/></svg>';
    var ICO_DL = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v7.5m0 0-3-3m3 3 3-3"/><path d="M3 12.5h10"/></svg>';
    var ICO_RELOAD = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.3-3.4"/><path d="M13 3v2.5h-2.5"/></svg>';
    var ICO_MORE = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/></svg>';
    var ICO_FOLDER = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.3 1.5h4.7A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/></svg>';
    var ICO_THEME = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5"/><path d="M8 3v10" stroke-width="1.3"/></svg>';
    var render = function () {
      if (!dot || !current) return;
      dot.style.setProperty('--zshell-dot', current.color);
      if (label && label.textContent !== current.short) label.textContent = current.short;
      if (current.reconnect) dot.setAttribute('data-zshell-reconnect', '');
      else dot.removeAttribute('data-zshell-reconnect');
      dot.setAttribute('aria-label', current.label + ' · KShell');
      dot.title = current.label;
    };
    window.__zshellUpdateZcodeStatus = function (value) { current = value; render(); };
    window.__zshellUpdateZcodeNav = function (value) {
      navDead = !(value && value.canGoBack);
      if (!back) return;
      if (navDead) back.setAttribute('data-zshell-zc-nav-dead', '');
      else back.removeAttribute('data-zshell-zc-nav-dead');
    };
    var applySkin = function (force) {
      if (!row) return;
      try {
        var docEl = document.documentElement;
        var skinKey = (docEl.className || '') + '|' + (docEl.getAttribute('data-color-scheme') || '') + '|' + (row.className || '');
        if (!force && skinKey === lastSkinKey) return;
        lastSkinKey = skinKey;
        var cs = getComputedStyle(row);
        var root = docEl.style;
        var bg = cs.backgroundColor || '#fff', fg = cs.color || '#111';
        if (root.getPropertyValue('--zshell-zc-bg') !== bg) root.setProperty('--zshell-zc-bg', bg);
        if (root.getPropertyValue('--zshell-zc-fg') !== fg) root.setProperty('--zshell-zc-fg', fg);
      } catch (_) { /* cosmetic only */ }
    };
    window.__zshellSyncZcodeSkin = function () { applySkin(true); };
    try {
      if (typeof window.matchMedia === 'function') {
        var mq = window.matchMedia('(prefers-color-scheme: dark)');
        if (mq && typeof mq.addEventListener === 'function') {
          mq.addEventListener('change', function () { applySkin(true); });
        }
      }
    } catch (_) {}
    var dismissMenu = function (e) {
      if (menu && !menu.contains(e.target) && !dot.contains(e.target)) closeMenu();
    };
    var closeMenu = function () {
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
      menu = null;
      document.removeEventListener('click', dismissMenu, true);
    };
    var forwardMenu = function (el) {
      if (!el || !el.isConnected) return false;
      try {
        el.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, pointerType: 'mouse', button: 0,
        }));
      } catch (_) {
        try { el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true})); } catch (_) {}
      }
      el.click();
      return true;
    };
    var toggleSidePane = function () {
      var toggle = document.querySelector(sideToggle);
      if (toggle) { toggle.click(); return; }
      var overlay = document.querySelector(paneOverlay);
      var closeBtn = overlay ? overlay.querySelector('button') : null;
      if (closeBtn) closeBtn.click();
    };
    var openMenu = function () {
      closeMenu();
      applySkin(true);
      var m = document.createElement('div');
      m.className = 'zshell-menu';
      m.setAttribute('role', 'menu');
      var item = function (icon, text, hint, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        var left = document.createElement('span');
        left.className = 'zm-left';
        left.innerHTML = icon;
        var t = document.createElement('span');
        t.textContent = text;
        left.appendChild(t);
        b.appendChild(left);
        if (hint) {
          var h = document.createElement('small');
          h.textContent = hint;
          b.appendChild(h);
        }
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          closeMenu();
          fn();
        });
        m.appendChild(b);
      };
      var divider = function () {
        var d = document.createElement('div');
        d.className = 'zm-div';
        m.appendChild(d);
      };
      item(ICO_BACK, '返回列表', '保持后台', function () { post('zshell:zcode-back'); });
      if (current && current.canSwitch) {
        item(ICO_SWITCH, '切换机器', '', function () { post('zshell:zcode-switch'); });
      }
      if (homeBtn && homeBtn.isConnected) {
        item(ICO_LIST, '所有会话', '任务列表', function () { homeBtn.click(); });
      }
      item(ICO_DL, '下载管理', '', function () { post('zshell:zcode-downloads'); });
      item(ICO_RELOAD, '重新加载', '', function () { post('zshell:zcode-reload'); });
      var moreBtn = document.querySelector(wsMore);
      var pathBtn = document.querySelector(wsPath);
      var hasTheme = themeBtn && themeBtn.isConnected;
      if (moreBtn || pathBtn || hasTheme) divider();
      if (moreBtn) item(ICO_MORE, '会话操作', '原菜单', function () { forwardMenu(moreBtn); });
      if (pathBtn) item(ICO_FOLDER, '工作区信息', '', function () { pathBtn.click(); });
      if (hasTheme) item(ICO_THEME, '主题', '浅色 / 深色', function () { forwardMenu(themeBtn); });
      document.body.appendChild(m);
      menu = m;
      document.addEventListener('click', dismissMenu, true);
    };
    var forget = function () {
      closeMenu();
      if (back && back.parentNode) back.parentNode.removeChild(back);
      if (title && title.parentNode) title.parentNode.removeChild(title);
      if (dot && dot.parentNode) dot.parentNode.removeChild(dot);
      if (sidebar && sidebar.parentNode) sidebar.parentNode.removeChild(sidebar);
      if (row) row.removeAttribute('data-zshell-zc-row');
      if (homeBtn) homeBtn.removeAttribute('data-zshell-zc-hide');
      if (staticTitle) staticTitle.removeAttribute('data-zshell-zc-hide');
      if (themeBtn) themeBtn.removeAttribute('data-zshell-zc-themebtn');
      document.documentElement.removeAttribute('data-zshell-zcode-topbar');
      active = null;
      row = null;
      back = null;
      title = null;
      dot = null;
      label = null;
      sidebar = null;
      staticTitle = null;
      themeBtn = null;
      homeBtn = null;
      lastSkinKey = '';
    };
    var updateTitle = function () {
      if (!title) return;
      var text = '';
      var h1 = document.querySelector(wsTitle);
      if (h1) text = (h1.textContent || '').trim();
      if (!text && staticTitle) text = (staticTitle.textContent || '').trim();
      if (title.textContent !== text) title.textContent = text;
      title.hidden = text === '';
    };
    var findRow = function (section) {
      var candidate = section.firstElementChild;
      if (!candidate || candidate.tagName !== 'DIV') return null;
      var buttons = [];
      var spans = [];
      for (var c = candidate.firstElementChild; c; c = c.nextElementSibling) {
        if (c.hasAttribute('data-zshell-zc')) continue;
        if (c.tagName === 'BUTTON') buttons.push(c);
        else if (c.tagName === 'SPAN') spans.push(c);
      }
      if (buttons.length < 1 || spans.length < 1) return null;
      return {
        row: candidate,
        home: buttons[0],
        staticTitle: spans[0],
        theme: buttons.length > 1 ? buttons[buttons.length - 1] : null,
      };
    };
    var iconButton = function (icon, attr, label, onClick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-zshell-zc', '');
      b.setAttribute(attr, '');
      b.setAttribute('aria-label', label);
      b.innerHTML = icon;
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        onClick();
      });
      return b;
    };
    var scan = function (announce) {
      try {
        var section = document.querySelector(chatSection);
        var parts = section ? findRow(section) : null;
        if (section && parts && !style.isConnected) {
          (document.head || document.documentElement).appendChild(style);
        }
        if (!section || !parts) {
          if (section && !parts && lastReportedMiss !== 'row') {
            lastReportedMiss = 'row';
            post('zshell:zcode-topbar-miss:row');
          }
          var state = document.querySelector('section[data-mobile-page="home"]')
            ? 'home' : 'other';
          if (active) forget();
          if (pageState !== state) {
            pageState = state;
            post(state === 'home' ? 'zshell:zcode-home' : 'zshell:zcode-header-off');
          }
          return;
        }
        lastReportedMiss = '';
        pageState = 'chat';
        if (active === parts.row && back && back.parentNode === parts.row &&
            homeBtn === parts.home && staticTitle === parts.staticTitle &&
            (themeBtn || null) === (parts.theme || null)) {
          staticTitle.setAttribute('data-zshell-zc-hide', '');
          homeBtn.setAttribute('data-zshell-zc-hide', '');
          if (themeBtn) themeBtn.setAttribute('data-zshell-zc-themebtn', '');
          applySkin(false);
          updateTitle();
          if (announce) post('zshell:zcode-header-on');
          return;
        }
        forget();
        active = parts.row;
        row = parts.row;
        homeBtn = parts.home;
        staticTitle = parts.staticTitle;
        themeBtn = parts.theme;
        row.setAttribute('data-zshell-zc-row', '');
        back = iconButton(ICON_BACK, 'data-zshell-zc-back', '返回上一页', function () {
          post('zshell:zcode-webback');
        });
        if (navDead) back.setAttribute('data-zshell-zc-nav-dead', '');
        title = document.createElement('span');
        title.setAttribute('data-zshell-zc', '');
        title.setAttribute('data-zshell-zc-title', '');
        dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'zshell-status';
        dot.setAttribute('data-zshell-zc', '');
        dot.appendChild(document.createElement('i'));
        label = dot.appendChild(document.createElement('span'));
        dot.addEventListener('click', function () {
          if (current && current.reconnect) post('zshell:zcode-reconnect');
          else if (menu) closeMenu();
          else openMenu();
        });
        sidebar = iconButton(ICON_SIDEBAR, 'data-zshell-zc-sidebar', '侧栏', function () {
          toggleSidePane();
        });
        row.appendChild(back);
        row.appendChild(title);
        row.appendChild(dot);
        row.appendChild(sidebar);
        homeBtn.setAttribute('data-zshell-zc-hide', '');
        staticTitle.setAttribute('data-zshell-zc-hide', '');
        if (themeBtn) themeBtn.setAttribute('data-zshell-zc-themebtn', '');
        document.documentElement.setAttribute('data-zshell-zcode-topbar', '');
        applySkin(true);
        render();
        updateTitle();
        post('zshell:zcode-header-on');
      } catch (_) { /* Leave the original controls available. */ }
    };
    window.__zshellRefreshZcodeTopbar = ${INSTALL_TOPBAR_ACTIVITY}(
      scan, closeMenu, ['class', 'hidden', 'aria-hidden', 'style', 'data-testid']);
    post('zshell:topbar-activity-ready');
  } catch (_) { /* Leave the original controls available. */ }
})();`;
}
