# FluiStream — Script de Compilação Automatizada Multiplataforma
# Padrão Cesar Ovies Engineering Standards (win-x64, linux-x64, linux-arm64, osx-arm64)

param (
    [string]$Configuration = "Release",
    [string]$Version = "1.1.0",
    [switch]$IncludeInternalWeb
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

# 0. Opcional (uso interno): Empacotar Core UI Web
if ($IncludeInternalWeb) {
    $webOut = Join-Path $dist "web"
    New-Item -ItemType Directory -Path $webOut | Out-Null
    Write-Host "--> [Interno] Empacotando Core UI Web..." -ForegroundColor Yellow
    Copy-Item -Path "$webDir\*" -Destination $webOut -Recurse -Force
    if (Test-Path "$root\public") {
        Copy-Item -Path "$root\public\*" -Destination $webOut -Recurse -Force
    }
    $webZip = Join-Path $dist "FluiStream-v$Version-web-standalone.zip"
    Compress-Archive -Path "$webOut\*" -DestinationPath $webZip -Force
    Remove-Item -Path $webOut -Recurse -Force
}

# 1. Compilar Desktop Portable Windows x64 (WinForms + LibVLC + WebView2 Single-File)
$winOut = Join-Path $dist "win-x64"
New-Item -ItemType Directory -Path $winOut | Out-Null
Write-Host "--> Compilando Windows x64 Portable Single-File..." -ForegroundColor Yellow
dotnet publish $desktopProj `
    -f net10.0-windows `
    -c $Configuration `
    -r win-x64 `
    -p:Version=$Version `
    -p:PublishSingleFile=true `
    -p:SelfContained=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:PublishReadyToRun=true `
    -o $winOut `
    --nologo

$winZip = Join-Path $dist "FluiStream-v$Version-win-x64-portable.zip"
Write-Host "--> Gerando pacote zip Windows: $winZip..." -ForegroundColor Yellow
Compress-Archive -Path "$winOut\*" -DestinationPath $winZip -Force

# 2. Compilar Desktop Portable Linux x64 Single-File
$linuxOut = Join-Path $dist "linux-x64"
New-Item -ItemType Directory -Path $linuxOut | Out-Null
Write-Host "--> Compilando Linux x64 Portable Single-File..." -ForegroundColor Yellow
dotnet publish $desktopProj `
    -f net10.0 `
    -c $Configuration `
    -r linux-x64 `
    -p:Version=$Version `
    -p:PublishSingleFile=true `
    -p:SelfContained=true `
    -o $linuxOut `
    --nologo

$linuxZip = Join-Path $dist "FluiStream-v$Version-linux-x64-portable.zip"
Write-Host "--> Gerando pacote zip Linux x64: $linuxZip..." -ForegroundColor Yellow
Compress-Archive -Path "$linuxOut\*" -DestinationPath $linuxZip -Force

$linuxTar = Join-Path $dist "FluiStream-v$Version-linux-x64-portable.tar.gz"
Write-Host "--> Gerando pacote tar.gz Linux x64: $linuxTar..." -ForegroundColor Yellow
tar -czf $linuxTar -C $linuxOut .

# 3. Compilar Desktop Portable Linux ARM64 Single-File
$linuxArmOut = Join-Path $dist "linux-arm64"
New-Item -ItemType Directory -Path $linuxArmOut | Out-Null
Write-Host "--> Compilando Linux ARM64 Portable Single-File..." -ForegroundColor Yellow
dotnet publish $desktopProj `
    -f net10.0 `
    -c $Configuration `
    -r linux-arm64 `
    -p:Version=$Version `
    -p:PublishSingleFile=true `
    -p:SelfContained=true `
    -o $linuxArmOut `
    --nologo

$linuxArmZip = Join-Path $dist "FluiStream-v$Version-linux-arm64-portable.zip"
Write-Host "--> Gerando pacote zip Linux ARM64: $linuxArmZip..." -ForegroundColor Yellow
Compress-Archive -Path "$linuxArmOut\*" -DestinationPath $linuxArmZip -Force

$linuxArmTar = Join-Path $dist "FluiStream-v$Version-linux-arm64-portable.tar.gz"
Write-Host "--> Gerando pacote tar.gz Linux ARM64: $linuxArmTar..." -ForegroundColor Yellow
tar -czf $linuxArmTar -C $linuxArmOut .

# 4. Compilar Desktop Portable macOS ARM64 Single-File
$osxOut = Join-Path $dist "osx-arm64"
New-Item -ItemType Directory -Path $osxOut | Out-Null
Write-Host "--> Compilando macOS ARM64 (Apple Silicon) Portable Single-File..." -ForegroundColor Yellow
dotnet publish $desktopProj `
    -f net10.0 `
    -c $Configuration `
    -r osx-arm64 `
    -p:Version=$Version `
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
Remove-Item -Path $linuxArmOut -Recurse -Force
Remove-Item -Path $osxOut -Recurse -Force

# 5. Gerar Hashes Criptográficos SHA-256 e SHA-512
Write-Host "--> Gerando Hashes SHA-256 e SHA-512..." -ForegroundColor Yellow
$archiveFiles = Get-ChildItem -Path $dist | Where-Object { $_.Extension -in @(".zip", ".gz") } | Sort-Object Name
$sha256Lines = @()
$sha512Lines = @()

foreach ($f in $archiveFiles) {
    $h256 = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $h512 = (Get-FileHash -Path $f.FullName -Algorithm SHA512).Hash.ToLowerInvariant()
    $sha256Lines += "$h256  $($f.Name)"
    $sha512Lines += "$h512  $($f.Name)"
}

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllLines((Join-Path $dist "SHA256SUMS.txt"), $sha256Lines, $utf8NoBom)
[System.IO.File]::WriteAllLines((Join-Path $dist "SHA512SUMS.txt"), $sha512Lines, $utf8NoBom)

Write-Host "==========================================" -ForegroundColor Green
Write-Host "   Build multiplataforma concluído com sucesso em dist/   " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Get-ChildItem -Path $dist | Select-Object Name, Length
