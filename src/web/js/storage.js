/**
 * FluiStream — Storage Service (IndexedDB + LocalStorage)
 * Persistência local multi-perfil de listas, EPG, favoritos, histórico e configurações
 */

const DB_NAME = 'FluiStreamDB';
const DB_VERSION = 1;
const STORE_PLAYLIST = 'playlist';
const STORE_EPG = 'epg';

export class StorageService {
  constructor() {
    this.db = null;
    this.initPromise = this.initDB();
  }

  async initDB() {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return null;
    }

    return new Promise((resolve) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_PLAYLIST)) {
          db.createObjectStore(STORE_PLAYLIST, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_EPG)) {
          db.createObjectStore(STORE_EPG, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.warn('IndexedDB unavailable, falling back to localStorage', event.target.error);
        resolve(null);
      };
    });
  }

  // --- PERFIS (MULTI-PLAYLIST) ---
  getProfiles() {
    try {
      const data = localStorage.getItem('fluistream_profiles');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  saveProfiles(profiles) {
    try {
      localStorage.setItem('fluistream_profiles', JSON.stringify(profiles));
    } catch {
      // Ignore
    }
  }

  getActiveProfileId() {
    try {
      return localStorage.getItem('fluistream_active_profile_id') || null;
    } catch {
      return null;
    }
  }

  setActiveProfileId(id) {
    try {
      if (id) {
        localStorage.setItem('fluistream_active_profile_id', id);
      } else {
        localStorage.removeItem('fluistream_active_profile_id');
      }
    } catch {
      // Ignore
    }
  }

  getActiveProfile() {
    const profiles = this.getProfiles();
    const activeId = this.getActiveProfileId();
    if (activeId) {
      const found = profiles.find(p => p.id === activeId);
      if (found) return found;
    }
    return profiles[0] || null;
  }

  saveProfile(profile) {
    if (!profile || !profile.id) return;
    const profiles = this.getProfiles();
    const idx = profiles.findIndex(p => p.id === profile.id);
    if (idx >= 0) {
      profiles[idx] = { ...profiles[idx], ...profile, updatedAt: Date.now() };
    } else {
      profiles.push({ ...profile, createdAt: profile.createdAt || Date.now(), updatedAt: Date.now() });
    }
    this.saveProfiles(profiles);
    if (!this.getActiveProfileId() || profiles.length === 1) {
      this.setActiveProfileId(profile.id);
    }
  }

  async deleteProfile(profileId) {
    const profiles = this.getProfiles().filter(p => p.id !== profileId);
    this.saveProfiles(profiles);

    if (this.getActiveProfileId() === profileId) {
      const nextActive = profiles[0] ? profiles[0].id : null;
      this.setActiveProfileId(nextActive);
    }

    await this.initPromise;
    if (this.db) {
      const tx = this.db.transaction([STORE_PLAYLIST, STORE_EPG], 'readwrite');
      tx.objectStore(STORE_PLAYLIST).delete(profileId);
      tx.objectStore(STORE_EPG).delete(`epg_${profileId}`);
    }
  }

  // --- PLAYLIST CACHE (POR PERFIL) ---
  async savePlaylist(playlistData, profileId = null) {
    await this.initPromise;
    const targetKey = profileId || this.getActiveProfileId() || 'active';

    if (this.db) {
      return new Promise((resolve) => {
        const tx = this.db.transaction([STORE_PLAYLIST], 'readwrite');
        const store = tx.objectStore(STORE_PLAYLIST);
        store.put({ id: targetKey, ...playlistData, updatedAt: Date.now() });
        // Mantém 'active' em sincronia para compatibilidade
        if (targetKey !== 'active') {
          store.put({ id: 'active', ...playlistData, updatedAt: Date.now() });
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    }

    try {
      const light = {
        name: playlistData.name,
        epgUrl: playlistData.epgUrl,
        summary: playlistData.summary,
        itemsCount: playlistData.items?.length || 0
      };
      localStorage.setItem(`fluistream_playlist_meta_${targetKey}`, JSON.stringify(light));
    } catch {
      // Quota exceeded
    }
  }

  async loadPlaylist(profileId = null) {
    await this.initPromise;
    const targetKey = profileId || this.getActiveProfileId() || 'active';

    if (this.db) {
      return new Promise((resolve) => {
        const tx = this.db.transaction([STORE_PLAYLIST], 'readonly');
        const store = tx.objectStore(STORE_PLAYLIST);
        const req = store.get(targetKey);
        req.onsuccess = () => {
          if (req.result) {
            resolve(req.result);
          } else if (targetKey !== 'active') {
            // Fallback para chave 'active'
            const fallbackReq = store.get('active');
            fallbackReq.onsuccess = () => resolve(fallbackReq.result || null);
            fallbackReq.onerror = () => resolve(null);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    }
    return null;
  }

  // --- EPG CACHE (POR PERFIL) ---
  async saveEpg(rawXml, profileId = null) {
    await this.initPromise;
    if (!rawXml) return;
    const targetKey = profileId ? `epg_${profileId}` : (this.getActiveProfileId() ? `epg_${this.getActiveProfileId()}` : 'active_xml');

    if (this.db) {
      return new Promise((resolve) => {
        const tx = this.db.transaction([STORE_EPG], 'readwrite');
        const store = tx.objectStore(STORE_EPG);
        store.put({ id: targetKey, xml: rawXml, updatedAt: Date.now() });
        if (targetKey !== 'active_xml') {
          store.put({ id: 'active_xml', xml: rawXml, updatedAt: Date.now() });
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    }
  }

  async loadEpg(profileId = null) {
    await this.initPromise;
    const targetKey = profileId ? `epg_${profileId}` : (this.getActiveProfileId() ? `epg_${this.getActiveProfileId()}` : 'active_xml');

    if (this.db) {
      return new Promise((resolve) => {
        const tx = this.db.transaction([STORE_EPG], 'readonly');
        const store = tx.objectStore(STORE_EPG);
        const req = store.get(targetKey);
        req.onsuccess = () => {
          if (req.result && req.result.xml) {
            resolve(req.result.xml);
          } else if (targetKey !== 'active_xml') {
            const fb = store.get('active_xml');
            fb.onsuccess = () => resolve(fb.result ? fb.result.xml : null);
            fb.onerror = () => resolve(null);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    }
    return null;
  }

  // --- FAVORITOS (LocalStorage) ---
  getFavorites() {
    try {
      const activeId = this.getActiveProfileId() || 'default';
      const data = localStorage.getItem(`fluistream_favorites_${activeId}`) || localStorage.getItem('fluistream_favorites');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  saveFavorites(favorites) {
    try {
      const activeId = this.getActiveProfileId() || 'default';
      localStorage.setItem(`fluistream_favorites_${activeId}`, JSON.stringify(favorites));
    } catch {
      // Ignore
    }
  }

  toggleFavorite(itemId) {
    const list = this.getFavorites();
    const idx = list.indexOf(itemId);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push(itemId);
    }
    this.saveFavorites(list);
    return list.includes(itemId);
  }

  isFavorite(itemId) {
    const list = this.getFavorites();
    return list.includes(itemId);
  }

  // --- RECENTES ---
  getRecents() {
    try {
      const activeId = this.getActiveProfileId() || 'default';
      const data = localStorage.getItem(`fluistream_recents_${activeId}`) || localStorage.getItem('fluistream_recents');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  addRecent(item) {
    if (!item || !item.url) return;
    try {
      const activeId = this.getActiveProfileId() || 'default';
      let recents = this.getRecents();
      recents = recents.filter(x => x.url !== item.url);
      recents.unshift({
        id: item.id,
        name: item.name,
        logo: item.logo,
        group: item.group,
        type: item.type,
        url: item.url,
        playedAt: Date.now()
      });
      if (recents.length > 30) recents = recents.slice(0, 30);
      localStorage.setItem(`fluistream_recents_${activeId}`, JSON.stringify(recents));
    } catch {
      // Ignore
    }
  }

  // --- CONFIGURAÇÕES DO PERFIL / APLICAÇÃO ---
  getSettings() {
    try {
      const activeProfile = this.getActiveProfile();
      const globalData = localStorage.getItem('fluistream_settings');
      const globalCfg = globalData ? JSON.parse(globalData) : {};

      return {
        corsProxy: activeProfile?.corsProxy ?? globalCfg.corsProxy ?? '',
        volume: globalCfg.volume ?? 0.8,
        aspectRatio: globalCfg.aspectRatio ?? 'auto',
        streamMode: activeProfile?.streamMode ?? globalCfg.streamMode ?? 'auto',
        playerEngine: activeProfile?.playerEngine ?? globalCfg.playerEngine ?? 'vlc',
        preferEmbeddedEpg: activeProfile?.preferEmbeddedEpg ?? globalCfg.preferEmbeddedEpg ?? true
      };
    } catch {
      return { corsProxy: '', volume: 0.8, aspectRatio: 'auto', streamMode: 'auto', playerEngine: 'vlc', preferEmbeddedEpg: true };
    }
  }

  saveSettings(settings) {
    try {
      localStorage.setItem('fluistream_settings', JSON.stringify(settings));
      // Se há perfil ativo, sincroniza configurações individuais do perfil
      const activeProfile = this.getActiveProfile();
      if (activeProfile) {
        if (settings.streamMode) activeProfile.streamMode = settings.streamMode;
        if (settings.playerEngine) activeProfile.playerEngine = settings.playerEngine;
        if (settings.corsProxy !== undefined) activeProfile.corsProxy = settings.corsProxy;
        this.saveProfile(activeProfile);
      }
    } catch {
      // Ignore
    }
  }

  // --- LIMPAR TUDO ---
  async clearAll() {
    await this.initPromise;
    if (this.db) {
      const tx = this.db.transaction([STORE_PLAYLIST, STORE_EPG], 'readwrite');
      tx.objectStore(STORE_PLAYLIST).clear();
      tx.objectStore(STORE_EPG).clear();
    }
    localStorage.removeItem('fluistream_profiles');
    localStorage.removeItem('fluistream_active_profile_id');
    localStorage.removeItem('fluistream_favorites');
    localStorage.removeItem('fluistream_recents');
    localStorage.removeItem('fluistream_playlist_meta');
  }
}

export const storage = new StorageService();
