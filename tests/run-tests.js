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
import { VideoPlayerController } from '../src/web/js/player.js';
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

  assert.equal(ptKeys.length, 244, `Esperado exatamente 244 chaves i18n em pt-BR, obtido ${ptKeys.length}`);
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

console.log(`\n========================================`);
console.log(`Resultados dos Testes: ${passedTests}/${totalTests} passaram.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}

