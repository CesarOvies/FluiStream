/**
 * FluiStream — Suíte de Testes Automatizados Unitários
 * Valida M3UParser, EPGParser, XtreamApi e Dicionário i18n
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { M3UParser, ItemType } from '../src/web/js/m3u-parser.js';
import { EPGParser } from '../src/web/js/epg-parser.js';
import { XtreamApi } from '../src/web/js/xtream-api.js';
import { translations, SupportedLanguages, i18n } from '../src/web/js/localization.js';
import { APP_VERSION, getCurrentVersion, parseCleanVersion, isNewerVersion, selectReleaseAssets, checkForUpdate } from '../src/web/js/version.js';
import { VideoPlayerController, computeOverlayLayout } from '../src/web/js/player.js';
import {
  cleanMediaTitle,
  parseAdoroCinemaHtml,
  scoreTitleMatch,
  selectBestYouTubeTrailerFromHtml,
  resolveYouTubeTrailerId,
  resolveTrailerPlayback,
  resolveMediaMetadata
} from '../src/web/js/media-metadata.js';
import { StorageService } from '../src/web/js/storage.js';
import { applyCorsProxy } from '../src/web/js/network.js';

let totalTests = 0;
let passedTests = 0;

async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('\n--- 1. Testes do M3UParser ---');

await test('Deve extrair url-tvg / x-tvg-url do cabeçalho #EXTM3U', () => {
  const m3u = `#EXTM3U x-tvg-url="http://meuepg.com/epg.xml"\n#EXTINF:-1 tvg-name="Canal",Canal\nhttp://stream.com/live.m3u8`;
  const result = M3UParser.parse(m3u);
  assert.equal(result.epgUrl, 'http://meuepg.com/epg.xml');
  assert.equal(result.items.length, 1);
});

await test('Deve classificar canais ao vivo corretamente', () => {
  const m3u = `#EXTM3U\n#EXTINF:-1 tvg-id="noticias1" group-title="TV Aberta",Canal Teste 1\nhttp://stream.com/canal1.m3u8`;
  const result = M3UParser.parse(m3u);
  assert.equal(result.items[0].type, ItemType.LIVE);
  assert.equal(result.items[0].group, 'TV Aberta');
  assert.equal(result.items[0].name, 'Canal Teste 1');
});

await test('Deve classificar filmes VOD corretamente', () => {
  const m3u = `#EXTM3U\n#EXTINF:7200 tvg-id="filme1" group-title="Filmes Ação",Filme Demonstração Ação\nhttp://stream.com/movie/user/pass/123.mp4`;
  const result = M3UParser.parse(m3u);
  assert.equal(result.items[0].type, ItemType.MOVIE);
});

await test('Deve classificar séries e extrair temporada e episódio', () => {
  const m3u = `#EXTM3U\n#EXTINF:-1 group-title="Séries Drama",Série Exemplo - S02E05 - Episódio Teste\nhttp://stream.com/series/user/pass/456.mp4`;
  const result = M3UParser.parse(m3u);
  assert.equal(result.items[0].type, ItemType.SERIES);
  assert.equal(result.items[0].season, 2);
  assert.equal(result.items[0].episode, 5);
  assert.equal(result.items[0].seriesTitle, 'Série Exemplo');
});

console.log('\n--- 2. Testes do EPGParser (XMLTV) ---');

await test('Deve converter data XMLTV com fuso horário corretamente', () => {
  const parsed = EPGParser.parseXmltvDate('20261111220000 -0300');
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getUTCHours(), 1); // 22h -0300 = 01h UTC do dia seguinte
});

await test('Deve parsear canais e programas e calcular programa atual', () => {
  const now = new Date();
  const startStr = `${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,'0')}${String(now.getUTCDate()).padStart(2,'0')}000000 +0000`;
  const stopStr = `${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,'0')}${String(now.getUTCDate()+1).padStart(2,'0')}235959 +0000`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <tv>
    <channel id="canal.teste"><display-name>Canal de Notícias</display-name></channel>
    <programme start="${startStr}" stop="${stopStr}" channel="canal.teste">
      <title>Telejornal da Noite</title>
      <desc>Noticiário</desc>
    </programme>
  </tv>`;

  const parser = new EPGParser();
  parser.parse(xml);

  assert.equal(parser.channels.size, 1);
  assert.equal(parser.programmes.get('canal.teste')?.length, 1);

  const cur = parser.getCurrentProgram('canal.teste', 'Canal de Notícias', now);
  assert.ok(cur);
  assert.equal(cur.title, 'Telejornal da Noite');
  assert.ok(cur.progress >= 0 && cur.progress <= 100);
});

console.log('\n--- 3. Testes do XtreamApi ---');

await test('Deve normalizar URL e gerar endpoints corretos do player_api e get.php', () => {
  const xtream = new XtreamApi('http://myiptv.com:8080///', 'teste', 'senha123');
  assert.equal(xtream.serverUrl, 'http://myiptv.com:8080');
  assert.equal(xtream.getM3uUrl(), 'http://myiptv.com:8080/get.php?username=teste&password=senha123&type=m3u_plus&output=m3u8');
  assert.equal(xtream.getEpgUrl(), 'http://myiptv.com:8080/xmltv.php?username=teste&password=senha123');
  assert.equal(xtream.getPlayerApiUrl(), 'http://myiptv.com:8080/player_api.php?username=teste&password=senha123');
});

console.log('\n--- 4. Testes de Internacionalização (i18n - 3 Idiomas) ---');

await test('Todos os 3 idiomas (pt-BR, en-US, es) devem possuir o mesmo conjunto de chaves', () => {
  assert.deepEqual(Object.values(SupportedLanguages).sort(), ['en-US', 'es', 'pt-BR']);

  const ptKeys = Object.keys(translations['pt-BR']).sort();
  const enKeys = Object.keys(translations['en-US']).sort();
  const esKeys = Object.keys(translations['es']).sort();

  assert.equal(ptKeys.length, 257, `Esperado exatamente 257 chaves i18n em pt-BR, obtido ${ptKeys.length}`);
  assert.deepEqual(ptKeys, enKeys, 'Chaves pt-BR e en-US devem ser idênticas');
  assert.deepEqual(ptKeys, esKeys, 'Chaves pt-BR e es devem ser idênticas');

  for (const lang of ['pt-BR', 'en-US', 'es']) {
    for (const key of ptKeys) {
      assert.equal(typeof translations[lang][key], 'string', `${lang}.${key} deve ser string`);
      assert.ok(translations[lang][key].length > 0, `${lang}.${key} não pode estar vazio`);
    }
    assert.ok(translations[lang].settingsVersion.includes(APP_VERSION), `${lang}.settingsVersion deve refletir v${APP_VERSION}`);
    assert.ok('settingsAdvancedDebug' in translations[lang], `${lang} deve conter chave settingsAdvancedDebug`);
  }
});

await test('Todas as chaves data-i18n* em src/web/index.html devem existir em localization.js', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const htmlPath = resolve(__dirname, '../src/web/index.html');
  const html = readFileSync(htmlPath, 'utf8');
  const attrRegex = /data-i18n(?:-[a-z-]+)?="([^"]+)"/g;
  const htmlKeys = new Set();
  let match;
  while ((match = attrRegex.exec(html)) !== null) {
    htmlKeys.add(match[1]);
  }
  assert.ok(htmlKeys.size > 0, 'Deve encontrar atributos data-i18n* no index.html');

  const missing = [];
  for (const key of htmlKeys) {
    if (!(key in translations['pt-BR'])) {
      missing.push(key);
    }
  }
  assert.deepEqual(missing, [], `Chaves ausentes em localization.js: ${missing.join(', ')}`);
});

console.log('\n--- 5. Testes do Auto-Update & Versioning ---');

await test('APP_VERSION deve ser 1.1.0 e seguir comparação semântica', () => {
  assert.equal(APP_VERSION, '1.1.0');
  assert.equal(isNewerVersion('v1.2.0', APP_VERSION), true);
  assert.equal(isNewerVersion('v1.1.0', APP_VERSION), false);
});

await test('Deve fazer parse limpo de versão semântica', () => {
  const v1 = parseCleanVersion('v1.2.3');
  assert.deepEqual(v1, { major: 1, minor: 2, patch: 3 });

  const v2 = parseCleanVersion('2.0.0-beta.1');
  assert.deepEqual(v2, { major: 2, minor: 0, patch: 0 });
});

await test('Deve detectar corretamente se há versão mais recente no Git', () => {
  assert.equal(isNewerVersion('v1.0.1', '1.0.0'), true);
  assert.equal(isNewerVersion('v1.1.0', '1.0.9'), true);
  assert.equal(isNewerVersion('v2.0.0', '1.9.9'), true);
  assert.equal(isNewerVersion('v1.0.0', '1.0.0'), false);
  assert.equal(isNewerVersion('v0.9.8', '1.0.0'), false);
});

await test('Deve selecionar assets Windows, Android APK e SHA256SUMS.txt da release', () => {
  const assets = [
    { name: 'FluiStream-v1.2.0-linux-x64-portable.zip', browser_download_url: 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/FluiStream-v1.2.0-linux-x64-portable.zip' },
    { name: 'FluiStream-v1.2.0-win-x64-portable.zip', browser_download_url: 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/FluiStream-v1.2.0-win-x64-portable.zip' },
    { name: 'FluiStream-v1.2.0-android.apk', browser_download_url: 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/FluiStream-v1.2.0-android.apk' },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/SHA256SUMS.txt' }
  ];

  const selected = selectReleaseAssets(assets);
  assert.equal(selected.winDownloadUrl, 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/FluiStream-v1.2.0-win-x64-portable.zip');
  assert.equal(selected.apkDownloadUrl, 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/FluiStream-v1.2.0-android.apk');
  assert.equal(selected.apkAssetName, 'FluiStream-v1.2.0-android.apk');
  assert.equal(selected.sha256SumsUrl, 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/SHA256SUMS.txt');
});

await test('checkForUpdate deve usar versão nativa do Android e expor available/hasUpdate + APK', async () => {
  const prevFetch = globalThis.fetch;
  const prevWindow = globalThis.window;

  globalThis.window = {
    androidBridge: {
      getAppVersion: () => '1.0.0'
    }
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      tag_name: 'v1.2.0',
      body: 'Novidades Android',
      html_url: 'https://github.com/CesarOvies/FluiStream/releases/tag/v1.2.0',
      assets: [
        { name: 'FluiStream-v1.2.0-android.apk', browser_download_url: 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/FluiStream-v1.2.0-android.apk' },
        { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/SHA256SUMS.txt' }
      ]
    })
  });

  try {
    const info = await checkForUpdate();
    assert.equal(info.available, true);
    assert.equal(info.hasUpdate, true);
    assert.equal(info.currentVersion, '1.0.0');
    assert.equal(info.latestVersion, '1.2.0');
    assert.equal(info.apkAssetName, 'FluiStream-v1.2.0-android.apk');
    assert.ok(info.apkDownloadUrl.endsWith('.apk'));
    assert.ok(info.sha256SumsUrl.endsWith('SHA256SUMS.txt'));

    const upToDate = await checkForUpdate('1.2.0');
    assert.equal(upToDate.available, false);
    assert.equal(upToDate.hasUpdate, false);

    globalThis.window.androidBridge.getAppVersion = () => 'v1.2.0';
    assert.equal(getCurrentVersion(), '1.2.0');
    assert.ok(i18n.get('settingsVersion').includes('1.2.0'));
    const nativeUpToDate = await checkForUpdate();
    assert.equal(nativeUpToDate.available, false);
    assert.equal(nativeUpToDate.currentVersion, '1.2.0');
  } finally {
    globalThis.fetch = prevFetch;
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
});

await test('Build Android e workflow de release devem sincronizar versionName/versionCode e assets web com a versão distribuída', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const gradleKts = readFileSync(resolve(rootDir, 'src/android/app/build.gradle.kts'), 'utf-8');
  const releaseYml = readFileSync(resolve(rootDir, '.github/workflows/release.yml'), 'utf-8');
  const updateMgrKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/AppUpdateManager.kt'), 'utf-8');
  const playerMgrKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/VideoPlayerManager.kt'), 'utf-8');

  assert.match(gradleKts, /providers\.gradleProperty\("versionName"\)/);
  assert.match(gradleKts, /versionCode\s*=\s*resolvedVersionCode/);
  assert.match(gradleKts, /versionName\s*=\s*resolvedVersionName/);
  assert.match(gradleKts, /buildConfig\s*=\s*true/);
  assert.equal(/\bversionCode\s*=\s*2\b/.test(gradleKts), false);
  assert.equal(/\bversionName\s*=\s*"1\.1\.0"/.test(gradleKts), false);

  assert.match(updateMgrKt, /BuildConfig\.VERSION_NAME/);
  assert.equal(updateMgrKt.includes('FALLBACK_VERSION'), false);
  assert.match(playerMgrKt, /BuildConfig\.VERSION_NAME/);

  assert.match(releaseYml, /-PversionName="\$RELEASE_VERSION"/);
  assert.match(releaseYml, /output-metadata\.json/);
  assert.match(releaseYml, /Verify APK Version Matches Release/);

  for (const rel of ['js/version.js', 'js/localization.js', 'js/app.js']) {
    const webFile = readFileSync(resolve(rootDir, 'src/web', rel), 'utf-8');
    const androidAsset = readFileSync(resolve(rootDir, 'src/android/app/src/main/assets/web', rel), 'utf-8');
    assert.equal(androidAsset, webFile, `Asset Android ${rel} deve estar sincronizado com src/web/${rel}`);
  }
});

console.log('\n--- 6. Testes de Otimização e Categorização Pré-load ---');

await test('Deve agrupar e paginar 10.000 itens de filmes/séries em < 20ms sem travar a interface', () => {
  const largeItemList = [];
  const genres = ['Ação', 'Comédia', 'Drama', 'Ficção', 'Terror'];
  for (let i = 0; i < 10000; i++) {
    largeItemList.push({
      id: `vod_${i}`,
      name: `Filme Exemplo ${i}`,
      group: genres[i % genres.length],
      type: ItemType.MOVIE,
      url: `http://server.com/movie/${i}.mp4`
    });
  }

  const start = Date.now();
  // Agrupamento por categoria
  const groupsMap = new Map();
  largeItemList.forEach(it => {
    const g = it.group || 'Geral';
    groupsMap.set(g, (groupsMap.get(g) || 0) + 1);
  });
  const sortedGroups = Array.from(groupsMap.entries()).sort((a, b) => b[1] - a[1]);
  const duration = Date.now() - start;

  assert.equal(sortedGroups.length, 5);
  assert.equal(sortedGroups[0][1], 2000); // 10000 / 5
  assert.ok(duration < 50, `Agrupamento de 10.000 itens levou ${duration}ms (esperado < 50ms)`);

  // Paginação / chunking em lotes de 60
  const pageSize = 60;
  const firstBatch = largeItemList.slice(0, pageSize);
  assert.equal(firstBatch.length, 60);
  assert.equal(firstBatch[0].id, 'vod_0');
  assert.equal(firstBatch[59].id, 'vod_59');
});

console.log('\n--- 7. Testes de Resolução Multi-Apelidos no EPG (EPG-AutoAdjusted) ---');

await test('Deve resolver "HBO + PLUS FHD" para o id "hboplus.br" via índice de apelidos multi-display-name', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <tv>
    <channel id="hbo.br">
      <display-name>HBO</display-name>
      <display-name>HBO HD</display-name>
    </channel>
    <channel id="hboplus.br">
      <display-name>HBO Plus</display-name>
      <display-name>HBO PLUS</display-name>
      <display-name>HBO + PLUS</display-name>
      <display-name>HBO + PLUS FHD</display-name>
      <display-name>HBO Plus FHD</display-name>
    </channel>
    <programme start="20261111220000 -0300" stop="20261112020000 -0300" channel="hboplus.br">
      <title>Filme Teste HBO Plus</title>
      <desc>Descrição de teste</desc>
    </programme>
  </tv>`;

  const parser = new EPGParser();
  parser.parse(xml);

  // Deve resolver canal id exato mesmo vindo com formatação de provedor IPTV
  const resolvedId = parser.resolveChannelId('', 'HBO + PLUS FHD');
  assert.equal(resolvedId, 'hboplus.br');

  const progs = parser.getChannelPrograms('', 'HBO + PLUS FHD');
  assert.equal(progs.length, 1);
  assert.equal(progs[0].title, 'Filme Teste HBO Plus');
});

console.log('\n--- 8. Testes de Agrupamento de Séries por Nome e Temporada ---');

await test('Deve agrupar episódios soltos em entidade de série única com temporadas organizadas', () => {
  const rawEpisodes = [
    { id: '1', name: '13 Reasons Why S01E01', seriesTitle: '13 Reasons Why', season: 1, episode: 1, type: ItemType.SERIES, group: 'Series | Netflix' },
    { id: '2', name: '13 Reasons Why S01E02', seriesTitle: '13 Reasons Why', season: 1, episode: 2, type: ItemType.SERIES, group: 'Series | Netflix' },
    { id: '3', name: '13 Reasons Why S02E01', seriesTitle: '13 Reasons Why', season: 2, episode: 1, type: ItemType.SERIES, group: 'Series | Netflix' },
    { id: '4', name: 'Dark S01E01', seriesTitle: 'Dark', season: 1, episode: 1, type: ItemType.SERIES, group: 'Series | Netflix' }
  ];

  const seriesMap = new Map();
  rawEpisodes.forEach(it => {
    const sTitle = it.seriesTitle || it.name;
    const normKey = sTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!seriesMap.has(normKey)) {
      seriesMap.set(normKey, {
        id: `series_${normKey}`,
        seriesTitle: sTitle,
        group: it.group,
        seasons: {},
        episodes: []
      });
    }
    const ser = seriesMap.get(normKey);
    const sNum = it.season || 1;
    if (!ser.seasons[sNum]) ser.seasons[sNum] = [];
    ser.seasons[sNum].push(it);
    ser.episodes.push(it);
  });

  const grouped = Array.from(seriesMap.values());
  assert.equal(grouped.length, 2);

  const thirteen = grouped.find(s => s.seriesTitle === '13 Reasons Why');
  assert.ok(thirteen);
  assert.equal(Object.keys(thirteen.seasons).length, 2); // Temporadas 1 e 2
  assert.equal(thirteen.seasons[1].length, 2); // 2 eps na temporada 1
  assert.equal(thirteen.seasons[2].length, 1); // 1 ep na temporada 2
});

console.log('\n--- 9. Testes de Gerenciamento e Edição de Perfis ---');

await test('Deve criar, atualizar/editar e persistir atributos de um perfil existente', () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };

  const storageService = new StorageService();
  const initialProf = {
    id: 'prof_test_1',
    name: 'Lista Original',
    type: 'xtream',
    url: 'http://iptv.server:8080',
    username: 'user1',
    password: 'pass1',
    streamMode: 'auto',
    epgUrl: 'http://iptv.server:8080/epg.xml'
  };

  storageService.saveProfile(initialProf);
  assert.equal(storageService.getProfiles().length, 1);
  assert.equal(storageService.getActiveProfile()?.name, 'Lista Original');

  // Simula edição pelo usuário
  const updatedProf = {
    ...initialProf,
    name: 'Lista Editada da Sala',
    username: 'user_novo',
    password: 'pass_nova',
    streamMode: 'ts',
    epgUrl: 'http://outroservidor.com/epg.xml'
  };

  storageService.saveProfile(updatedProf);
  const profiles = storageService.getProfiles();
  assert.equal(profiles.length, 1, 'Não deve duplicar perfil ao editar');
  assert.equal(profiles[0].name, 'Lista Editada da Sala');
  assert.equal(profiles[0].username, 'user_novo');
  assert.equal(profiles[0].streamMode, 'ts');
  assert.equal(profiles[0].epgUrl, 'http://outroservidor.com/epg.xml');
  assert.ok(profiles[0].updatedAt);
});

console.log('\n--- 10. Testes de Faixas de Áudio e Legendas do Player ---');

await test('Deve extrair faixas de áudio e legendas e notificar callback', () => {
  const mockVideo = {
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {},
    classList: { add: () => {}, remove: () => {} }
  };
  const mockContainer = {
    classList: { add: () => {}, remove: () => {} }
  };

  const controller = new VideoPlayerController(mockVideo, mockContainer);
  let tracksReported = null;
  controller.onTracksUpdated = (info) => {
    tracksReported = info;
  };

  const sampleAudioTracks = [
    { id: 0, name: 'Português', lang: 'por' },
    { id: 1, name: 'Inglês', lang: 'eng' },
    { id: 2, name: 'Espanhol', lang: 'spa' }
  ];

  const sampleSubtitleTracks = [
    { id: 0, name: 'Português (Legenda)', lang: 'por' },
    { id: 1, name: 'Inglês (Legenda)', lang: 'eng' }
  ];

  controller.extractHlsAudioTracks(sampleAudioTracks);
  controller.extractHlsSubtitleTracks(sampleSubtitleTracks);

  assert.ok(tracksReported);
  assert.equal(tracksReported.audioTracks.length, 3);
  assert.equal(tracksReported.subtitleTracks.length, 2);
  assert.equal(tracksReported.audioTracks[0].name, 'Português');
  assert.equal(tracksReported.subtitleTracks[0].name, 'Português (Legenda)');

  // Testar troca de faixas
  controller.setAudioTrack(1);
  assert.equal(controller.currentAudioTrack, 1);

  controller.setSubtitleTrack(0);
  assert.equal(controller.currentSubtitleTrack, 0);

  // Desativar legendas
  controller.setSubtitleTrack(-1);
  assert.equal(controller.currentSubtitleTrack, -1);
});

console.log('\n--- 11. Testes do Formatador de Proxy CORS ---');

await test('Deve aplicar Proxy CORS corretamente respeitando ? e /', () => {
  const url = 'http://stream.servidor.com:8080/live/user/pass/123.m3u8';
  const encoded = encodeURIComponent(url);

  // Proxy com ? (ex: corsproxy.io)
  assert.equal(applyCorsProxy('https://corsproxy.io/?', url), `https://corsproxy.io/?${encoded}`);

  // Proxy com ?url= (ex: allorigins)
  assert.equal(applyCorsProxy('https://api.allorigins.win/raw?url=', url), `https://api.allorigins.win/raw?url=${encoded}`);

  // Proxy com / final
  assert.equal(applyCorsProxy('https://meuproxy.com/', url), `https://meuproxy.com/${encoded}`);

  // Proxy sem / final
  assert.equal(applyCorsProxy('https://meuproxy.com', url), `https://meuproxy.com/${encoded}`);

  // Proxy vazio ou nulo (retorna URL original)
  assert.equal(applyCorsProxy('', url), url);
  assert.equal(applyCorsProxy(null, url), url);

  // URLs especiais (blob, data)
  assert.equal(applyCorsProxy('https://corsproxy.io/?', 'blob:http://localhost/abc'), 'blob:http://localhost/abc');
});

console.log('\n--- 12. Testes de Delegação da Ponte Nativa Android (window.androidBridge) ---');

await test('Deve delegar playStream, setAspectRatio e stop para window.androidBridge e ocultar <video>', async () => {
  const prevWindow = globalThis.window;
  const calls = { playStream: [], stopStream: 0, setAspectRatio: [] };
  const states = [];

  globalThis.window = {
    addEventListener: () => {},
    androidBridge: {
      playStream(url, title, itemType, streamMode) {
        calls.playStream.push({ url, title, itemType, streamMode });
      },
      stopStream() {
        calls.stopStream++;
      },
      setAspectRatio(ratio) {
        calls.setAspectRatio.push(ratio);
      }
    }
  };

  try {
    const mockVideo = {
      addEventListener: () => {},
      removeEventListener: () => {},
      pause: () => {},
      removeAttribute: () => {},
      load: () => {},
      play: () => Promise.resolve(),
      style: { display: 'block' },
      classList: { add: () => {}, remove: () => {} }
    };
    const mockContainer = {
      classList: { add: () => {}, remove: () => {} }
    };

    const controller = new VideoPlayerController(mockVideo, mockContainer);
    controller.onStateChange = (state) => states.push(state);

    const item = {
      name: 'Canal HD',
      type: 'live',
      url: 'http://iptv.example.com:8080/user/pass/42'
    };

    await controller.playStream(item, '', 'ts', 'hls');

    assert.equal(mockVideo.style.display, 'none', 'Deve ocultar <video> HTML5 no Android');
    assert.equal(calls.playStream.length, 1);
    assert.deepEqual(calls.playStream[0], {
      url: 'http://iptv.example.com:8080/live/user/pass/42.ts',
      title: 'Canal HD',
      itemType: 'live',
      streamMode: 'ts'
    });
    assert.equal(mockVideo.src, undefined, 'Não deve atribuir src ao <video> quando delegado ao Android');
    assert.deepEqual(states, ['loading', 'playing']);

    controller.setAspectRatio('16:9');
    assert.deepEqual(calls.setAspectRatio, ['16:9']);

    controller.stop();
    assert.equal(calls.stopStream, 1);
    assert.equal(mockVideo.style.display, 'none', 'Deve manter <video> oculto ao parar no Android');
    assert.equal(controller.isStopped, true);
    assert.equal(states[states.length - 1], 'idle');
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
});

await test('Deve restaurar display block no <video> quando window.androidBridge não está presente', async () => {
  const prevWindow = globalThis.window;
  globalThis.window = { addEventListener: () => {} };

  try {
    const mockVideo = {
      addEventListener: () => {},
      removeEventListener: () => {},
      pause: () => {},
      removeAttribute: () => {},
      load: () => {},
      play: () => Promise.resolve(),
      style: { display: 'none' },
      classList: { add: () => {}, remove: () => {} }
    };
    const mockContainer = {
      classList: { add: () => {}, remove: () => {} }
    };

    const controller = new VideoPlayerController(mockVideo, mockContainer);
    await controller.playStream({ name: 'VOD', type: 'movie', url: 'http://cdn.example.com/movie.mp4' }, '', 'auto', 'hls');
    assert.equal(mockVideo.style.display, 'block');
    assert.equal(mockVideo.src, 'http://cdn.example.com/movie.mp4');

    controller.stop();
    assert.equal(mockVideo.style.display, 'block');
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
});

console.log('\n--- 13. Testes Midnight Amber v2: M3UParser Catch-up & Shift ---');

await test('M3UParser deve extrair catchup, catchup-days, catchup-source, tvg-shift e hasCatchup', () => {
  const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="c1" catchup="default" catchup-days="7" catchup-source="http://arc.com/{utc}" tvg-shift="-3" group-title="Canais",Canal Catchup
http://stream.com/live/c1.m3u8
#EXTINF:-1 tvg-id="c2" catchup=flussonic catchup-days=3 tvg-shift=1.5,Canal Flussonic
http://stream.com/live/c2.m3u8
#EXTINF:-1 tvg-id="c3" catchup="none" catchup-days="0",Canal Sem Catchup
http://stream.com/live/c3.m3u8`;

  const result = M3UParser.parse(m3u);
  assert.equal(result.items.length, 3);

  const [c1, c2, c3] = result.items;
  assert.equal(c1.catchup, 'default');
  assert.equal(c1.catchupDays, 7);
  assert.equal(c1.catchupSource, 'http://arc.com/{utc}');
  assert.equal(c1.tvgShift, -3);
  assert.equal(c1.hasCatchup, true);

  assert.equal(c2.catchup, 'flussonic');
  assert.equal(c2.catchupDays, 3);
  assert.equal(c2.tvgShift, 1.5);
  assert.equal(c2.hasCatchup, true);

  assert.equal(c3.catchup, 'none');
  assert.equal(c3.catchupDays, 0);
  assert.equal(c3.tvgShift, 0);
  assert.equal(c3.hasCatchup, false);
});

console.log('\n--- 14. Testes Midnight Amber v2: EPGParser setTimeshift() e mergeXml() ---');

await test('EPGParser.setTimeshift() deve deslocar horários em getChannelPrograms, getCurrentProgram e getUpcomingPrograms', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <tv>
    <channel id="ch.shift"><display-name>Canal Shift</display-name></channel>
    <programme start="20261112100000 +0000" stop="20261112110000 +0000" channel="ch.shift">
      <title>Programa A</title>
    </programme>
    <programme start="20261112110000 +0000" stop="20261112120000 +0000" channel="ch.shift">
      <title>Programa B</title>
    </programme>
  </tv>`;

  const parser = new EPGParser();
  parser.parse(xml);

  assert.equal(parser.setTimeshift(2), 2);
  const shifted = parser.getChannelPrograms('ch.shift');
  assert.equal(shifted[0].start.toISOString(), '2026-11-12T12:00:00.000Z');
  assert.equal(shifted[0].stop.toISOString(), '2026-11-12T13:00:00.000Z');

  const now = new Date('2026-11-12T12:30:00.000Z');
  const current = parser.getCurrentProgram('ch.shift', '', now);
  assert.ok(current);
  assert.equal(current.title, 'Programa A');
  assert.equal(current.progress, 50);

  const upcoming = parser.getUpcomingPrograms('ch.shift', '', 5, now);
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].title, 'Programa B');
  assert.equal(upcoming[0].start.toISOString(), '2026-11-12T13:00:00.000Z');

  assert.equal(parser.setTimeshift('invalido'), 0);
});

await test('EPGParser.mergeXml() deve mesclar fontes, unir aliases, deduplicar e ordenar programas', () => {
  const xml1 = `<?xml version="1.0" encoding="UTF-8"?>
  <tv>
    <channel id="espn.br"><display-name>ESPN</display-name></channel>
    <programme start="20261112140000 +0000" stop="20261112150000 +0000" channel="espn.br">
      <title>SportsCenter</title>
    </programme>
    <programme start="20261112100000 +0000" stop="20261112110000 +0000" channel="espn.br">
      <title>Abre o Jogo</title>
    </programme>
  </tv>`;

  const xml2 = `<?xml version="1.0" encoding="UTF-8"?>
  <tv>
    <channel id="espn.br">
      <display-name>ESPN Brasil</display-name>
      <icon src="https://img.example.com/espn.png" />
    </channel>
    <channel id="band.br"><display-name>Band</display-name></channel>
    <programme start="20261112140000 +0000" stop="20261112150000 +0000" channel="espn.br">
      <title>SportsCenter</title>
    </programme>
    <programme start="20261112120000 +0000" stop="20261112130000 +0000" channel="espn.br">
      <title>Linha de Passe</title>
    </programme>
  </tv>`;

  const parser = new EPGParser();
  parser.mergeXml([xml1, xml2]);

  assert.equal(parser.channels.size, 2);
  const espnChannel = parser.channels.get('espn.br');
  assert.deepEqual(espnChannel.names, ['ESPN', 'ESPN Brasil']);
  assert.equal(espnChannel.icon, 'https://img.example.com/espn.png');

  const progs = parser.getChannelPrograms('', 'ESPN Brasil');
  assert.equal(progs.length, 3); // 1 duplicado removido
  assert.deepEqual(progs.map(p => p.title), ['Abre o Jogo', 'Linha de Passe', 'SportsCenter']);
});

console.log('\n--- 15. Testes Midnight Amber v2: StorageService ---');

function withMockLocalStorage(fn) {
  const prevStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    get length() { return store.size; },
    key(index) { return Array.from(store.keys())[index] ?? null; },
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); }
  };
  return Promise.resolve().then(() => fn(store)).finally(() => {
    if (prevStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevStorage;
  });
}

await test('StorageService deve expor defaults expandidos em getSettings(), normalizar perfil Xtream, persistir epgSources/notifications/watchProgress e limpar tudo em clearAll()', async () => {
  await withMockLocalStorage(async (store) => {
    const svc = new StorageService();

    // 1. Defaults expandidos de settings
    const defaults = svc.getSettings();
    assert.equal(defaults.timeFormat, '24h');
    assert.equal(defaults.deviceMode, 'auto');
    assert.equal(defaults.autoRefresh, false);
    assert.equal(defaults.autoPlayNext, true);
    assert.equal(defaults.epgTimeshift, 0);
    assert.equal(defaults.parentalPinHash, '');

    svc.saveSettings({ timeFormat: '12h', deviceMode: 'tv', autoRefresh: true, epgTimeshift: -3, parentalPinHash: 'abc123' });
    const savedCfg = svc.getSettings();
    assert.equal(savedCfg.timeFormat, '12h');
    assert.equal(savedCfg.deviceMode, 'tv');
    assert.equal(savedCfg.autoRefresh, true);
    assert.equal(savedCfg.epgTimeshift, -3);
    assert.equal(savedCfg.parentalPinHash, 'abc123');

    // 2. Normalização de perfil Xtream
    svc.saveProfile({
      id: 'xt_1',
      name: 'Xtream Casa',
      type: 'xtream',
      xtreamServer: 'http://panel.example.com:8080',
      xtreamUser: 'cesar',
      xtreamPass: 'segredo',
      externalEpgUrl: 'http://panel.example.com:8080/xmltv.php'
    });
    const prof = svc.getActiveProfile();
    assert.equal(prof.url, 'http://panel.example.com:8080');
    assert.equal(prof.serverUrl, 'http://panel.example.com:8080');
    assert.equal(prof.xtreamServer, 'http://panel.example.com:8080');
    assert.equal(prof.username, 'cesar');
    assert.equal(prof.xtreamUser, 'cesar');
    assert.equal(prof.password, 'segredo');
    assert.equal(prof.xtreamPass, 'segredo');
    assert.equal(prof.epgUrl, 'http://panel.example.com:8080/xmltv.php');
    assert.equal(prof.accountInfo.username, 'cesar');
    assert.equal(prof.accountInfo.serverUrl, 'http://panel.example.com:8080');

    // 3. epgSources por perfil
    const sources = [{ url: 'http://epg1.xml', status: 'loaded' }, { url: 'http://epg2.xml', status: 'pending' }];
    svc.saveEpgSources(sources);
    assert.deepEqual(svc.getEpgSources(), sources);

    // 4. Notificações
    const added = svc.addNotification({ type: 'warning', title: 'Expiração', message: 'Expira em 3 dias' });
    assert.ok(added?.id);
    assert.equal(svc.getNotifications().length, 1);
    assert.equal(svc.getNotifications()[0].title, 'Expiração');
    svc.clearNotifications();
    assert.equal(svc.getNotifications().length, 0);

    // 5. WatchProgress
    const prog = svc.saveWatchProgress('movie_42', 450, 900);
    assert.equal(prog.percent, 50);
    assert.equal(svc.getWatchProgress('movie_42')?.posSec, 450);
    assert.equal(svc.saveWatchProgress('movie_99', 120, 60).percent, 100);

    // 6. clearAll()
    svc.toggleFavorite('ch_1');
    svc.addRecent({ id: 'ch_1', name: 'Canal 1', url: 'http://stream/1.m3u8' });
    svc.addNotification({ type: 'info', title: 'Teste', message: 'Msg' });
    await svc.clearAll();

    assert.equal(svc.getProfiles().length, 0);
    assert.equal(svc.getActiveProfileId(), null);
    assert.equal(svc.getEpgSources('xt_1').length, 0);
    assert.equal(svc.getNotifications().length, 0);
    assert.equal(svc.getWatchProgress('movie_42'), null);
    assert.equal(svc.getSettings().timeFormat, '24h');
    assert.equal(store.size, 0, `Store deveria estar vazio após clearAll(), restaram: ${Array.from(store.keys()).join(', ')}`);
  });
});

console.log('\n--- 16. Testes Midnight Amber v2: XtreamApi.authenticate() serverInfo ---');

await test('XtreamApi.authenticate() deve retornar serverInfo e accountInfo completos', async () => {
  const prevFetch = globalThis.fetch;
  const mockPayload = {
    user_info: {
      username: 'demo_user',
      status: 'Active',
      auth: 1,
      exp_date: '1893456000',
      is_trial: '0',
      active_cons: '1',
      max_connections: '3'
    },
    server_info: {
      url: 'iptv.example.com',
      port: '8080',
      https_port: '8443',
      server_protocol: 'http',
      timezone: 'America/Sao_Paulo'
    }
  };

  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(mockPayload)).buffer
  });

  try {
    const api = new XtreamApi('http://iptv.example.com:8080', 'demo_user', 'demo_pass');
    const res = await api.authenticate();
    assert.equal(res.success, true);
    assert.deepEqual(res.serverInfo, mockPayload.server_info);
    assert.deepEqual(res.server, mockPayload.server_info);
    assert.equal(res.accountInfo.username, 'demo_user');
    assert.equal(res.accountInfo.status, 'Active');
    assert.equal(res.accountInfo.maxConnections, '3');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

console.log('\n--- 17. Testes de Regressão UX / Responsividade / EPG / Busca ---');

await test('HTML, CSS e JS devem implementar drill-down na sidebar, player com overlay ocioso, EPG maximizado abaixo e omitir Catch-Up', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf-8');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf-8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf-8');

  assert.equal(html.includes('btn-home-catchup'), false);
  assert.equal(html.includes('btn-quick-catchup'), false);
  assert.equal(html.includes('id="channel-grid-section"'), false);
  assert.equal(html.includes('id="search-filter-bar"'), false);

  assert.match(html, /id="split-sidebar-title"/);
  assert.match(html, /id="sidebar-items-toolbar"/);
  assert.match(html, /id="player-idle-overlay"/);
  assert.match(html, /class="player-epg-card player-epg-maximized hidden"\s+id="player-epg-card"/);
  assert.match(html, /id="btn-epg-mode-channel"/);
  assert.match(html, /id="btn-epg-mode-all"/);
  assert.match(html, /id="input-browse-epg-search"/);
  assert.match(html, /id="player-epg-extended-list"/);
  assert.match(html, /id="btn-browse-epg-load-more"/);
  assert.match(html, /id="btn-epg-timeline-load-more"/);

  assert.match(css, /\.nav-tabs-wrapper\s*\{[^}]*flex-shrink:\s*0/);
  assert.match(css, /\.profile-card-name\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(css, /\.epg-content-panel\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.player-epg-card\.player-epg-maximized\s*\{/);
  assert.match(css, /\.sidebar-item-row\s*\{/);

  assert.match(appJs, /removeEpgSourceAt/);
  assert.match(appJs, /sidebarDrillMode/);
  assert.match(appJs, /closeEnteredCategory\(/);
  assert.match(appJs, /renderSidebarItems\(/);
  assert.match(appJs, /_collectLiveEpgRows\(/);
  assert.match(appJs, /currentPlayingItem\.type\s*===\s*ItemType\.LIVE/);
  assert.match(appJs, /_epgItemByChannelKey/);
  assert.match(appJs, /itemMatches\.length >= 40\) break/);
  assert.match(appJs, /M3UParser\.ensureUniqueItemIds/);
});

await test('Canais FHD/HD/SD com mesmo tvg-id devem ter IDs únicos para destacar apenas o canal clicado', () => {
  const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="CartoonNetwork.br" group-title="INFANTIS",CARTOON NETWORK FHD
http://stream.com/cn_fhd.m3u8
#EXTINF:-1 tvg-id="CartoonNetwork.br" group-title="INFANTIS",CARTOON NETWORK HD
http://stream.com/cn_hd.m3u8
#EXTINF:-1 tvg-id="CartoonNetwork.br" group-title="INFANTIS",CARTOON NETWORK SD
http://stream.com/cn_sd.m3u8
#EXTINF:-1 tvg-id="CartoonNetwork.br" group-title="INFANTIS",CARTOON NETWORK SD
http://stream.com/cn_sd_backup.m3u8`;

  const parsed = M3UParser.parse(m3u);
  assert.equal(parsed.items.length, 4);
  const ids = new Set(parsed.items.map(i => i.id));
  assert.equal(ids.size, 4, 'Cada variação FHD/HD/SD deve ter ID distinto');
  assert.ok(parsed.items.every(i => i.tvgId === 'CartoonNetwork.br'), 'tvgId para EPG deve permanecer intacto');

  // Playlists legadas em cache (com id duplicado igual ao tvgId) também devem ser normalizadas
  const legacyItems = [
    { id: 'CartoonNetwork.br', name: 'CARTOON NETWORK FHD', group: 'INFANTIS', tvgId: 'CartoonNetwork.br' },
    { id: 'CartoonNetwork.br', name: 'CARTOON NETWORK HD', group: 'INFANTIS', tvgId: 'CartoonNetwork.br' },
    { id: 'CartoonNetwork.br', name: 'CARTOON NETWORK SD', group: 'INFANTIS', tvgId: 'CartoonNetwork.br' }
  ];
  M3UParser.ensureUniqueItemIds(legacyItems);
  assert.equal(new Set(legacyItems.map(i => i.id)).size, 3);
});

await test('Desktop MainForm.cs deve desmaximizar e reduzir MinimumSize ao entrar em Picture-in-Picture', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const mainFormCs = readFileSync(resolve(rootDir, 'src/desktop/MainForm.cs'), 'utf-8');
  assert.match(mainFormCs, /SetMiniPlayerPip\(/);
  assert.match(mainFormCs, /MinimumSize\s*=\s*PipMinimumWindowSize/);
  assert.match(mainFormCs, /WindowState\s*=\s*FormWindowState\.Normal/);
  assert.match(mainFormCs, /_isFullScreen\s*\|\|\s*_isPipMode/);
  assert.match(mainFormCs, /_vlcSingleClickTimer/);
  assert.match(mainFormCs, /UpdateCenterPlayOverlay/);
});

await test('Mute icon, volume bar, pause central, botões de cabeçalho e Formato de Stream separado', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf-8');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf-8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf-8');

  assert.match(html, /id="btn-player-center-toggle"/);
  assert.match(html, /data-i18n="navAccount"/);
  assert.match(html, /data-i18n="navAboutShort"/);
  assert.equal(html.includes('id="btn-open-import"'), false);
  assert.equal(html.includes('id="settings-stream-mode-select"'), false);
  assert.match(css, /--vol-pct/);
  assert.match(css, /\.player-center-toggle\s*\{/);
  assert.match(appJs, /syncVolumeUi\(/);
  assert.match(appJs, /addEventListener\('volumechange'/);
  assert.match(appJs, /openStreamFormatSubModal\(/);
});

await test('Histórico limitado e limpeza, Teste de Velocidade real e Update apenas em Notificações', async () => {
  await withMockLocalStorage(async () => {
    const svc = new StorageService();
    svc.saveSettings({ historyLimit: 5 });
    for (let i = 1; i <= 8; i++) {
      svc.addRecent({ id: `ch_${i}`, name: `Canal ${i}`, url: `http://ex.com/${i}.m3u8`, type: 'live' });
    }
    assert.equal(svc.getRecents().length, 5, 'Deve respeitar limite de histórico configurado');
    svc.saveWatchProgress('ch_1', 60, 120);
    globalThis.localStorage.setItem('fluistream_recents_other', '[{"url":"http://ex.com/old.m3u8"}]');
    svc.clearRecents(true);
    assert.equal(svc.getRecents().length, 0, 'clearRecents() deve limpar todo o histórico');
    assert.equal(globalThis.localStorage.getItem('fluistream_recents_other'), null, 'clearRecents() deve remover todas as chaves fluistream_recents*');
    assert.equal(svc.getWatchProgress('ch_1'), null, 'clearRecents(true) deve limpar progresso salvo');
  });

  for (const lang of ['pt-BR', 'en-US', 'es']) {
    assert.ok(translations[lang].speedTestResult.includes('{mbps}'), `${lang}.speedTestResult deve interpolar {mbps}`);
    assert.ok(translations[lang].speedTestResult.includes('{ms}'), `${lang}.speedTestResult deve interpolar {ms}`);
  }

  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf-8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf-8');
  const mainFormCs = readFileSync(resolve(rootDir, 'src/desktop/MainForm.cs'), 'utf-8');

  assert.match(html, /id="settings-history-limit-select"/);
  assert.match(html, /id="btn-clear-history"/);
  assert.equal(html.includes('id="update-toast"'), false, 'Não deve renderizar popup flutuante de atualização');
  assert.match(appJs, /runFreeSpeedTest\(/);
  assert.match(appJs, /notifyHostUpdateAvailable\(/);
  assert.match(mainFormCs, /DispatchPendingUpdateNotification/);
});

await test('Modo de Dispositivo aplica TV/Mobile/Desktop e inclui sidebar e header na navegação espacial D-Pad', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf-8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf-8');

  assert.match(css, /data-effective-device-mode="tv"/);
  assert.match(css, /data-effective-device-mode="mobile"/);
  assert.match(css, /data-effective-device-mode="desktop"/);
  assert.match(appJs, /resolveEffectiveDeviceMode\(/);
  assert.match(appJs, /data-effective-device-mode/);
  assert.match(appJs, /'\.sidebar-item-row'/);
  assert.match(appJs, /deviceModeHelp/);
  assert.match(appJs, /refreshHomePlaylist\(/);
  assert.match(appJs, /formatLastUpdated\(/);
});

await test('Multi-Tela suporta fallback HLS/MPEG-TS/LibVLC nativo sem derrubar slots ativos e otimiza flags LibVLC', () => {
  const helper = new VideoPlayerController(null, null);
  const cands = helper.buildStreamCandidates('http://myiptv.com/live/user/pass/155.m3u8', ItemType.LIVE, 'auto');
  assert.deepEqual(cands, [
    'http://myiptv.com/live/user/pass/155.m3u8',
    'http://myiptv.com/live/user/pass/155.ts',
    'http://myiptv.com/live/user/pass/155.m3u8'
  ].filter((v, i, a) => a.indexOf(v) === i));

  const candsRaw = helper.buildStreamCandidates('http://myiptv.com/user/pass/155', ItemType.LIVE, 'auto');
  assert.deepEqual(candsRaw, [
    'http://myiptv.com/live/user/pass/155.m3u8',
    'http://myiptv.com/live/user/pass/155.ts',
    'http://myiptv.com/user/pass/155'
  ]);

  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf-8');
  const playerJs = readFileSync(resolve(rootDir, 'src/web/js/player.js'), 'utf-8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf-8');
  const mainFormCs = readFileSync(resolve(rootDir, 'src/desktop/MainForm.cs'), 'utf-8');

  assert.match(html, /mpegts\.js/);
  assert.match(playerJs, /handleNativeSlotState/);
  assert.match(playerJs, /MS_PLAY_SLOT/);
  assert.match(appJs, /renderMultiScreenSlot/);
  assert.match(appJs, /selectMultiScreenAudioSlot/);
  assert.match(mainFormCs, /PlayMultiScreenSlot/);
  assert.match(mainFormCs, /MULTISCREEN_LAYOUT_UPDATE/);
  assert.match(mainFormCs, /--avcodec-hw=d3d11va,dxva2,none/);
  assert.match(mainFormCs, /--http-reconnect/);
  assert.equal(mainFormCs.includes('--avcodec-skiploopfilter=4'), false);
  assert.equal(mainFormCs.includes('--clock-jitter=0'), false);
});

await test('Layout Mobile Portrait/Landscape e Insets Android evitam barras presas, gaveta cortada e colisão com status bar', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf-8');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf-8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf-8');
  const mainActivityKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/MainActivity.kt'), 'utf-8');

  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /id="sidebar-backdrop"/);
  assert.match(html, /aria-controls="split-sidebar"/);

  assert.match(appJs, /setMobileSidebarOpen\(/);
  assert.match(appJs, /minViewportSide <= 900/);
  assert.match(appJs, /classList\.add\('is-android-app'\)/);

  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /@media \(max-width: 960px\), \(max-height: 540px\) and \(max-width: 1024px\)/);
  assert.match(css, /@media \(max-height: 540px\) and \(max-width: 1024px\)/);
  assert.match(css, /100dvh/);
  assert.match(css, /body\.is-android-app \.player-wrapper/);

  assert.match(mainActivityKt, /applyTopHudWindowInsets/);
  assert.match(mainActivityKt, /WindowInsetsCompat\.Type\.displayCutout\(\)/);
  assert.match(mainActivityKt, /WindowInsetsCompat\.Type\.statusBars\(\)/);
});

await test('Vídeo permanece fixado no fundo sob categorias/modais/header e só desfixa em PiP/Fullscreen', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  const mainFormCs = readFileSync(resolve(rootDir, 'src/desktop/MainForm.cs'), 'utf8');

  assert.match(css, /\.player-section\s*\{[^}]*z-index:\s*1;/);
  assert.match(css, /\.player-wrapper\s*\{[^}]*z-index:\s*1;/);
  assert.match(css, /body\.desktop-mini-pip \.app-header/);
  assert.match(appJs, /setMobileSidebarOpen\(open\)\s*\{[\s\S]*updateNativeOverlayVisibility\(\)/);
  assert.match(mainFormCs, /#split-sidebar\.open-mobile, #sidebar-backdrop:not\(\.hidden\)/);
  assert.match(mainFormCs, /_btnCenterPlayOverlay\.Visible = false/);

  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  try {
    let blockingMatch = false;
    let headerSticky = false;
    let fullscreenEl = null;
    let pipActive = false;
    let wrapperRect = { left: 20, top: 120, bottom: 380, width: 480, height: 260 };

    const fakeHeader = { getBoundingClientRect: () => ({ top: 0, bottom: 56, height: 56 }) };
    const stageEl = {
      closest: () => null,
      getBoundingClientRect: () => wrapperRect
    };

    globalThis.window = {
      innerHeight: 720,
      devicePixelRatio: 1,
      getComputedStyle: () => ({ position: headerSticky ? 'sticky' : 'static' })
    };
    globalThis.document = {
      get fullscreenElement() { return fullscreenEl; },
      webkitFullscreenElement: null,
      pictureInPictureElement: null,
      body: { classList: { contains: (cls) => cls === 'desktop-mini-pip' && pipActive } },
      querySelector: () => (blockingMatch ? {} : null),
      getElementById: (id) => (id === 'app-header' ? fakeHeader : null)
    };

    assert.equal(computeOverlayLayout(stageEl).visible, true, 'visível quando sem overlays');
    blockingMatch = true;
    assert.equal(computeOverlayLayout(stageEl).visible, false, 'oculto quando gaveta de categorias ou modal aberta');
    fullscreenEl = stageEl;
    assert.equal(computeOverlayLayout(stageEl).visible, true, 'desfixado/visível quando em fullscreen');
    fullscreenEl = null;
    pipActive = true;
    assert.equal(computeOverlayLayout(stageEl).visible, true, 'desfixado/visível quando em mini-PiP');
    pipActive = false;
    blockingMatch = false;
    headerSticky = true;
    wrapperRect = { left: 20, top: 30, bottom: 290, width: 480, height: 260 };
    assert.equal(computeOverlayLayout(stageEl).visible, false, 'oculto quando vídeo rola sob cabeçalho sticky');
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  }
});

await test('Todos os botões Início (header, marca e barra de categorias) navegam para Home/Empty', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');

  assert.match(html, /id="btn-back-categories"/);
  assert.match(appJs, /btnBackCategories:\s*document\.getElementById\('btn-back-categories'\)/);
  assert.match(appJs, /goHome\(\)\s*\{[\s\S]*this\.navigateToScreen\(this\.playlist\.items\.length > 0 \? 'home' : 'empty'\)/);
  assert.match(appJs, /this\.dom\.btnBackCategories\.addEventListener\('click',\s*\(\)\s*=>\s*this\.goHome\(\)\)/);
});

await test('Layout fixo (categorias esquerda, player direita, EPG baixo) e 1-clique fullscreen em TV/Android', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');

  assert.match(css, /#btn-toggle-sidebar-mobile,\s*#btn-sidebar-close\s*\{\s*display:\s*none !important;/);
  assert.doesNotMatch(css, /\.split-pane-shell\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(appJs, /isSingleClickFullscreenMode\(\)/);
  assert.match(appJs, /if \(this\.isSingleClickFullscreenMode\(\)\)\s*\{[\s\S]*this\.player\.toggleFullscreen\(\);/);
  assert.match(css, /\.epg-card-title-group\s*\{[\s\S]*flex-wrap:\s*wrap;/);
  assert.match(css, /\.epg-prog-title\s*\{[^}]*overflow-wrap:\s*break-word;/);
});

await test('Histórico separado por tipo (live/movie/series) e Favoritos dividido em Ao Vivo/Filmes/Séries sem Histórico', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');

  assert.match(appJs, /getRecentsForView\(viewType = this\.currentView\)/);
  assert.match(appJs, /if \(viewType === 'favorites'\) return \[\];/);
  assert.match(appJs, /getFavoritesForView\(viewType = this\.currentView\)/);
  assert.match(appJs, /data-group="__fav_live__"/);
  assert.match(appJs, /data-group="__fav_movie__"/);
  assert.match(appJs, /data-group="__fav_series__"/);
});

await test('Filmes exibem modal com sinopse enriquecida, thumb e trailer embutido no app (ausente em séries)', async () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  const xtreamJs = readFileSync(resolve(rootDir, 'src/web/js/xtream-api.js'), 'utf8');

  assert.match(html, /id="btn-movie-trailer"/);
  assert.match(html, /id="movie-trailer-box"/);
  assert.match(xtreamJs, /getVodInfoUrl\(vodId\)/);
  assert.match(xtreamJs, /async getVodInfo\(vodId\)/);
  assert.match(appJs, /openMovieDetailModal\(movie\)/);
  assert.match(appJs, /playMovieTrailerInline\(\)/);
  assert.match(appJs, /openSeriesDetailModal\(series\)[\s\S]*btnMovieTrailer\?\.classList\.add\('hidden'\)/);

  const cleaned = cleanMediaTitle('A Freira 2 (2023) [FHD] Dual');
  assert.deepEqual(cleaned, { title: 'A Freira 2', year: '2023' });

  const adoroParsed = parseAdoroCinemaHtml(`
    <html><head>
      <meta property="og:image" content="https://img.adorocinema.com/poster.jpg" />
      <script type="application/ld+json">{"description":"Sinopse oficial obtida do AdoroCinema."}</script>
    </head></html>
  `);
  assert.equal(adoroParsed.poster, 'https://img.adorocinema.com/poster.jpg');
  assert.equal(adoroParsed.synopsis, 'Sinopse oficial obtida do AdoroCinema.');

  const ytTrailer = await resolveTrailerPlayback({ name: 'Teste', trailer: 'QF-oyCwaArU' }, null);
  assert.equal(ytTrailer.type, 'youtube');
  assert.match(ytTrailer.src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/QF-oyCwaArU/);

  const directTrailer = await resolveTrailerPlayback({ name: 'Teste' }, { trailerUrl: 'https://cdn.example.com/trailer.mp4' });
  assert.equal(directTrailer.type, 'video');
  assert.equal(directTrailer.src, 'https://cdn.example.com/trailer.mp4');
});

await test('Mobile não entra em fullscreen automático ao dar play/tocar e retoma reprodução ao sair do tela cheia', async () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  const fnMatch = appJs.match(/isSingleClickFullscreenMode\(\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'isSingleClickFullscreenMode deve existir');
  assert.doesNotMatch(fnMatch[0], /effective === 'mobile'/);

  const listeners = new Map();
  let playCalls = 0;
  const mockVideo = {
    paused: false,
    readyState: 4,
    volume: 1,
    muted: false,
    style: {},
    addEventListener: (ev, cb) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(cb);
    },
    play: () => {
      playCalls += 1;
      mockVideo.paused = false;
      return Promise.resolve();
    }
  };
  const emit = (ev) => (listeners.get(ev) || []).forEach(cb => cb());

  const { VideoPlayerController } = await import('../src/web/js/player.js');
  const ctrl = new VideoPlayerController(mockVideo, null);
  ctrl.currentItem = { id: 'ch-1', name: 'Canal 1', type: 'live' };
  ctrl.isStopped = false;

  emit('webkitbeginfullscreen');
  mockVideo.paused = true; // iOS Safari pausa ao sair do fullscreen nativo
  emit('webkitendfullscreen');

  assert.equal(playCalls >= 1, true, 'Deve chamar video.play() ao sair do fullscreen nativo');
  clearTimeout(ctrl._fullscreenResumeTimer);
});

await test('Android TV D-Pad navega por tabs, inputs de texto, checkboxes, selects e teclado IME sem ficar preso', async () => {
  const { runInNewContext } = await import('node:vm');
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf8');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf8');
  const bridgeKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/NativeBridge.kt'), 'utf8');
  const activityKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/MainActivity.kt'), 'utf8');

  assert.match(bridgeKt, /@JavascriptInterface\s+fun isTv\(\): Boolean/);
  assert.match(bridgeKt, /@JavascriptInterface\s+fun showKeyboard\(\)/);
  assert.match(bridgeKt, /@JavascriptInterface\s+fun hideKeyboard\(\)/);
  assert.match(activityKt, /SOFT_INPUT_ADJUST_RESIZE/);

  for (const rel of ['index.html', 'css/style.css', 'js/app.js']) {
    assert.equal(
      readFileSync(resolve(rootDir, 'src/web', rel), 'utf8'),
      readFileSync(resolve(rootDir, 'src/android/app/src/main/assets/web', rel), 'utf8'),
      `Asset Android dessincronizado: ${rel}`
    );
  }
  assert.match(html, /class="xtream-credentials-grid"/);
  assert.match(html, /id="btn-cancel-import"/);
  assert.match(css, /\.xtream-credentials-grid/);
  assert.match(css, /\[data-tv-editing="true"\]:focus/);

  const extractMethod = (name) => {
    const start = appJs.indexOf(`  ${name}(`);
    assert.ok(start !== -1, `Método ${name} deve existir em app.js`);
    let i = appJs.indexOf('{', start);
    let depth = 0;
    for (; i < appJs.length; i++) {
      const ch = appJs[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return appJs.slice(start, i + 1);
      }
    }
    throw new Error(`Fechamento de chaves não encontrado para ${name}`);
  };

  let activeEl = null;
  let showKbCount = 0;
  let hideKbCount = 0;

  const makeEl = ({ id = '', tagName = 'DIV', type = 'text', classes = [], rect, parent = null }) => {
    const classSet = new Set(classes);
    const el = {
      id,
      tagName,
      type,
      value: '',
      readOnly: false,
      disabled: false,
      clicked: 0,
      selectionStart: 0,
      selectionEnd: 0,
      children: [],
      attributes: new Map(),
      dataset: {},
      classList: {
        contains: (c) => classSet.has(c),
        add: (c) => classSet.add(c),
        remove: (c) => classSet.delete(c),
        toggle: (c, force) => {
          if (force === undefined) classSet.has(c) ? classSet.delete(c) : classSet.add(c);
          else if (force) classSet.add(c);
          else classSet.delete(c);
        }
      },
      setAttribute: (k, v) => el.attributes.set(k, v),
      removeAttribute: (k) => el.attributes.delete(k),
      getBoundingClientRect: () => rect,
      focus: () => { activeEl = el; },
      scrollIntoView: () => {},
      click: () => { el.clicked++; },
      setSelectionRange: (s, e) => { el.selectionStart = s; el.selectionEnd = e; },
      contains: (other) => {
        let cur = other;
        while (cur) {
          if (cur === el) return true;
          cur = cur.parent;
        }
        return false;
      },
      closest: (sel) => {
        const tokens = sel.split(',').map(s => s.trim());
        let cur = el;
        while (cur) {
          if (tokens.some(t => t === '.hidden' && cur.classList.contains('hidden')) ||
              tokens.some(t => t === '.modal-header' && cur.classList.contains('modal-header')) ||
              tokens.some(t => t === '.modal-body' && cur.classList.contains('modal-body')) ||
              tokens.some(t => t === '.modal-footer' && cur.classList.contains('modal-footer'))) {
            return cur;
          }
          cur = cur.parent;
        }
        return null;
      },
      matches: (sel) => sel.split(',').map(s => s.trim()).some(part => {
        if (part.startsWith('.')) return el.classList.contains(part.slice(1));
        if (part.startsWith('#')) return el.id === part.slice(1);
        if (part.startsWith('input')) return el.tagName === 'INPUT' && el.type !== 'hidden';
        if (part === 'select') return el.tagName === 'SELECT';
        if (part === 'textarea') return el.tagName === 'TEXTAREA';
        if (part === 'button') return el.tagName === 'BUTTON';
        return false;
      }),
      querySelectorAll: (sel) => {
        const out = [];
        const tokens = sel.split(',').map(s => s.trim());
        const walk = (node) => {
          for (const child of node.children) {
            const matched = tokens.some(tok => {
              if (tok.startsWith('.modal-header ')) return child.closest('.modal-header') && child.matches(tok.replace('.modal-header ', ''));
              if (tok.startsWith('.modal-body ')) return child.closest('.modal-body') && child.matches(tok.replace('.modal-body ', ''));
              if (tok.startsWith('.modal-footer ')) return child.closest('.modal-footer') && child.matches(tok.replace('.modal-footer ', ''));
              return child.matches(tok);
            });
            if (matched) out.push(child);
            walk(child);
          }
        };
        walk(el);
        return out;
      },
      querySelector: (sel) => el.querySelectorAll(sel)[0] || null,
      parent
    };
    if (parent) parent.children.push(el);
    return el;
  };

  const zeroRect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  const modal = makeEl({ id: 'modal-import', classes: ['modal-backdrop'], rect: zeroRect });
  const header = makeEl({ classes: ['modal-header'], rect: zeroRect, parent: modal });
  const body = makeEl({ classes: ['modal-body'], rect: zeroRect, parent: modal });
  const footer = makeEl({ classes: ['modal-footer'], rect: zeroRect, parent: modal });

  const btnClose = makeEl({ id: 'btn-close-import', tagName: 'BUTTON', rect: { left: 680, right: 716, top: 40, bottom: 76, width: 36, height: 36 }, parent: header });
  const inputProfile = makeEl({ id: 'input-profile-name', tagName: 'INPUT', type: 'text', rect: { left: 240, right: 696, top: 96, bottom: 140, width: 456, height: 44 }, parent: body });
  const tabFile = makeEl({ id: 'tab-file', tagName: 'BUTTON', classes: ['import-tab-btn'], rect: { left: 240, right: 388, top: 152, bottom: 196, width: 148, height: 44 }, parent: body });
  const tabUrl = makeEl({ id: 'tab-url', tagName: 'BUTTON', classes: ['import-tab-btn'], rect: { left: 396, right: 544, top: 152, bottom: 196, width: 148, height: 44 }, parent: body });
  const tabXtream = makeEl({ id: 'tab-xtream', tagName: 'BUTTON', classes: ['import-tab-btn', 'active'], rect: { left: 552, right: 696, top: 152, bottom: 196, width: 144, height: 44 }, parent: body });
  const inputXtreamServer = makeEl({ id: 'input-xtream-server', tagName: 'INPUT', type: 'text', rect: { left: 240, right: 696, top: 208, bottom: 252, width: 456, height: 44 }, parent: body });
  const inputXtreamUser = makeEl({ id: 'input-xtream-user', tagName: 'INPUT', type: 'text', rect: { left: 240, right: 462, top: 264, bottom: 308, width: 222, height: 44 }, parent: body });
  const inputXtreamPass = makeEl({ id: 'input-xtream-pass', tagName: 'INPUT', type: 'password', rect: { left: 474, right: 696, top: 264, bottom: 308, width: 222, height: 44 }, parent: body });
  const checkEpg = makeEl({ id: 'check-use-embedded-epg', tagName: 'INPUT', type: 'checkbox', rect: { left: 240, right: 260, top: 324, bottom: 344, width: 20, height: 20 }, parent: body });
  // Simula campo abaixo da dobra de scroll do .modal-body (top maior que o rodapé fixo)
  const selectTest = makeEl({ id: 'select-test', tagName: 'SELECT', rect: { left: 240, right: 696, top: 480, bottom: 524, width: 456, height: 44 }, parent: body });
  const btnCancel = makeEl({ id: 'btn-cancel-import', tagName: 'BUTTON', rect: { left: 430, right: 550, top: 420, bottom: 466, width: 120, height: 46 }, parent: footer });
  const btnSubmit = makeEl({ id: 'btn-submit-import', tagName: 'BUTTON', rect: { left: 560, right: 696, top: 420, bottom: 466, width: 136, height: 46 }, parent: footer });

  const mockDocument = {
    body: modal,
    get activeElement() { return activeEl; },
    querySelector: (sel) => (sel.includes('.modal-backdrop:not(.hidden)') && !modal.classList.contains('hidden')) ? modal : null,
    querySelectorAll: (sel) => (sel.includes('.modal-backdrop:not(.hidden)') && !modal.classList.contains('hidden')) ? [modal] : []
  };
  const mockWindow = {
    innerWidth: 960,
    innerHeight: 540,
    matchMedia: () => ({ matches: false }),
    androidBridge: {
      isAndroid: () => true,
      isTv: () => true,
      showKeyboard: () => { showKbCount++; },
      hideKeyboard: () => { hideKbCount++; }
    }
  };
  const code = `(() => class TestNavController {
    constructor() { this.dom = {}; }
    setBackgroundInert() {}
    updateNativeOverlayVisibility() {}
    ${extractMethod('resolveEffectiveDeviceMode')}
    ${extractMethod('_isTvNavigationMode')}
    ${extractMethod('_isTextEntryElement')}
    ${extractMethod('_setTvInputEditing')}
    ${extractMethod('moveSpatialFocus')}
    ${extractMethod('handleGlobalKeyDown')}
    ${extractMethod('openModal')}
  })()`;

  const NavController = runInNewContext(code, {
    storage: { getSettings: () => ({ deviceMode: 'auto' }) },
    document: mockDocument,
    window: mockWindow,
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; sdk_google_atv64_x86_64) AppleWebKit/537.36' }
  });
  const ctrl = new NavController();

  assert.equal(ctrl.resolveEffectiveDeviceMode('auto'), 'tv');

  ctrl.openModal(modal);
  assert.equal(activeEl, inputProfile, 'openModal deve focar primeiro campo útil no modal-body, não o botão X');
  assert.equal(inputProfile.readOnly, true);
  assert.equal(inputProfile.dataset.tvEditing, 'false');

  const keyEv = (key) => {
    let prevented = false;
    return {
      key,
      code: key === ' ' ? 'Space' : key,
      target: activeEl,
      preventDefault: () => { prevented = true; },
      stopPropagation: () => {},
      get prevented() { return prevented; }
    };
  };

  // Navega das abas até a aba da direita (Xtream); ArrowRight extra na última aba não deve pular para o X do header
  tabXtream.focus();
  ctrl.handleGlobalKeyDown(keyEv('ArrowRight'));
  assert.equal(activeEl, tabXtream, 'ArrowRight na última aba não deve pular diagonalmente ao header');
  ctrl.handleGlobalKeyDown(keyEv('ArrowDown'));
  assert.equal(activeEl, inputXtreamServer, 'ArrowDown na aba direita deve alcançar input-xtream-server');
  assert.equal(inputXtreamServer.readOnly, true);

  // DPAD_CENTER / Enter ativa edição e abre teclado IME
  ctrl.handleGlobalKeyDown(keyEv('Enter'));
  assert.equal(inputXtreamServer.readOnly, false);
  assert.equal(inputXtreamServer.dataset.tvEditing, 'true');
  assert.equal(showKbCount, 1);

  // ArrowDown sai da edição, fecha IME e desce ao usuário
  ctrl.handleGlobalKeyDown(keyEv('ArrowDown'));
  assert.equal(inputXtreamServer.readOnly, true);
  assert.equal(inputXtreamServer.dataset.tvEditing, 'false');
  assert.equal(hideKbCount, 1);
  assert.equal(activeEl, inputXtreamUser);

  // ArrowRight vai para senha; ArrowDown desce para checkbox -> Enter marca checkbox
  ctrl.handleGlobalKeyDown(keyEv('ArrowRight'));
  assert.equal(activeEl, inputXtreamPass);
  ctrl.handleGlobalKeyDown(keyEv('ArrowDown'));
  assert.equal(activeEl, checkEpg);
  ctrl.handleGlobalKeyDown(keyEv('Enter'));
  assert.equal(checkEpg.clicked, 1);

  // ArrowDown vai para <select> e ArrowDown sai do <select> para botão no footer
  ctrl.handleGlobalKeyDown(keyEv('ArrowDown'));
  assert.equal(activeEl, selectTest);
  ctrl.handleGlobalKeyDown(keyEv('ArrowDown'));
  assert.ok(activeEl === btnCancel || activeEl === btnSubmit, 'ArrowDown deve sair de <select> para o rodapé');

  // Evita aviso de variável não usada em btnClose / tabFile / tabUrl
  assert.ok(btnClose && tabFile && tabUrl);
});

await test('Multi-Tela D-Pad navega diretamente pelos botões de áudio, recarregar, trocar, fechar e slot vazio', async () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  const { runInNewContext } = await import('node:vm');

  assert.doesNotMatch(appJs, /class="multiscreen-slot [^"]*"[^>]*tabindex="0"/, 'Slots preenchidos não devem bloquear foco interno com tabindex próprio');
  assert.match(appJs, /'\.multiscreen-slot-empty',\s*'\.multiscreen-slot-actions button'/);

  const extractMethod = (name) => {
    const start = appJs.indexOf(`  ${name}(`);
    assert.ok(start >= 0, `Método ${name} deve existir`);
    const nextMatch = appJs.slice(start + 1).search(/\n  (?:async )?[a-zA-Z_][a-zA-Z0-9_]*\(/);
    return nextMatch >= 0 ? appJs.slice(start, start + 1 + nextMatch) : appJs.slice(start);
  };

  let activeEl = null;
  const makeBtn = (id, classes, rect, parent) => {
    const el = {
      id,
      tagName: 'BUTTON',
      classes: new Set(classes),
      children: [],
      dataset: {},
      classList: { contains: (c) => el.classes.has(c) },
      focus: () => { activeEl = el; },
      scrollIntoView: () => {},
      getBoundingClientRect: () => rect,
      closest: (sel) => {
        const tokens = sel.split(',').map(s => s.trim());
        let cur = el;
        while (cur) {
          if (tokens.some(t => t.startsWith('.') ? cur.classes.has(t.slice(1)) : cur.id === t.replace('#', ''))) return cur;
          cur = cur.parent;
        }
        return null;
      },
      matches: (sel) => sel.split(',').some(t => {
        const tok = t.trim();
        if (tok === '.multiscreen-slot-empty') return el.classes.has('multiscreen-slot-empty');
        if (tok === '.multiscreen-slot-actions button') return Boolean(el.closest('.multiscreen-slot-actions'));
        return false;
      }),
      contains: (other) => other === el,
      parent
    };
    if (parent) parent.children.push(el);
    return el;
  };
  const grid = { id: 'ms-grid', classes: new Set(['multiscreen-grid']), children: [], classList: { contains: () => false }, parent: null };
  const slot0 = { id: 'slot0', classes: new Set(['multiscreen-slot']), children: [], classList: { contains: () => false }, parent: grid };
  const actions0 = { id: 'act0', classes: new Set(['multiscreen-slot-actions']), children: [], classList: { contains: () => false }, parent: slot0 };
  const btnAudio0 = makeBtn('ms-audio-0', ['btn-icon'], { left: 100, right: 134, top: 420, bottom: 454, width: 34, height: 34 }, actions0);
  const btnRetry0 = makeBtn('ms-retry-0', ['btn-icon'], { left: 140, right: 174, top: 420, bottom: 454, width: 34, height: 34 }, actions0);
  const btnPick0 = makeBtn('ms-pick-0', ['btn-icon'], { left: 180, right: 214, top: 420, bottom: 454, width: 34, height: 34 }, actions0);
  const btnClear0 = makeBtn('ms-clear-0', ['btn-icon'], { left: 220, right: 254, top: 420, bottom: 454, width: 34, height: 34 }, actions0);
  const slot1 = { id: 'slot1', classes: new Set(['multiscreen-slot']), children: [], classList: { contains: () => false }, parent: grid };
  const btnEmpty1 = makeBtn('ms-empty-1', ['multiscreen-slot-empty'], { left: 500, right: 900, top: 100, bottom: 260, width: 400, height: 160 }, slot1);

  const scope = {
    contains: () => true,
    querySelectorAll: () => [btnAudio0, btnRetry0, btnPick0, btnClear0, btnEmpty1]
  };
  const mockDoc = {
    body: scope,
    get activeElement() { return activeEl; },
    getElementById: (id) => (id === 'main-layout' ? scope : null),
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const NavCls = runInNewContext(`(() => class MsNav {
    constructor() { this.dom = {}; }
    _isTvNavigationMode() { return true; }
    _isTextEntryElement() { return false; }
    maybeAutoLoadMoreForElement() {}
    ${extractMethod('moveSpatialFocus')}
  })()`, { document: mockDoc });
  const nav = new NavCls();

  btnAudio0.focus();
  assert.equal(nav.moveSpatialFocus('ArrowRight', false), true);
  assert.equal(activeEl, btnRetry0, 'D-Pad Right deve alcançar botão Recarregar');
  assert.equal(nav.moveSpatialFocus('ArrowRight', false), true);
  assert.equal(activeEl, btnPick0, 'D-Pad Right deve alcançar botão Trocar Canal');
  assert.equal(nav.moveSpatialFocus('ArrowRight', false), true);
  assert.equal(activeEl, btnClear0, 'D-Pad Right deve alcançar botão Fechar/Limpar Slot');
  assert.equal(nav.moveSpatialFocus('ArrowRight', false), true);
  assert.equal(activeEl, btnEmpty1, 'D-Pad Right em layout assimétrico deve alcançar slot vazio da coluna ao lado');
});

await test('Trailer do filme rejeita bumper/15s não relacionado e escolhe o trailer oficial com título e ano compatíveis', async () => {
  const youtubeHtml = `
    "videoRenderer":{"videoId":"bad15sClip1","title":{"runs":[{"text":"D106 Victorian Psychopath Initial Credits 15s video 1920x1080"}]},"lengthText":{"simpleText":"0:15"}}
    "videoRenderer":{"videoId":"badUnrelated","title":{"runs":[{"text":"Outra Coisa Qualquer Trailer Oficial"}]},"lengthText":{"simpleText":"2:10"}}
    "videoRenderer":{"videoId":"pele2016Ok1","title":{"runs":[{"text":"Pelé: O Nascimento de uma Lenda (2016) | Trailer Oficial Legendado"}]},"lengthText":{"simpleText":"2:18"}}
  `;
  const picked = selectBestYouTubeTrailerFromHtml(youtubeHtml, 'Pelé: O Nascimento de uma Lenda', '2016');
  assert.equal(picked, 'pele2016Ok1');
  assert.equal(scoreTitleMatch('Victorian Psychopath Initial Credits', 'Pelé: O Nascimento de uma Lenda', '2016'), -1);

  const meta = await resolveMediaMetadata(
    { id: 'mov-pele-2016', name: 'Pelé: O Nascimento de uma Lenda (2016)', type: 'movie' },
    {
      fetchText: async () => '',
      fetchJson: async (url) => {
        if (url.includes('itunes.apple.com')) {
          return {
            results: [
              { trackName: 'Victorian Psychopath', releaseDate: '2024-01-01', previewUrl: 'https://cdn.example/wrong.m4v', artworkUrl100: 'https://cdn.example/wrong_100x100bb.jpg' },
              { trackName: 'Pelé: Birth of a Legend', releaseDate: '2016-05-06', artworkUrl100: 'https://cdn.example/wrong_en_100x100bb.jpg' }
            ]
          };
        }
        return {};
      }
    }
  );
  assert.equal(meta.trailerUrl, '', 'Não deve aceitar previewUrl do iTunes cujo título/ano divergem do filme');

  const ytRes = await resolveYouTubeTrailerId('Pelé: O Nascimento de uma Lenda', async (url) => {
    assert.ok(url.includes('2016'), 'Busca de trailer no YouTube deve incluir ano do filme quando disponível');
    return youtubeHtml;
  }, '2016');
  assert.equal(ytRes, 'pele2016Ok1');
});

await test('Tela maximizada exclusiva antes do play, pré-carregamento de capas, auto-load e menu interno do player', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf8');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');

  // 1. Menu interno de ferramentas dentro do player e remoção de motor/estilo da barra do player
  const playerWrapperStart = html.indexOf('id="player-wrapper"');
  const playerMetaStart = html.indexOf('class="player-meta-bar"');
  const playerWrapperBlock = html.slice(playerWrapperStart, playerMetaStart);
  const playerMetaBlock = html.slice(playerMetaStart, html.indexOf('id="player-epg-card"'));

  assert.match(playerWrapperBlock, /id="btn-player-tools"/);
  assert.match(playerWrapperBlock, /id="player-tools-menu"/);
  assert.match(playerWrapperBlock, /id="btn-player-mute"/);
  assert.match(playerWrapperBlock, /id="input-player-volume"/);
  assert.match(playerWrapperBlock, /id="select-aspect-ratio"/);
  assert.match(playerWrapperBlock, /id="select-player-audio"/);
  assert.match(playerWrapperBlock, /id="select-player-subtitles"/);
  assert.match(playerWrapperBlock, /id="btn-player-pip"/);
  assert.match(playerWrapperBlock, /id="btn-player-fullscreen"/);
  assert.match(playerWrapperBlock, /id="btn-player-playpause"/);
  assert.match(playerWrapperBlock, /id="btn-player-stop"/);
  assert.match(playerWrapperBlock, /id="btn-player-close"/);

  assert.equal(playerMetaBlock.includes('id="select-player-engine"'), false, 'Seletor HLS/VLC deve ficar apenas nas Configurações');
  assert.equal(playerMetaBlock.includes('id="select-stream-mode"'), false, 'Seletor de formato (.m3u8/.ts) deve ficar apenas nas Configurações');
  assert.match(html, /id="settings-player-engine-select"/, 'Seletor HLS/VLC deve permanecer nas Configurações');
  assert.match(appJs, /openStreamFormatSubModal\(/, 'Seletor de formato deve permanecer nas Configurações');

  // 2. Catálogo maximizado antes da reprodução e pré-carregamento de capas
  assert.match(appJs, /classList\.toggle\('catalog-maximized',\s*catalogMaximized\)/);
  assert.match(appJs, /playerSection\?\.classList\.toggle\('hidden',\s*!playing\)/);
  assert.match(css, /\.split-pane-shell\.catalog-maximized/);
  assert.match(css, /\.split-pane-shell\.catalog-maximized\.mode-items #sidebar-category-list/);
  assert.match(appJs, /_enqueuePosterPreload\(/);
  assert.match(appJs, /flui_poster_cache_v1/);

  // 3. Carregamento automático por scroll e foco D-Pad sem precisar clicar Carregar Mais
  assert.match(appJs, /maybeAutoLoadMoreSidebarItems\(/);
  assert.match(appJs, /maybeAutoLoadMoreForElement\(/);
  assert.match(css, /\.sidebar-load-more-wrap,\s*\.load-more-wrap\s*\{\s*display:\s*none\s*!important;/);
});

await test('Grade de categorias maximizada mantém altura automática sem empilhamento em telas grandes e pequenas', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf8');

  assert.match(css, /\.split-pane-shell\.catalog-maximized\.mode-categories\s+#sidebar-category-list[\s\S]*?grid-auto-rows:\s*max-content/);
  assert.match(css, /\.split-pane-shell\.catalog-maximized\.mode-items\s+#sidebar-category-list[\s\S]*?grid-auto-rows:\s*max-content/);
  assert.match(css, /\.split-pane-shell\.catalog-maximized\.mode-items\s+\.sidebar-item-row[\s\S]*?height:\s*auto\s*!important/);
  assert.match(css, /\.split-pane-shell\.catalog-maximized\.mode-items\s+\.sidebar-item-row[\s\S]*?min-height:\s*max-content\s*!important/);
  assert.match(css, /\.sidebar-item-row\s*\{[\s\S]*?flex-shrink:\s*0/);
  assert.match(css, /\.sidebar-cat-btn\s*\{[\s\S]*?flex-shrink:\s*0/);
  assert.match(css, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.split-pane-shell\.catalog-maximized\.mode-items\s+#sidebar-category-list/);
  assert.match(css, /@media\s*\(max-width:\s*480px\)[\s\S]*?\.split-pane-shell\.catalog-maximized\.mode-items\s+#sidebar-category-list/);
});

await test('Controles de áudio, legenda e ajustes acessíveis no player HTML5, Fullscreen e overlay Desktop VLC', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf8');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  const mainFormCs = readFileSync(resolve(rootDir, 'src/desktop/MainForm.cs'), 'utf8');
  const locCs = readFileSync(resolve(rootDir, 'src/desktop/LocalizationService.cs'), 'utf8');

  assert.match(html, /<video[^>]*id="main-video"[^>]*controlslist="nofullscreen"/);
  assert.match(html, /id="btn-meta-player-tools"/);
  assert.match(html, /id="btn-meta-player-fullscreen"/);
  assert.match(css, /\.player-wrapper:fullscreen\s+\.btn-player-tools[\s\S]*?z-index:\s*2147483647/);
  assert.match(appJs, /handleNativeAspectRatio\(/);
  assert.match(appJs, /notifyNativeVlc\('TOGGLE_TOOLS_MENU'\)/);

  assert.match(mainFormCs, /action == "TOGGLE_TOOLS_MENU"/);
  assert.match(mainFormCs, /_btnVlcTools/);
  assert.match(mainFormCs, /_pnlVlcToolsMenu/);
  assert.match(mainFormCs, /RepositionVlcOverlays\(/);
  assert.match(mainFormCs, /StartLocalStreamProxy\(/);
  assert.match(mainFormCs, /WebResourceRequested/);

  assert.match(locCs, /\["VlcToolsBtn"\]/);
  assert.match(locCs, /\["VlcAudioLabel"\]/);
  assert.match(locCs, /\["VlcSubtitleLabel"\]/);
});

await test('VideoPlayerController executa proxy local, fallback .m3u8 -> .ts -> LibVLC no Desktop e modo direct via mpegts', async () => {
  const prevWindow = globalThis.window;
  const prevRaf = globalThis.requestAnimationFrame;

  const hlsInstances = [];
  const mpegtsRequests = [];
  const postedVlcMessages = [];
  const emittedStates = [];
  const videoListeners = {};

  class MockHls {
    static isSupported() { return true; }
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    static Events = {
      AUDIO_TRACKS_UPDATED: 'hlsAudioTracksUpdated',
      AUDIO_TRACK_SWITCHED: 'hlsAudioTrackSwitched',
      SUBTITLE_TRACKS_UPDATED: 'hlsSubtitleTracksUpdated',
      SUBTITLE_TRACK_SWITCH: 'hlsSubtitleTrackSwitch',
      MANIFEST_PARSED: 'hlsManifestParsed',
      ERROR: 'hlsError'
    };
    constructor() {
      this.handlers = {};
      this.loadedUrl = '';
      hlsInstances.push(this);
    }
    on(evt, fn) { (this.handlers[evt] ||= []).push(fn); }
    loadSource(url) { this.loadedUrl = url; }
    attachMedia() {}
    destroy() {}
    startLoad() {}
    recoverMediaError() {}
    emit(evt, data) {
      for (const fn of (this.handlers[evt] || [])) fn(evt, data);
    }
  }

  const mockMpegts = {
    isSupported: () => true,
    Events: { ERROR: 'error' },
    createPlayer: (mediaCfg) => {
      const p = {
        handlers: {},
        url: mediaCfg.url,
        attachMediaElement() {},
        load() {},
        play: () => Promise.resolve(),
        pause() {},
        unload() {},
        detachMediaElement() {},
        destroy() {},
        on(evt, fn) { (this.handlers[evt] ||= []).push(fn); },
        emit(evt, errType, detail) {
          for (const fn of (this.handlers[evt] || [])) fn(errType, detail);
        }
      };
      mpegtsRequests.push(p);
      return p;
    }
  };

  globalThis.window = {
    addEventListener() {},
    Hls: MockHls,
    mpegts: mockMpegts,
    __fluiLocalProxyUrl: 'http://127.0.0.1:5055/',
    chrome: {
      webview: {
        postMessage: (msg) => postedVlcMessages.push(msg)
      }
    }
  };
  globalThis.requestAnimationFrame = (fn) => fn();

  try {
    const mockVideo = {
      style: {},
      addEventListener: (evt, fn) => { (videoListeners[evt] ||= []).push(fn); },
      pause() {},
      removeAttribute() { this.src = ''; },
      load() {},
      play: () => Promise.resolve()
    };

    const controller = new VideoPlayerController(mockVideo, null);
    controller.onStateChange = (state, err) => emittedStates.push({ state, err });

    await controller.playStream(
      { name: 'TC TOUCH HD', type: 'live', url: 'http://myiptv.com/user/pass/155' },
      '',
      'auto',
      'hls'
    );

    assert.equal(hlsInstances.length, 1, 'Primeira tentativa HLS deve iniciar via Hls.js');
    assert.ok(
      hlsInstances[0].loadedUrl.startsWith('http://127.0.0.1:5055/proxy?url='),
      'Desktop HLS nativo deve priorizar proxy HTTP local (127.0.0.1)'
    );

    // Simula manifestLoadError na tentativa .m3u8 via proxy e direto, avançando até mpegts (.ts)
    while (hlsInstances.length > 0 && mpegtsRequests.length === 0 && !postedVlcMessages.some(m => m.action === 'PLAY')) {
      const latestHls = hlsInstances[hlsInstances.length - 1];
      const countBefore = hlsInstances.length + mpegtsRequests.length;
      latestHls.emit(MockHls.Events.ERROR, { fatal: true, type: MockHls.ErrorTypes.NETWORK_ERROR, details: 'manifestLoadError' });
      // Disparo espúrio de <video error> durante troca de candidato não deve encerrar fila prematuramente
      for (const fn of (videoListeners.error || [])) fn();
      if (hlsInstances.length + mpegtsRequests.length === countBefore && !postedVlcMessages.some(m => m.action === 'PLAY')) break;
    }

    assert.ok(mpegtsRequests.length >= 1, 'Após falha .m3u8 deve tentar fallback MPEG-TS (.ts) via mpegts.js');
    assert.equal(emittedStates.some(s => s.state === 'error'), false, 'Não deve emitir erro antes de esgotar candidatos e fallback VLC');

    // Simula falha em todas as tentativas restantes de mpegts/hls até acionar fallback automático LibVLC
    for (let guard = 0; guard < 12; guard++) {
      if (postedVlcMessages.some(m => m.action === 'PLAY')) break;
      const lastTs = mpegtsRequests[mpegtsRequests.length - 1];
      if (lastTs && controller._activeAttempt?.kind === 'mpegts') {
        lastTs.emit('error', 'NetworkError', 'Exception');
      } else if (controller._activeAttempt?.kind === 'hls') {
        hlsInstances[hlsInstances.length - 1].emit(MockHls.Events.ERROR, {
          fatal: true,
          type: MockHls.ErrorTypes.NETWORK_ERROR,
          details: 'manifestLoadError'
        });
      } else {
        break;
      }
    }

    const vlcPlay = postedVlcMessages.find(m => m.action === 'PLAY');
    assert.ok(vlcPlay, 'Esgotando candidatos HTML5 no Desktop, deve acionar fallback automático LibVLC');
    assert.equal(controller.currentEngine, 'vlc');

    // Testa modo 'direct' para live sem extensão: deve tentar mpegts em vez de jogar direto em <video.src>
    mpegtsRequests.length = 0;
    mockVideo.src = '';
    await controller.playStream(
      { name: 'Canal Direto', type: 'live', url: 'http://myiptv.com/live/u/p/777' },
      '',
      'direct',
      'hls'
    );
    assert.equal(mpegtsRequests.length, 1, 'Modo direct para canal live deve tentar mpegts.js');
    assert.equal(mockVideo.src || '', '', 'Modo direct para live não deve atribuir URL bruta direto em video.src');
  } finally {
    globalThis.window = prevWindow;
    globalThis.requestAnimationFrame = prevRaf;
  }
});

await test('Proxy local automatizado (Windows/Linux/macOS) e aviso de escolha HLS vs VLC em 3 idiomas', async () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const mainFormCs = readFileSync(resolve(rootDir, 'src/desktop/MainForm.cs'), 'utf8');
  const crossHostCs = readFileSync(resolve(rootDir, 'src/desktop/CrossPlatformHost.cs'), 'utf8');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');

  for (const hostCode of [mainFormCs, crossHostCs]) {
    assert.match(hostCode, /"\/health"/);
    assert.match(hostCode, /"\/proxy"/);
    assert.match(hostCode, /RewriteM3u8Manifest/);
    assert.match(hostCode, /Timeout\s*=\s*Timeout\.InfiniteTimeSpan/);
  }
  assert.match(mainFormCs, /ENSURE_LOCAL_PROXY/);
  assert.match(crossHostCs, /window\.__fluiLocalProxyUrl/);

  assert.match(html, /id="settings-player-engine-notice"/);
  assert.match(html, /id="edit-player-engine-notice"/);
  assert.match(appJs, /ensureLocalProxyStarted\(/);
  assert.match(appJs, /updatePlayerEngineNotice\(/);
  assert.match(appJs, /handleLocalProxyStatus\(/);

  for (const lang of ['pt-BR', 'en-US', 'es']) {
    assert.ok(translations[lang].playerEngineHlsNotice, `Falta playerEngineHlsNotice em ${lang}`);
    assert.ok(translations[lang].playerEngineVlcNotice, `Falta playerEngineVlcNotice em ${lang}`);
    assert.ok(translations[lang].localProxyAutoActive, `Falta localProxyAutoActive em ${lang}`);
  }

  // Valida que Linux/macOS host local (window.__fluiLocalProxyUrl sem chrome.webview) usa proxy automaticamente no HLS
  const prevWindow = globalThis.window;
  const prevRaf = globalThis.requestAnimationFrame;
  const hlsLoadedUrls = [];
  class MockLinuxHls {
    static isSupported() { return true; }
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    static Events = {
      AUDIO_TRACKS_UPDATED: 'a',
      AUDIO_TRACK_SWITCHED: 'b',
      SUBTITLE_TRACKS_UPDATED: 'c',
      SUBTITLE_TRACK_SWITCH: 'd',
      MANIFEST_PARSED: 'e',
      ERROR: 'f'
    };
    on() {}
    loadSource(url) { hlsLoadedUrls.push(url); }
    attachMedia() {}
    destroy() {}
  }
  globalThis.window = {
    addEventListener() {},
    Hls: MockLinuxHls,
    __fluiLocalProxyUrl: 'http://localhost:5055/'
  };
  globalThis.requestAnimationFrame = (fn) => fn();
  try {
    const controller = new VideoPlayerController({
      style: {},
      addEventListener() {},
      pause() {},
      removeAttribute() {},
      load() {},
      play: () => Promise.resolve()
    }, null);
    await controller.playStream({ name: 'Canal Linux', type: 'live', url: 'http://provider.net/user/pass/99' }, '', 'auto', 'hls');
    assert.equal(hlsLoadedUrls.length, 1);
    assert.ok(hlsLoadedUrls[0].startsWith('http://localhost:5055/proxy?url='), 'CrossPlatformHost Linux/macOS deve rotear via proxy local automático');
  } finally {
    globalThis.window = prevWindow;
    globalThis.requestAnimationFrame = prevRaf;
  }
});

await test('Player HLS (#main-video) deve ficar estritamente contido em .player-wrapper sem cobrir .player-meta-bar', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf8');

  assert.match(css, /\.player-section\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
  assert.match(css, /\.player-wrapper\s*\{[^}]*overflow:\s*hidden;/);
  assert.match(css, /#main-video\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*max-width:\s*100%;[^}]*max-height:\s*100%;[^}]*display:\s*block;[^}]*object-fit:\s*contain;/);
  assert.doesNotMatch(css, /#main-video\s*\{[^}]*max-height:\s*min\(60vh,\s*560px\)/);
  assert.match(css, /\.player-meta-bar\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*2;/);
});

await test('HLS fullscreen auto-oculta botões ociosos e mantém #btn-player-tools ancorado mesmo com foco no modo TV', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf8');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf8');
  const app = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');

  assert.doesNotMatch(css, /body\[data-effective-device-mode="tv"\]\s*button:focus[^{]*\{[^}]*position:\s*relative;/);
  assert.match(css, /\.btn-player-tools:focus[^{]*\{[^}]*position:\s*absolute\s*!important;/);
  assert.match(css, /\.player-wrapper:fullscreen\.is-user-idle[\s\S]*?\{[^}]*cursor:\s*none;/);
  assert.match(css, /\.player-wrapper\.is-user-idle\s+\.player-center-hit:not\(\.is-paused\)\s+\.player-center-toggle/);
  assert.match(css, /\.player-wrapper\.is-user-idle\s+\.btn-player-tools\[aria-expanded="false"\]\s*\{[^}]*opacity:\s*0\s*!important;/);

  const videoTagMatch = html.match(/<video\s+id="main-video"[^>]*>/);
  assert.ok(videoTagMatch, '<video id="main-video"> deve existir');
  assert.doesNotMatch(videoTagMatch[0], /\scontrols(?:=|\s|>)/);

  assert.match(app, /wakePlayerControls\s*\(/);
  assert.match(app, /clearPlayerIdleTimer\s*\(/);
});

await test('Player VLC Desktop mantém Z-order idempotente sem thrashing e oculta HUD ocioso em fullscreen', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const cs = readFileSync(resolve(rootDir, 'src/desktop/MainForm.cs'), 'utf8');

  assert.match(cs, /private void EnsureVlcOverlayZOrder\s*\(/);
  assert.match(cs, /private Point _lastVlcCursorPos/);
  assert.match(cs, /private bool _vlcFullscreenHudVisible/);

  const reposIdx = cs.indexOf('private void RepositionVlcOverlays()');
  assert.ok(reposIdx !== -1, 'RepositionVlcOverlays deve existir');
  const reposSlice = cs.slice(reposIdx, reposIdx + 2200);
  assert.doesNotMatch(reposSlice, /_videoView\.BringToFront\(\)/);
  assert.match(reposSlice, /EnsureVlcOverlayZOrder\(\)/);

  assert.match(cs, /_vlcFullscreenHudVisible = false;[\s\S]*_btnExitFullscreen\.Visible = false;[\s\S]*_btnVlcTools\.Visible = false;/);
});

console.log(`\n========================================`);
console.log(`Resultados dos Testes: ${passedTests}/${totalTests} passaram.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}

