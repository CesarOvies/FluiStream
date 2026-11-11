/**
 * FluiStream — Suíte de Testes Automatizados Unitários
 * Valida M3UParser, EPGParser, XtreamApi e Dicionário i18n
 */

import assert from 'node:assert/strict';
import { M3UParser, ItemType } from '../src/web/js/m3u-parser.js';
import { EPGParser } from '../src/web/js/epg-parser.js';
import { XtreamApi } from '../src/web/js/xtream-api.js';
import { translations, SupportedLanguages } from '../src/web/js/localization.js';

let totalTests = 0;
let passedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('\n--- 1. Testes do M3UParser ---');

test('Deve extrair url-tvg / x-tvg-url do cabeçalho #EXTM3U', () => {
  const m3u = `#EXTM3U x-tvg-url="http://meuepg.com/epg.xml"\n#EXTINF:-1 tvg-name="Canal",Canal\nhttp://stream.com/live.m3u8`;
  const result = M3UParser.parse(m3u);
  assert.equal(result.epgUrl, 'http://meuepg.com/epg.xml');
  assert.equal(result.items.length, 1);
});

test('Deve classificar canais ao vivo corretamente', () => {
  const m3u = `#EXTM3U\n#EXTINF:-1 tvg-id="globo" group-title="TV Aberta",Globo SP\nhttp://stream.com/globo.m3u8`;
  const result = M3UParser.parse(m3u);
  assert.equal(result.items[0].type, ItemType.LIVE);
  assert.equal(result.items[0].group, 'TV Aberta');
  assert.equal(result.items[0].name, 'Globo SP');
});

test('Deve classificar filmes VOD corretamente', () => {
  const m3u = `#EXTM3U\n#EXTINF:7200 tvg-id="filme1" group-title="Filmes Ação",Vingadores Ultimato\nhttp://stream.com/movie/user/pass/123.mp4`;
  const result = M3UParser.parse(m3u);
  assert.equal(result.items[0].type, ItemType.MOVIE);
});

test('Deve classificar séries e extrair temporada e episódio', () => {
  const m3u = `#EXTM3U\n#EXTINF:-1 group-title="Séries Drama",Breaking Bad - S02E05 - Quebras\nhttp://stream.com/series/user/pass/456.mp4`;
  const result = M3UParser.parse(m3u);
  assert.equal(result.items[0].type, ItemType.SERIES);
  assert.equal(result.items[0].season, 2);
  assert.equal(result.items[0].episode, 5);
  assert.equal(result.items[0].seriesTitle, 'Breaking Bad');
});

console.log('\n--- 2. Testes do EPGParser (XMLTV) ---');

test('Deve converter data XMLTV com fuso horário corretamente', () => {
  const parsed = EPGParser.parseXmltvDate('20261111220000 -0300');
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getUTCHours(), 1); // 22h -0300 = 01h UTC do dia seguinte
});

test('Deve parsear canais e programas e calcular programa atual', () => {
  const now = new Date();
  const startStr = `${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,'0')}${String(now.getUTCDate()).padStart(2,'0')}000000 +0000`;
  const stopStr = `${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,'0')}${String(now.getUTCDate()+1).padStart(2,'0')}235959 +0000`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <tv>
    <channel id="globo.br"><display-name>TV Globo</display-name></channel>
    <programme start="${startStr}" stop="${stopStr}" channel="globo.br">
      <title>Jornal Nacional</title>
      <desc>Noticiário</desc>
    </programme>
  </tv>`;

  const parser = new EPGParser();
  parser.parse(xml);

  assert.equal(parser.channels.size, 1);
  assert.equal(parser.programmes.get('globo.br')?.length, 1);

  const cur = parser.getCurrentProgram('globo.br', 'TV Globo', now);
  assert.ok(cur);
  assert.equal(cur.title, 'Jornal Nacional');
  assert.ok(cur.progress >= 0 && cur.progress <= 100);
});

console.log('\n--- 3. Testes do XtreamApi ---');

test('Deve normalizar URL e gerar endpoints corretos do player_api e get.php', () => {
  const xtream = new XtreamApi('http://myiptv.com:8080///', 'teste', 'senha123');
  assert.equal(xtream.serverUrl, 'http://myiptv.com:8080');
  assert.equal(xtream.getM3uUrl(), 'http://myiptv.com:8080/get.php?username=teste&password=senha123&type=m3u_plus&output=m3u8');
  assert.equal(xtream.getEpgUrl(), 'http://myiptv.com:8080/xmltv.php?username=teste&password=senha123');
  assert.equal(xtream.getPlayerApiUrl(), 'http://myiptv.com:8080/player_api.php?username=teste&password=senha123');
});

console.log('\n--- 4. Testes de Internacionalização (i18n - 3 Idiomas) ---');

test('Todos os 3 idiomas (pt-BR, en-US, es) devem possuir o mesmo conjunto de chaves', () => {
  const ptKeys = Object.keys(translations['pt-BR']).sort();
  const enKeys = Object.keys(translations['en-US']).sort();
  const esKeys = Object.keys(translations['es']).sort();

  assert.deepEqual(ptKeys, enKeys, 'Chaves pt-BR e en-US devem ser idênticas');
  assert.deepEqual(ptKeys, esKeys, 'Chaves pt-BR e es devem ser idênticas');
});

console.log(`\n========================================`);
console.log(`Resultados dos Testes: ${passedTests}/${totalTests} passaram.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}
