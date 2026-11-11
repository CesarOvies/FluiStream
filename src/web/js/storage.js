/**
 * FluiStream — Storage Service (IndexedDB + LocalStorage)
 * Persistência local de listas, EPG, favoritos, histórico e configurações
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

    return new Promise((resolve, reject) => {
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

  // --- PLAYLIST CACHE ---
  async savePlaylist(playlistData) {
    await this.initPromise;
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction([STORE_PLAYLIST], 'readwrite');
        const store = tx.objectStore(STORE_PLAYLIST);
        store.put({ id: 'active', ...playlistData, updatedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    }

    try {
      // LocalStorage fallback (resumo reduzido se for grande)
      const light = {
        name: playlistData.name,
        epgUrl: playlistData.epgUrl,
        summary: playlistData.summary,
        itemsCount: playlistData.items?.length || 0
      };
      localStorage.setItem('fluistream_playlist_meta', JSON.stringify(light));
    } catch {
      // Quota exceeded
    }
  }

  async loadPlaylist() {
    await this.initPromise;
    if (this.db) {
      return new Promise((resolve) => {
        const tx = this.db.transaction([STORE_PLAYLIST], 'readonly');
        const store = tx.objectStore(STORE_PLAYLIST);
        const req = store.get('active');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    }
    return null;
  }

  // --- EPG CACHE ---
  async saveEpg(rawXml) {
    await this.initPromise;
    if (this.db && rawXml) {
      return new Promise((resolve) => {
        const tx = this.db.transaction([STORE_EPG], 'readwrite');
        const store = tx.objectStore(STORE_EPG);
        store.put({ id: 'active_xml', xml: rawXml, updatedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    }
  }

  async loadEpg() {
    await this.initPromise;
    if (this.db) {
      return new Promise((resolve) => {
        const tx = this.db.transaction([STORE_EPG], 'readonly');
        const store = tx.objectStore(STORE_EPG);
        const req = store.get('active_xml');
        req.onsuccess = () => resolve(req.result ? req.result.xml : null);
        req.onerror = () => resolve(null);
      });
    }
    return null;
  }

  // --- FAVORITOS (LocalStorage) ---
  getFavorites() {
    try {
      const data = localStorage.getItem('fluistream_favorites');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  saveFavorites(favorites) {
    try {
      localStorage.setItem('fluistream_favorites', JSON.stringify(favorites));
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
      const data = localStorage.getItem('fluistream_recents');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  addRecent(item) {
    if (!item || !item.url) return;
    try {
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
      localStorage.setItem('fluistream_recents', JSON.stringify(recents));
    } catch {
      // Ignore
    }
  }

  // --- CONFIGURAÇÕES ---
  getSettings() {
    try {
      const data = localStorage.getItem('fluistream_settings');
      return data ? JSON.parse(data) : {
        corsProxy: '',
        volume: 0.8,
        aspectRatio: 'auto',
        preferEmbeddedEpg: true
      };
    } catch {
      return { corsProxy: '', volume: 0.8, aspectRatio: 'auto', preferEmbeddedEpg: true };
    }
  }

  saveSettings(settings) {
    try {
      localStorage.setItem('fluistream_settings', JSON.stringify(settings));
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
    localStorage.removeItem('fluistream_favorites');
    localStorage.removeItem('fluistream_recents');
    localStorage.removeItem('fluistream_playlist_meta');
  }
}

export const storage = new StorageService();
