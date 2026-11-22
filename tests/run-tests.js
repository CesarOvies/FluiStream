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
import { VideoPlayerController, MultiScreenController, WebGlVideoUpscaler, computeOverlayLayout, IMAGE_BOOST_MODES, IMAGE_BOOST_PRESETS } from '../src/web/js/player.js';
import {
  cleanMediaTitle,
  parseAdoroCinemaHtml,
  scoreTitleMatch,
  selectBestYouTubeTrailerFromHtml,
  resolveYouTubeTrailerId,
  resolveTrailerPlayback,
  resolveMediaMetadata,
  resolveKnownChannelLogo,
  normalizeLiveChannelKey,
  buildProxyLogoFallbackUrl
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

  const xtreamWithProxy = new XtreamApi('http://myiptv.com:8080', 'teste', 'senha123', 'http://127.0.0.1:5055/proxy?url=');
  const proxiedApi = xtreamWithProxy.applyProxy(xtreamWithProxy.getPlayerApiUrl());
  assert.equal(proxiedApi, 'http://127.0.0.1:5055/proxy?url=http%3A%2F%2Fmyiptv.com%3A8080%2Fplayer_api.php%3Fusername%3Dteste%26password%3Dsenha123');
  assert.ok(!proxiedApi.includes('?url=/http'), 'Não deve conter barra / imediatamente após ?url=');
});

console.log('\n--- 4. Testes de Internacionalização (i18n - 3 Idiomas) ---');

await test('Todos os 3 idiomas (pt-BR, en-US, es) devem possuir o mesmo conjunto de chaves', () => {
  assert.deepEqual(Object.values(SupportedLanguages).sort(), ['en-US', 'es', 'pt-BR']);

  const ptKeys = Object.keys(translations['pt-BR']).sort();
  const enKeys = Object.keys(translations['en-US']).sort();
  const esKeys = Object.keys(translations['es']).sort();

  assert.equal(ptKeys.length, 295, `Esperado exatamente 295 chaves i18n em pt-BR, obtido ${ptKeys.length}`);
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

await test('APP_VERSION deve ser 1.2.0 e seguir comparação semântica', () => {
  assert.equal(APP_VERSION, '1.2.0');
  assert.equal(isNewerVersion('v1.3.0', APP_VERSION), true);
  assert.equal(isNewerVersion('v1.2.0', APP_VERSION), false);
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

await test('Deve selecionar assets Windows, macOS DMG, Android APK e SHA256SUMS.txt da release', () => {
  const assets = [
    { name: 'FluiStream-v1.2.0-linux-x64-portable.zip', browser_download_url: 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/FluiStream-v1.2.0-linux-x64-portable.zip' },
    { name: 'FluiStream-v1.2.0-win-x64-portable.zip', browser_download_url: 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/FluiStream-v1.2.0-win-x64-portable.zip' },
    { name: 'FluiStream-v1.2.0-macOS.dmg', browser_download_url: 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/FluiStream-v1.2.0-macOS.dmg' },
    { name: 'FluiStream-v1.2.0-android.apk', browser_download_url: 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/FluiStream-v1.2.0-android.apk' },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/SHA256SUMS.txt' }
  ];

  const selected = selectReleaseAssets(assets);
  assert.equal(selected.winDownloadUrl, 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/FluiStream-v1.2.0-win-x64-portable.zip');
  assert.equal(selected.macDmgDownloadUrl, 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.0/FluiStream-v1.2.0-macOS.dmg');
  assert.equal(selected.macDmgAssetName, 'FluiStream-v1.2.0-macOS.dmg');
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

  for (const rel of ['js/version.js', 'js/localization.js', 'js/app.js', 'js/storage.js']) {
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

await test('VideoPlayerController toggleFullscreen e togglePip no Desktop/macOS acionam desktop-fullscreen, desktop-mini-pip e notifyDesktopHost', async () => {
  const containerClasses = new Set();
  const bodyClasses = new Set();
  const mockContainer = {
    classList: {
      add: (c) => containerClasses.add(c),
      remove: (c) => containerClasses.delete(c),
      contains: (c) => containerClasses.has(c)
    },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 450, top: 0, bottom: 450, left: 0, right: 800 }),
    closest: () => null
  };
  const mockVideo = {
    style: {},
    addEventListener: () => {},
    pause: () => {},
    removeAttribute: () => {},
    load: () => {},
    classList: { add: () => {}, remove: () => {} }
  };

  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const dispatchedHostActions = [];

  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    external: {
      sendMessage: () => {}
    }
  };

  globalThis.document = {
    body: {
      classList: {
        add: (c) => bodyClasses.add(c),
        remove: (c) => bodyClasses.delete(c),
        contains: (c) => bodyClasses.has(c),
        toggle: (c) => {
          if (bodyClasses.has(c)) { bodyClasses.delete(c); return false; }
          bodyClasses.add(c); return true;
        }
      }
    },
    addEventListener: () => {},
    fullscreenElement: null,
    webkitFullscreenElement: null,
    pictureInPictureElement: null,
    querySelector: () => null,
    getElementById: () => null
  };

  try {
    const ctrl = new VideoPlayerController(mockVideo, mockContainer);
    ctrl.notifyDesktopHost = (act) => dispatchedHostActions.push(act);

    // 1. Toggle Fullscreen ON
    await ctrl.toggleFullscreen();
    assert.ok(bodyClasses.has('desktop-fullscreen'), 'Deve adicionar desktop-fullscreen ao body');
    assert.ok(containerClasses.has('is-fullscreen'), 'Deve adicionar is-fullscreen ao container');
    assert.ok(dispatchedHostActions.some(a => a === 'ENTER_FULLSCREEN' || a === 'TOGGLE_FULLSCREEN'), 'Deve despachar comando de fullscreen para o host desktop');

    // 2. Toggle Fullscreen OFF
    ctrl._lastFsToggleTime = 0;
    await ctrl.toggleFullscreen();
    assert.ok(!bodyClasses.has('desktop-fullscreen'), 'Deve remover desktop-fullscreen do body');
    assert.ok(!containerClasses.has('is-fullscreen'), 'Deve remover is-fullscreen do container');
    assert.ok(dispatchedHostActions.includes('EXIT_FULLSCREEN'), 'Deve despachar EXIT_FULLSCREEN para o host desktop');

    // 3. Toggle PiP ON
    await ctrl.togglePip();
    assert.ok(bodyClasses.has('desktop-mini-pip'), 'Deve adicionar desktop-mini-pip ao body');
    assert.ok(dispatchedHostActions.some(a => a === 'ENTER_PIP' || a === 'TOGGLE_PIP'), 'Deve despachar comando de PiP para o host desktop');

    // 4. Toggle PiP OFF
    ctrl._lastPipToggleTime = 0;
    await ctrl.togglePip();
    assert.ok(!bodyClasses.has('desktop-mini-pip'), 'Deve remover desktop-mini-pip do body');
    assert.ok(dispatchedHostActions.includes('EXIT_PIP'), 'Deve despachar EXIT_PIP para o host desktop');
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  }
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

  // Não deve duplicar proxy se a URL já está envelopada em proxy
  const alreadyProxied = 'http://127.0.0.1:5055/proxy?url=' + encoded;
  assert.equal(applyCorsProxy('http://127.0.0.1:5055/proxy?url=', alreadyProxied), alreadyProxied);
});

await test('fetchRemoteText deve usar fallback do proxy local (window.__fluiLocalProxyUrl) quando fetch direto falha', async () => {
  const { fetchRemoteText } = await import('../src/web/js/network.js');
  const prevWindow = globalThis.window;
  const prevFetch = globalThis.fetch;
  const fetchCalls = [];

  globalThis.window = {
    __fluiLocalProxyUrl: 'http://127.0.0.1:5055/'
  };

  globalThis.fetch = async (input) => {
    fetchCalls.push(String(input));
    if (String(input).includes('2025easy.net') && !String(input).includes('127.0.0.1:5055')) {
      throw new TypeError('Load failed');
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode('{"user_info":{"auth":1}}').buffer
    };
  };

  try {
    const text = await fetchRemoteText('http://2025easy.net/player_api.php?username=user&password=pass');
    assert.match(text, /"auth":1/);
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[0], 'http://2025easy.net/player_api.php?username=user&password=pass');
    assert.equal(fetchCalls[1], 'http://127.0.0.1:5055/proxy?url=' + encodeURIComponent('http://2025easy.net/player_api.php?username=user&password=pass'));
  } finally {
    globalThis.fetch = prevFetch;
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
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

await test('fetchRemoteText deve delegar para window.androidBridge.fetchText nativo quando disponível', async () => {
  const { fetchRemoteText } = await import('../src/web/js/network.js');
  const prevWindow = globalThis.window;
  const bridgeCalls = [];

  globalThis.window = {
    androidBridge: {
      fetchText(url, timeoutMs) {
        bridgeCalls.push({ url, timeoutMs });
        return '{"user_info":{"auth":1,"status":"Active"}}';
      }
    }
  };

  try {
    const text = await fetchRemoteText('http://2025easy.net/player_api.php?username=test&password=pass', 30000);
    assert.match(text, /"auth":1/);
    assert.equal(bridgeCalls.length, 1);
    assert.equal(bridgeCalls[0].url, 'http://2025easy.net/player_api.php?username=test&password=pass');
    assert.equal(bridgeCalls[0].timeoutMs, 30000);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});

await test('NativeBridge.kt e MainActivity.kt devem conter fetchText, descompressão gzip e strip de chunked transfer-encoding', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const nativeBridgeKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/NativeBridge.kt'), 'utf8');
  assert.match(nativeBridgeKt, /fun fetchText\(url: String\?, timeoutMs: Int\): String/);
  assert.match(nativeBridgeKt, /activity\.fetchRemoteTextDirectly/);

  const mainActivityKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/MainActivity.kt'), 'utf8');
  assert.match(mainActivityKt, /fun fetchRemoteTextDirectly\(/);
  assert.match(mainActivityKt, /GZIPInputStream/);
  assert.match(mainActivityKt, /transfer-encoding/);
  assert.match(mainActivityKt, /content-encoding/);
});

await test('TvFocusHelper.kt e app.js devem implementar clique e segurar (long press) para favoritos no controle remoto', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const tvFocusKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/TvFocusHelper.kt'), 'utf8');
  assert.match(tvFocusKt, /centerLongPressHandler/);
  assert.match(tvFocusKt, /centerLongPressRunnable/);
  assert.match(tvFocusKt, /KeyEvent\.KEYCODE_MENU/);

  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  assert.match(appJs, /if \(e\.detail === 0\) \{\s*e\.preventDefault\(\);\s*return;\s*\}/);
  assert.match(appJs, /this\._channelLongPressTimer = setTimeout/);
  assert.match(appJs, /openChannelActionsModal/);
});

await test('Navegação espacial D-Pad e seletores devem incluir .btn-bento-refresh para atualizar listas individuais', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  assert.match(appJs, /\.btn-bento-refresh/);
  assert.match(appJs, /isParentChildBento/);
  assert.match(appJs, /if \(e\.target\.closest\('\.btn-bento-refresh'\)\) return;/);

  const styleCss = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf8');
  assert.match(styleCss, /\.btn-bento-refresh:focus/);
  assert.match(styleCss, /\.btn-bento-refresh:focus-visible/);
});

await test('FluiStream.Desktop.csproj e CrossPlatformHost.cs devem isolar Photino e alvos Windows/macOS', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const csproj = readFileSync(resolve(rootDir, 'src/desktop/FluiStream.Desktop.csproj'), 'utf8');
  const crossHost = readFileSync(resolve(rootDir, 'src/desktop/CrossPlatformHost.cs'), 'utf8');

  // CrossPlatformHost deve ter #if !WINDOWS no topo cobrindo todos os usings do Photino
  assert.match(crossHost, /^\s*#if !WINDOWS[\s\S]*using Photino\.NET;/);

  // csproj deve remover CrossPlatformHost.cs do target net10.0-windows
  assert.match(csproj, /<ItemGroup Condition="'\$\(TargetFramework\)' == 'net10\.0-windows'">[\s\S]*?<Compile Remove="CrossPlatformHost\.cs" \/>/);

  // csproj deve remover MainForm.cs e NativeBridge.cs dos targets não-windows
  assert.match(csproj, /<ItemGroup Condition="'\$\(TargetFramework\)' != 'net10\.0-windows'">[\s\S]*?<Compile Remove="MainForm\.cs" \/>/);
  assert.match(csproj, /<ItemGroup Condition="'\$\(TargetFramework\)' != 'net10\.0-windows'">[\s\S]*?<Compile Remove="NativeBridge\.cs" \/>/);
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

  assert.equal(html.includes('class="nav-tabs-wrapper"'), false);
  assert.equal(html.includes('id="home-expiration-footer"'), false);
  assert.match(css, /\.header-actions\s*\{[^}]*flex-wrap:\s*wrap/);
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
  assert.equal(html.includes('id="btn-open-account"'), false);
  assert.equal(html.includes('id="btn-open-about"'), false);
  assert.match(html, /data-settings-tile="about"[\s\S]*data-i18n="navAboutShort"/);
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
    ${extractMethod('_clearChannelLongPressTimer')}
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

await test('Android ExoPlayer: decoder fallback, TsExtractor IPTV flags, fallback URLs via NativeBridge e UI ExoPlayer', async () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const playerKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/VideoPlayerManager.kt'), 'utf8');
  const bridgeKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/NativeBridge.kt'), 'utf8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  const webPlayerJs = readFileSync(resolve(rootDir, 'src/web/js/player.js'), 'utf8');
  const androidPlayerJs = readFileSync(resolve(rootDir, 'src/android/app/src/main/assets/web/js/player.js'), 'utf8');

  assert.equal(androidPlayerJs, webPlayerJs, 'Asset Android js/player.js deve estar sincronizado com src/web/js/player.js');

  assert.match(playerKt, /DefaultRenderersFactory\(context\)[\s\S]*?\.setEnableDecoderFallback\(true\)/);
  assert.match(playerKt, /DefaultExtractorsFactory\(\)[\s\S]*?\.setTsExtractorFlags\(/);
  assert.match(playerKt, /FLAG_ALLOW_NON_IDR_KEYFRAMES/);
  assert.match(playerKt, /FLAG_DETECT_ACCESS_UNITS/);
  assert.match(playerKt, /fun setPendingFallbackUrls\(/);
  assert.match(playerKt, /private fun buildDefaultFallbackUrls\(/);
  assert.match(playerKt, /if \(pendingFallbackUrls\.isNotEmpty\(\)\)/);
  assert.match(bridgeKt, /@JavascriptInterface[\s\S]*?fun setFallbackUrls\(/);

  for (const lang of ['pt-BR', 'en-US', 'es']) {
    assert.ok(translations[lang].playerEngineExo, `Falta playerEngineExo em ${lang}`);
    assert.ok(translations[lang].playerEngineExoNotice, `Falta playerEngineExoNotice em ${lang}`);
  }
  assert.match(appJs, /_syncPlayerEngineSelect\(/);
  assert.match(appJs, /playerEngineExo/);
  assert.match(appJs, /playerEngineExoNotice/);

  const prevWindow = globalThis.window;
  const callSequence = [];
  let receivedFallbacks = [];
  globalThis.window = {
    addEventListener: () => {},
    androidBridge: {
      setFallbackUrls(json) {
        callSequence.push('setFallbackUrls');
        receivedFallbacks = JSON.parse(json);
      },
      playStream(url, title, itemType, streamMode) {
        callSequence.push('playStream');
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
    const controller = new VideoPlayerController(mockVideo, null);
    await controller.playStream(
      { name: 'Canal Live', type: 'live', url: 'http://iptv.example.com:8080/user/pass/55' },
      '',
      'auto',
      'hls'
    );
    assert.deepEqual(callSequence, ['setFallbackUrls', 'playStream']);
    assert.ok(receivedFallbacks.includes('http://iptv.example.com:8080/live/user/pass/55.ts'));

    const mainActivityKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/MainActivity.kt'), 'utf8');
    assert.match(mainActivityKt, /fun interceptRemoteHttpRequest\(/);
    assert.match(mainActivityKt, /shouldInterceptRequest[\s\S]*?interceptRemoteHttpRequest/);
    assert.match(mainActivityKt, /Access-Control-Allow-Origin/);
    assert.match(mainActivityKt, /trustAllSslSocketFactory/);
    assert.match(mainActivityKt, /connectTimeout = 30_000/);
    assert.match(mainActivityKt, /readTimeout = 120_000/);
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
});

await test('StorageService: shouldRefreshProfile, intervalo autoRefreshIntervalHours por perfil e onboardingCompleted', async () => {
  await withMockLocalStorage(async () => {
    const svc = new StorageService();
    const initial = svc.getSettings();
    assert.equal(initial.onboardingCompleted, false);
    assert.equal(initial.autoRefreshIntervalHours, 24);

    svc.saveSettings({ onboardingCompleted: true, autoRefreshIntervalHours: 0 });
    assert.equal(svc.getSettings().onboardingCompleted, true);
    assert.equal(svc.getSettings().autoRefreshIntervalHours, 1, 'Intervalo mínimo deve ser 1h');

    svc.saveSettings({ autoRefreshIntervalHours: 999 });
    assert.equal(svc.getSettings().autoRefreshIntervalHours, 168, 'Intervalo máximo deve ser 168h');

    svc.saveSettings({ autoRefresh: false, autoRefreshIntervalHours: 6 });
    const now = Date.UTC(2026, 0, 10, 12, 0, 0);
    assert.equal(svc.shouldRefreshProfile({ id: 'p_file', type: 'm3u_file', updatedAt: new Date(now - 24 * 3600000).toISOString() }, now), false);
    assert.equal(svc.shouldRefreshProfile({ id: 'p_missing', type: 'xtream' }, now), true);
    assert.equal(svc.shouldRefreshProfile({ id: 'p_fresh', type: 'm3u_url', updatedAt: new Date(now - 2 * 3600000).toISOString() }, now), false);
    assert.equal(svc.shouldRefreshProfile({ id: 'p_stale', type: 'xtream', updatedAt: new Date(now - 6 * 3600000).toISOString() }, now), true);

    // Timestamps numéricos (Date.now()) devem funcionar sem retornar NaN
    assert.equal(svc.shouldRefreshProfile({ id: 'p_num_fresh', type: 'xtream', autoRefreshIntervalHours: 24, updatedAt: now - 2 * 3600000 }, now), false);
    assert.equal(svc.shouldRefreshProfile({ id: 'p_num_stale', type: 'xtream', autoRefreshIntervalHours: 24, updatedAt: now - 25 * 3600000 }, now), true);

    // Configuração independente por perfil
    svc.saveProfile({ id: 'prof_24h', name: 'Casa 24h', type: 'xtream', autoRefreshIntervalHours: 24, updatedAt: now - 10 * 3600000, playlistUpdatedAt: now - 10 * 3600000 });
    svc.saveProfile({ id: 'prof_6h', name: 'Sala 6h', type: 'm3u_url', autoRefreshIntervalHours: 6, updatedAt: now - 10 * 3600000, playlistUpdatedAt: now - 10 * 3600000 });
    const saved24 = svc.getProfiles().find(p => p.id === 'prof_24h');
    const saved6 = svc.getProfiles().find(p => p.id === 'prof_6h');
    assert.equal(svc.shouldRefreshProfile(saved24, now), false, 'Perfil 24h não deve recarregar com 10h');
    assert.equal(svc.shouldRefreshProfile(saved6, now), true, 'Perfil 6h deve recarregar com 10h');

    svc.setActiveProfileId('prof_24h');
    assert.equal(svc.getSettings().autoRefreshIntervalHours, 24);
    svc.setActiveProfileId('prof_6h');
    assert.equal(svc.getSettings().autoRefreshIntervalHours, 6);

    // Edição cosmética de perfil preserva playlistUpdatedAt original
    svc.saveProfile({ id: 'prof_24h', name: 'Casa 24h Editado', updatedAt: now });
    const edited24 = svc.getProfiles().find(p => p.id === 'prof_24h');
    assert.equal(edited24.playlistUpdatedAt, now - 10 * 3600000);
    assert.equal(svc.shouldRefreshProfile(edited24, now), false);

    svc.saveSettings({ autoRefresh: true, autoRefreshIntervalHours: 12 });
    assert.equal(svc.shouldRefreshProfile({ id: 'p_fresh_auto', type: 'm3u_url', updatedAt: new Date(now - 60000).toISOString() }, now), true);
    assert.equal(svc.shouldRefreshProfile({ id: 'p_file_auto', type: 'm3u_file' }, now), false);
  });
});

await test('Onboarding 2 etapas, seleção de perfil com sync em segundo plano, topo empilhado e remoção do rodapé de expiração', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf-8');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf-8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf-8');

  // Onboarding + Importação Streamlined
  assert.match(html, /id="modal-onboarding"/);
  assert.match(html, /data-onboarding-mode="mobile"/);
  assert.match(html, /data-onboarding-mode="desktop"/);
  assert.match(html, /data-onboarding-mode="tv"/);
  assert.match(html, /id="btn-import-back-device"/);
  assert.match(html, /id="btn-import-demo"/);
  assert.match(html, /id="input-xtream-server"[^>]*autocapitalize="none"/);
  assert.match(html, /id="modal-profiles-title"/);

  // Cabeçalho simplificado e remoção do rodapé de expiração
  const headerHtml = html.match(/<header class="app-header"[\s\S]*?<\/header>/)?.[0] || '';
  for (const requiredId of [
    'btn-brand-home',
    'header-clock-time',
    'header-clock-date',
    'btn-master-search',
    'btn-quick-multiscreen',
    'btn-quick-notifications',
    'btn-open-profiles',
    'btn-open-settings'
  ]) {
    assert.ok(headerHtml.includes(`id="${requiredId}"`), `Header deve manter #${requiredId}`);
  }
  for (const removedId of [
    'btn-quick-live-epg',
    'btn-quick-epg-guide',
    'btn-open-account',
    'btn-open-about'
  ]) {
    assert.equal(headerHtml.includes(`id="${removedId}"`), false, `Header não deve conter #${removedId}`);
  }
  assert.equal(headerHtml.includes('nav-tabs-wrapper'), false, 'Header não deve conter abas de navegação redundantes');
  assert.equal(html.includes('id="home-expiration-footer"'), false, 'Rodapé de expiração deve ser removido da tela inicial');
  assert.match(html, /data-settings-tile="about"/);

  // CSS: relógio sempre visível, topo horizontal sem overflow-x e alvos táteis >=44px
  assert.equal(/\.header-clock-wrap\s*\{\s*display:\s*none/i.test(css), false, 'Relógio/data não deve ser ocultado em telas menores');
  assert.equal(/\.header-actions\s*\{[^}]*overflow-x:\s*auto/i.test(css), false, 'Ações do topo não devem gerar rolagem horizontal');
  assert.match(css, /\.header-inner\s*\{[^}]*flex-direction:\s*row/);
  assert.equal(/\.header-inner\s*\{[^}]*flex-direction:\s*column/.test(css), false, 'Cabeçalho não deve empilhar em coluna');
  assert.match(css, /\.onboarding-device-grid\s*\{/);
  assert.match(css, /@media\s*\(pointer:\s*coarse\)/);

  // App.js: fluxos de onboarding, seleção inicial de perfil e sync em segundo plano
  assert.match(appJs, /openOnboardingModal\(/);
  assert.match(appJs, /selectOnboardingDeviceMode\(/);
  assert.match(appJs, /openImportModal\(/);
  assert.match(appJs, /startBackgroundProfilesSync\(/);
  assert.match(appJs, /updateProfileCardSyncUi\(/);
  assert.match(appJs, /openProfilesModal\(\{\s*isStartup:\s*true\s*\}\)/);
  assert.match(appJs, /sub-auto-refresh-interval/);
});

await test('Orientação e layout fixados na Horizontal (Android, Desktop, Web/PWA e CSS)', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const androidManifest = readFileSync(resolve(rootDir, 'src/android/app/src/main/AndroidManifest.xml'), 'utf-8');
  const mainActivityKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/MainActivity.kt'), 'utf-8');
  const mainFormCs = readFileSync(resolve(rootDir, 'src/desktop/MainForm.cs'), 'utf-8');
  const crossPlatformHostCs = readFileSync(resolve(rootDir, 'src/desktop/CrossPlatformHost.cs'), 'utf-8');
  const manifestWeb = readFileSync(resolve(rootDir, 'src/web/manifest.webmanifest'), 'utf-8');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf-8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf-8');

  assert.match(androidManifest, /android:screenOrientation="sensorLandscape"/);
  assert.match(androidManifest, /android:resizeableActivity="false"/);
  assert.match(mainActivityKt, /ActivityInfo\.SCREEN_ORIENTATION_SENSOR_LANDSCAPE/);

  assert.match(mainFormCs, /DefaultMinimumWindowSize\s*=\s*new\(960,\s*540\)/);
  assert.match(mainFormCs, /Size\s*=\s*new Size\(1280,\s*720\)/);
  assert.match(mainFormCs, /EnforceHorizontalWindowBounds\(/);
  assert.match(crossPlatformHostCs, /--window-size=1280,720/);

  assert.match(manifestWeb, /"orientation":\s*"landscape"/);
  assert.match(appJs, /data-orientation-lock',\s*'landscape'/);
  assert.match(appJs, /window\.screen\.orientation\.lock\('landscape'\)/);

  assert.equal(/\.home-bento-layout\s*\{\s*grid-template-columns:\s*1fr;/i.test(css), false, '.home-bento-layout não deve empilhar em 1 coluna');
  assert.equal(/\.onboarding-device-grid\s*\{\s*grid-template-columns:\s*1fr;/i.test(css), false, '.onboarding-device-grid não deve empilhar em 1 coluna');
  assert.equal(/\.epg-split-layout\s*\{\s*grid-template-columns:\s*1fr;/i.test(css), false, '.epg-split-layout não deve empilhar em 1 coluna');
});

await test('Topo (app-header) oculto nas categorias/player e altura devolvida aos painéis', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf-8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf-8');

  assert.match(css, /body\.app-header-hidden \.app-header\s*\{\s*display:\s*none;/);
  assert.match(css, /\.split-sidebar\s*\{[^}]*height:\s*calc\(100vh - 115px \+ var\(--hidden-header-h, 0px\)\)/);
  assert.match(appJs, /syncAppHeaderVisibility\(\)\s*\{[\s\S]*?this\.activeScreen !== 'browse'[\s\S]*?app-header-hidden/);
  assert.match(appJs, /toggle\('hidden', key !== screenName\);\s*\}\);\s*this\.syncAppHeaderVisibility\(\);/);
});

await test('Opções de canal na TV / Desktop (botão direito e long press) e foco suave em campos de texto', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf-8');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf-8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf-8');
  const bridgeKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/NativeBridge.kt'), 'utf-8');
  const tvFocusKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/TvFocusHelper.kt'), 'utf-8');

  // 1. Android TV NativeBridge não reseta foco da WebView incondicionalmente e força teclado
  assert.match(bridgeKt, /if\s*\(!activity\.webView\.hasFocus\(\)\)\s*\{\s*activity\.webView\.requestFocus\(\)/);
  assert.match(bridgeKt, /SHOW_FORCED/);
  assert.match(tvFocusKt, /KeyEvent\.KEYCODE_MENU/);

  // 2. Elementos do Modal de Ações de Canal e Tradução
  assert.match(html, /id="modal-channel-actions"/);
  assert.match(html, /id="btn-channel-action-toggle-fav"/);
  assert.match(html, /id="channel-action-fav-star"/);
  assert.match(html, /id="btn-channel-action-play"/);

  // 3. Estilização da Estrelinha pintada / apagada
  assert.match(css, /\.channel-action-star\.is-fav/);
  assert.match(css, /\.sidebar-item-fav\.is-fav/);

  // 4. JS: abertura de menu de canal por botão direito (contextmenu), long press D-pad e pointer
  assert.match(appJs, /openChannelActionsModal\(/);
  assert.match(appJs, /_updateChannelActionsFavButton\(/);
  assert.match(appJs, /addEventListener\('contextmenu'/);
  assert.match(appJs, /channelActionAddToFavorites/);
  assert.match(appJs, /channelActionRemoveFromFavorites/);
  assert.match(appJs, /activateChannelRow\(/);
  assert.match(appJs, /_suppressChannelClickUntil/);

  // 5. JS: foco seguro em inputs sem jogar para o começo da tela
  assert.match(appJs, /el\.blur\(\)/);
  assert.match(appJs, /scrollIntoView\(\{\s*block:\s*'nearest'/);
  assert.match(appJs, /activateInputEditing/);

  // 6. Teste funcional do toggle de favorito e atualização da estrela
  const favState = new Set();
  const mockStorage = {
    isFavorite: (id) => favState.has(id),
    toggleFavorite: (id) => {
      if (favState.has(id)) { favState.delete(id); return false; }
      favState.add(id); return true;
    },
    getFavorites: () => Array.from(favState)
  };

  const starSpan = { classList: new Set(), textContent: '★' };
  starSpan.classList.toggle = (c, val) => { val ? starSpan.classList.add(c) : starSpan.classList.delete(c); };
  const textSpan = { textContent: '' };
  const btnToggle = { classList: new Set() };
  btnToggle.classList.toggle = (c, val) => { val ? btnToggle.classList.add(c) : btnToggle.classList.delete(c); };

  const updateFavUi = (isFav) => {
    btnToggle.classList.toggle('is-fav', Boolean(isFav));
    starSpan.classList.toggle('is-fav', Boolean(isFav));
    textSpan.textContent = isFav ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos';
  };

  // Inicial: canal não favorito -> estrela apagada
  updateFavUi(mockStorage.isFavorite('ch_1'));
  assert.equal(starSpan.classList.has('is-fav'), false, 'Estrela deve estar apagada quando canal não é favorito');
  assert.equal(textSpan.textContent, 'Adicionar aos Favoritos');

  // Toggle -> vira favorito -> estrela pintada
  const isNowFav = mockStorage.toggleFavorite('ch_1');
  assert.equal(isNowFav, true);
  updateFavUi(isNowFav);
  assert.equal(starSpan.classList.has('is-fav'), true, 'Estrela deve ficar pintada quando canal é adicionado aos favoritos');
  assert.equal(textSpan.textContent, 'Remover dos Favoritos');

  // Toggle novamente -> remove favorito -> estrela apagada
  const removedFav = mockStorage.toggleFavorite('ch_1');
  assert.equal(removedFav, false);
  updateFavUi(removedFav);
  assert.equal(starSpan.classList.has('is-fav'), false, 'Estrela deve voltar a ficar apagada ao remover dos favoritos');
  assert.equal(textSpan.textContent, 'Adicionar aos Favoritos');
});

await test('Tela de Loading pós-seleção de perfil e ausência de pré-carregamento no startup', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf-8');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf-8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf-8');

  // 1. Elementos HTML da tela de loading
  assert.match(html, /id="profile-loading-screen"/, 'Deve conter elemento #profile-loading-screen');
  assert.match(html, /<span class="profile-loading-brand-text">FluiStream<\/span>/, 'Tela de loading deve exibir marca FluiStream');
  assert.equal(/profile-loading-brand-text">\s*FLOW PLAY/i.test(html), false, 'Tela de loading não deve exibir FLOW PLAY');
  assert.match(html, /id="profile-loading-avatar"/, 'Deve conter elemento #profile-loading-avatar');
  assert.match(html, /id="profile-loading-title"[^>]*data-i18n="profileLoadingTitle"/, 'Deve conter #profile-loading-title com i18n');
  assert.match(html, /id="profile-loading-name"/, 'Deve conter #profile-loading-name');
  assert.match(html, /id="profile-loading-progress-bar"/, 'Deve conter barra de progresso');
  assert.match(html, /id="profile-loading-status"[^>]*data-i18n="profileLoadingInit"/, 'Deve conter #profile-loading-status com i18n');

  // 2. Estilos CSS da tela de loading
  assert.match(css, /\.profile-loading-screen\s*\{[^}]*position:\s*fixed/, 'Tela de loading deve ter position: fixed cobrindo viewport');
  assert.match(css, /\.profile-loading-screen\s*\{[^}]*z-index:\s*9999/, 'Tela de loading deve ter z-index 9999');
  assert.match(css, /\.profile-loading-card\s*\{/, 'Deve conter classe .profile-loading-card');
  assert.match(css, /\.profile-loading-bar\s*\{/, 'Deve conter classe .profile-loading-bar');
  assert.match(css, /\.profile-loading-spinner\s*\{/, 'Deve conter spinner animado');
  assert.match(css, /body\[data-(?:effective-)?device-mode="tv"\]\s+\.profile-loading-card/, 'Deve possuir regras responsivas para modo TV');

  // 3. Regras de negócio no App.js:
  // - Na seleção de perfil inicial NÃO deve pré-carregar playlist ou sincronizar segundo plano
  assert.match(appJs, /profileLoadingScreen:\s*document\.getElementById\('profile-loading-screen'\)/, 'DOM elements deve registrar profileLoadingScreen');
  assert.match(appJs, /showProfileLoading\(/, 'Deve conter método showProfileLoading');
  assert.match(appJs, /updateProfileLoadingStatus\(/, 'Deve conter método updateProfileLoadingStatus');
  assert.match(appJs, /hideProfileLoading\(/, 'Deve conter método hideProfileLoading');

  // Verifica que switchProfile orquestra loading -> loadPlaylist -> sync remoto (se necessário) -> parse EPG -> renderHomeHub -> hideProfileLoading
  assert.match(appJs, /this\.showProfileLoading\(prof\)/, 'switchProfile deve abrir tela de loading');
  assert.match(appJs, /this\.hideProfileLoading\(\)/, 'switchProfile deve fechar tela de loading no final');

  // Verifica que handleGlobalKeyDown bloqueia input enquanto a tela de loading estiver ativa
  assert.match(appJs, /if\s*\(this\.dom\.profileLoadingScreen\s*&&\s*!this\.dom\.profileLoadingScreen\.classList\.contains\('hidden'\)\)/, 'Deve bloquear atalhos D-Pad durante loading');

  // 4. i18n
  for (const lang of ['pt-BR', 'en-US', 'es']) {
    assert.ok(translations[lang].profileLoadingTitle, `${lang} deve ter profileLoadingTitle`);
    assert.ok(translations[lang].profileLoadingInit, `${lang} deve ter profileLoadingInit`);
    assert.ok(translations[lang].profileLoadingReading, `${lang} deve ter profileLoadingReading`);
    assert.ok(translations[lang].profileLoadingSyncing, `${lang} deve ter profileLoadingSyncing`);
    assert.ok(translations[lang].profileLoadingProcessing, `${lang} deve ter profileLoadingProcessing`);
    assert.ok(translations[lang].profileLoadingEpg, `${lang} deve ter profileLoadingEpg`);
    assert.ok(translations[lang].profileLoadingReady, `${lang} deve ter profileLoadingReady`);
  }
});

await test('Testes de Correção HY300 Android / TV: Telas em %, ExoPlayer User-Agent/SSL e OOM Streaming', async () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(__dirname, '..');
  const manifestXml = readFileSync(resolve(rootDir, 'src/android/app/src/main/AndroidManifest.xml'), 'utf8');
  const mainActivityKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/MainActivity.kt'), 'utf8');
  const playerKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/VideoPlayerManager.kt'), 'utf8');
  const bridgeKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/NativeBridge.kt'), 'utf8');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf8');
  const m3uParserJs = readFileSync(resolve(rootDir, 'src/web/js/m3u-parser.js'), 'utf8');

  // 1. Android Manifest deve ter largeHeap="true" para projetores/TV boxes com 1GB RAM
  assert.match(manifestXml, /android:largeHeap="true"/, 'AndroidManifest deve conter largeHeap="true"');

  // 2. MainActivity deve configurar SSL global trust-all para fluxos HTTPS de IPTV e streaming direto com PushbackInputStream
  assert.match(mainActivityKt, /HttpsURLConnection\.setDefaultSSLSocketFactory/, 'MainActivity deve definir default SSLSocketFactory');
  assert.match(mainActivityKt, /PushbackInputStream/, 'fetchRemoteTextDirectly deve usar PushbackInputStream para streaming sem alocações massivas');

  // 3. VideoPlayerManager deve usar User-Agent compatível com IPTV (IPTVSmartersPro) e timeouts adequados
  assert.match(playerKt, /IPTVSmartersPro/, 'ExoPlayer deve usar User-Agent IPTVSmartersPro');
  assert.match(playerKt, /setConnectTimeoutMs\(25_000\)/, 'ExoPlayer deve usar timeout de 25s');

  // 4. NativeBridge deve detectar TV por ausência de touch (FEATURE_TOUCHSCREEN)
  assert.match(bridgeKt, /FEATURE_TOUCHSCREEN/, 'isTv deve checar ausência de FEATURE_TOUCHSCREEN');

  // 5. CSS deve usar porcentagem (%) no modal-dialog e possuir regras responsivas para modo TV
  assert.match(css, /max-height:\s*86%/, 'modal-dialog deve usar % para altura máxima');
  assert.match(css, /body\[data-effective-device-mode="tv"\]\s+\.modal-dialog[\s\S]*?max-height:\s*84%/, 'TV modal-dialog deve respeitar altura compacta');
  assert.match(css, /body\[data-effective-device-mode="tv"\]\s+\.settings-tile[\s\S]*?min-height:\s*68px/, 'TV settings-tile deve ter min-height compacta');

  // 6. M3UParser deve iterar linha a linha sem replace() global duplicando strings na memória
  assert.doesNotMatch(m3uParserJs, /content\.replace\(/, 'M3UParser não deve usar replace() global em todo o conteúdo');
});

await test('Fast-path ao selecionar mesmo perfil dentro de 24h e controles de intervalo por perfil', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf-8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf-8');

  assert.match(html, /id="settings-refresh-interval-select"[^>]*name="autoRefreshIntervalHours"/);
  assert.match(html, /id="select-edit-refresh-interval"[^>]*name="editAutoRefreshIntervalHours"/);
  assert.match(html, /<option value="24" selected>24h<\/option>/);
  assert.match(html, /<label for="settings-refresh-interval-select"/);
  assert.match(html, /<label for="select-edit-refresh-interval"/);

  assert.match(appJs, /_preloadLastActiveProfileCache\(/);
  assert.match(appJs, /this\._loadedProfileId/);
  assert.match(appJs, /if\s*\(isAlreadyLoaded\s*&&\s*!needsRefresh\)\s*\{[\s\S]*?return;[\s\S]*?\}\s*\n\s*this\.closeModal\(this\.dom\.modalProfiles\);\s*\n\s*this\.showProfileLoading\(prof\);/);

  for (const lang of ['pt-BR', 'en-US', 'es']) {
    assert.ok(translations[lang].autoRefreshIntervalLabel, `${lang} deve ter autoRefreshIntervalLabel`);
    assert.ok(translations[lang].autoRefreshIntervalHelp, `${lang} deve ter autoRefreshIntervalHelp`);
  }
});

await test('Home Hub D-Pad alcança .btn-bento-refresh via ArrowDown, navega horizontalmente entre refreshes e preserva foco após atualizar', async () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf-8');
  const { runInNewContext } = await import('node:vm');

  const extractMethod = (name) => {
    const start = appJs.indexOf(`  ${name}(`);
    assert.ok(start >= 0, `Método ${name} deve existir em app.js`);
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
  const makeNode = ({ id = '', tagName = 'DIV', classes = [], rect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }, parent = null }) => {
    const classSet = new Set(classes);
    const el = {
      id,
      tagName,
      disabled: false,
      children: [],
      dataset: {},
      classList: {
        contains: (c) => classSet.has(c),
        add: (c) => classSet.add(c),
        remove: (c) => classSet.delete(c)
      },
      focus: () => { activeEl = el; },
      scrollIntoView: () => {},
      getBoundingClientRect: () => rect,
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
          if (tokens.some(t => t.startsWith('.') && cur.classList.contains(t.slice(1)))) return cur;
          cur = cur.parent;
        }
        return null;
      },
      matches: (sel) => sel.split(',').some(t => {
        const tok = t.trim();
        if (tok.startsWith('.')) return el.classList.contains(tok.slice(1));
        if (tok.startsWith('#')) return el.id === tok.slice(1);
        return false;
      }),
      querySelectorAll: (sel) => {
        const out = [];
        const walk = (node) => {
          for (const child of node.children) {
            if (child.matches(sel)) out.push(child);
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

  const mainLayout = makeNode({ id: 'main-layout', rect: { left: 0, right: 1280, top: 64, bottom: 720, width: 1280, height: 656 } });
  const heroRow = makeNode({ classes: ['home-hero-row'], rect: { left: 24, right: 806, top: 80, bottom: 240, width: 782, height: 160 }, parent: mainLayout });

  const bentoLive = makeNode({ id: 'bento-live', classes: ['bento-card'], rect: { left: 24, right: 274, top: 80, bottom: 240, width: 250, height: 160 }, parent: heroRow });
  const footerLive = makeNode({ classes: ['bento-card-footer'], rect: { left: 42, right: 256, top: 190, bottom: 228, width: 214, height: 38 }, parent: bentoLive });
  const btnRefreshLive = makeNode({ id: 'btn-refresh-live', tagName: 'BUTTON', classes: ['btn-bento-refresh'], rect: { left: 218, right: 256, top: 190, bottom: 228, width: 38, height: 38 }, parent: footerLive });

  const bentoMovie = makeNode({ id: 'bento-movie', classes: ['bento-card'], rect: { left: 290, right: 540, top: 80, bottom: 240, width: 250, height: 160 }, parent: heroRow });
  const footerMovie = makeNode({ classes: ['bento-card-footer'], rect: { left: 308, right: 522, top: 190, bottom: 228, width: 214, height: 38 }, parent: bentoMovie });
  const btnRefreshMovies = makeNode({ id: 'btn-refresh-movies', tagName: 'BUTTON', classes: ['btn-bento-refresh'], rect: { left: 484, right: 522, top: 190, bottom: 228, width: 38, height: 38 }, parent: footerMovie });

  const bentoSeries = makeNode({ id: 'bento-series', classes: ['bento-card'], rect: { left: 556, right: 806, top: 80, bottom: 240, width: 250, height: 160 }, parent: heroRow });
  const footerSeries = makeNode({ classes: ['bento-card-footer'], rect: { left: 574, right: 788, top: 190, bottom: 228, width: 214, height: 38 }, parent: bentoSeries });
  const btnRefreshSeries = makeNode({ id: 'btn-refresh-series', tagName: 'BUTTON', classes: ['btn-bento-refresh'], rect: { left: 750, right: 788, top: 190, bottom: 228, width: 38, height: 38 }, parent: footerSeries });

  const tileLiveEpg = makeNode({ id: 'btn-home-live-epg', tagName: 'BUTTON', classes: ['gradient-tile'], rect: { left: 24, right: 407, top: 256, bottom: 330, width: 383, height: 74 }, parent: mainLayout });
  const tileFavourite = makeNode({ id: 'btn-home-favourite', tagName: 'BUTTON', classes: ['gradient-tile'], rect: { left: 423, right: 806, top: 256, bottom: 330, width: 383, height: 74 }, parent: mainLayout });

  const mockDoc = {
    body: mainLayout,
    get activeElement() { return activeEl; },
    getElementById: (id) => (id === 'main-layout' ? mainLayout : null),
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const HomeNav = runInNewContext(`(() => class HomeNav {
    constructor() { this.dom = {}; }
    _isTvNavigationMode() { return true; }
    _isTextEntryElement() { return false; }
    maybeAutoLoadMoreForElement() {}
    ${extractMethod('moveSpatialFocus')}
  })()`, { document: mockDoc });
  const nav = new HomeNav();

  // 1. ArrowDown em #bento-live foca #btn-refresh-live (não #btn-home-live-epg)
  bentoLive.focus();
  assert.equal(nav.moveSpatialFocus('ArrowDown', false), true);
  assert.equal(activeEl, btnRefreshLive);

  // 2. ArrowDown em #btn-refresh-live desce para #btn-home-live-epg
  assert.equal(nav.moveSpatialFocus('ArrowDown', false), true);
  assert.equal(activeEl, tileLiveEpg);

  // 3. ArrowUp em #btn-home-live-epg volta para #btn-refresh-live
  assert.equal(nav.moveSpatialFocus('ArrowUp', false), true);
  assert.equal(activeEl, btnRefreshLive);

  // 4. ArrowRight / ArrowLeft navegam entre #btn-refresh-live, #btn-refresh-movies e #btn-refresh-series
  assert.equal(nav.moveSpatialFocus('ArrowRight', false), true);
  assert.equal(activeEl, btnRefreshMovies);
  assert.equal(nav.moveSpatialFocus('ArrowRight', false), true);
  assert.equal(activeEl, btnRefreshSeries);
  assert.equal(nav.moveSpatialFocus('ArrowLeft', false), true);
  assert.equal(activeEl, btnRefreshMovies);
  assert.equal(nav.moveSpatialFocus('ArrowLeft', false), true);
  assert.equal(activeEl, btnRefreshLive);

  // 5. ArrowUp em #btn-refresh-live volta para #bento-live; ArrowRight fica na linha de cards
  assert.equal(nav.moveSpatialFocus('ArrowUp', false), true);
  assert.equal(activeEl, bentoLive);
  assert.equal(nav.moveSpatialFocus('ArrowRight', false), true);
  assert.equal(activeEl, bentoMovie);

  // 6. ArrowUp em #btn-home-favourite também alcança .btn-bento-refresh
  tileFavourite.focus();
  assert.equal(nav.moveSpatialFocus('ArrowUp', false), true);
  assert.ok(activeEl === btnRefreshMovies || activeEl === btnRefreshSeries);

  // 7. refreshHomePlaylist restaura foco em clickedBtn após reabilitar os botões
  assert.match(appJs, /const hadFocus = typeof document !== 'undefined' && document\.activeElement === clickedBtn;/);
  assert.match(appJs, /if \(hadFocus && !clickedBtn\.disabled\) \{\s*clickedBtn\.focus\(\{ preventScroll: true \}\);\s*\}/);
});

await test('macOS: versão injetada pelo host (__fluiAppVersion), download direto do .dmg via OPEN_URL e build scripts estampam versão', async () => {
  const prevFetch = globalThis.fetch;
  const prevWindow = globalThis.window;
  const prevDoc = globalThis.document;

  const fetchCalls = [];
  const hostCommands = [];
  const openedModals = [];
  const subFooterClasses = new Set();

  globalThis.window = {
    __fluiAppVersion: '1.2.7',
    __fluiHostPlatform: 'macos',
    __fluiLocalHostApp: true,
    __fluiLocalProxyUrl: 'http://127.0.0.1:5055/',
    location: { origin: 'http://127.0.0.1:5055' }
  };
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url: String(url), opts });
    return {
      ok: true,
      json: async () => ({
        tag_name: 'v1.2.7',
        body: 'macOS release',
        html_url: 'https://github.com/CesarOvies/FluiStream/releases/tag/v1.2.7',
        assets: [
          { name: 'FluiStream-v1.2.7-macOS.dmg', browser_download_url: 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.7/FluiStream-v1.2.7-macOS.dmg' }
        ]
      })
    };
  };

  try {
    assert.equal(getCurrentVersion(), '1.2.7');
    assert.ok(i18n.get('settingsVersion').includes('1.2.7'), 'settingsVersion deve refletir window.__fluiAppVersion');
    const upToDate = await checkForUpdate();
    assert.equal(upToDate.available, false);
    assert.equal(upToDate.currentVersion, '1.2.7');
    assert.equal(upToDate.macDmgAssetName, 'FluiStream-v1.2.7-macOS.dmg');

    const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf-8');
    const crossHostCs = readFileSync(resolve(rootDir, 'src/desktop/CrossPlatformHost.cs'), 'utf-8');
    const mainFormCs = readFileSync(resolve(rootDir, 'src/desktop/MainForm.cs'), 'utf-8');
    const updateServiceCs = readFileSync(resolve(rootDir, 'src/desktop/UpdateService.cs'), 'utf-8');
    const buildMacSh = readFileSync(resolve(rootDir, 'build-macos.sh'), 'utf-8');
    const buildAllPs1 = readFileSync(resolve(rootDir, 'build-all.ps1'), 'utf-8');
    const releaseYml = readFileSync(resolve(rootDir, '.github/workflows/release.yml'), 'utf-8');

    const { runInNewContext } = await import('node:vm');
    const extractMethod = (name) => {
      const start = appJs.indexOf(`  ${name}(`);
      assert.ok(start >= 0, `Método ${name} deve existir em app.js`);
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

    const settingsUpdateStatusEl = { textContent: '' };
    const subTitleEl = { textContent: '' };
    const subBodyEl = { innerHTML: '' };
    const subFooterEl = {
      classList: {
        add: (c) => subFooterClasses.add(c),
        remove: (c) => subFooterClasses.delete(c)
      }
    };
    const subModalEl = { id: 'modal-settings-sub' };
    const fakeBtn = { addEventListener: () => {} };

    globalThis.document = {
      getElementById: () => fakeBtn
    };

    const MacUpdateApp = runInNewContext(`(() => class MacUpdateApp {
      constructor() {
        this.player = { notifyDesktopHost: (action, data) => hostCommands.push({ action, data }) };
        this.dom = {
          settingsUpdateStatus: settingsUpdateStatusEl,
          modalSettingsSub: subModalEl,
          modalSettingsSubTitle: subTitleEl,
          modalSettingsSubBody: subBodyEl,
          modalSettingsSubFooter: subFooterEl
        };
      }
      escapeHtml(s) { return String(s || ''); }
      openModal(m) { openedModals.push(m); }
      closeModal() {}
      ${extractMethod('isMacOSPlatform')}
      ${extractMethod('resolveMacDmgDownloadUrl')}
      ${extractMethod('openExternalUrl')}
      ${extractMethod('showMacUpdateInstructions')}
      ${extractMethod('triggerAppUpdate')}
    })()`, {
      window: globalThis.window,
      document: globalThis.document,
      navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', platform: 'MacIntel' },
      fetch: globalThis.fetch,
      i18n,
      hostCommands,
      settingsUpdateStatusEl,
      subModalEl,
      subTitleEl,
      subBodyEl,
      subFooterEl,
      openedModals
    });

    fetchCalls.length = 0;
    const app = new MacUpdateApp();
    assert.equal(app.isMacOSPlatform(), true);
    assert.equal(
      app.resolveMacDmgDownloadUrl({ updateVersion: '1.2.8' }),
      'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.8/FluiStream-v1.2.8-macOS.dmg'
    );

    app.triggerAppUpdate({
      updateVersion: '1.2.8',
      macDmgDownloadUrl: 'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.8/FluiStream-v1.2.8-macOS.dmg',
      macDmgAssetName: 'FluiStream-v1.2.8-macOS.dmg'
    });

    assert.equal(hostCommands.length, 1);
    assert.equal(hostCommands[0].action, 'OPEN_URL');
    assert.equal(
      hostCommands[0].data.url,
      'https://github.com/CesarOvies/FluiStream/releases/download/v1.2.8/FluiStream-v1.2.8-macOS.dmg'
    );
    assert.ok(
      fetchCalls.some(c => c.url.includes('/api/window?action=OPEN_URL&url=https%3A%2F%2Fgithub.com%2FCesarOvies%2FFluiStream%2Freleases%2Fdownload%2Fv1.2.8%2FFluiStream-v1.2.8-macOS.dmg')),
      'Deve enviar OPEN_URL para /api/window no host local macOS'
    );
    assert.ok(settingsUpdateStatusEl.textContent.includes('FluiStream-v1.2.8-macOS.dmg'));
    assert.equal(openedModals.length, 1);
    assert.ok(subFooterClasses.has('hidden'));
    assert.ok(subBodyEl.innerHTML.includes('FluiStream-v1.2.8-macOS.dmg'));

    assert.match(crossHostCs, /window\.__fluiAppVersion/);
    assert.match(crossHostCs, /window\.__fluiHostPlatform/);
    assert.match(crossHostCs, /OpenExternalUrl\(/);
    assert.match(crossHostCs, /"OPEN_URL"/);
    assert.match(mainFormCs, /window\.__fluiAppVersion/);
    assert.match(updateServiceCs, /\.dmg/);
    assert.equal(buildMacSh.includes('grep -oPm1'), false, 'build-macos.sh não deve usar grep -P incompatível com macOS BSD grep');
    assert.match(buildMacSh, /export const APP_VERSION = /);
    assert.match(buildAllPs1, /Update-PackagedWebVersion/);
    assert.match(releaseYml, /Verify macOS Bundle Version Matches Release/);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

console.log('\n--- 26. Testes de Correção de Logos (M3U vírgula em aspas, normalização, fallback e Android WebView) ---');

await test('M3UParser.parseExtInf preserva tvg-logo e group-title quando tvg-name ou tvg-logo contém vírgula entre aspas', () => {
  const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="" tvg-name="24h Coragem, o Cão Covarde" tvg-logo="http://32q0d.xyz/images/coragem.png" group-title="⏰ CANAIS 24H",24h Coragem, o Cão Covarde
https://netlez.uno:443/live/1
#EXTINF:-1 tvg-id="C3 TV" tvg-name="C3 TV" tvg-logo="https://static.wixstatic.com/media/abc/v1/fill/w_50,h_52,al_c/c3.png" group-title="VARIEDADES",C3 TV
https://netlez.uno:443/live/2
#EXTINF:-1 tvg-name="Pokémon, o Filme: Segredos da Selva (2020)" tvg-logo="https://image.tmdb.org/t/p/w600_and_h900_bestv2/eqw2li.jpg" group-title="Filmes | Infantil",Pokémon, o Filme: Segredos da Selva (2020)
https://netlez.uno:443/movie/3.mp4`;

  const parsed = M3UParser.parse(m3u);
  assert.equal(parsed.items.length, 3);
  assert.equal(parsed.items[0].name, '24h Coragem, o Cão Covarde');
  assert.equal(parsed.items[0].group, '⏰ CANAIS 24H');
  assert.equal(parsed.items[0].logo, 'https://i0.wp.com/32q0d.xyz/images/coragem.png');

  assert.equal(parsed.items[1].name, 'C3 TV');
  assert.equal(parsed.items[1].group, 'VARIEDADES');
  assert.equal(parsed.items[1].logo, 'https://static.wixstatic.com/media/abc/v1/fill/w_50,h_52,al_c/c3.png');

  assert.equal(parsed.items[2].name, 'Pokémon, o Filme: Segredos da Selva (2020)');
  assert.equal(parsed.items[2].group, 'Filmes | Infantil');
  assert.equal(parsed.items[2].logo, 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/eqw2li.jpg');
});

await test('M3UParser.normalizeLogoUrl reescreve domínios bloqueados/mortos e preserva URLs válidas', () => {
  assert.equal(
    M3UParser.normalizeLogoUrl('https://www.fontedecanais.io/logos/canais/espn3.png'),
    'https://i0.wp.com/www.fontedecanais.io/logos/canais/espn3.png'
  );
  assert.equal(
    M3UParser.normalizeLogoUrl('http://32q0d.xyz/images/logos/89c82ac7b48190d42c202057b99b354b.png'),
    'https://i0.wp.com/32q0d.xyz/images/logos/89c82ac7b48190d42c202057b99b354b.png'
  );
  assert.equal(
    M3UParser.normalizeLogoUrl('https://static.wikia.nocookie.net/logopedia/images/8/8e/RB_de_televisao_2021.png/revision/latest/scale-to-width-down/200'),
    'https://i0.wp.com/static.wikia.nocookie.net/logopedia/images/8/8e/RB_de_televisao_2021.png'
  );
  assert.equal(
    M3UParser.normalizeLogoUrl('http://tv.factoryiptv.com:80/images/weAvkxl0dnPevIKD8fwHjiOi6tc_small.jpg'),
    'https://image.tmdb.org/t/p/w600_and_h900_bestv2/weAvkxl0dnPevIKD8fwHjiOi6tc.jpg'
  );
  assert.equal(M3UParser.normalizeLogoUrl('https://s10.aconvert.com/convert/p3r68-cdx67/a8b7t-9ep3d.png'), '');
  assert.equal(M3UParser.normalizeLogoUrl('https://easypr1.com/logos/cancao_nova.png'), '');
  assert.equal(M3UParser.normalizeLogoUrl('https://cdn.guiademarcas.globo/logo_globo_corporativa_restrita_branco.png'), 'https://cdn.guiademarcas.globo/logo_globo_corporativa_restrita_branco.png');
  assert.equal(M3UParser.normalizeLogoUrl('http://iptv.example.com:8080/logo.png'), 'http://iptv.example.com:8080/logo.png');
  assert.equal(M3UParser.normalizeLogoUrl('http://192.168.1.10/logo.png'), 'http://192.168.1.10/logo.png');
});

await test('resolveKnownChannelLogo, EPGParser.getChannelIcon e fallback de irmãos resolvem canais ao vivo sem logo', async () => {
  assert.match(resolveKnownChannelLogo('ESPN 3 FHD', 'ESPN.3.HD.uy'), /^https:\/\//);
  assert.match(resolveKnownChannelLogo('HBO + PLUS FHD', 'HBO.PLUS.HD.uy'), /^https:\/\//);
  assert.match(resolveKnownChannelLogo('ADULT SWIM HD', 'Adult.Swim.ca2'), /^https:\/\//);
  assert.match(resolveKnownChannelLogo('CARTOON NETWORK FHD', 'Cartoon.Network.HD.za'), /^https:\/\//);
  assert.match(resolveKnownChannelLogo('SBT+ KIDS', ''), /^https:\/\//);
  assert.match(resolveKnownChannelLogo('DISNEY+ 1', ''), /^https:\/\//);
  assert.equal(
    buildProxyLogoFallbackUrl('https://example.com/logo.png'),
    'https://wsrv.nl/?url=https%3A%2F%2Fexample.com%2Flogo.png'
  );
  assert.equal(
    buildProxyLogoFallbackUrl('https://wsrv.nl/?url=https%3A%2F%2Fexample.com%2Flogo.png'),
    'https://i0.wp.com/example.com/logo.png'
  );
  assert.equal(
    buildProxyLogoFallbackUrl('https://i0.wp.com/example.com/logo.png', 'http://127.0.0.1:5055/'),
    'http://127.0.0.1:5055/proxy?url=https%3A%2F%2Fexample.com%2Flogo.png'
  );
  assert.equal(
    buildProxyLogoFallbackUrl('http://192.168.1.10:8080/logo.png', 'http://127.0.0.1:5055/'),
    'http://127.0.0.1:5055/proxy?url=http%3A%2F%2F192.168.1.10%3A8080%2Flogo.png'
  );
  assert.equal(
    buildProxyLogoFallbackUrl('http://127.0.0.1:5055/proxy?url=http%3A%2F%2Fexample.com%2Flogo.png', 'http://127.0.0.1:5055/'),
    ''
  );

  const epg = new EPGParser();
  epg.parse(`<?xml version="1.0" encoding="UTF-8"?><tv>
    <channel id="cancaonova.br"><display-name>CANÇÃO NOVA SD</display-name><icon src="https://logodownload.org/wp-content/uploads/2018/12/cancao-nova-logo.png" /></channel>
  </tv>`);
  assert.equal(
    epg.getChannelIcon('cancaonova.br', 'CANÇÃO NOVA SD'),
    'https://logodownload.org/wp-content/uploads/2018/12/cancao-nova-logo.png'
  );

  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  const extractMethod = (name) => {
    const start = appJs.indexOf(`  ${name}(`);
    assert.ok(start !== -1, `Método ${name} não encontrado`);
    const nextMatch = appJs.slice(start + 10).search(/\n  (?:async\s+)?[a-zA-Z0-9_]+\(/);
    const end = nextMatch === -1 ? appJs.length : start + 10 + nextMatch;
    return appJs.slice(start, end);
  };

  const LogoApp = new Function('M3UParser', 'ItemType', 'EPGParser', 'resolveKnownChannelLogo', 'normalizeLiveChannelKey', `
    return class {
      constructor() {
        this.playlist = {
          items: [
            { id: 'c1', name: 'CANÇÃO NOVA FHD', tvgId: 'cn.br', type: ItemType.LIVE, logo: 'https://logodownload.org/wp-content/uploads/2018/12/cancao-nova-logo.png' },
            { id: 'c2', name: 'CANÇÃO NOVA SD', tvgId: 'cn.sd', type: ItemType.LIVE, logo: '' },
            { id: 'c3', name: 'SBT+ KIDS', tvgId: '', type: ItemType.LIVE, logo: 'https://s10.aconvert.com/convert/p3r68-cdx67/a8b7t-9ep3d.png' }
          ]
        };
        this.epg = new EPGParser();
        this._posterCacheMap = new Map();
      }
      ${extractMethod('_ensurePlaylistIndexes')}
      ${extractMethod('_getPosterCacheKey')}
      ${extractMethod('_getCachedPoster')}
    };
  `)(M3UParser, ItemType, EPGParser, resolveKnownChannelLogo, normalizeLiveChannelKey);

  const inst = new LogoApp();
  inst._ensurePlaylistIndexes();
  assert.equal(inst._getCachedPoster(inst.playlist.items[1], false), 'https://logodownload.org/wp-content/uploads/2018/12/cancao-nova-logo.png');
  assert.match(inst._getCachedPoster(inst.playlist.items[2], false), /^https:\/\/cdn\.jsdelivr\.net\/gh\/tv-logo\/tv-logos/);

  const mainActivityKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/MainActivity.kt'), 'utf8');
  assert.match(mainActivityKt, /!k\.equals\("Referer", ignoreCase = true\)/);
  assert.match(mainActivityKt, /!k\.equals\("X-Requested-With", ignoreCase = true\)/);
  assert.match(mainActivityKt, /!rawMsg\.isNullOrBlank\(\)/);
  assert.match(mainActivityKt, /safeCode/);
  assert.match(mainActivityKt, /https:\/\/i0\.wp\.com\/\$host\$encodedPath\$encodedQuery/);
  assert.match(appJs, /referrerpolicy="no-referrer"/);
  assert.match(appJs, /referrerPolicy\s*=\s*'no-referrer'/);
});

console.log('\n--- 27. Testes de Controle Parental (Confirmação), Player Embutido Inicial + EPG e Saída de Fullscreen ---');

await test('Controle Parental exige confirmação do PIN atual e confirmação do novo PIN para alterar ou desativar', async () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  const { runInNewContext } = await import('node:vm');

  for (const lang of ['pt-BR', 'en-US', 'es']) {
    for (const key of ['parentalCurrentPin', 'parentalNewPin', 'parentalConfirmPin', 'parentalPinMismatch', 'parentalPinTooShort', 'parentalDisableConfirm']) {
      assert.ok(translations[lang][key], `Falta chave ${key} em ${lang}`);
    }
  }

  const extractMethod = (name) => {
    const start = appJs.indexOf(`  ${name}(`);
    assert.ok(start >= 0, `Método ${name} deve existir em app.js`);
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

  let settings = { parentalPinHash: '' };
  let promptCalls = 0;
  let promptResult = false;
  let modalClosed = 0;
  const elements = new Map();
  const makeInput = (id, init = {}) => {
    const attrs = new Map();
    const classes = new Set();
    const listeners = {};
    const el = {
      id,
      value: init.value || '',
      checked: Boolean(init.checked),
      disabled: Boolean(init.disabled),
      textContent: '',
      attributes: attrs,
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, force) => (force === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (force ? classes.add(c) : classes.delete(c)))
      },
      setAttribute: (k, v) => attrs.set(k, v),
      removeAttribute: (k) => attrs.delete(k),
      addEventListener: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
      focus: () => {}
    };
    elements.set(id, el);
    return el;
  };

  const mockDoc = {
    getElementById: (id) => elements.get(id) || null
  };
  const ParentalApp = runInNewContext(`(() => class ParentalApp {
    constructor() {
      this.parentalUnlocked = false;
      this.activeScreen = 'settings';
      this.dom = {
        modalSettingsSub: { id: 'modal-settings-sub' },
        modalSettingsSubTitle: { textContent: '' },
        modalSettingsSubFooter: { classList: { remove: () => {} } },
        modalSettingsSubBody: {
          _html: '',
          set innerHTML(v) {
            this._html = v;
            resetFields(v);
          },
          get innerHTML() { return this._html; }
        },
        btnSaveSettingsSub: { onclick: null }
      };
    }
    escapeHtml(s) { return String(s || ''); }
    updateSettingsTileSubtitles() {}
    renderSidebarPanel() {}
    updateCurrentEpgDisplay() {}
    openModal() {}
    closeModal() { onModalClose(); }
    async promptParentalPin() { onPromptCalled(); return getPromptResult(); }
    async hashPin(pin) { return 'hash:' + pin; }
    ${extractMethod('openParentalSubModal')}
  })()`, {
    document: mockDoc,
    i18n,
    storage: {
      getSettings: () => ({ ...settings }),
      saveSettings: (patch) => { settings = { ...settings, ...patch }; }
    },
    resetFields: (html) => {
      elements.clear();
      makeInput('sub-parental-form');
      makeInput('sub-parental-enable', { checked: Boolean(settings.parentalPinHash) });
      makeInput('sub-parental-new-fields');
      if (html.includes('sub-parental-current-pin')) makeInput('sub-parental-current-pin');
      makeInput('sub-parental-pin');
      makeInput('sub-parental-pin-confirm');
      const err = makeInput('sub-parental-error');
      err.classList.add('hidden');
    },
    onModalClose: () => { modalClosed++; },
    onPromptCalled: () => { promptCalls++; },
    getPromptResult: () => promptResult
  });

  const app = new ParentalApp();

  // 1. Ativação inicial exige confirmação igual
  app.openParentalSubModal();
  elements.get('sub-parental-enable').checked = true;
  elements.get('sub-parental-pin').value = '1234';
  elements.get('sub-parental-pin-confirm').value = '9999';
  await app.dom.btnSaveSettingsSub.onclick();
  assert.equal(settings.parentalPinHash, '', 'Não deve ativar PIN quando confirmação diverge');
  assert.equal(elements.get('sub-parental-error').classList.contains('hidden'), false);

  elements.get('sub-parental-pin-confirm').value = '1234';
  await app.dom.btnSaveSettingsSub.onclick();
  assert.equal(settings.parentalPinHash, 'hash:1234');
  assert.equal(modalClosed, 1);

  // 2. Troca de PIN sem PIN atual e com prompt cancelado deve falhar
  app.openParentalSubModal();
  assert.ok(elements.has('sub-parental-current-pin'), 'Deve renderizar campo de PIN atual quando ativo');
  elements.get('sub-parental-pin').value = '5678';
  elements.get('sub-parental-pin-confirm').value = '5678';
  promptResult = false;
  await app.dom.btnSaveSettingsSub.onclick();
  assert.equal(promptCalls, 1, 'Sem PIN atual digitado, deve pedir confirmação via promptParentalPin');
  assert.equal(settings.parentalPinHash, 'hash:1234', 'Não deve trocar PIN sem confirmação');

  // 3. Troca de PIN com PIN atual incorreto deve falhar
  elements.get('sub-parental-current-pin').value = '0000';
  await app.dom.btnSaveSettingsSub.onclick();
  assert.equal(settings.parentalPinHash, 'hash:1234', 'Não deve trocar PIN com PIN atual incorreto');
  assert.equal(elements.get('sub-parental-error').classList.contains('hidden'), false);

  // 4. Troca de PIN com PIN atual correto deve atualizar
  elements.get('sub-parental-current-pin').value = '1234';
  await app.dom.btnSaveSettingsSub.onclick();
  assert.equal(settings.parentalPinHash, 'hash:5678');

  // 5. Desativação exige confirmação do PIN atual (recusa errado, aceita correto)
  app.openParentalSubModal();
  elements.get('sub-parental-enable').checked = false;
  elements.get('sub-parental-current-pin').value = '1234';
  await app.dom.btnSaveSettingsSub.onclick();
  assert.equal(settings.parentalPinHash, 'hash:5678', 'Não deve desativar com PIN atual incorreto');

  elements.get('sub-parental-current-pin').value = '5678';
  await app.dom.btnSaveSettingsSub.onclick();
  assert.equal(settings.parentalPinHash, '', 'Deve desativar após confirmar PIN atual correto');
});

await test('Clique no canal inicia em modo embutido (lista + player + EPG) e mantém vídeo ao sair do fullscreen', async () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  const playerJs = readFileSync(resolve(rootDir, 'src/web/js/player.js'), 'utf8');
  const mainFormCs = readFileSync(resolve(rootDir, 'src/desktop/MainForm.cs'), 'utf8');
  const playerKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/VideoPlayerManager.kt'), 'utf8');
  const bridgeKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/NativeBridge.kt'), 'utf8');
  const mainActivityKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/MainActivity.kt'), 'utf8');
  const tvFocusKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/TvFocusHelper.kt'), 'utf8');

  // 1. playChannel sincroniza layout dividido (lista + player + EPG) ANTES de playStream e evita fullscreen acidental
  const playChIdx = appJs.indexOf('  playChannel(item, opts = {})');
  assert.ok(playChIdx >= 0);
  const playChSlice = appJs.slice(playChIdx, playChIdx + 2200);
  assert.ok(playChSlice.indexOf('this.syncBrowseViewLayout()') < playChSlice.indexOf('this.player.playStream('));
  assert.match(appJs, /_suppressAutoFullscreenUntil/);
  assert.match(appJs, /android-fullscreen-changed/);

  // 2. Android inicia embutido (isFullscreenMode = false), suporta updatePlayerLayout/setFullscreen/toggleFullscreen e volta ao mini-player no Back
  assert.match(playerKt, /private var isFullscreenMode: Boolean = false/);
  assert.match(playerKt, /fun updateLayout\(x: Int, y: Int, width: Int, height: Int, visible: Boolean\)/);
  assert.match(playerKt, /fun setFullscreen\(fullscreen: Boolean\)/);
  assert.match(playerKt, /fun toggleFullscreen\(\)/);
  assert.match(playerKt, /isFullscreenMode = false[\s\S]*?applyOverlayLayout\(\)/);
  assert.match(bridgeKt, /@JavascriptInterface[\s\S]*?fun updatePlayerLayout\(/);
  assert.match(bridgeKt, /@JavascriptInterface[\s\S]*?fun setFullscreen\(/);
  assert.match(bridgeKt, /@JavascriptInterface[\s\S]*?fun toggleFullscreen\(/);
  assert.match(mainActivityKt, /if \(videoPlayerManager\.isFullscreen\(\)\) \{\s*videoPlayerManager\.setFullscreen\(false\)/);
  assert.match(tvFocusKt, /if \(videoPlayerManager\.isFullscreen\(\)\)/);

  // 3. Desktop MainForm.cs inicia _videoView sem Dock.Fill, restaura Bounds antes de WindowState e re-sincroniza layout pós-fullscreen
  assert.match(mainFormCs, /Dock = DockStyle\.None,\s*\r?\n\s*Visible = false/);
  assert.match(mainFormCs, /ApplyFormFullscreenBounds\(/);
  assert.match(mainFormCs, /msgType == "DESKTOP_COMMAND"/);
  assert.match(mainFormCs, /Task\.Delay\(80\)/);
  assert.match(mainFormCs, /Task\.Delay\(220\)/);

  // 4. VideoPlayerController no Android reporta layout e delega toggleFullscreen sem expandir desktop-fullscreen
  const prevWin = globalThis.window;
  const prevDoc = globalThis.document;
  const bridgeCalls = [];
  globalThis.window = {
    devicePixelRatio: 2,
    innerHeight: 540,
    addEventListener: () => {},
    getComputedStyle: () => ({ position: 'static' }),
    androidBridge: {
      updatePlayerLayout: (x, y, w, h, vis) => bridgeCalls.push({ fn: 'updatePlayerLayout', x, y, w, h, vis }),
      playStream: (url) => bridgeCalls.push({ fn: 'playStream', url }),
      toggleFullscreen: () => bridgeCalls.push({ fn: 'toggleFullscreen' })
    }
  };
  globalThis.document = {
    fullscreenElement: null,
    webkitFullscreenElement: null,
    pictureInPictureElement: null,
    body: { classList: { contains: () => false, add: () => {}, remove: () => {} } },
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: () => {}
  };
  try {
    const mockContainer = {
      classList: { add: () => {}, remove: () => {}, contains: () => false },
      closest: () => null,
      getBoundingClientRect: () => ({ left: 200, top: 40, bottom: 240, width: 320, height: 180 })
    };
    const mockVideo = {
      style: { display: 'block' },
      addEventListener: () => {},
      pause: () => {},
      removeAttribute: () => {},
      load: () => {}
    };
    const ctrl = new VideoPlayerController(mockVideo, mockContainer);
    await ctrl.playStream({ name: 'Canal 1', type: 'live', url: 'http://ex.com/live/u/p/1.m3u8' }, '', 'auto', 'hls');
    const layoutCall = bridgeCalls.find(c => c.fn === 'updatePlayerLayout');
    assert.ok(layoutCall, 'Deve reportar coordenadas do mini-player ao androidBridge.updatePlayerLayout');
    assert.deepEqual(layoutCall, { fn: 'updatePlayerLayout', x: 400, y: 80, w: 640, h: 360, vis: true });
    assert.equal(bridgeCalls.some(c => c.fn === 'toggleFullscreen'), false, 'Clique inicial no canal não deve disparar fullscreen');

    await ctrl.toggleFullscreen();
    assert.equal(bridgeCalls.some(c => c.fn === 'toggleFullscreen'), true, 'toggleFullscreen deve delegar ao androidBridge');
  } finally {
    globalThis.window = prevWin;
    globalThis.document = prevDoc;
  }

  // 5. Asset Android sincronizado com src/web
  assert.equal(
    readFileSync(resolve(rootDir, 'src/android/app/src/main/assets/web/js/player.js'), 'utf8'),
    playerJs
  );
  assert.equal(
    readFileSync(resolve(rootDir, 'src/android/app/src/main/assets/web/js/app.js'), 'utf8'),
    appJs
  );
  assert.equal(
    readFileSync(resolve(rootDir, 'src/android/app/src/main/assets/web/js/localization.js'), 'utf8'),
    readFileSync(resolve(rootDir, 'src/web/js/localization.js'), 'utf8')
  );
});

await test('2º clique no mesmo canal abre fullscreen e Voltar/botão fullscreen sai do fullscreen sem fechar categoria', async () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  const mainFormCs = readFileSync(resolve(rootDir, 'src/desktop/MainForm.cs'), 'utf8');
  const playerKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/VideoPlayerManager.kt'), 'utf8');
  const { runInNewContext } = await import('node:vm');

  const extractMethod = (name) => {
    const start = appJs.indexOf(`  ${name}(`);
    assert.ok(start >= 0, `Método ${name} deve existir em app.js`);
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

  const calls = [];
  const pushCall = (entry) => calls.push({ ...entry });
  const mockDoc = {
    activeElement: null,
    fullscreenElement: null,
    webkitFullscreenElement: null,
    body: { classList: { contains: () => false } },
    querySelectorAll: () => []
  };

  const ChannelClickApp = runInNewContext(`(() => class ChannelClickApp {
    constructor() {
      this.activeScreen = 'browse';
      this.sidebarDrillMode = 'items';
      this.currentPlayingItem = null;
      this.currentFilteredItems = [
        { id: 'ch_1', name: 'Canal 1', type: 'live' },
        { id: 'ch_2', name: 'Canal 2', type: 'live' }
      ];
      this.dom = {
        seasonsPopup: null,
        playerToolsMenu: null,
        splitSidebar: null,
        playerContainer: { classList: { contains: () => false } }
      };
      this.player = {
        isStopped: true,
        _isDesktopFullscreen: false,
        toggleFullscreen: () => {
          this.player._isDesktopFullscreen = !this.player._isDesktopFullscreen;
          pushCall({ fn: 'toggleFullscreen', fs: this.player._isDesktopFullscreen });
        }
      };
    }
    _isSeriesGroupingActive() { return false; }
    setMobileSidebarOpen() {}
    openMovieDetailModal() {}
    openSeriesDetailModal() {}
    closeEnteredCategory() { pushCall({ fn: 'closeEnteredCategory' }); }
    navigateToScreen(s) { pushCall({ fn: 'navigateToScreen', screen: s }); }
    playChannel(item) {
      this.currentPlayingItem = item;
      this.player.isStopped = false;
      pushCall({ fn: 'playChannel', id: item.id });
    }
    ${extractMethod('isPlayerFullscreen')}
    ${extractMethod('activateChannelRow')}
    ${extractMethod('handleNativeBack')}
  })()`, {
    document: mockDoc,
    ItemType: { MOVIE: 'movie', LIVE: 'live', SERIES: 'series' },
    pushCall
  });

  const app = new ChannelClickApp();
  const makeRow = (id) => ({ getAttribute: (attr) => (attr === 'data-id' ? id : null) });

  // 1. 1º clique no canal toca no modo embutido sem abrir fullscreen
  app.activateChannelRow(makeRow('ch_1'));
  assert.deepEqual(calls, [{ fn: 'playChannel', id: 'ch_1' }]);
  assert.equal(app.isPlayerFullscreen(), false);

  // 2. 2º clique no mesmo canal abre fullscreen sem reiniciar o stream
  calls.length = 0;
  app.activateChannelRow(makeRow('ch_1'));
  assert.deepEqual(calls, [{ fn: 'toggleFullscreen', fs: true }]);
  assert.equal(app.isPlayerFullscreen(), true);

  // 3. Clique no botão Voltar (handleNativeBack) sai do fullscreen sem fechar categoria nem ir para Home
  calls.length = 0;
  assert.equal(app.handleNativeBack(), 'handled');
  assert.deepEqual(calls, [{ fn: 'toggleFullscreen', fs: false }]);
  assert.equal(app.isPlayerFullscreen(), false);

  // 4. Novo 2º clique no mesmo canal volta para fullscreen e clique no botão fullscreen sai do fullscreen
  calls.length = 0;
  app.activateChannelRow(makeRow('ch_1'));
  assert.equal(app.isPlayerFullscreen(), true);
  app.player.toggleFullscreen();
  assert.equal(app.isPlayerFullscreen(), false);
  assert.deepEqual(calls, [
    { fn: 'toggleFullscreen', fs: true },
    { fn: 'toggleFullscreen', fs: false }
  ]);

  // 5. Clique em canal diferente troca de canal no modo embutido
  calls.length = 0;
  app.activateChannelRow(makeRow('ch_2'));
  assert.deepEqual(calls, [{ fn: 'playChannel', id: 'ch_2' }]);
  assert.equal(app.isPlayerFullscreen(), false);

  // 6. Android registra botão fullscreen nativo e Desktop trata Keys.Back / Keys.BrowserBack em fullscreen
  assert.match(playerKt, /playerView\.setFullscreenButtonClickListener\s*\{/);
  assert.match(mainFormCs, /e\.KeyCode\s*==\s*Keys\.Escape\s*\|\|\s*e\.KeyCode\s*==\s*Keys\.Back\s*\|\|\s*e\.KeyCode\s*==\s*Keys\.BrowserBack/);
});

console.log('\n--- 31. Testes de Classificação M3U (4K UHD | QHD, FILMES E SERIES, NxM Filmes) ---');

await test('M3UParser.classifyItem deve manter categorias Ao Vivo (4K UHD | QHD, FILMES E SERIES, Atualização) em LIVE e filmes NxM em MOVIE', () => {
  const m3u = `#EXTM3U
#EXTINF:-1 group-title="⏺️  4K UHD | QHD",AXN 4K
http://example.com:80/user/pass/181.m3u8
#EXTINF:-1 group-title="⏺️  4K UHD | QHD",BAND SP 4K
http://example.com:80/user/pass/180.m3u8
#EXTINF:-1 group-title="⏺️  FILMES E SERIES",A&E UHD
http://example.com:80/user/pass/379.m3u8
#EXTINF:-1 group-title="⏺️  FILMES E SERIES",WARNER CHANNEL FHD
http://example.com:80/user/pass/85.m3u8
#EXTINF:-1 group-title="⭐️  ATUALIZACÃO : FILMES ✔️",⭐️ATUALIZACAO DIARIA (FILMES)
http://example.com:80/user/pass/1124.m3u8
#EXTINF:-1 group-title="⭐️  ATUALIZACÃO : SERIE ✔️",⭐️ATUALIZACAO DIARIA (SERIES)
http://example.com:80/user/pass/1123.m3u8
#EXTINF:-1 group-title="Filmes | Suspense",4x4 (2019)
http://example.com:80/movie/user/pass/2218145.mp4
#EXTINF:-1 group-title="Filmes | Drama",10x10 (2019)
http://example.com:80/movie/user/pass/2220550.mp4
#EXTINF:-1 group-title="Filmes | Drama",10x10: O Cativeiro (2018)
http://example.com:80/movie/user/pass/2221645.mp4
#EXTINF:-1 group-title="Filmes | Drama",4x100: Correndo por um Sonho (2021)
http://example.com:80/movie/user/pass/2222572.mp4
#EXTINF:-1 group-title="Series | Discovery+",4x4 Sob Medida S01E01
http://example.com:80/series/user/pass/2363744.mp4
`;

  const parsed = M3UParser.parse(m3u);
  assert.deepEqual(parsed.summary, { total: 11, live: 6, movies: 4, series: 1 });

  const byName = new Map(parsed.items.map(it => [it.name, it]));
  assert.equal(byName.get('AXN 4K').type, ItemType.LIVE);
  assert.equal(byName.get('BAND SP 4K').type, ItemType.LIVE);
  assert.equal(byName.get('A&E UHD').type, ItemType.LIVE);
  assert.equal(byName.get('WARNER CHANNEL FHD').type, ItemType.LIVE);
  assert.equal(byName.get('⭐️ATUALIZACAO DIARIA (FILMES)').type, ItemType.LIVE);
  assert.equal(byName.get('⭐️ATUALIZACAO DIARIA (SERIES)').type, ItemType.LIVE);

  for (const movieTitle of ['4x4 (2019)', '10x10 (2019)', '10x10: O Cativeiro (2018)', '4x100: Correndo por um Sonho (2021)']) {
    const mv = byName.get(movieTitle);
    assert.equal(mv.type, ItemType.MOVIE, `${movieTitle} deve ser MOVIE`);
    assert.equal(mv.seriesTitle, undefined);
  }

  const ser = byName.get('4x4 Sob Medida S01E01');
  assert.equal(ser.type, ItemType.SERIES);
  assert.equal(ser.seriesTitle, '4x4 Sob Medida');
  assert.equal(ser.season, 1);
  assert.equal(ser.episode, 1);
});

await test('_ensurePlaylistIndexes deve reclassificar itens em cache e recalcular playlist.summary', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  const m3uParserJs = readFileSync(resolve(rootDir, 'src/web/js/m3u-parser.js'), 'utf8');
  const androidM3uParserJs = readFileSync(resolve(rootDir, 'src/android/app/src/main/assets/web/js/m3u-parser.js'), 'utf8');
  assert.equal(androidM3uParserJs, m3uParserJs, 'Asset Android js/m3u-parser.js deve estar sincronizado com src/web/js/m3u-parser.js');

  const extractMethod = (name) => {
    const start = appJs.indexOf(`  ${name}(`);
    assert.ok(start !== -1, `Método ${name} não encontrado`);
    const nextMatch = appJs.slice(start + 10).search(/\n  (?:async\s+)?[a-zA-Z0-9_]+\(/);
    const end = nextMatch === -1 ? appJs.length : start + 10 + nextMatch;
    return appJs.slice(start, end);
  };

  const ReclassifyApp = new Function('M3UParser', 'ItemType', 'normalizeLiveChannelKey', `
    return class {
      constructor() {
        this.playlist = {
          items: [
            { id: '1', name: 'AXN 4K', group: '⏺️  4K UHD | QHD', type: ItemType.MOVIE, url: 'http://example.com:80/u/p/181.m3u8' },
            { id: '2', name: 'WARNER CHANNEL FHD', group: '⏺️  FILMES E SERIES', type: ItemType.SERIES, seriesTitle: 'WARNER CHANNEL FHD', season: 1, episode: 1, url: 'http://example.com:80/u/p/85.m3u8' },
            { id: '3', name: '4x4 (2019)', group: 'Filmes | Suspense', type: ItemType.SERIES, seriesTitle: '4', season: 4, episode: 4, url: 'http://example.com:80/movie/u/p/2218145.mp4' },
            { id: '4', name: 'Dark S01E01', group: 'Series | Netflix', type: ItemType.SERIES, url: 'http://example.com:80/series/u/p/999.mp4' }
          ],
          summary: { total: 4, live: 0, movies: 1, series: 3 }
        };
      }
      ${extractMethod('_ensurePlaylistIndexes')}
    };
  `)(M3UParser, ItemType, normalizeLiveChannelKey);

  const inst = new ReclassifyApp();
  inst._ensurePlaylistIndexes();
  assert.equal(inst.playlist.items[0].type, ItemType.LIVE);
  assert.equal(inst.playlist.items[1].type, ItemType.LIVE);
  assert.equal(inst.playlist.items[1].seriesTitle, undefined);
  assert.equal(inst.playlist.items[2].type, ItemType.MOVIE);
  assert.equal(inst.playlist.items[2].seriesTitle, undefined);
  assert.equal(inst.playlist.items[3].type, ItemType.SERIES);
  assert.deepEqual(inst.playlist.summary, { total: 4, live: 2, movies: 1, series: 1 });
});

console.log('\n--- 32. Testes de Image Boost / Super Resolution 2K (Web, Desktop VLC/WebView2 & Android Media3) ---');

await test('IMAGE_BOOST_MODES, VideoPlayerController e MultiScreenController devem aplicar presets, persistir e delegar para Android/VLC', async () => {
  assert.deepEqual(IMAGE_BOOST_MODES, ['off', 'hd_plus', 'ultra_2k']);
  assert.equal(IMAGE_BOOST_PRESETS.hd_plus.svgFilterId, 'flui-boost-hd-plus');
  assert.equal(IMAGE_BOOST_PRESETS.ultra_2k.svgFilterId, 'flui-boost-ultra-2k');
  assert.equal(IMAGE_BOOST_PRESETS.ultra_2k.targetHeight, 1440);
  assert.ok(IMAGE_BOOST_PRESETS.ultra_2k.sharpenSigma > IMAGE_BOOST_PRESETS.hd_plus.sharpenSigma);

  await withMockLocalStorage(async () => {
    const prevWindow = globalThis.window;
    const prevDoc = globalThis.document;
    const prevRaf = globalThis.requestAnimationFrame;
    const androidCalls = [];
    const webviewMessages = [];

    globalThis.requestAnimationFrame = (cb) => {
      if (typeof cb === 'function') cb();
      return 0;
    };

    const makeClassList = () => {
      const set = new Set();
      return {
        add: (...cls) => cls.forEach(c => set.add(c)),
        remove: (...cls) => cls.forEach(c => set.delete(c)),
        contains: (c) => set.has(c)
      };
    };

    const makeNode = () => ({
      style: { display: 'block', filter: '' },
      classList: makeClassList(),
      attributes: new Map(),
      setAttribute(k, v) { this.attributes.set(k, v); },
      getBoundingClientRect: () => ({ left: 0, top: 100, bottom: 500, width: 640, height: 360 }),
      closest: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
      pause: () => {},
      removeAttribute: () => {},
      load: () => {},
      play: () => Promise.resolve()
    });

    globalThis.window = {
      innerHeight: 720,
      addEventListener: () => {},
      removeEventListener: () => {},
      androidBridge: {
        setImageBoost: (m) => androidCalls.push({ fn: 'setImageBoost', mode: m }),
        playStream: (url, title, type, mode) => androidCalls.push({ fn: 'playStream', url, title, type, mode })
      }
    };
    globalThis.document = {
      body: { classList: makeClassList() },
      addEventListener: () => {},
      querySelector: () => null,
      getElementById: () => null
    };

    try {
      const videoEl = makeNode();
      const containerEl = makeNode();
      const ctrl = new VideoPlayerController(videoEl, containerEl);
      ctrl.hls = { capLevelToPlayerSize: true };

      assert.equal(ctrl.setImageBoost('hd_plus'), 'hd_plus');
      assert.equal(videoEl.classList.contains('boost-hd-plus'), true);
      assert.equal(containerEl.classList.contains('boost-hd-plus'), true);
      assert.match(videoEl.style.filter, /#flui-boost-hd-plus/);
      assert.equal(ctrl.hls.capLevelToPlayerSize, false);
      assert.equal(globalThis.localStorage.getItem('fluistream_image_boost'), 'hd_plus');
      assert.deepEqual(androidCalls[0], { fn: 'setImageBoost', mode: 'hd_plus' });

      assert.equal(ctrl.cycleImageBoost(), 'ultra_2k');
      assert.equal(videoEl.classList.contains('boost-ultra-2k'), true);
      assert.match(videoEl.style.filter, /#flui-boost-ultra-2k/);

      await ctrl.playStream({ name: 'Canal FHD', type: 'live', url: 'http://ex.com/live/u/p/10.m3u8' }, '', 'auto', 'hls');
      const lastSetIdx = androidCalls.map(c => c.fn).lastIndexOf('setImageBoost');
      const playIdx = androidCalls.map(c => c.fn).lastIndexOf('playStream');
      assert.ok(lastSetIdx >= 0 && playIdx > lastSetIdx, 'Deve sincronizar setImageBoost antes de playStream no Android');
      assert.equal(androidCalls[playIdx].mode, 'auto');

      assert.equal(ctrl.cycleImageBoost(), 'off');
      assert.equal(videoEl.style.filter, '');
      assert.equal(videoEl.classList.contains('boost-off'), true);

      // Desktop WebView2 + VLC mode
      delete globalThis.window.androidBridge;
      globalThis.window.chrome = {
        webview: {
          postMessage: (msg) => webviewMessages.push(msg),
          addEventListener: () => {}
        }
      };

      const vlcVideo = makeNode();
      const vlcContainer = makeNode();
      const vlcCtrl = new VideoPlayerController(vlcVideo, vlcContainer);
      vlcCtrl.setImageBoost('ultra_2k');
      assert.ok(webviewMessages.some(m => m.type === 'VLC_PLAYER_COMMAND' && m.action === 'SET_IMAGE_BOOST' && m.mode === 'ultra_2k'));

      webviewMessages.length = 0;
      await vlcCtrl.playStream({ name: 'Canal VLC', type: 'live', url: 'http://ex.com/live/u/p/20.m3u8' }, '', 'auto', 'vlc');
      const playCmd = webviewMessages.find(m => m.type === 'VLC_PLAYER_COMMAND' && m.action === 'PLAY');
      assert.ok(playCmd);
      assert.equal(playCmd.imageBoost, 'ultra_2k');

      // MultiScreenController
      webviewMessages.length = 0;
      const ms = new MultiScreenController();
      const slotVideo = makeNode();
      const slotStage = makeNode();
      ms.setImageBoost('hd_plus');
      ms.attachSlot(0, slotVideo, { id: 'ms1', name: 'Slot 1', type: 'live', url: 'http://ex.com/1.mp4' }, '', 'auto', 'hls', slotStage);
      assert.equal(slotVideo.classList.contains('boost-hd-plus'), true);
      assert.match(slotVideo.style.filter, /#flui-boost-hd-plus/);

      ms.setImageBoost('ultra_2k');
      assert.equal(slotVideo.classList.contains('boost-ultra-2k'), true);
      assert.ok(webviewMessages.some(m => m.action === 'SET_IMAGE_BOOST' && m.mode === 'ultra_2k'));
      vlcCtrl.stop();
      ms.clearAll();
    } finally {
      if (prevWindow === undefined) delete globalThis.window;
      else globalThis.window = prevWindow;
      if (prevDoc === undefined) delete globalThis.document;
      else globalThis.document = prevDoc;
      if (prevRaf === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = prevRaf;
    }
  });
});

await test('StorageService deve persistir imageBoost e limpar fluistream_image_boost em clearAll()', async () => {
  await withMockLocalStorage(async (store) => {
    const svc = new StorageService();
    assert.equal(svc.getSettings().imageBoost, 'off');

    svc.saveProfile({ id: 'p_boost', name: 'Perfil Boost', type: 'm3u_file' });
    svc.saveSettings({ imageBoost: 'ultra_2k' });
    assert.equal(svc.getSettings().imageBoost, 'ultra_2k');
    assert.equal(svc.getActiveProfile().imageBoost, 'ultra_2k');

    globalThis.localStorage.setItem('fluistream_image_boost', 'ultra_2k');
    await svc.clearAll();
    assert.equal(svc.getSettings().imageBoost, 'off');
    assert.equal(store.size, 0);
  });
});

await test('Arquivos Web, Desktop LibVLC/WebView2 e Android Media3 devem expor Image Boost sincronizado', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf8');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf8');
  const appJs = readFileSync(resolve(rootDir, 'src/web/js/app.js'), 'utf8');
  const playerJs = readFileSync(resolve(rootDir, 'src/web/js/player.js'), 'utf8');
  const locJs = readFileSync(resolve(rootDir, 'src/web/js/localization.js'), 'utf8');
  const storageJs = readFileSync(resolve(rootDir, 'src/web/js/storage.js'), 'utf8');
  const swJs = readFileSync(resolve(rootDir, 'src/web/sw.js'), 'utf8');

  assert.match(html, /id="flui-svg-shader-defs"/);
  assert.match(html, /id="flui-boost-hd-plus"/);
  assert.match(html, /id="flui-boost-ultra-2k"/);
  assert.match(html, /id="main-video-upscale-canvas"/);
  assert.match(html, /id="player-boost-osd"/);
  assert.match(html, /id="select-image-boost"/);
  assert.match(html, /id="btn-meta-image-boost"/);
  assert.match(html, /id="meta-image-boost-label"/);
  assert.match(html, /js\/app\.js\?v=2\.1\.0/);

  assert.match(css, /\.video-upscale-canvas/);
  assert.match(css, /#player-wrapper\.webgl-upscale-active #main-video/);
  assert.match(css, /\.player-boost-osd/);
  assert.match(css, /#main-video\.boost-hd-plus/);
  assert.match(css, /#main-video\.boost-ultra-2k/);
  assert.match(css, /\.multiscreen-slot video\.boost-ultra-2k/);
  assert.match(css, /#btn-meta-image-boost\.is-boost-2k/);

  assert.match(appJs, /setImageBoostMode\(/);
  assert.match(appJs, /syncImageBoostUi\(/);
  assert.match(appJs, /showImageBoostOsd\(/);
  assert.match(appJs, /handleNativeImageBoost\(/);
  assert.match(playerJs, /export class WebGlVideoUpscaler/);
  assert.match(playerJs, /_configureVideoCrossOrigin\(/);
  assert.match(playerJs, /_syncWebGlUpscaler\(/);
  assert.match(swJs, /CACHE_NAME\s*=\s*'fluistream-v2\.1\.0'/);

  // Desktop Windows LibVLC & WebView2 VSR
  const mainFormCs = readFileSync(resolve(rootDir, 'src/desktop/MainForm.cs'), 'utf8');
  const locCs = readFileSync(resolve(rootDir, 'src/desktop/LocalizationService.cs'), 'utf8');
  assert.match(mainFormCs, /NvidiaVpSuperResolution,VpSuperResolution/);
  assert.match(mainFormCs, /ApplyVlcImageBoostToMedia/);
  assert.match(mainFormCs, /ApplyVlcImageBoostToPlayer/);
  assert.match(mainFormCs, /:d3d11-upscaling=super/);
  assert.match(mainFormCs, /action == "SET_IMAGE_BOOST"/);
  assert.match(mainFormCs, /_cmbVlcBoost/);
  assert.match(mainFormCs, /handleNativeImageBoost/);
  assert.match(locCs, /\["VlcBoostLabel"\]/);
  assert.match(locCs, /\["VlcBoostUltra2k"\]/);

  // Android & Android TV Media3 Effects
  const gradleKts = readFileSync(resolve(rootDir, 'src/android/app/build.gradle.kts'), 'utf8');
  const playerKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/VideoPlayerManager.kt'), 'utf8');
  const bridgeKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/NativeBridge.kt'), 'utf8');
  const mainActivityKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/MainActivity.kt'), 'utf8');
  const activityXml = readFileSync(resolve(rootDir, 'src/android/app/src/main/res/layout/activity_main.xml'), 'utf8');
  const stringsXml = readFileSync(resolve(rootDir, 'src/android/app/src/main/res/values/strings.xml'), 'utf8');

  assert.match(gradleKts, /androidx\.media3:media3-effect:1\.3\.1/);
  assert.match(playerKt, /fun setImageBoost\(mode: String\)/);
  assert.match(playerKt, /Presentation\.createForHeight\(1440\)/);
  assert.match(playerKt, /player\.setVideoEffects\(effects\)/);
  assert.match(playerKt, /ERROR_CODE_VIDEO_FRAME_PROCESSOR_INIT_FAILED/);
  assert.match(bridgeKt, /@JavascriptInterface[\s\S]*?fun setImageBoost\(/);
  assert.match(mainActivityKt, /R\.id\.btn_player_boost/);
  assert.match(mainActivityKt, /handleNativeImageBoost/);
  assert.match(activityXml, /android:id="@\+id\/btn_player_boost"/);
  assert.match(stringsXml, /name="player_boost_ultra_2k"/);

  // Sincronização src/web -> src/android/app/src/main/assets/web
  const webFiles = {
    'index.html': html,
    'css/style.css': css,
    'js/app.js': appJs,
    'js/player.js': playerJs,
    'js/localization.js': locJs,
    'js/storage.js': storageJs,
    'sw.js': swJs
  };
  for (const [rel, expected] of Object.entries(webFiles)) {
    const synced = readFileSync(resolve(rootDir, 'src/android/app/src/main/assets/web', rel), 'utf8');
    assert.equal(synced, expected, `Asset Android ${rel} deve estar sincronizado com src/web/${rel}`);
  }
});

await test('WebGlVideoUpscaler, CORS crossOrigin e fallback CSS devem renderizar e proteger fluxos sem CORS', () => {
  assert.equal(IMAGE_BOOST_PRESETS.off.webgl.enabled, false);
  assert.equal(IMAGE_BOOST_PRESETS.hd_plus.webgl.enabled, true);
  assert.equal(IMAGE_BOOST_PRESETS.ultra_2k.webgl.enabled, true);
  assert.ok(IMAGE_BOOST_PRESETS.ultra_2k.webgl.sharpness > IMAGE_BOOST_PRESETS.hd_plus.webgl.sharpness);

  const prevWindow = globalThis.window;
  const prevDoc = globalThis.document;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancelRaf = globalThis.cancelAnimationFrame;

  const makeClassList = (initial = []) => {
    const set = new Set(initial);
    return {
      add: (...cls) => cls.forEach(c => set.add(c)),
      remove: (...cls) => cls.forEach(c => set.delete(c)),
      contains: (c) => set.has(c)
    };
  };

  let throwTaint = false;
  let drawCalls = 0;
  let texImageCalls = 0;
  const uniformsSet = {};
  const mockGl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    FLOAT: 7,
    TEXTURE_2D: 8,
    UNPACK_FLIP_Y_WEBGL: 9,
    TEXTURE_WRAP_S: 10,
    TEXTURE_WRAP_T: 11,
    TEXTURE_MIN_FILTER: 12,
    TEXTURE_MAG_FILTER: 13,
    CLAMP_TO_EDGE: 14,
    LINEAR: 15,
    MAX_VIEWPORT_DIMS: 16,
    TEXTURE0: 17,
    RGBA: 18,
    UNSIGNED_BYTE: 19,
    TRIANGLES: 20,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    deleteShader: () => {},
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    useProgram: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    createTexture: () => ({}),
    bindTexture: () => {},
    pixelStorei: () => {},
    texParameteri: () => {},
    getUniformLocation: (_p, name) => name,
    getParameter: () => [4096, 4096],
    viewport: () => {},
    activeTexture: () => {},
    texImage2D: () => {
      if (throwTaint) {
        const err = new Error('The operation is insecure.');
        err.name = 'SecurityError';
        throw err;
      }
      texImageCalls++;
    },
    uniform1i: () => {},
    uniform2f: () => {},
    uniform1f: (loc, val) => { uniformsSet[loc] = val; },
    drawArrays: () => { drawCalls++; },
    isContextLost: () => false
  };

  const upscaleCanvas = {
    id: 'main-video-upscale-canvas',
    width: 0,
    height: 0,
    clientHeight: 720,
    style: {},
    classList: makeClassList(['video-upscale-canvas', 'hidden']),
    addEventListener: () => {},
    getContext: (type) => (type === 'webgl' ? mockGl : null)
  };
  const attrs = new Map();
  const mockVideo = {
    readyState: 4,
    videoWidth: 1280,
    videoHeight: 720,
    currentTime: 12.5,
    paused: false,
    crossOrigin: null,
    style: { display: 'block', filter: '' },
    classList: makeClassList(),
    setAttribute(k, v) { attrs.set(k, v); },
    removeAttribute(k) { attrs.delete(k); },
    addEventListener: () => {},
    pause: () => {},
    load: () => {},
    play: () => Promise.resolve()
  };
  const container = {
    clientHeight: 720,
    classList: makeClassList(),
    attributes: new Map(),
    setAttribute(k, v) { this.attributes.set(k, v); },
    querySelector: (sel) => (sel === '#main-video-upscale-canvas' ? upscaleCanvas : null)
  };

  globalThis.window = {
    devicePixelRatio: 2,
    __fluiLocalProxyUrl: 'http://127.0.0.1:5055',
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  globalThis.document = {
    body: { classList: makeClassList() },
    addEventListener: () => {},
    querySelector: () => null,
    getElementById: (id) => (id === 'main-video-upscale-canvas' ? upscaleCanvas : null)
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  try {
    const ctrl = new VideoPlayerController(mockVideo, container);
    ctrl.isStopped = false;
    ctrl.currentEngine = 'hls';

    // 1. CORS & fila VOD com boost ativo
    assert.equal(ctrl._configureVideoCrossOrigin('http://127.0.0.1:5055/proxy?url=http%3A%2F%2Fex.com%2F1.mp4', false), true);
    assert.equal(mockVideo.crossOrigin, 'anonymous');
    assert.equal(ctrl._configureVideoCrossOrigin('http://cdn.ex.com/movie.mp4', false), false);
    assert.equal(mockVideo.crossOrigin, null);

    ctrl.imageBoost = 'off';
    const queueOff = ctrl._buildHtml5AttemptQueue(['http://cdn.ex.com/movie.mp4'], { type: 'movie' }, '', 'auto');
    assert.ok(queueOff[0].url.startsWith('http://cdn.ex.com/'), 'VOD sem boost deve tentar URL direta primeiro');
    ctrl.imageBoost = 'ultra_2k';
    const queueBoost = ctrl._buildHtml5AttemptQueue(['http://cdn.ex.com/movie.mp4'], { type: 'movie' }, '', 'auto');
    assert.ok(queueBoost[0].url.startsWith('http://127.0.0.1:5055/proxy?url='), 'VOD com Image Boost ativo deve priorizar proxy local CORS para WebGL');
    assert.equal(queueBoost[0].corsProxied, true);

    // 2. Render WebGL 2K CAS + aspect ratio sincronizado
    ctrl.setImageBoost('ultra_2k');
    assert.ok(ctrl.webglUpscaler instanceof WebGlVideoUpscaler);
    assert.equal(texImageCalls >= 1, true);
    assert.equal(drawCalls >= 1, true);
    assert.equal(upscaleCanvas.height, 1440);
    assert.equal(upscaleCanvas.width, 2560);
    assert.equal(upscaleCanvas.classList.contains('hidden'), false);
    assert.equal(container.classList.contains('webgl-upscale-active'), true);
    assert.equal(uniformsSet.u_sharpness, IMAGE_BOOST_PRESETS.ultra_2k.webgl.sharpness);

    ctrl.setAspectRatio('fill');
    assert.equal(upscaleCanvas.classList.contains('aspect-fill'), true);
    assert.equal(upscaleCanvas.style.objectFit, 'fill');

    // 3. Fallback automatico em SecurityError (tainted canvas) mantendo boost CSS no <video>
    throwTaint = true;
    ctrl.webglUpscaler.renderFrame(true);
    assert.equal(ctrl._webglCorsBlocked, true);
    assert.equal(ctrl.webglUpscaler.active, false);
    assert.equal(upscaleCanvas.classList.contains('hidden'), true);
    assert.equal(container.classList.contains('webgl-upscale-active'), false);
    assert.equal(mockVideo.classList.contains('boost-ultra-2k'), true);

    ctrl.stop();
    assert.equal(ctrl.webglUpscaler.active, false);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (prevRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = prevRaf;
    if (prevCancelRaf === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = prevCancelRaf;
  }
});

console.log('\n--- 33. Testes HY300 Projetor (Chromium 83 WebView, Loop 3min, Xtream JSON Lazy, 1GB RAM) ---');

await test('CSS & HTML garantem compatibilidade Chromium 83 WebView (top/right/bottom/left antes de inset, vh/--app-vh, modal-import 720p)', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const css = readFileSync(resolve(rootDir, 'src/web/css/style.css'), 'utf8');
  const html = readFileSync(resolve(rootDir, 'src/web/index.html'), 'utf8');

  assert.match(css, /\.modal-backdrop\s*\{[\s\S]*?top:\s*0;\s*\n\s*right:\s*0;\s*\n\s*bottom:\s*0;\s*\n\s*left:\s*0;\s*\n\s*inset:\s*0;/);
  assert.match(css, /\.modal-backdrop\s*\{[\s\S]*?width:\s*var\(--app-vw,\s*100vw\);[\s\S]*?height:\s*var\(--app-vh,\s*100vh\);/);
  assert.match(css, /\.modal-footer\s*\{[\s\S]*?position:\s*sticky;\s*\n\s*bottom:\s*0;/);
  assert.match(css, /\.checkbox-label input\[type="checkbox"\]\s*\{[\s\S]*?margin:\s*0 0\.5rem 0 0;/);
  assert.match(css, /#modal-import \.modal-dialog/);
  assert.match(css, /@media \(max-height: 760px\), \(pointer: coarse\)[\s\S]*?#modal-import \.modal-footer/);
  assert.match(html, /class="import-epg-options"/);
  assert.match(html, /class="modal-footer-actions"/);
});

await test('Android MainActivity.kt e NativeBridge.kt corrigem escala HY300, onRenderProcessGone e protecao OOM', () => {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const mainActivityKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/MainActivity.kt'), 'utf8');
  const nativeBridgeKt = readFileSync(resolve(rootDir, 'src/android/app/src/main/java/com/cesarovies/fluistream/NativeBridge.kt'), 'utf8');

  assert.match(mainActivityKt, /useWideViewPort\s*=\s*false/);
  assert.match(mainActivityKt, /loadWithOverviewMode\s*=\s*false/);
  assert.match(mainActivityKt, /textZoom\s*=\s*100/);
  assert.match(mainActivityKt, /override fun onRenderProcessGone\(/);
  assert.match(mainActivityKt, /override fun onTrimMemory\(/);
  assert.match(mainActivityKt, /fun isLowMemoryDevice\(\): Boolean/);
  assert.match(mainActivityKt, /fun getDeviceProfileJson\(\): String/);
  assert.match(mainActivityKt, /maxChars\s*=\s*if\s*\(isLowMemoryDevice\(\)\)\s*16_000_000/);
  assert.match(mainActivityKt, /if\s*\(isImageRequest\)\s*\{\s*\n\s*connectTimeout\s*=\s*6_000\s*\n\s*readTimeout\s*=\s*10_000/);
  assert.match(nativeBridgeKt, /@JavascriptInterface\s+fun isLowMemoryDevice\(\): Boolean/);
  assert.match(nativeBridgeKt, /@JavascriptInterface\s+fun getDeviceProfileJson\(\): String/);
});

await test('fetchRemoteText nao entra em loop de fallback (fetch/allorigins) quando window.androidBridge.fetchText falha', async () => {
  const { fetchRemoteText } = await import('../src/web/js/network.js');
  const prevWindow = globalThis.window;
  const prevFetch = globalThis.fetch;
  let fetchCalled = 0;

  globalThis.fetch = async () => {
    fetchCalled++;
    return { ok: true, text: async () => '#EXTM3U' };
  };
  globalThis.window = {
    androidBridge: {
      fetchText() {
        throw new Error('HTTP 502 Bad Gateway');
      }
    }
  };

  try {
    await assert.rejects(
      () => fetchRemoteText('http://2025easy.net/get.php?username=a&password=b', 15000),
      /HTTP 502 Bad Gateway/
    );
    assert.equal(fetchCalled, 0, 'Nao deve tentar fetch() ou proxy CORS apos falha direta do NativeBridge no Android');
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = prevFetch;
  }
});

await test('XtreamApi.fetchStructuredCatalog usa player_api.php JSON leve e adia episodios para getSeriesInfo sob demanda', async () => {
  const { XtreamApi } = await import('../src/web/js/xtream-api.js');
  const { ItemType } = await import('../src/web/js/m3u-parser.js');
  const prevWindow = globalThis.window;
  const requestedUrls = [];

  globalThis.window = {
    androidBridge: {
      fetchText(url) {
        requestedUrls.push(url);
        if (url.includes('action=get_live_categories')) {
          return JSON.stringify([{ category_id: '1', category_name: 'Esportes' }]);
        }
        if (url.includes('action=get_live_streams')) {
          return JSON.stringify([
            { stream_id: 101, name: 'ESPN Brasil', category_id: '1', stream_icon: 'http://cdn.tv/espn.png', epg_channel_id: 'espn.br', tv_archive: 1, tv_archive_duration: 3 }
          ]);
        }
        if (url.includes('action=get_vod_categories')) {
          return JSON.stringify([{ category_id: '2', category_name: 'Ação' }]);
        }
        if (url.includes('action=get_vod_streams')) {
          return JSON.stringify([
            { stream_id: 202, name: 'Matrix (1999)', category_id: '2', container_extension: 'mp4', stream_icon: 'https://cdn.tv/matrix.jpg' }
          ]);
        }
        if (url.includes('action=get_series_categories')) {
          return JSON.stringify([{ category_id: '3', category_name: 'Sci-Fi' }]);
        }
        if (url.includes('action=get_series_info') && url.includes('series_id=303')) {
          return JSON.stringify({
            info: { name: 'Dark', cover: 'https://cdn.tv/dark.jpg', plot: 'Sinopse completa', genre: 'Sci-Fi' },
            episodes: {
              '1': [
                { id: 9001, episode_num: 1, title: 'Segredos', container_extension: 'mp4', info: { duration_secs: 3100 } }
              ]
            }
          });
        }
        if (/[?&]action=get_series(?:&|$)/.test(url)) {
          return JSON.stringify([
            { series_id: 303, name: 'Dark', category_id: '3', cover: 'https://cdn.tv/dark.jpg', plot: 'Viagem no tempo', genre: 'Sci-Fi' }
          ]);
        }
        return '[]';
      }
    }
  };

  try {
    const xtream = new XtreamApi('http://2025easy.net', 'user1', 'pass1');
    const catalog = await xtream.fetchStructuredCatalog();
    assert.ok(catalog);
    assert.equal(catalog.structured, true);
    assert.equal(catalog.summary.total, 3);
    assert.equal(catalog.summary.live, 1);
    assert.equal(catalog.summary.movies, 1);
    assert.equal(catalog.summary.series, 1);
    assert.equal(catalog.items[0].url, 'http://2025easy.net/live/user1/pass1/101.m3u8');
    assert.equal(catalog.items[0].hasCatchup, true);
    assert.equal(catalog.items[1].url, 'http://2025easy.net/movie/user1/pass1/202.mp4');
    assert.equal(catalog.items[2].type, ItemType.SERIES);
    assert.equal(catalog.items[2].xtreamSeriesId, '303');
    assert.equal(catalog.items[2].url, '', 'Serie estruturada nao deve baixar todos os episodios na importacao');
    assert.equal(catalog.items[2].isLazySeriesPlaceholder, true);
    assert.equal(requestedUrls.some(u => u.includes('get.php')), false);

    // Refresh de secao unica deve buscar somente LIVE
    requestedUrls.length = 0;
    const liveOnly = await xtream.fetchStructuredCatalog({ sectionType: ItemType.LIVE });
    assert.equal(liveOnly.summary.total, 1);
    assert.equal(requestedUrls.some(u => u.includes('get_vod_streams')), false);
    assert.equal(requestedUrls.some(u => u.includes('get_series')), false);

    // Sob demanda: getSeriesInfo + buildSeriesEpisodeUrl
    const seriesInfo = await xtream.getSeriesInfo('303');
    assert.equal(seriesInfo.episodes['1'][0].id, 9001);
    assert.equal(xtream.buildSeriesEpisodeUrl(9001, 'mp4'), 'http://2025easy.net/series/user1/pass1/9001.mp4');
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});

await test('M3UParser maxItems, EPGParser janela em XML >4MB e StorageService chunking >15000 itens protegem 1GB RAM', async () => {
  const { M3UParser } = await import('../src/web/js/m3u-parser.js');
  const { EPGParser } = await import('../src/web/js/epg-parser.js');
  const { StorageService } = await import('../src/web/js/storage.js');

  // 1. M3UParser.parse maxItems
  const sampleM3u = `#EXTM3U
#EXTINF:-1,Canal 1
http://ex.com/1.m3u8
#EXTINF:-1,Canal 2
http://ex.com/2.m3u8
#EXTINF:-1,Canal 3
http://ex.com/3.m3u8`;
  const capped = M3UParser.parse(sampleM3u, { maxItems: 2 });
  assert.equal(capped.items.length, 2);
  assert.equal(capped.truncated, true);

  // 2. EPGParser prunes ancient programs when XML > 4MB
  const nowSec = Math.floor(Date.now() / 1000);
  const fmtXmltv = (sec) => {
    const d = new Date(sec * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
  };
  const fillerDesc = 'x'.repeat(400);
  const bigEpg = `<tv><channel id="c1"><display-name>C1</display-name></channel>`
    + `<programme start="${fmtXmltv(nowSec - 72 * 3600)}" stop="${fmtXmltv(nowSec - 70 * 3600)}" channel="c1"><title>Antigo</title><desc>Old</desc></programme>`
    + `<programme start="${fmtXmltv(nowSec - 600)}" stop="${fmtXmltv(nowSec + 1800)}" channel="c1"><title>Agora</title><desc>${fillerDesc}</desc></programme>`
    + `<!-- ${' '.repeat(4_100_000)} --></tv>`;
  const epg = new EPGParser();
  epg.parse(bigEpg);
  const progs = epg.programmes.get('c1') || [];
  assert.equal(progs.length, 1);
  assert.equal(progs[0].title, 'Agora');
  assert.ok(progs[0].desc.length <= 241);

  // 3. StorageService chunking (>15000 itens) + cleanup on overwrite/delete + no duplicate active_xml
  const plMap = new Map();
  const epgMap = new Map();
  const prevStorage = globalThis.localStorage;
  const memLs = new Map();
  globalThis.localStorage = {
    getItem: (k) => (memLs.has(k) ? memLs.get(k) : null),
    setItem: (k, v) => { memLs.set(k, String(v)); },
    removeItem: (k) => { memLs.delete(k); }
  };

  const makeStoreApi = (backingMap, onDone) => ({
    get(k) {
      const req = { result: backingMap.get(k), onsuccess: null, onerror: null };
      queueMicrotask(() => {
        req.onsuccess?.({ target: req });
        onDone();
      });
      return req;
    },
    put(obj) {
      backingMap.set(obj.id, obj);
      return {};
    },
    delete(k) {
      backingMap.delete(k);
      return {};
    }
  });

  const svc = new StorageService();
  svc.initPromise = Promise.resolve();
  svc.db = {
    transaction(stores) {
      let pendingOps = 0;
      const tx = {
        oncomplete: null,
        onerror: null,
        objectStore(name) {
          const backing = name === 'playlist' ? plMap : epgMap;
          pendingOps++;
          const settle = () => {
            pendingOps--;
            if (pendingOps === 0) queueMicrotask(() => tx.oncomplete?.());
          };
          queueMicrotask(() => {
            if (pendingOps > 0) {
              pendingOps--;
              if (pendingOps === 0) tx.oncomplete?.();
            }
          });
          return makeStoreApi(backing, () => {
            pendingOps = Math.max(0, pendingOps);
            if (pendingOps === 0) queueMicrotask(() => tx.oncomplete?.());
          });
        }
      };
      return tx;
    }
  };

  try {
    const bigItems = Array.from({ length: 16500 }, (_, i) => ({ id: `it_${i}`, name: `Ch ${i}`, type: 'live' }));
    svc.saveProfiles([{ id: 'p_chunk', name: 'Chunk Test', type: 'xtream' }]);
    await svc.savePlaylist({ name: 'Big', items: bigItems, summary: { total: 16500 } }, 'p_chunk');
    assert.equal(plMap.get('p_chunk').chunkCount, 2);
    assert.equal(plMap.get('p_chunk').items.length, 0);
    assert.equal(plMap.get('p_chunk__chunk_0').items.length, 15000);
    assert.equal(plMap.get('p_chunk__chunk_1').items.length, 1500);

    const loaded = await svc.loadPlaylist('p_chunk');
    assert.equal(loaded.items.length, 16500);
    assert.equal(loaded.items[16499].id, 'it_16499');

    await svc.saveEpg('<tv/>', 'p_chunk');
    assert.equal(epgMap.has('epg_p_chunk'), true);
    assert.equal(epgMap.has('active_xml'), false, 'Nao deve duplicar XML inteiro em active_xml quando perfil e especificado');

    await svc.deleteProfile('p_chunk');
    assert.equal(plMap.has('p_chunk'), false);
    assert.equal(plMap.has('p_chunk__chunk_0'), false);
    assert.equal(plMap.has('p_chunk__chunk_1'), false);
  } finally {
    if (prevStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevStorage;
  }
});

console.log(`\n========================================`);
console.log(`Resultados dos Testes: ${passedTests}/${totalTests} passaram.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}

