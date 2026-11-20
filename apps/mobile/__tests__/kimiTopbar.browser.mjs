import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildKimiThemePrelude, KIMI_TOPBAR_PATCH} from '../src/kimiTopbar.ts';

const chrome = process.env.CHROME_PATH;
assert.ok(chrome, 'Set CHROME_PATH to a Chromium browser executable');

const fixture = function (install, applyTheme) {
  const app = document.querySelector('.app');
  const pill = () => app.querySelector('.zshell-status');
  const box = element => element.getBoundingClientRect();
  const check = (condition, message) => { if (!condition) throw Error(message); };
  // Headless Chromium's virtual clock advances timers even without compositor frames.
  window.requestAnimationFrame = callback => setTimeout(callback, 16);
  const frame = () => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  const assertLayout = header => {
    const title = header.querySelector('.tb-main');
    const action = header.querySelector('.ui-icon-button');
    check(pill()?.parentElement === header, 'status pill in current header');
    check(pill().previousElementSibling === title, 'status pill follows title');
    if (action) {
      check(Math.abs(box(header).right - box(action).right - 8) < 1, 'settings stays at right edge');
      check(box(pill()).right < box(action).left, 'no overlap with settings');
    }
    check(Math.abs(box(pill()).left - box(title).right - 6) < 1, 'status pill is left-aligned');
  };
  const mark = result => { document.querySelector('output').textContent = result; };
  void (async () => {
    const root = document.documentElement;
    const getTheme = () => document.getElementById('kshell-kimi-document-theme');
    const canvas = () => getComputedStyle(root).backgroundColor;
    const location = {hostname: 'code-rc.kimi.com', protocol: 'https:', pathname: '/devices/test/'};
    applyTheme('dark', 'dark', {...location, hostname: 'example.com'});
    applyTheme('dark', 'dark', {...location, pathname: '/login'});
    check(!getTheme(), 'bootstrap ignores other origins and the login page');
    const head = document.head;
    head.remove();
    applyTheme('dark', null, location);
    root.prepend(head);
    await Promise.resolve();
    check(canvas() === 'rgb(18, 18, 18)' && root.dataset.colorScheme === 'system',
      'system startup paints dark once the head is parsed');
    getTheme().remove();
    applyTheme('light', 'dark', location);
    check(canvas() === 'rgb(18, 18, 18)' && root.dataset.colorScheme === 'dark',
      'saved dark theme wins over a light host');
    applyTheme('light', 'light', location);
    check(root.dataset.colorScheme === 'dark', 'reinjection does not reset theme');
    getTheme().remove();
    root.dataset.colorScheme = 'system';
    applyTheme('dark', 'light', location);
    check(canvas() === 'rgb(255, 255, 255)' && root.dataset.colorScheme === 'light',
      'saved light theme wins over a dark host');
    const officialStyle = document.createElement('style');
    officialStyle.textContent = 'html[data-color-scheme="dark"]{--color-bg:#1e1e1e;color-scheme:dark}';
    head.append(officialStyle);
    root.dataset.colorScheme = 'dark';
    check(canvas() === 'rgb(30, 30, 30)' && getComputedStyle(root).colorScheme === 'dark',
      'official CSS and subsequent theme choices take precedence');

    install();
    const old = app.querySelector('.topbar');
    assertLayout(old);
    pill().click();
    check(!!document.querySelector('.zshell-menu'), 'status menu opens');

    // The previous header remains mounted while the new-session shell loads.
    const next = document.createElement('header');
    next.className = 'topbar';
    next.innerHTML = '<div class="tb-main"><span></span></div>';
    app.append(next);
    await frame();
    check(box(old).height === 0, 'previous header is hidden');
    check(box(next).height === 0, 'empty replacement has no height');
    check(!pill() && !document.querySelector('.zshell-menu'), 'old pill and menu are removed');

    // The title can arrive without .tb-line or a settings button.
    const title = next.querySelector('span');
    const text = title.appendChild(document.createTextNode(''));
    await frame();
    text.data = 'New session';
    await frame();
    assertLayout(next);
    install();
    check(app.querySelectorAll('.zshell-status').length === 1, 'reinjection keeps one pill');

    title.className = 'tt';
    text.data = 'A long session title '.repeat(15);
    next.insertAdjacentHTML('beforeend', '<button hidden class="ui-icon-button">≡</button>');
    const action = next.querySelector('button.ui-icon-button');
    let clicks = 0;
    action.addEventListener('click', () => { clicks++; });
    await frame();
    action.hidden = false;
    app.style.width = '280px';
    await frame();
    assertLayout(next);
    check(title.scrollWidth > title.clientWidth, 'long title truncates');
    action.click();
    check(clicks === 1, 'original settings handler still works');

    next.remove();
    await frame();
    assertLayout(old);

    const previousText = old.querySelector('.tt').firstChild;
    old.querySelector('.ui-icon-button').hidden = true;
    previousText.data = '';
    await frame();
    check(box(old).height === 0 && !pill(), 'reused header collapses when emptied');
    window.__zshellSetTopbarActive(false);
    previousText.data = 'Restored session';
    window.dispatchEvent(new Event('resize'));
    install();
    await new Promise(done => setTimeout(done, 1300));
    check(!pill(), 'hidden header ignores mutations, refresh and the timer');
    window.__zshellSetTopbarActive(true);
    check(!!pill(), 'visible header rescans immediately');
    mark('PASS');
  })().catch(error => mark(error.message));
};

const tempRoot = resolve(tmpdir());
const temp = mkdtempSync(join(tempRoot, 'kshell-topbar-'));
try {
  const html = join(temp, 'fixture.html');
  const colors = {dark: '#121212', light: '#ffffff'};
  const preludes = Object.fromEntries(['dark', 'light'].map(scheme =>
    [scheme, buildKimiThemePrelude(scheme, colors)]));
  writeFileSync(html, `<!doctype html><html data-color-scheme="system"><meta charset="utf-8">
    <style>
      .app {width: 390px}
      .topbar {display:flex; height:72px; box-sizing:border-box}
      .tb-main {display:flex; flex:1; align-items:center}
    </style>
    <div id="app"><div class="app mobile"><header class="topbar"><button class="tb-main">
      <span class="tb-line"><span class="tt">Previous session</span></span></button>
      <button class="ui-icon-button">≡</button></header></div></div>
    <output>TEST DID NOT FINISH</output><script>
      (${fixture.toString()})(() => new Function('location', ${JSON.stringify(KIMI_TOPBAR_PATCH)})({
        hostname: 'code-rc.kimi.com', pathname: '/devices/test/'
      }), (scheme, stored, url) => new Function('location', 'localStorage',
        ${JSON.stringify(preludes)}[scheme])(url, {getItem: () => stored}));
    </script>`);
  const result = execFileSync(chrome, [
    '--headless', '--disable-gpu', '--disable-software-rasterizer', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(temp, 'profile')}`,
    ...(process.env.KSHELL_BROWSER_NO_SANDBOX ? ['--no-sandbox'] : []),
    '--virtual-time-budget=4000', '--dump-dom', pathToFileURL(html).href,
  ], {encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore']});
  assert.equal(result.match(/<output>([^<]*)<\/output>/)?.[1], 'PASS');
  console.log('Kimi topbar browser regression passed');
} finally {
  assert.equal(dirname(resolve(temp)), tempRoot);
  rmSync(temp, {recursive: true, force: true, maxRetries: 5});
}
