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
// (返回列表 / 所有会话 / 下载管理 / 重新加载 / 会话操作 / 工作区信息 / 主题),
// while a dead connection turns the tap into a direct 重连. The page's own
// back-home arrow is hidden in place — in the common flow it duplicates the
// shell ‹ web-back — and the menu carries a "所有会话" item that forwards to
// it, so the task list stays reachable even without web history.
//
// Anchors are stable product attributes only (`data-mobile-page`,
// `data-testid`), never button text or coordinates. The workspace header row
// collapses to a zero-height invisible box (not display:none) so Radix
// dropdowns forwarded from the ⋯ menu still anchor next to the row; the theme
// menu trigger collapses the same way inside the row.
// Any missed anchor restores the original layout (forget()) and announces
// header-off. The task home reports 'zshell:zcode-home'. Outside both views,
// the native footer is reserved for page load failures, never startup or relay status.
//
// The same script is injected twice (`beforeContentLoaded` and after load);
// the second run reuses the first observer through `__zshellRefreshZcodeTopbar`.
export function buildZcodeTopbarPatch(
  colors: Record<ColorScheme, Pick<Palette, 'consoleBg' | 'consoleHeaderBg'>>,
): string {
  const {light, dark} = colors;
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
      // Match Kimi's rendered surfaces while following ZCode's own color-scheme.
      'html[data-zshell-zcode-topbar] ' + chatSection + '{background-color:light-dark(${light.consoleBg},${dark.consoleBg})}',
      'html[data-zshell-zcode-topbar] ' + chatSection + ' > [data-zshell-zc-row]{background-color:light-dark(${light.consoleHeaderBg},${dark.consoleHeaderBg})}',
      // The page's own h-11 mobile header row becomes the single 48px row.
      '[data-zshell-zc-row]{position:relative;justify-content:flex-start;gap:4px;padding:0 8px 0 12px!important;height:48px!important;min-height:48px!important;max-height:48px!important;overflow:hidden}',
      // Static "task console" caption and the original back-home arrow (it
      // duplicates the shell ‹ web-back in the common flow; the ⋯ menu
      // forwards to it so the task list stays reachable) are hidden in place.
      '[data-zshell-zc-row] > [data-zshell-zc-hide]{display:none!important}',
      // Theme menu trigger collapses in place: absolutely positioned at the
      // row's right edge so it neither takes part in flex layout (no phantom
      // gap) nor shifts the sidebar, while its Radix dropdown still anchors
      // beside the row when forwarded from the menu.
      '[data-zshell-zc-row] > [data-zshell-zc-themebtn]{order:9;position:absolute;right:0;top:0;height:100%;width:0!important;min-width:0!important;padding:0!important;margin:0!important;border:0!important;overflow:hidden;visibility:hidden}',
      // Shell controls, in visual order. Sidebar pins to the right edge.
      '[data-zshell-zc-row] > [data-zshell-zc-back]{order:0}',
      '[data-zshell-zc-row] > [data-zshell-zc-title]{order:1;flex:0 1 auto;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit}',
      '[data-zshell-zc-row] > .zshell-status{order:2}',
      '[data-zshell-zc-row] > [data-zshell-zc-sidebar]{order:5;margin-inline-start:auto!important}',
      '[data-zshell-zc-back],[data-zshell-zc-sidebar]{flex:none;display:flex;align-items:center;justify-content:center;width:34px;height:40px;margin:0;padding:0;border:0;background:transparent;color:inherit;cursor:pointer}',
      '[data-zshell-zc-back][data-zshell-zc-nav-dead]{opacity:.35}',
      // Connection pill (single menu entry), fed natively through
      // __zshellUpdateZcodeStatus.
      '.zshell-status{flex:none;display:flex;align-items:center;gap:4px;height:30px;margin:0;padding:0 8px;border:1px solid rgba(127,127,127,.35);border-radius:999px;background:rgba(127,127,127,.08);color:inherit;font:inherit;font-size:11px;white-space:nowrap;cursor:pointer}',
      '.zshell-status i{width:6px;height:6px;border-radius:50%;flex:none;background:var(--zshell-dot,#888)}',
      // The page's workspace header row collapses to a zero-height invisible
      // box that keeps its geometry, so forwarded Radix dropdowns and the
      // workspace popover anchor next to our row instead of the viewport origin.
      'html[data-zshell-zcode-topbar] header[data-testid="workspace-header"]{height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;border-bottom-width:0!important;visibility:hidden!important}',
      // Floating menu (⋯).
      '.zshell-menu{position:fixed;top:52px;right:8px;z-index:2147483000;display:flex;flex-direction:column;min-width:148px;padding:5px;border:1px solid rgba(127,127,127,.35);border-radius:12px;background:var(--zshell-zc-bg,#fff);box-shadow:0 10px 28px rgba(0,0,0,.2);font:inherit;color:var(--zshell-zc-fg,#111)}',
      '.zshell-menu button{all:unset;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:9px 10px;border-radius:8px;font-size:13px;cursor:pointer;color:inherit}',
      '.zshell-menu button:active{background:rgba(127,127,127,.16)}',
      '.zshell-menu small{font-size:11px;opacity:.55}',
      '@media(max-width:310px){[data-zshell-zc-row] > .zshell-status{padding-inline:5px}[data-zshell-zc-row] > .zshell-status span{display:none}}'
    ].join('\n');
    var active = null, row = null, back = null, title = null, dot = null, label = null,
        sidebar = null, staticTitle = null, themeBtn = null, homeBtn = null,
        menu = null, current = null, navDead = false, pageState = null;
    var ICON_BACK = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10.5 3 5.5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var ICON_SIDEBAR = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="10" y1="2.5" x2="10" y2="13.5" stroke="currentColor" stroke-width="1.4"/></svg>';
    var render = function () {
      if (!dot || !current) return;
      dot.style.setProperty('--zshell-dot', current.color);
      if (label && label.textContent !== current.short) label.textContent = current.short;
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
    var applySkin = function () {
      if (!row) return;
      try {
        var cs = getComputedStyle(row);
        var root = document.documentElement.style;
        var bg = cs.backgroundColor || '#fff', fg = cs.color || '#111';
        if (root.getPropertyValue('--zshell-zc-bg') !== bg) root.setProperty('--zshell-zc-bg', bg);
        if (root.getPropertyValue('--zshell-zc-fg') !== fg) root.setProperty('--zshell-zc-fg', fg);
      } catch (_) { /* cosmetic only */ }
    };
    var dismissMenu = function (e) {
      // The pill must stay excluded — it toggles the menu, and its
      // capture-phase dismissal would race its own toggle handler.
      if (menu && !menu.contains(e.target) && !dot.contains(e.target)) closeMenu();
    };
    var closeMenu = function () {
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
      menu = null;
      document.removeEventListener('click', dismissMenu, true);
    };
    // Radix dropdown triggers open on pointerdown; a plain .click() is not
    // enough. Element-level dispatch only — never coordinates.
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
      item('返回列表', '结束当前视图', function () { post('zshell:zcode-back'); });
      if (homeBtn && homeBtn.isConnected) {
        item('所有会话', '打开任务列表', function () { homeBtn.click(); });
      }
      item('下载管理', '', function () { post('zshell:zcode-downloads'); });
      item('重新加载', '', function () { post('zshell:zcode-reload'); });
      var moreBtn = document.querySelector(wsMore);
      if (moreBtn) item('会话操作', '原页面菜单', function () { forwardMenu(moreBtn); });
      var pathBtn = document.querySelector(wsPath);
      if (pathBtn) item('工作区信息', '', function () { pathBtn.click(); });
      if (themeBtn && themeBtn.isConnected) item('主题', '浅色 / 深色', function () { forwardMenu(themeBtn); });
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
    // The chat section's first element child is the page's own mobile header
    // row: [back-home button, static title span, theme menu trigger]. Radix
    // renders no wrapper around the theme trigger, so the shape is exact.
    // Our own nodes carry data-zshell-zc and are excluded from the match.
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
          // Off the chat page: the task home paints its own chrome, so the
          // shell hides the native footer there too ('zshell:zcode-home').
          // Other views let the shell decide whether a failure needs controls.
          var state = document.querySelector('section[data-mobile-page="home"]')
            ? 'home' : 'other';
          if (active) forget();
          if (pageState !== state) {
            pageState = state;
            post(state === 'home' ? 'zshell:zcode-home' : 'zshell:zcode-header-off');
          }
          return;
        }
        pageState = 'chat';
        if (active === parts.row && back && back.parentNode === parts.row &&
            homeBtn === parts.home && staticTitle === parts.staticTitle &&
            (themeBtn || null) === (parts.theme || null)) {
          // Same row: refresh derived bits, no rebuild.
          staticTitle.setAttribute('data-zshell-zc-hide', '');
          homeBtn.setAttribute('data-zshell-zc-hide', '');
          if (themeBtn) themeBtn.setAttribute('data-zshell-zc-themebtn', '');
          applySkin();
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
        applySkin();
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
