/**
 * FluiStream — Version & Auto-Update Service (Web & Desktop Bridge)
 * Padrão Cesar Ovies Engineering Standards
 */

export const APP_VERSION = '1.2.0';
export const GITHUB_REPO = 'CesarOvies/FluiStream';
export const VERSION_INFO = { version: APP_VERSION, repo: GITHUB_REPO };
export const UpdateChecker = {
  checkForUpdates: (currentVer) => checkForUpdate(currentVer)
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

export function selectReleaseAssets(assets) {
  let winDownloadUrl = null;
  let macDmgDownloadUrl = null;
  let macDmgAssetName = null;
  let apkDownloadUrl = null;
  let apkAssetName = null;
  let sha256SumsUrl = null;

  if (!Array.isArray(assets)) {
    return { winDownloadUrl, macDmgDownloadUrl, macDmgAssetName, apkDownloadUrl, apkAssetName, sha256SumsUrl };
  }

  for (const a of assets) {
    const name = a?.name || '';
    const url = a?.browser_download_url || null;
    if (!name || !url) continue;

    const lower = name.toLowerCase();
    if (name.toUpperCase() === 'SHA256SUMS.TXT') {
      sha256SumsUrl = url;
    } else if (!winDownloadUrl && lower.endsWith('.zip') && lower.includes('win-x64')) {
      winDownloadUrl = url;
    } else if (lower.endsWith('.dmg')) {
      if (!macDmgDownloadUrl || lower.includes('macos') || lower.includes('osx')) {
        macDmgDownloadUrl = url;
        macDmgAssetName = name;
      }
    } else if (lower.endsWith('.apk')) {
      if (!apkDownloadUrl || lower.includes('android')) {
        apkDownloadUrl = url;
        apkAssetName = name;
      }
    }
  }

  return { winDownloadUrl, macDmgDownloadUrl, macDmgAssetName, apkDownloadUrl, apkAssetName, sha256SumsUrl };
}

export function getCurrentVersion() {
  try {
    if (typeof window !== 'undefined') {
      const nativeVer = window.androidBridge?.getAppVersion?.() || window.__fluiAppVersion;
      if (typeof nativeVer === 'string' && nativeVer.trim()) {
        return nativeVer.trim().replace(/^[vV]/, '');
      }
    }
  } catch {
    // Ignore bridge access errors
  }
  return APP_VERSION;
}

export async function checkForUpdate(currentVer) {
  const resolvedCurrentVer = (typeof currentVer === 'string' && currentVer.trim())
    ? currentVer.trim().replace(/^[vV]/, '')
    : getCurrentVersion();

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

    if (!response.ok) return { available: false, hasUpdate: false };

    const data = await response.json();
    const latestTag = data.tag_name || '';
    const available = isNewerVersion(latestTag, resolvedCurrentVer);
    const { winDownloadUrl, macDmgDownloadUrl, macDmgAssetName, apkDownloadUrl, apkAssetName, sha256SumsUrl } = selectReleaseAssets(data.assets);

    return {
      available,
      hasUpdate: available,
      currentVersion: resolvedCurrentVer,
      latestVersion: latestTag.replace(/^[vV]/, ''),
      releaseNotes: data.body || '',
      releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
      downloadUrl: winDownloadUrl,
      macDmgDownloadUrl,
      macDmgAssetName,
      apkDownloadUrl,
      apkAssetName,
      sha256SumsUrl
    };
  } catch (err) {
    // Falha silenciosa em offline ou bloqueio de rede
    return { available: false, hasUpdate: false, error: err.message };
  }
}

