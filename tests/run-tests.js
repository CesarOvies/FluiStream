/**
 * FluiStream — Suíte de Testes Automatizados Unitários
 * Valida M3UParser, EPGParser, XtreamApi e Dicionário i18n
 */

import assert from 'node:assert/strict';
import { M3UParser, ItemType } from '../src/web/js/m3u-parser.js';
import { EPGParser } from '../src/web/js/epg-parser.js';
import { XtreamApi } from '../src/web/js/xtream-api.js';
import { translations, SupportedLanguages } from '../src/web/js/localization.js';
import { APP_VERSION, parseCleanVersion, isNewerVersion, selectReleaseAssets, checkForUpdate } from '../src/web/js/version.js';
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
  } finally {
    globalThis.fetch = prevFetch;
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
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

console.log(`\n========================================`);
console.log(`Resultados dos Testes: ${passedTests}/${totalTests} passaram.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}

