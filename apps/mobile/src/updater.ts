import {
  parseLatestRelease,
  pickLatestRelease,
  ReleaseInfo,
} from '@zshell/core-shell';

const REPOSITORY = 'Martin-ding0918/KShell';
const RELEASES = `https://api.github.com/repos/${REPOSITORY}/releases`;
const ARM64_ONLY = ['arm64-v8a'];
export const PROJECT_PAGE = `https://github.com/${REPOSITORY}`;

export type UpdateChannel = 'stable' | 'beta';

async function getJson(url: string): Promise<unknown | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      headers: {Accept: 'application/vnd.github+json'},
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Latest usable release for a channel. Stable reads `releases/latest`
 * (GitHub excludes pre-releases there); beta reads the release list, which
 * includes them, and picks the highest version.
 */
export async function fetchLatestRelease(
  channel: UpdateChannel = 'stable',
): Promise<ReleaseInfo | null> {
  if (channel === 'beta') {
    return pickLatestRelease(await getJson(`${RELEASES}?per_page=15`), ARM64_ONLY, true);
  }
  return parseLatestRelease(await getJson(`${RELEASES}/latest`), ARM64_ONLY, true);
}
