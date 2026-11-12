# FluiStream — Script de Compilação Automatizada Multiplataforma
# Padrão Cesar Ovies Engineering Standards (win-x64, linux-x64, osx-arm64, web)

param (
    [string]$Configuration = "Release",
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   Iniciando Build de FluiStream v$Version" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$root = $PSScriptRoot
$dist = Join-Path $root "dist"
$desktopProj = Join-Path $root "src\desktop\FluiStream.Desktop.csproj"
$webDir = Join-Path $root "src\web"

if (Test-Path $dist) {
    Remove-Item -Path $dist -Recurse -Force
}
New-Item -ItemType Directory -Path $dist | Out-Null
$webOut = Join-Path $dist "web"
New-Item -ItemType Directory -Path $webOut | Out-Null

# 1. Empacotar versão Web Estática (100% Client-Side)
Write-Host "--> Empacotando versão Web (100% Client-Side)..." -ForegroundColor Yellow
Copy-Item -Path "$webDir\*" -Destination $webOut -Recurse -Force
if (Test-Path "$root\public") {
    Copy-Item -Path "$root\public\*" -Destination $webOut -Recurse -Force
}
$webZip = Join-Path $dist "FluiStream-v$Version-web-standalone.zip"
Compress-Archive -Path "$webOut\*" -DestinationPath $webZip -Force

# 2. Compilar Desktop Portable Windows x64 (WinForms + LibVLC + WebView2 Single-File)
$winOut = Join-Path $dist "win-x64"
New-Item -ItemType Directory -Path $winOut | Out-Null
Write-Host "--> Compilando Windows x64 Portable Single-File..." -ForegroundColor Yellow
dotnet publish $desktopProj `
    -f net10.0-windows `
    -c $Configuration `
    -r win-x64 `
    -p:PublishSingleFile=true `
    -p:SelfContained=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:PublishReadyToRun=true `
    -o $winOut `
    --nologo

$winZip = Join-Path $dist "FluiStream-v$Version-win-x64-portable.zip"
Write-Host "--> Gerando pacote zip Windows: $winZip..." -ForegroundColor Yellow
Compress-Archive -Path "$winOut\*" -DestinationPath $winZip -Force

# 3. Compilar Desktop Portable Linux x64 Single-File
$linuxOut = Join-Path $dist "linux-x64"
New-Item -ItemType Directory -Path $linuxOut | Out-Null
Write-Host "--> Compilando Linux x64 Portable Single-File..." -ForegroundColor Yellow
dotnet publish $desktopProj `
    -f net10.0 `
    -c $Configuration `
    -r linux-x64 `
    -p:PublishSingleFile=true `
    -p:SelfContained=true `
    -o $linuxOut `
    --nologo

$linuxZip = Join-Path $dist "FluiStream-v$Version-linux-x64-portable.zip"
Write-Host "--> Gerando pacote zip Linux: $linuxZip..." -ForegroundColor Yellow
Compress-Archive -Path "$linuxOut\*" -DestinationPath $linuxZip -Force

$linuxTar = Join-Path $dist "FluiStream-v$Version-linux-x64-portable.tar.gz"
Write-Host "--> Gerando pacote tar.gz Linux: $linuxTar..." -ForegroundColor Yellow
tar -czf $linuxTar -C $linuxOut .

# 4. Compilar Desktop Portable macOS ARM64 Single-File
$osxOut = Join-Path $dist "osx-arm64"
New-Item -ItemType Directory -Path $osxOut | Out-Null
Write-Host "--> Compilando macOS ARM64 (Apple Silicon) Portable Single-File..." -ForegroundColor Yellow
dotnet publish $desktopProj `
    -f net10.0 `
    -c $Configuration `
    -r osx-arm64 `
    -p:PublishSingleFile=true `
    -p:SelfContained=true `
    -o $osxOut `
    --nologo

$osxZip = Join-Path $dist "FluiStream-v$Version-osx-arm64-portable.zip"
Write-Host "--> Gerando pacote zip macOS: $osxZip..." -ForegroundColor Yellow
Compress-Archive -Path "$osxOut\*" -DestinationPath $osxZip -Force

$osxTar = Join-Path $dist "FluiStream-v$Version-osx-arm64-portable.tar.gz"
Write-Host "--> Gerando pacote tar.gz macOS: $osxTar..." -ForegroundColor Yellow
tar -czf $osxTar -C $osxOut .

# Limpar pastas intermediárias de compilação
Remove-Item -Path $winOut -Recurse -Force
Remove-Item -Path $linuxOut -Recurse -Force
Remove-Item -Path $osxOut -Recurse -Force
Remove-Item -Path $webOut -Recurse -Force

# 5. Gerar Hashes Criptográficos SHA-256 e SHA-512
Write-Host "--> Gerando Hashes SHA-256 e SHA-512..." -ForegroundColor Yellow
$archiveFiles = Get-ChildItem -Path $dist | Where-Object { $_.Extension -in @(".zip", ".tar.gz", ".gz") }
$sha256Lines = @()
$sha512Lines = @()

foreach ($f in $archiveFiles) {
    $h256 = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash
    $h512 = (Get-FileHash -Path $f.FullName -Algorithm SHA512).Hash
    $sha256Lines += "$h256  $($f.Name)"
    $sha512Lines += "$h512  $($f.Name)"
}

$sha256Lines | Out-File -FilePath (Join-Path $dist "SHA256SUMS.txt") -Encoding utf8
$sha512Lines | Out-File -FilePath (Join-Path $dist "SHA512SUMS.txt") -Encoding utf8

Write-Host "==========================================" -ForegroundColor Green
Write-Host "   Build multiplataforma concluído com sucesso em dist/   " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Get-ChildItem -Path $dist | Select-Object Name, Length
