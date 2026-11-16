#!/usr/bin/env bash
# ==============================================================================
# FluiStream — Script de Compilação e Empacotamento Nativo macOS (.app / .dmg)
# Padrão Cesar Ovies Engineering Standards
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
DIST_DIR="$ROOT_DIR/dist"
APP_NAME="FluiStream"
VERSION="1.2.0"
BUNDLE_ID="com.cesarovies.fluistream"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
DMG_FILE="$DIST_DIR/${APP_NAME}-v${VERSION}-macOS.dmg"
ZIP_FILE="$DIST_DIR/${APP_NAME}-v${VERSION}-macOS.zip"

echo "===================================================="
echo "   Iniciando Build Nativo macOS: FluiStream v$VERSION"
echo "   Padrão Cesar Ovies Engineering Standards"
echo "===================================================="

# 1. Validação de Pré-requisitos
command -v dotnet >/dev/null 2>&1 || { echo "[ERRO] dotnet SDK não encontrado." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "[ERRO] node não encontrado." >&2; exit 1; }

# 2. Sincronizar Assets Web e Executar Suíte de Testes
echo "--> [1/6] Sincronizando assets web e executando testes unitários..."
rsync -a "$ROOT_DIR/src/web/" "$ROOT_DIR/src/android/app/src/main/assets/web/"
node "$ROOT_DIR/tests/run-tests.js"

# 3. Limpar pasta dist
echo "--> [2/6] Preparando diretório de distribuição..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# 4. Compilar Desktop (.NET 10 Target net10.0)
echo "--> [3/6] Compilando projeto Desktop C# (.NET 10)..."
BUILD_TEMP="$DIST_DIR/build-temp"
mkdir -p "$BUILD_TEMP"

dotnet publish "$ROOT_DIR/src/desktop/FluiStream.Desktop.csproj" \
    -c Release \
    -f net10.0 \
    -o "$BUILD_TEMP" \
    --nologo

# 5. Criar Estrutura do macOS Application Bundle (.app)
echo "--> [4/6] Estruturando macOS Application Bundle ($APP_NAME.app)..."
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
echo "--> [5/6] Configurando AppIcon.icns nativo..."
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

# 7. Empacotar em Imagem de Disco DMG e arquivo ZIP portátil
echo "--> [6/6] Gerando pacotes de distribuição (ZIP e DMG)..."
(cd "$DIST_DIR" && zip -r -q "$ZIP_FILE" "$APP_NAME.app")
rm -f "$DIST_DIR/SHA256SUMS-macOS.txt"

DMG_STAGING="$DIST_DIR/dmg-staging"
mkdir -p "$DMG_STAGING"
cp -R "$APP_BUNDLE" "$DMG_STAGING/"
ln -s /Applications "$DMG_STAGING/Applications"

if command -v hdiutil >/dev/null 2>&1 && hdiutil create \
    -volname "$APP_NAME v$VERSION" \
    -srcfolder "$DMG_STAGING" \
    -ov \
    -format UDZO \
    "$DMG_FILE" >/dev/null 2>&1; then
    echo "--> DMG gerado com sucesso: $DMG_FILE"
    SHA_DMG=$(shasum -a 256 "$DMG_FILE" | awk '{print $1}')
    echo "$SHA_DMG  $(basename "$DMG_FILE")" >> "$DIST_DIR/SHA256SUMS-macOS.txt"
else
    echo "--> [Aviso] hdiutil create requer permissão de dispositivo de bloco neste ambiente. Pacote ZIP portátil gerado com sucesso."
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
