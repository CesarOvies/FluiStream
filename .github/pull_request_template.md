## Descrição / Description

<!-- Descreva de forma clara e objetiva o que foi alterado e o motivo. -->

## Tipo de Alteração / Change Type

- [ ] `feat`: Nova funcionalidade / New feature
- [ ] `fix`: Correção de bug / Bug fix
- [ ] `docs`: Documentação & metadados (`README.md`, `llms.txt`, `CITATION.cff`)
- [ ] `ci`: CI/CD, workflows ou scripts de build (`build-all.ps1`)
- [ ] `refactor`: Refatoração sem mudança de comportamento
- [ ] `chore`: Manutenção / dependências

## Plataforma Afetada / Affected Platforms

- [ ] Desktop Portable (`.NET 10` — `win-x64`, `linux-x64`, `linux-arm64`, `osx-arm64`)
- [ ] Android / Android TV (`src/android/` — Media3 ExoPlayer)
- [ ] Core UI (`src/web/`)
- [ ] Governança / CI / Docs (`.github/`, `README.md`, `tests/`)

## Checklist — Padrões Cesar Ovies

- [ ] **Gitflow**: PR para `develop` vem de branch `feature/*` ou `fix/*`; PR para `main` vem **exclusivamente** de `develop`.
- [ ] **Testes Locais (Regra de Ouro 1)**:
  - [ ] `node tests/run-tests.js` executado e passando 100%.
  - [ ] `dotnet build src/desktop/FluiStream.Desktop.csproj -c Release` com `0` erros e `0` warnings relevantes.
  - [ ] Build Android (`./gradlew assembleRelease` / `assembleDebug`) validado ou verificado via CI, com `src/web/*` sincronizado em `src/android/app/src/main/assets/web/` se houve alteração de UI.
- [ ] **i18n (3 Idiomas)**: Toda nova string de interface foi adicionada simultaneamente em `pt-BR`, `en-US` e `es`.
- [ ] **Dark UI & User-Space**: Paleta GitHub Dark (`#0D1117`) preservada, zero diálogos brancos/nativos crus, execução 100% User-Space (`asInvoker`).
- [ ] **Segurança**: Zero segredos/credenciais expostos no cliente; validação SHA-256 preservada no auto-update.

## Evidências de Teste / Test Evidence

```text
# Cole aqui a saída dos testes locais executados antes do commit
```
