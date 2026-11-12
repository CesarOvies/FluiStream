/**
 * FluiStream — Version & Auto-Update Service (Web & Desktop Bridge)
 * Padrão Cesar Ovies Engineering Standards
 */

export const APP_VERSION = '1.1.0';
export const GITHUB_REPO = 'CesarOvies/FluiStream';
export const VERSION_INFO = { version: APP_VERSION, repo: GITHUB_REPO };
export const UpdateChecker = {
  checkForUpdates: (currentVer = APP_VERSION) => checkForUpdate(currentVer)
};

export function parseCleanVersion(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.trim().replace(/^[vV]/, '').split(/[-+]/)[0];
  const parts = clean.split('.').map(x => parseInt(x, 10));
  if (parts.some(isNaN)) return null;
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0
  };
}

export function isNewerVersion(latestTag, currentVer = APP_VERSION) {
  const latest = parseCleanVersion(latestTag);
  const current = parseCleanVersion(currentVer);
  if (!latest || !current) return false;

  if (latest.major > current.major) return true;
  if (latest.major === current.major && latest.minor > current.minor) return true;
  if (latest.major === current.major && latest.minor === current.minor && latest.patch > current.patch) return true;
  return false;
}

export async function checkForUpdate(currentVer = APP_VERSION) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    clearTimeout(timeoutId);

    if (!response.ok) return { available: false };

    const data = await response.json();
    const latestTag = data.tag_name || '';
    const available = isNewerVersion(latestTag, currentVer);

    let winDownloadUrl = null;
    if (data.assets && Array.isArray(data.assets)) {
      const asset = data.assets.find(a => a.name && a.name.endsWith('.zip') && a.name.includes('win-x64'));
      if (asset) winDownloadUrl = asset.browser_download_url;
    }

    return {
      available,
      currentVersion: currentVer,
      latestVersion: latestTag.replace(/^[vV]/, ''),
      releaseNotes: data.body || '',
      releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
      downloadUrl: winDownloadUrl
    };
  } catch (err) {
    // Falha silenciosa em offline ou bloqueio de rede
    return { available: false, error: err.message };
  }
}

