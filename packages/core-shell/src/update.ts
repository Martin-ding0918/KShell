/**
 * Update checking against GitHub Releases (public repo, no server needed).
 * Pure logic: version comparison + release JSON parsing. The app layer does
 * the network fetch and hands the parsed JSON here.
 */

export interface ReleaseInfo {
  /** Version without the leading "v", e.g. "0.0.1-alpha.3". */
  version: string;
  tag: string;
  notes: string;
  apkUrl: string;
  apkSize: number | null;
  /** Optional SHA-256 hex digest from GitHub release asset metadata. */
  apkSha256?: string | null;
  publishedAt: string | null;
}

interface AssetLike {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  digest?: unknown;
}

interface ReleaseLike {
  tag_name?: unknown;
  body?: unknown;
  published_at?: unknown;
  assets?: unknown;
}

const TRUSTED_UPDATE_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

/** Normalize and validate an official GitHub HTTPS release asset URL. */
function normalizeTrustedUpdateUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (
      url.protocol !== 'https:' ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      !TRUSTED_UPDATE_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

/** Only HTTPS URLs hosted on official GitHub release domains are accepted. */
export function isTrustedUpdateUrl(raw: string): boolean {
  return normalizeTrustedUpdateUrl(raw) != null;
}

const PRE_CHANNEL_RANK: ReadonlyMap<string, number> = new Map([
  ['alpha', 1],
  ['beta', 2],
  ['rc', 3],
]);

function tokenizePreRelease(raw: string): string[] {
  const parts = raw.toLowerCase().split('.');
  // Normalize compact channel identifiers such as "rc1" -> ["rc", "1"]
  // without inventing a ".0" for bare channels like "beta".
  const compact = /^(alpha|beta|rc)(\d+)$/.exec(parts[0]);
  if (compact != null) {
    return [compact[1], compact[2], ...parts.slice(1)];
  }
  return parts;
}

function comparePreRelease(aRaw: string, bRaw: string): number {
  const aParts = tokenizePreRelease(aRaw);
  const bParts = tokenizePreRelease(bRaw);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const pa = aParts[i];
    const pb = bParts[i];
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    if (pa === pb) continue;
    if (i === 0) {
      const ra = PRE_CHANNEL_RANK.get(pa) ?? 0;
      const rb = PRE_CHANNEL_RANK.get(pb) ?? 0;
      if (ra !== rb) {
        return ra > rb ? 1 : -1;
      }
    }
    const na = /^\d+$/.test(pa);
    const nb = /^\d+$/.test(pb);
    if (na && nb) {
      const numA = Number(pa);
      const numB = Number(pb);
      if (numA === numB) continue;
      return numA > numB ? 1 : -1;
    }
    if (na !== nb) {
      return na ? -1 : 1;
    }
    return pa > pb ? 1 : -1;
  }
  return 0;
}

/**
 * Compare dotted versions with an optional pre-release suffix
 * ("-alpha.N" / "-beta.N" / "-rc.N" / arbitrary SemVer pre-release).
 * Returns 1 when a is newer, -1 when b is newer, 0 when equal.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const withoutBuild = v.trim().replace(/^v/i, '').split('+')[0];
    const dash = withoutBuild.indexOf('-');
    const coreRaw = dash >= 0 ? withoutBuild.slice(0, dash) : withoutBuild;
    const preRaw = dash >= 0 ? withoutBuild.slice(dash + 1) : '';
    const core = coreRaw.split('.').map(p => (/^\d+$/.test(p) ? Number(p) : 0));
    return {core, pre: preRaw.length > 0 ? preRaw : null};
  };
  const va = parse(a);
  const vb = parse(b);
  for (let i = 0; i < Math.max(va.core.length, vb.core.length); i++) {
    const difference = (va.core[i] ?? 0) - (vb.core[i] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  // No pre-release beats any pre-release.
  if (va.pre == null && vb.pre == null) {
    return 0;
  }
  if (va.pre == null) {
    return 1;
  }
  if (vb.pre == null) {
    return -1;
  }
  return comparePreRelease(va.pre, vb.pre);
}

export function isNewer(current: string, release: ReleaseInfo): boolean {
  return compareVersions(release.version, current) > 0;
}

function parseSha256Digest(digest: unknown): string | null {
  if (typeof digest !== 'string') {
    return null;
  }
  const m = /^sha256:([0-9a-f]{64})$/i.exec(digest.trim());
  return m != null ? m[1].toLowerCase() : null;
}

/**
 * Pick the best APK asset: first match by the ordered preference tags
 * (default arm64-v8a then universal), else any APK (ABI split releases
 * upload several files). Only trusted HTTPS GitHub asset URLs are eligible.
 */
function pickApkAsset(
  assets: AssetLike[],
  prefer: readonly string[] = ['arm64-v8a', 'universal'],
  requirePreferred = false,
): AssetLike | null {
  const apks = assets.filter(
    a =>
      a != null &&
      typeof a === 'object' &&
      typeof a.name === 'string' &&
      (a.name as string).endsWith('.apk') &&
      typeof a.browser_download_url === 'string' &&
      isTrustedUpdateUrl(a.browser_download_url),
  );
  if (apks.length === 0) {
    return null;
  }
  for (const tag of prefer) {
    const hit = apks.find(a => (a.name as string).includes(tag));
    if (hit != null) {
      return hit;
    }
  }
  return requirePreferred ? null : apks[0];
}

/** Extract update info from a GitHub `releases/latest` response; null when unusable. */
export function parseLatestRelease(
  json: unknown,
  prefer?: readonly string[],
  requirePreferred = false,
): ReleaseInfo | null {
  if (json == null || typeof json !== 'object') {
    return null;
  }
  const rel = json as ReleaseLike;
  if (typeof rel.tag_name !== 'string' || rel.tag_name.length === 0) {
    return null;
  }
  const assets = Array.isArray(rel.assets) ? (rel.assets as AssetLike[]) : [];
  const apk = pickApkAsset(assets, prefer, requirePreferred);
  const apkUrl =
    typeof apk?.browser_download_url === 'string'
      ? normalizeTrustedUpdateUrl(apk.browser_download_url)
      : null;
  if (apk == null || apkUrl == null) {
    return null;
  }
  const apkSha256 = parseSha256Digest(apk.digest);
  return {
    version: rel.tag_name.replace(/^v/i, ''),
    tag: rel.tag_name,
    notes: typeof rel.body === 'string' ? rel.body : '',
    apkUrl,
    apkSize: typeof apk.size === 'number' ? apk.size : null,
    ...(apkSha256 != null ? {apkSha256} : {}),
    publishedAt: typeof rel.published_at === 'string' ? rel.published_at : null,
  };
}
