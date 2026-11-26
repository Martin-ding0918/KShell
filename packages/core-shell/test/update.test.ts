import {describe, expect, it} from 'vitest';
import {
  compareVersions,
  isNewer,
  isTrustedUpdateUrl,
  parseLatestRelease,
} from '../src/update';

const GH = 'https://github.com/Martin-ding0918/KShell/releases/download/v1.0.0';

describe('compareVersions', () => {
  it.each([
    ['0.0.1-alpha.3', '0.0.1-alpha.2', 1],
    ['0.0.1-alpha.10', '0.0.1-alpha.9', 1],
    ['0.0.1', '0.0.1-alpha.9', 1],
    ['0.0.1-alpha.3', '0.0.1', -1],
    ['0.1.0', '0.0.9', 1],
    ['1.2.3', '1.2.3', 0],
    ['v0.2.0', '0.1.9', 1],
    ['0.0.1-beta.1', '0.0.1-alpha.5', 1],
    ['0.0.1-rc.1', '0.0.1-beta.1', 1],
    ['0.0.1', '0.0.1', 0],
    ['0.0.1.11', '0.0.1.10', 1],
    ['1.0.0-beta', '1.0.0-rc.1', -1],
    ['1.0.0-rc1', '1.0.0-beta.2', 1],
    ['1.0.0-dev.5', '1.0.0-alpha.1', -1],
    ['1.0.0-beta', '1.0.0', -1],
    ['1.0.0-alpha.1.1', '1.0.0-alpha.1', 1],
    ['1.0.0-alpha.1', '1.0.0-alpha.1.1', -1],
    ['1.0.0-beta.0', '1.0.0-beta', 1],
    ['1.0.0-beta', '1.0.0-beta.0', -1],
    ['1.0.0-alpha.1', '1.0.0-alpha.beta', -1],
  ])('%s vs %s -> %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});

describe('parseLatestRelease', () => {
  const sampleDigest = 'a'.repeat(64);
  const sample = {
    tag_name: 'v0.0.1-alpha.4',
    body: '### 修复\n- 图案设置',
    published_at: '2026-10-09T10:00:00Z',
    assets: [
      {name: 'release_notes.md', browser_download_url: `${GH}/n.md`, size: 100},
      {
        name: 'app-release.apk',
        browser_download_url: `${GH}/a.apk`,
        size: 74000000,
        digest: `sha256:${sampleDigest}`,
      },
    ],
  };

  it('picks the APK asset, extracts digest, and strips the v prefix', () => {
    const r = parseLatestRelease(sample)!;
    expect(r.version).toBe('0.0.1-alpha.4');
    expect(r.apkUrl).toBe(`${GH}/a.apk`);
    expect(r.apkSize).toBe(74000000);
    expect(r.apkSha256).toBe(sampleDigest);
    expect(r.notes).toContain('图案设置');
  });

  it('isNewer compares against current version', () => {
    const r = parseLatestRelease(sample)!;
    expect(isNewer('0.0.1-alpha.3', r)).toBe(true);
    expect(isNewer('0.0.1-alpha.4', r)).toBe(false);
    expect(isNewer('0.0.1', r)).toBe(false);
  });

  it('prefers arm64 asset, then universal, then any APK', () => {
    const base = {tag_name: 'v1.0.0'};
    expect(
      parseLatestRelease({
        ...base,
        assets: [
          {name: 'ZShell-1.0.0-universal-release.apk', browser_download_url: `${GH}/u.apk`, size: 1},
          {name: 'ZShell-1.0.0-arm64-v8a-release.apk', browser_download_url: `${GH}/a.apk`, size: 2},
          {name: 'ZShell-1.0.0-x86_64-release.apk', browser_download_url: `${GH}/x.apk`, size: 3},
        ],
      })!.apkUrl,
    ).toBe(`${GH}/a.apk`);
    expect(
      parseLatestRelease({
        ...base,
        assets: [
          {name: 'ZShell-1.0.0-x86_64-release.apk', browser_download_url: `${GH}/x.apk`},
          {name: 'ZShell-1.0.0-universal-release.apk', browser_download_url: `${GH}/u.apk`},
        ],
      })!.apkUrl,
    ).toBe(`${GH}/u.apk`);
    expect(
      parseLatestRelease({
        ...base,
        assets: [{name: 'ZShell-1.0.0-x86_64-release.apk', browser_download_url: `${GH}/x.apk`}],
      })!.apkUrl,
    ).toBe(`${GH}/x.apk`);
  });

  it('rejects unusable payloads and untrusted/cleartext download URLs', () => {
    expect(parseLatestRelease(null)).toBeNull();
    expect(parseLatestRelease({})).toBeNull();
    expect(parseLatestRelease({tag_name: 'v1.0.0', assets: []})).toBeNull();
    expect(
      parseLatestRelease({tag_name: 'v1.0.0', assets: [{name: 'x.txt'}]}),
    ).toBeNull();
    expect(
      parseLatestRelease({
        tag_name: 'v1.0.0',
        assets: [{name: 'app.apk', browser_download_url: 'http://github.com/a/b/app.apk'}],
      }),
    ).toBeNull();
    expect(
      parseLatestRelease({
        tag_name: 'v1.0.0',
        assets: [{name: 'app.apk', browser_download_url: 'https://evil.example/app.apk'}],
      }),
    ).toBeNull();
    expect(isTrustedUpdateUrl('https://github.com/Martin-ding0918/KShell/releases/download/v1/a.apk')).toBe(true);
    expect(isTrustedUpdateUrl('http://github.com/a.apk')).toBe(false);
    expect(isTrustedUpdateUrl('https://github.com.evil.test/a.apk')).toBe(false);
    expect(isTrustedUpdateUrl('https://github.com:8443/a.apk')).toBe(false);
    expect(isTrustedUpdateUrl('https://evil@github.com/a.apk')).toBe(false);
    expect(parseLatestRelease({tag_name: 'v1.0.0', assets: [null]})).toBeNull();
    expect(
      parseLatestRelease({
        tag_name: 'v1.0.0',
        assets: [
          {
            name: 'KShell-1.0.0-arm64-v8a.apk',
            browser_download_url:
              'https://github.com/Martin-ding0918/KShell/releases/download/../../../../attacker/evil/releases/download/v1/a.apk',
          },
        ],
      })?.apkUrl,
    ).toBe('https://github.com/attacker/evil/releases/download/v1/a.apk');
  });

  it('keeps pre-release comparison antisymmetric for leading zeros and Object.prototype names', () => {
    expect(compareVersions('1.0.0-alpha.01', '1.0.0-alpha.1')).toBe(0);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.01')).toBe(0);
    expect(compareVersions('1.0.0-constructor.1', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-constructor.1')).toBe(1);
  });

  it('requires an ARM64 asset when fallbacks are disabled', () => {
    const arm = {tag_name: 'v0.0.1.11', assets: [
      {name: 'KShell-0.0.1.11-public-arm64-v8a.apk', browser_download_url: `${GH}/arm.apk`},
    ]};
    const other = {tag_name: 'v0.0.1.12', assets: [
      {name: 'KShell-0.0.1.12-public-universal.apk', browser_download_url: `${GH}/universal.apk`},
    ]};
    expect(parseLatestRelease(other, ['arm64-v8a'], true)).toBeNull();
    expect(parseLatestRelease(arm, ['arm64-v8a'], true)?.apkUrl).toBe(`${GH}/arm.apk`);
  });

  it('honors a device-derived asset preference (translation env -> universal)', () => {
    const release = {
      tag_name: 'v1.0.0',
      assets: [
        {name: 'ZShell-1.0.0-arm64-v8a-release.apk', browser_download_url: `${GH}/a.apk`, size: 2},
        {name: 'ZShell-1.0.0-universal-release.apk', browser_download_url: `${GH}/u.apk`, size: 1},
        {name: 'ZShell-1.0.0-x86_64-release.apk', browser_download_url: `${GH}/x.apk`, size: 3},
      ],
    };
    expect(parseLatestRelease(release, ['universal'])!.apkUrl).toBe(`${GH}/u.apk`);
    expect(parseLatestRelease(release, ['x86_64', 'universal'])!.apkUrl).toBe(`${GH}/x.apk`);
    expect(parseLatestRelease(release, ['armeabi-v7a', 'universal'])!.apkUrl).toBe(`${GH}/u.apk`);
  });
});
