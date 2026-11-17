#!/usr/bin/env bash
# ==============================================================================
# FluiStream — Script de Compilação e Empacotamento Nativo macOS (.app / .dmg)
# Padrão Cesar Ovies Engineering Standards
# Suporte a Assinatura Ad-Hoc (Opção B - Open Source / Sem Apple Developer Pago)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
DIST_DIR="$ROOT_DIR/dist"
APP_NAME="FluiStream"
TARGET_RID="${1:-osx-arm64}"
VERSION="${2:-}"

if [ -z "$VERSION" ]; then
    VERSION=$(grep -oPm1 '(?<=<Version>)[^<]+' "$ROOT_DIR/src/desktop/FluiStream.Desktop.csproj" || echo "1.2.0")
fi

BUNDLE_ID="com.cesarovies.fluistream"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
DMG_FILE="$DIST_DIR/${APP_NAME}-v${VERSION}-macOS.dmg"
ZIP_FILE="$DIST_DIR/${APP_NAME}-v${VERSION}-macOS.zip"

echo "===================================================="
echo "   Iniciando Build Nativo macOS: FluiStream v$VERSION ($TARGET_RID)"
echo "   Padrão Cesar Ovies Engineering Standards"
echo "===================================================="

# 1. Validação de Pré-requisitos
command -v dotnet >/dev/null 2>&1 || { echo "[ERRO] dotnet SDK não encontrado." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "[ERRO] node não encontrado." >&2; exit 1; }

# 2. Sincronizar Assets Web e Executar Suíte de Testes
echo "--> [1/7] Sincronizando assets web e executando testes unitários..."
if [ -d "$ROOT_DIR/src/android/app/src/main/assets" ]; then
    mkdir -p "$ROOT_DIR/src/android/app/src/main/assets/web/"
    rsync -a "$ROOT_DIR/src/web/" "$ROOT_DIR/src/android/app/src/main/assets/web/"
fi
node "$ROOT_DIR/tests/run-tests.js"

# 3. Limpar pasta dist (preservando outros binários se existirem)
echo "--> [2/7] Preparando diretório de distribuição..."
mkdir -p "$DIST_DIR"
rm -rf "$APP_BUNDLE" "$DMG_FILE" "$ZIP_FILE" "$DIST_DIR/dmg-staging" "$DIST_DIR/build-temp"

# 4. Compilar Desktop (.NET 10 Target net10.0 Single-File Self-Contained)
echo "--> [3/7] Compilando binário nativo macOS (.NET 10 $TARGET_RID self-contained)..."
BUILD_TEMP="$DIST_DIR/build-temp"
mkdir -p "$BUILD_TEMP"

dotnet publish "$ROOT_DIR/src/desktop/FluiStream.Desktop.csproj" \
    -c Release \
    -f net10.0 \
    -r "$TARGET_RID" \
    -p:PublishSingleFile=true \
    --self-contained true \
    -p:Version="$VERSION" \
    -o "$BUILD_TEMP" \
    --nologo

# 5. Criar Estrutura do macOS Application Bundle (.app)
echo "--> [4/7] Estruturando macOS Application Bundle ($APP_NAME.app)..."
CONTENTS_DIR="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

# Copiar binários e dependências para MacOS/
cp -R "$BUILD_TEMP/"* "$MACOS_DIR/"
rm -rf "$BUILD_TEMP"

# Sincronizar assets web para Resources/web e MacOS/web
mkdir -p "$RESOURCES_DIR/web"
rsync -a "$ROOT_DIR/src/web/" "$RESOURCES_DIR/web/"
if [ -d "$ROOT_DIR/public" ]; then
    rsync -a "$ROOT_DIR/public/" "$RESOURCES_DIR/web/" 2>/dev/null || true
fi
mkdir -p "$MACOS_DIR/web"
rsync -a "$RESOURCES_DIR/web/" "$MACOS_DIR/web/"

# 6. Configurar AppIcon.icns nativo
echo "--> [5/7] Configurando AppIcon.icns nativo..."
if [ -f "$ROOT_DIR/src/desktop/AppIcon.icns" ]; then
    cp "$ROOT_DIR/src/desktop/AppIcon.icns" "$RESOURCES_DIR/AppIcon.icns"
else
    echo "[Aviso] src/desktop/AppIcon.icns não encontrado; usando ícone PNG como fallback."
    cp "$ROOT_DIR/src/web/assets/icon-512.png" "$RESOURCES_DIR/AppIcon.png"
fi

# Criar Info.plist
cat <<EOF > "$CONTENTS_DIR/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>pt-BR</string>
    <key>CFBundleExecutable</key>
    <string>$APP_NAME</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>$BUNDLE_ID</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>$APP_NAME</string>
    <key>CFBundleDisplayName</key>
    <string>$APP_NAME</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>$VERSION</string>
    <key>CFBundleVersion</key>
    <string>$VERSION</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>CFBundleSupportedPlatforms</key>
    <array>
        <string>MacOSX</string>
    </array>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSRequiresAquaSystemAppearance</key>
    <false/>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsArbitraryLoads</key>
        <true/>
    </dict>
</dict>
</plist>
EOF

chmod +x "$MACOS_DIR/$APP_NAME"

# 7. Assinatura Ad-Hoc (Opção B - Obrigatória para Apple Silicon não abortar com SIGKILL)
echo "--> [6/7] Aplicando assinatura de código Ad-Hoc nos binários e bundle..."
if command -v codesign >/dev/null 2>&1; then
    ENTITLEMENTS_FILE="$ROOT_DIR/src/desktop/entitlements.plist"
    if [ -f "$ENTITLEMENTS_FILE" ]; then
        codesign --force --deep -s - --entitlements "$ENTITLEMENTS_FILE" "$APP_BUNDLE" || codesign --force --deep -s - "$APP_BUNDLE"
    else
        codesign --force --deep -s - "$APP_BUNDLE"
    fi
    echo "--> Assinatura Ad-Hoc aplicada com sucesso."
else
    echo "--> [Aviso] utilitário 'codesign' não disponível no ambiente atual."
fi

# 8. Empacotar em Imagem de Disco DMG e arquivo ZIP portátil
echo "--> [7/7] Gerando pacotes de distribuição (ZIP e DMG)..."
(cd "$DIST_DIR" && zip -r -q "$ZIP_FILE" "$APP_NAME.app")
rm -f "$DIST_DIR/SHA256SUMS-macOS.txt"

DMG_STAGING="$DIST_DIR/dmg-staging"
mkdir -p "$DMG_STAGING"
cp -R "$APP_BUNDLE" "$DMG_STAGING/"
ln -s /Applications "$DMG_STAGING/Applications"

# Adicionar guia rápido dentro do DMG para o usuário final
cat <<'EOF' > "$DMG_STAGING/COMO-ABRIR-NO-MAC.txt"
FluiStream — Como abrir no macOS
================================

Por ser software open-source distribuído sem assinatura paga da Apple ($99/ano),
o macOS Gatekeeper exibirá um aviso de segurança no primeiro uso.

Para abrir normalmente (escolha uma das opções):

OPÇÃO 1 (Recomendada - Visual):
1. Arraste o FluiStream.app para a pasta Aplicativos (Applications).
2. Na pasta Aplicativos, clique com o BOTÃO DIREITO (ou pressione Control + clique) no FluiStream.
3. Selecione "Abrir" no menu.
4. Na janela de confirmação que surgir, clique no botão "Abrir".
(Esse procedimento é necessário apenas na primeira execução; depois abre com 2 cliques normais).

OPÇÃO 2 (Via Ajustes do Sistema):
1. Tente abrir o FluiStream normalmente com dois cliques.
2. Abra "Ajustes do Sistema" -> "Privacidade e Segurança".
3. Role até a seção "Segurança" e clique em "Abrir Mesmo Assim".

OPÇÃO 3 (Via Terminal):
Abra o Terminal e execute o comando:
xattr -cr /Applications/FluiStream.app
EOF

if command -v hdiutil >/dev/null 2>&1 && hdiutil create \
    -volname "$APP_NAME v$VERSION" \
    -srcfolder "$DMG_STAGING" \
    -ov \
    -format UDZO \
    "$DMG_FILE" >/dev/null 2>&1; then
    echo "--> DMG gerado com sucesso: $DMG_FILE"
    if command -v codesign >/dev/null 2>&1; then
        codesign --force -s - "$DMG_FILE" 2>/dev/null || true
    fi
    SHA_DMG=$(shasum -a 256 "$DMG_FILE" | awk '{print $1}')
    echo "$SHA_DMG  $(basename "$DMG_FILE")" >> "$DIST_DIR/SHA256SUMS-macOS.txt"
else
    echo "--> [Aviso] hdiutil create não pôde gerar o DMG neste ambiente. Pacote ZIP portátil gerado com sucesso."
fi
rm -rf "$DMG_STAGING"

SHA_ZIP=$(shasum -a 256 "$ZIP_FILE" | awk '{print $1}')
echo "$SHA_ZIP  $(basename "$ZIP_FILE")" >> "$DIST_DIR/SHA256SUMS-macOS.txt"

echo "===================================================="
echo "   Build e Empacotamento macOS concluídos com sucesso!"
echo "   App Bundle: $APP_BUNDLE"
[ -f "$DMG_FILE" ] && echo "   DMG:        $DMG_FILE"
echo "   ZIP:        $ZIP_FILE"
echo "===================================================="
