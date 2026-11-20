import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {shouldShowZcodeFooter, ZCODE_TOPBAR_PATCH} from '../src/zcodeTopbar.ts';

for (const status of ['connecting', 'connected', 'waiting']) {
  assert.equal(shouldShowZcodeFooter('other', status, false), false,
    `startup has no footer when the bridge reports ${status}`);
}
assert.equal(shouldShowZcodeFooter('other', 'disconnected', false), true);
assert.equal(shouldShowZcodeFooter('other', 'kicked', false), true);
assert.equal(shouldShowZcodeFooter('other', 'connecting', true), true);
assert.equal(shouldShowZcodeFooter('home', 'connected', false), false);
assert.equal(shouldShowZcodeFooter('chat', 'disconnected', false), false);

const chrome = process.env.CHROME_PATH;
assert.ok(chrome, 'Set CHROME_PATH to a Chromium browser executable');

const fixture = function (install) {
  const section = () => document.querySelector('section[data-mobile-page="chat"]');
  const row = () => section().firstElementChild;
  const pill = () => row().querySelector('.zshell-status');
  const menu = () => document.querySelector('.zshell-menu');
  const shell = attr => row().querySelector(`[${attr}]`);
  const box = element => element.getBoundingClientRect();
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const posted = event => window.__posts.includes(event);
  // Headless Chromium's virtual clock advances timers even without compositor frames.
  window.requestAnimationFrame = callback => setTimeout(callback, 16);
  const frame = () => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  const clicks = {home: 0, more: 0, side: 0, theme: 0, path: 0};
  const mark = result => { document.querySelector('output').textContent = result; };
  void (async () => {
    window.__posts = [];
    window.ReactNativeWebView = {postMessage: m => window.__posts.push(m)};
    document.querySelector('#home').addEventListener('click', () => { clicks.home++; });
    const moreBtn = document.querySelector('[data-testid="workspace-more-button"]');
    moreBtn.addEventListener('pointerdown', () => { clicks.more++; });
    moreBtn.addEventListener('click', () => { clicks.more++; });
    document.querySelector('[data-testid="side-pane-toggle"]').addEventListener('click', () => { clicks.side++; });
    document.querySelector('#theme').addEventListener('pointerdown', () => { clicks.theme++; });
    document.querySelector('#theme').addEventListener('click', () => { clicks.theme++; });
    document.querySelector('[data-testid="workspace-path"]').addEventListener('click', () => { clicks.path++; });

    install();
    check(posted('zshell:zcode-header-on'), 'header announced');
    check(!!pill() && !!shell('data-zshell-zc-back') &&
      !!shell('data-zshell-zc-sidebar') && !!shell('data-zshell-zc-title'),
      'all shell controls attached');
    check(Math.round(box(row()).height) === 48, 'row compacted to 48px');
    check(box(document.querySelector('#static-title')).height === 0, 'static caption hidden');
    const header = document.querySelector('[data-testid="workspace-header"]');
    check(box(header).height === 0 && getComputedStyle(header).visibility === 'hidden',
      'workspace header collapsed but still boxed');
    check(box(document.querySelector('#home')).height === 0, 'back-home arrow hidden in row');
    const sideEl = shell('data-zshell-zc-sidebar');
    check(Math.abs(box(row()).right - box(sideEl).right - 8) < 2, 'sidebar pinned to right edge');
    check(box(sideEl).left > box(pill()).right + 20,
      'sidebar pushed right of the title group');
    check(shell('data-zshell-zc-title').textContent === 'Fix login bug', 'title mirrored');
    const labels = ['返回上一页', '侧栏'];
    for (const label of labels) {
      check(row().querySelector(`[aria-label="${label}"]`) != null, `a11y label: ${label}`);
    }

    // Original handlers keep working.
    document.querySelector('#home').click();
    check(clicks.home === 1, 'back-home handler untouched');

    // Pill menu: native items post, page items forward.
    pill().click();
    check(!!menu(), 'menu opens');
    check(menu().querySelectorAll('button').length === 7, 'menu has 7 items');
    const itemByText = text => Array.from(menu().querySelectorAll('button'))
      .find(button => button.textContent.includes(text));
    itemByText('下载管理').click();
    check(posted('zshell:zcode-downloads'), 'downloads item posts');
    check(!menu(), 'menu closes after item');
    pill().click();
    itemByText('重新加载').click();
    check(posted('zshell:zcode-reload'), 'reload item refreshes the current page');
    pill().click();
    itemByText('所有会话').click();
    check(clicks.home === 2, 'all-sessions forwards to hidden back-home');
    pill().click();
    itemByText('会话操作').click();
    check(clicks.more === 2, 'session menu forwards pointerdown+click');
    pill().click();
    itemByText('主题').click();
    check(clicks.theme === 2, 'theme trigger forwards pointerdown+click');
    pill().click();
    itemByText('工作区信息').click();
    check(clicks.path === 1, 'workspace popover forwards click');

    // Pill: status display + single menu entry; dead connection → direct reconnect.
    window.__zshellUpdateZcodeStatus({short: '已连接', label: '已连接', color: '#22c55e'});
    check(pill().querySelector('span').textContent === '已连接', 'pill label fed natively');
    check(pill().getAttribute('aria-label').includes('已连接'), 'pill a11y label');
    pill().click();
    check(!!menu(), 'connected pill toggles the menu open');
    pill().click();
    check(!menu(), 'connected pill toggles the menu closed');
    shell('data-zshell-zc-back').click();
    check(posted('zshell:zcode-webback'), 'web back posts');
    window.__zshellUpdateZcodeStatus({short: '重连', label: '连接已断开，点按重连', color: '#ef4444', reconnect: true});
    pill().click();
    check(!menu(), 'no menu while reconnect pending');
    check(posted('zshell:zcode-reconnect'), 'dead pill reconnects separately from menu reload');

    // ‹ dims without web history.
    window.__zshellUpdateZcodeNav({canGoBack: false});
    check(shell('data-zshell-zc-back').hasAttribute('data-zshell-zc-nav-dead'), 'back dims without history');
    window.__zshellUpdateZcodeNav({canGoBack: true});
    check(!shell('data-zshell-zc-back').hasAttribute('data-zshell-zc-nav-dead'), 'back re-arms with history');

    // Sidebar forwards to the original toggle.
    shell('data-zshell-zc-sidebar').click();
    check(clicks.side === 1, 'sidebar forwards to original toggle');

    // Long title truncates inside the fixed row.
    document.querySelector('#title-text').textContent = 'A very long session title '.repeat(12);
    await frame();
    const mirror = shell('data-zshell-zc-title');
    check(mirror.scrollWidth > mirror.clientWidth, 'long title truncates');

    // Reinjection keeps a single pill.
    install();
    check(row().querySelectorAll('.zshell-status').length === 1, 'reinjection keeps one pill');

    // Title falls back to the static caption when the task title is absent.
    const h1 = document.querySelector('[data-testid="workspace-title"]');
    h1.remove();
    await frame();
    check(shell('data-zshell-zc-title').textContent === '任务会话', 'title falls back to caption');

    // Missing anchors restore the original layout. Keep the node reference —
    // the section leaves the document here.
    const original = section();
    original.remove();
    await frame();
    check(posted('zshell:zcode-header-off'), 'header-off announced');
    check(!document.querySelector('.zshell-status'), 'shell controls removed');
    const bare = document.createElement('section');
    bare.setAttribute('data-mobile-page', 'chat');
    bare.innerHTML = '<div><button>‹</button></div><main></main>';
    document.body.appendChild(bare);
    await frame();
    check(!bare.querySelector('.zshell-status'), 'no attachment without the full row shape');
    check(!document.documentElement.hasAttribute('data-zshell-zcode-topbar'),
      'original layout restored');

    // Recovery re-attaches (a fresh full row, as after navigating back).
    bare.remove();
    window.__posts.length = 0;
    document.body.appendChild(original);
    await frame();
    check(!!pill() && posted('zshell:zcode-header-on'), 're-attaches after recovery');
    check(row().querySelectorAll('.zshell-status').length === 1, 'recovery keeps one pill');

    // Task home page: announce home so the native footer hides there.
    original.remove();
    window.__posts.length = 0;
    const home = document.createElement('section');
    home.setAttribute('data-mobile-page', 'home');
    document.body.appendChild(home);
    await frame();
    check(posted('zshell:zcode-home'), 'home page announces home');
    check(!document.querySelector('.zshell-status'), 'shell controls removed on home');
    home.remove();
    document.body.appendChild(original);
    await frame();
    check(!!pill() && posted('zshell:zcode-header-on'), 'chat re-attaches after home');
    window.__zshellUpdateZcodeStatus({short: '已连接', label: '已连接', color: '#22c55e'});
    pill().click();
    check(!!menu(), 'menu opens before hiding the console');
    window.__zshellSetTopbarActive(false);
    check(!menu(), 'hiding dismisses the menu');
    window.__posts.length = 0;
    original.remove();
    document.body.appendChild(home);
    window.dispatchEvent(new Event('popstate'));
    await new Promise(done => setTimeout(done, 1300));
    check(!posted('zshell:zcode-home'), 'hidden console does not scan the new route');
    window.__zshellSetTopbarActive(true);
    check(posted('zshell:zcode-home'), 'visible console detects the current route immediately');
    mark('PASS');
  })().catch(error => mark(error.message));
};

const tempRoot = resolve(tmpdir());
const temp = mkdtempSync(join(tempRoot, 'kshell-zcode-topbar-'));
try {
  const html = join(temp, 'fixture.html');
  writeFileSync(html, `<!doctype html><meta charset="utf-8">
    <style>
      body {margin: 0}
      section {width: 390px}
      .row {display:flex; height:44px; align-items:center; box-sizing:border-box}
      header[data-testid] {display:flex; height:48px; align-items:center; box-sizing:border-box}
      h1 {margin: 0; min-width: 0}
      span {white-space: nowrap}
    </style>
    <section data-mobile-page="chat" id="original-section">
      <div class="row"><button id="home" aria-label="返回任务首页">‹</button>
        <span id="static-title">任务会话</span>
        <button id="theme" aria-label="外观">◐</button></div>
      <header data-testid="workspace-header" data-workspace-header-variant="task">
        <button data-testid="workspace-path">📁 demo</button>
        <h1 data-testid="workspace-title"><span id="title-text">Fix login bug</span></h1>
        <button data-testid="workspace-more-button">⋯</button>
        <button data-testid="side-pane-toggle">▤</button>
      </header>
      <main data-mobile-chat-surface></main>
    </section>
    <output>TEST DID NOT FINISH</output><script>
      (${fixture.toString()})(() => new Function('location', ${JSON.stringify(ZCODE_TOPBAR_PATCH)})({
        hostname: 'zcode.z.ai', pathname: '/remote/v4'
      }));
    </script>`);
  const result = execFileSync(chrome, [
    '--headless', '--disable-gpu', '--disable-software-rasterizer', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(temp, 'profile')}`,
    ...(process.env.KSHELL_BROWSER_NO_SANDBOX ? ['--no-sandbox'] : []),
    '--virtual-time-budget=4000', '--dump-dom', pathToFileURL(html).href,
  ], {encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore']});
  assert.equal(result.match(/<output>([^<]*)<\/output>/)?.[1], 'PASS');
  console.log('ZCode topbar browser regression passed');
} finally {
  assert.equal(dirname(resolve(temp)), tempRoot);
  rmSync(temp, {recursive: true, force: true, maxRetries: 5});
}
