# Contribuindo com o FluiStream / Contributing to FluiStream

Obrigado pelo interesse em contribuir! / Thank you for your interest in contributing!

---

## 🐛 Pedidos de Correção ou Melhoria / Bug Reports & Feature Requests

Use os formulários estruturados na aba **Issues** do GitHub:
- **[Relatar Bug / Bug Report](https://github.com/CesarOvies/FluiStream/issues/new?template=bug_report.yml)**
- **[Pedir Melhoria / Feature Request](https://github.com/CesarOvies/FluiStream/issues/new?template=feature_request.yml)**

Para falhas de segurança, utilize o canal privado em [Security Advisories](https://github.com/CesarOvies/FluiStream/security/advisories/new).

---

## 🔀 Fluxo de Pull Requests (Gitflow)

1. Crie sua branch a partir de `develop`:
   - Nova funcionalidade: `feature/nome-curto`
   - Correção de bug: `fix/nome-curto`
2. Mantenha o padrão de UI (Dark Theme `#0D1117`) e adicione novas strings de interface nos **3 idiomas obrigatórios** (`pt-BR`, `en-US`, `es`).
3. Execute os testes locais antes de abrir o PR:
   ```bash
   node tests/run-tests.js
   ```
   Se alterou o Desktop (`.NET 10`):
   ```bash
   dotnet build src/desktop/FluiStream.Desktop.csproj -c Release
   ```
4. Abra o Pull Request para `develop` preenchendo o [template de PR](.github/pull_request_template.md).

