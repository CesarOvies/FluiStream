<p align="center">
  <img src="src/web/assets/logo.svg" alt="FluiStream Logo" width="160" />
</p>
<h1 align="center">FluiStream</h1>
<p align="center">
  <b>Reprodutor moderno e fluido de listas M3U/M3U8 com EPG XMLTV, Xtream Codes API, Web Responsiva e Desktop Portable.</b><br/>
  <i>Modern fluid M3U/M3U8 playlist player with XMLTV EPG, Xtream Codes API, Responsive Web and Portable Desktop.</i><br/>
  <i>Reproductor moderno y fluido de listas M3U/M3U8 con EPG XMLTV, API Xtream Codes, Web Responsiva y Desktop Portable.</i>
</p>

<p align="center">
  <a href="https://cesarovies.github.io/FluiStream/"><img src="https://img.shields.io/badge/Web_App-Live_Demo-238636?logo=githubpages&logoColor=white" alt="Live Demo" /></a>
  <a href="https://github.com/CesarOvies/FluiStream/releases"><img src="https://img.shields.io/github/v/release/CesarOvies/FluiStream?logo=github&label=Release" alt="Release" /></a>
  <a href="https://cesarovies.github.io/FluiStream/llms.txt"><img src="https://img.shields.io/badge/AI_Context-llms.txt-388BFD?logo=openai&logoColor=white" alt="llms.txt" /></a>
  <img src="https://img.shields.io/badge/.NET-10.0-512BD4?logo=dotnet&logoColor=white" alt=".NET 10.0" />
  <img src="https://img.shields.io/badge/Platform-Web%20%7C%20Windows%20Portable-slate" alt="Platform" />
  <img src="https://img.shields.io/badge/i18n-PT%20%7C%20EN%20%7C%20ES-06B6D4" alt="i18n" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" /></a>
</p>

<p align="center">
  🌐 <a href="https://cesarovies.github.io/FluiStream/"><strong>Usar Versão Web</strong></a> •
  💻 <a href="https://github.com/CesarOvies/FluiStream/releases"><strong>Baixar App Desktop Portable</strong></a> •
  🤖 <a href="https://cesarovies.github.io/FluiStream/llms.txt"><strong>llms.txt (AI Index)</strong></a>
</p>

---

## Sumário
1. [Visão Geral](#visão-geral)
2. [Recursos Principais](#recursos-principais)
3. [Arquitetura & Fluxo](#arquitetura--fluxo)
4. [Como Usar](#como-usar)
5. [Compilação e Testes](#compilação-e-testes)
6. [Governança e Segurança](#governança-e-segurança)

---

## Visão Geral

O **FluiStream** é um reprodutor de mídia e listas IPTV (M3U / M3U8) de alto desempenho projetado segundo os padrões de engenharia de software de **Cesar Ovies**.

Ele resolve as principais limitações dos players convencionais combinando uma interface web 100% client-side (PWA) de carregamento instantâneo com um executável desktop portátil (`.exe`) em **User-Space (`asInvoker`)** que dispensa instaladores, não exige privilégios de Administrador e remove restrições de CORS ao se conectar a servidores de streaming remotos.

> [!NOTE]
> O **FluiStream** é um reprodutor de mídia neutro. Ele não inclui e nem fornece listas, canais ou conteúdos de terceiros; o usuário é responsável por carregar suas próprias listas legítimas.

---

## Recursos Principais

### 1. Organização Inteligente em 3 Seções
- 📺 **Ao Vivo (Live TV)**: Canais de televisão abertos e por assinatura, esportes, notícias e variedades com guia de programação em tempo real.
- 🎬 **Filmes (VOD)**: Catálogo de filmes sob demanda organizados por categorias e gêneros.
- 🍿 **Séries (Series & Shows)**: Detecção automática de séries com agrupamento inteligente por Temporadas e Episódios (ex: `S01E02`, `1x05`, `Temporada 1`).

### 2. Guia Eletrônico de Programação (EPG XMLTV)
- **EPG Embutido**: Detecção e extração automática de URLs de EPG declaradas na própria lista (`#EXTM3U x-tvg-url="..."` ou `url-tvg="..."`).
- **EPG Externo**: Possibilidade de anexar EPG externo via URL XMLTV ou envio de arquivo `.xml`.
- **Exibição em Tempo Real**: Cálculo dinâmico do programa em exibição no momento, percentual decorrido na barra de progresso e lista dos próximos programas agendados.

### 3. Três Formas de Importação Flexíveis
1. **Arquivo Fixo Local**: Upload ou arraste (Drag & Drop) de arquivos `.m3u` ou `.m3u8`.
2. **URL Remota**: Download direto da lista com suporte a proxy CORS configurável.
3. **API Xtream Codes**: Autenticação nativa utilizando Nome da Lista, Usuário, Senha e URL do Servidor (consumindo `player_api.php`, `get.php` e `xmltv.php`).

### 4. Player de Vídeo Moderno & Fluido
- Motor HLS.js integrado para reprodução contínua de streams `.m3u8` e contêineres MP4 / MKV.
- Ajuste de **Proporção de Tela (Aspect Ratio)**: Automático, 16:9 (Widescreen), 4:3 (Clássico) e Preencher (Fill).
- Suporte nativo a **Picture-in-Picture (PiP)** e **Tela Cheia (Fullscreen)**.
- Integração com **Media Session API** (controles no teclado e na central de mídia do Windows/macOS/Android).
- Sistema de **Favoritos** persistente e histórico de canais recentes.

### 5. Padrões Cesar Ovies
- **Design GitHub Dark Theme** (`#0D1117`, `#161B22`, `#30363D`, `#238636`).
- **i18n Obrigatório em 3 Idiomas**: Português do Brasil (`pt-BR`), Inglês (`en-US`) e Espanhol (`es`).
- **100% User-Space**: Sem exigência de permissões elevadas de Administrador.
- **Auto-Atualização Desktop**: `UpdateService` com verificação de releases no GitHub e substituição atômica em segundo plano.

---

## Arquitetura & Fluxo

```mermaid
flowchart TD
    subgraph Importação
        M1[Arquivo Local .m3u / .m3u8] --> Parser[M3U Parser & Heurística]
        M2[URL Remota M3U] --> Parser
        M3[API Xtream Codes\nServidor + User + Pass] --> Xtream[Xtream API Connector]
        Xtream --> Parser
        EPG_IN[x-tvg-url Embutido] --> EPG[XMLTV EPG Parser]
        EPG_EXT[EPG Externo XML] --> EPG
    end

    subgraph Core
        Parser --> Classificador{Classificador Inteligente}
        Classificador -->|Ao Vivo| C1[📺 Grade Ao Vivo]
        Classificador -->|VOD| C2[🎬 Filmes]
        Classificador -->|Séries| C3[🍿 Séries & Episódios]
        EPG --> Grade[Grade de Horários & Progresso]
    end

    subgraph Apresentação
        C1 & C2 & C3 & Grade --> UI[Interface Web Responsiva #0D1117]
        UI --> WebPlayer[Web Player SPA / PWA\nGitHub Pages / Cloudflare]
        UI --> DesktopApp[Desktop Portable .NET 10\nWebView2 asInvoker]
    end
```

---

## Como Usar

### Versão Web
Acesse diretamente via navegador:
👉 **[https://cesarovies.github.io/FluiStream/](https://cesarovies.github.io/FluiStream/)**

### Versão Desktop Portable (Windows)
1. Baixe o arquivo `FluiStream-v1.0.0-win-x64-portable.zip` na aba [Releases](https://github.com/CesarOvies/FluiStream/releases).
2. Extraia para qualquer pasta (ex: em seu Pendrive ou Documentos).
3. Execute `FluiStream.exe`. Zero instalação necessária.

---

## Compilação e Testes

### Pré-requisitos
- .NET 10.0 SDK
- Node.js 20+

### Execução dos Testes Locais
```powershell
# Executar suíte de testes unitários
node tests/run-tests.js
```

### Compilação do Executável Desktop
```powershell
# Compilação em modo Release
dotnet build src/desktop/FluiStream.Desktop.csproj -c Release
```

### Geração Completa dos Pacotes de Distribuição
```powershell
# Executa o script oficial de build multiplataforma
./build-all.ps1
```

---

## Governança e Segurança

- **Gitflow**: Ramificações `main` (releases de produção via PR) e `develop` (desenvolvimento contínuo).
- **Regra de Ouro 1**: Nenhum commit é realizado sem testes locais validados com sucesso.
- **Regra de Ouro 2**: Nenhum `git push` é realizado sem o consentimento explícito do usuário.
- **Zero Secrets**: Nenhuma credencial ou token reside no código cliente.

---

<p align="center">
  Desenvolvido por <strong><a href="https://github.com/CesarOvies">Cesar Ovies</a></strong> sob a licença MIT.
</p>

