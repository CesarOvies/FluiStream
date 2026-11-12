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
    const existing = idx >= 0 ? profiles[idx] : null;
    const normalized = { ...profile };

    if (normalized.type === 'xtream') {
      const server = (normalized.serverUrl !== existing?.serverUrl ? normalized.serverUrl : undefined)
        ?? (normalized.url !== existing?.url ? normalized.url : undefined)
        ?? (normalized.xtreamServer !== existing?.xtreamServer ? normalized.xtreamServer : undefined)
        ?? normalized.serverUrl
        ?? normalized.url
        ?? normalized.xtreamServer
        ?? normalized.accountInfo?.serverUrl
        ?? '';
      const user = (normalized.username !== existing?.username ? normalized.username : undefined)
        ?? (normalized.xtreamUser !== existing?.xtreamUser ? normalized.xtreamUser : undefined)
        ?? normalized.username
        ?? normalized.xtreamUser
        ?? normalized.accountInfo?.username
        ?? '';
      const pass = (normalized.password !== existing?.password ? normalized.password : undefined)
        ?? (normalized.xtreamPass !== existing?.xtreamPass ? normalized.xtreamPass : undefined)
        ?? normalized.password
        ?? normalized.xtreamPass
        ?? normalized.accountInfo?.password
        ?? '';

      normalized.url = server;
      normalized.serverUrl = server;
      normalized.xtreamServer = server;
      normalized.username = user;
      normalized.xtreamUser = user;
      normalized.password = pass;
      normalized.xtreamPass = pass;

      if (normalized.accountInfo || server || user) {
        normalized.accountInfo = {
          ...(normalized.accountInfo || {}),
          username: user || normalized.accountInfo?.username || '',
          serverUrl: server || normalized.accountInfo?.serverUrl || ''
        };
      }
    }

    if (normalized.epgUrl === undefined && normalized.externalEpgUrl !== undefined) {
      normalized.epgUrl = normalized.externalEpgUrl;
    }

    if (idx >= 0) {
      profiles[idx] = { ...existing, ...normalized, updatedAt: Date.now() };
    } else {
      profiles.push({ ...normalized, createdAt: normalized.createdAt || Date.now(), updatedAt: Date.now() });
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
  getHistoryLimit() {
    const raw = parseInt(this.getSettings()?.historyLimit, 10);
    return Number.isFinite(raw) ? Math.max(1, Math.min(500, raw)) : 30;
  }

  getRecents() {
    try {
      const activeId = this.getActiveProfileId() || 'default';
      const data = localStorage.getItem(`fluistream_recents_${activeId}`) || localStorage.getItem('fluistream_recents');
      const list = data ? JSON.parse(data) : [];
      if (!Array.isArray(list)) return [];
      const limit = this.getHistoryLimit();
      return list.slice(0, limit);
    } catch {
      return [];
    }
  }

  addRecent(item) {
    if (!item || !item.url) return;
    try {
      const activeId = this.getActiveProfileId() || 'default';
      const limit = this.getHistoryLimit();
      const raw = localStorage.getItem(`fluistream_recents_${activeId}`) || localStorage.getItem('fluistream_recents');
      let recents = [];
      try { recents = raw ? JSON.parse(raw) : []; } catch { recents = []; }
      if (!Array.isArray(recents)) recents = [];
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
      if (recents.length > limit) recents = recents.slice(0, limit);
      localStorage.setItem(`fluistream_recents_${activeId}`, JSON.stringify(recents));
    } catch {
      // Ignore
    }
  }

  clearRecents(includeProgress = true) {
    try {
      const activeId = this.getActiveProfileId() || 'default';
      localStorage.removeItem(`fluistream_recents_${activeId}`);
      localStorage.removeItem('fluistream_recents');
      if (includeProgress && typeof localStorage !== 'undefined') {
        const keys = [];
        if (typeof localStorage.length === 'number' && typeof localStorage.key === 'function') {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('fluistream_watch_progress_')) keys.push(k);
          }
        } else {
          for (const k of Object.keys(localStorage)) {
            if (k.startsWith('fluistream_watch_progress_')) keys.push(k);
          }
        }
        for (const k of keys) localStorage.removeItem(k);
      }
    } catch {
      // Ignore
    }
  }

  // --- FONTES EPG (MULTI-SOURCE POR PERFIL) ---
  getEpgSources(profileId = null) {
    try {
      const targetId = profileId || this.getActiveProfileId() || 'default';
      const data = localStorage.getItem(`fluistream_epg_sources_${targetId}`);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  saveEpgSources(sources, profileId = null) {
    try {
      const targetId = profileId || this.getActiveProfileId() || 'default';
      localStorage.setItem(`fluistream_epg_sources_${targetId}`, JSON.stringify(Array.isArray(sources) ? sources : []));
    } catch {
      // Ignore
    }
  }

  // --- NOTIFICAÇÕES ---
  getNotifications() {
    try {
      const data = localStorage.getItem('fluistream_notifications');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  addNotification(n) {
    if (!n || typeof n !== 'object') return null;
    try {
      const list = this.getNotifications();
      const entry = {
        id: n.id || `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: n.type || 'info',
        title: n.title || '',
        message: n.message || '',
        read: Boolean(n.read),
        createdAt: n.createdAt || Date.now(),
        ...n
      };
      list.unshift(entry);
      if (list.length > 50) list.length = 50;
      localStorage.setItem('fluistream_notifications', JSON.stringify(list));
      return entry;
    } catch {
      return null;
    }
  }

  clearNotifications() {
    try {
      localStorage.removeItem('fluistream_notifications');
    } catch {
      // Ignore
    }
  }

  // --- PROGRESSO DE REPRODUÇÃO (CONTINUAR ASSISTINDO) ---
  getWatchProgress(itemId) {
    if (!itemId) return null;
    try {
      const data = localStorage.getItem(`fluistream_watch_progress_${itemId}`);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  saveWatchProgress(itemId, posSec, durSec) {
    if (!itemId) return null;
    try {
      const pos = Math.max(0, Number(posSec) || 0);
      const dur = Math.max(0, Number(durSec) || 0);
      const percent = dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0;
      const entry = {
        itemId,
        posSec: pos,
        durSec: dur,
        percent,
        updatedAt: Date.now()
      };
      localStorage.setItem(`fluistream_watch_progress_${itemId}`, JSON.stringify(entry));
      return entry;
    } catch {
      return null;
    }
  }

  // --- CONFIGURAÇÕES DO PERFIL / APLICAÇÃO ---
  getSettings() {
    const defaults = {
      corsProxy: '',
      volume: 0.8,
      aspectRatio: 'auto',
      streamMode: 'auto',
      playerEngine: 'vlc',
      preferEmbeddedEpg: true,
      timeFormat: '24h',
      deviceMode: 'auto',
      autoRefresh: false,
      autoPlayNext: true,
      epgTimeshift: 0,
      historyLimit: 30,
      parentalPinHash: ''
    };
    try {
      const activeProfile = this.getActiveProfile();
      const globalData = localStorage.getItem('fluistream_settings');
      const globalCfg = globalData ? JSON.parse(globalData) : {};
      const parsedLimit = parseInt(globalCfg.historyLimit, 10);

      return {
        corsProxy: activeProfile?.corsProxy ?? globalCfg.corsProxy ?? defaults.corsProxy,
        volume: globalCfg.volume ?? defaults.volume,
        aspectRatio: globalCfg.aspectRatio ?? defaults.aspectRatio,
        streamMode: activeProfile?.streamMode ?? globalCfg.streamMode ?? defaults.streamMode,
        playerEngine: activeProfile?.playerEngine ?? globalCfg.playerEngine ?? defaults.playerEngine,
        preferEmbeddedEpg: activeProfile?.preferEmbeddedEpg ?? globalCfg.preferEmbeddedEpg ?? defaults.preferEmbeddedEpg,
        timeFormat: globalCfg.timeFormat ?? defaults.timeFormat,
        deviceMode: globalCfg.deviceMode ?? defaults.deviceMode,
        autoRefresh: globalCfg.autoRefresh ?? defaults.autoRefresh,
        autoPlayNext: globalCfg.autoPlayNext ?? defaults.autoPlayNext,
        epgTimeshift: globalCfg.epgTimeshift ?? defaults.epgTimeshift,
        historyLimit: Number.isFinite(parsedLimit) ? Math.max(1, Math.min(500, parsedLimit)) : defaults.historyLimit,
        parentalPinHash: globalCfg.parentalPinHash ?? defaults.parentalPinHash
      };
    } catch {
      return defaults;
    }
  }

  saveSettings(settings) {
    try {
      const merged = { ...this.getSettings(), ...(settings || {}) };
      if (merged.historyLimit !== undefined) {
        const n = parseInt(merged.historyLimit, 10);
        merged.historyLimit = Number.isFinite(n) ? Math.max(1, Math.min(500, n)) : 30;
      }
      localStorage.setItem('fluistream_settings', JSON.stringify(merged));
      if (settings?.historyLimit !== undefined) {
        const activeId = this.getActiveProfileId() || 'default';
        const raw = localStorage.getItem(`fluistream_recents_${activeId}`);
        if (raw) {
          try {
            const list = JSON.parse(raw);
            if (Array.isArray(list) && list.length > merged.historyLimit) {
              localStorage.setItem(`fluistream_recents_${activeId}`, JSON.stringify(list.slice(0, merged.historyLimit)));
            }
          } catch {}
        }
      }
      // Se há perfil ativo, sincroniza configurações individuais do perfil
      const activeProfile = this.getActiveProfile();
      if (activeProfile) {
        if (settings?.streamMode) activeProfile.streamMode = settings.streamMode;
        if (settings?.playerEngine) activeProfile.playerEngine = settings.playerEngine;
        if (settings?.corsProxy !== undefined) activeProfile.corsProxy = settings.corsProxy;
        this.saveProfile(activeProfile);
      }
      return merged;
    } catch {
      return null;
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

    const profileIds = this.getProfiles().map(p => p.id).filter(Boolean);
    const activeId = this.getActiveProfileId();
    if (activeId && !profileIds.includes(activeId)) profileIds.push(activeId);
    profileIds.push('default', 'active');

    for (const id of profileIds) {
      localStorage.removeItem(`fluistream_favorites_${id}`);
      localStorage.removeItem(`fluistream_recents_${id}`);
      localStorage.removeItem(`fluistream_playlist_meta_${id}`);
      localStorage.removeItem(`fluistream_epg_sources_${id}`);
    }

    localStorage.removeItem('fluistream_profiles');
    localStorage.removeItem('fluistream_active_profile_id');
    localStorage.removeItem('fluistream_favorites');
    localStorage.removeItem('fluistream_recents');
    localStorage.removeItem('fluistream_playlist_meta');
    localStorage.removeItem('fluistream_settings');
    localStorage.removeItem('fluistream_notifications');

    if (typeof localStorage !== 'undefined' && typeof localStorage.length === 'number' && typeof localStorage.key === 'function') {
      const dynamicPrefixes = [
        'fluistream_favorites_',
        'fluistream_recents_',
        'fluistream_playlist_meta_',
        'fluistream_epg_sources_',
        'fluistream_watch_progress_'
      ];
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && dynamicPrefixes.some(prefix => key.startsWith(prefix))) {
          toRemove.push(key);
        }
      }
      for (const key of toRemove) {
        localStorage.removeItem(key);
      }
    }
  }
}

export const storage = new StorageService();
