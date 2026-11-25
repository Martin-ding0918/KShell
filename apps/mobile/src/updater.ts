import {parseLatestRelease, ReleaseInfo} from '@zshell/core-shell';

const REPOSITORY = 'Martin-ding0918/KShell';
const RELEASES = `https://api.github.com/repos/${REPOSITORY}/releases`;
const ARM64_ONLY = ['arm64-v8a'];
export const PROJECT_PAGE = `https://github.com/${REPOSITORY}`;

async function getJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {Accept: 'application/vnd.github+json'},
      signal: controller.signal,
    });
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Latest usable release: reads `releases/latest` (GitHub excludes
 * pre-releases there), so every install follows the stable channel.
 */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  const release = parseLatestRelease(await getJson(`${RELEASES}/latest`), ARM64_ONLY, true);
  if (release == null) {
    return null;
  }
  const expectedPrefix = `https://github.com/${REPOSITORY}/releases/download/`;
  if (!release.apkUrl.startsWith(expectedPrefix)) {
    return null;
  }
  return release;
}
