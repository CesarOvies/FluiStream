# FluiStream — Script de Compilação Automatizada Multiplataforma
# Padrão Cesar Ovies Engineering Standards

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
New-Item -ItemType Directory -Path (Join-Path $dist "web") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $dist "win-x64") | Out-Null

# 1. Copiar versão Web Estática para dist/web
Write-Host "--> Empacotando versão Web (100% Client-Side)..." -ForegroundColor Yellow
Copy-Item -Path "$webDir\*" -Destination (Join-Path $dist "web") -Recurse -Force
Copy-Item -Path "$root\public\*" -Destination (Join-Path $dist "web") -Recurse -Force

# 2. Compilar Desktop Portable Windows x64 Single-File
Write-Host "--> Compilando Windows x64 Single-File Portable..." -ForegroundColor Yellow
dotnet publish $desktopProj `
    -c $Configuration `
    -r win-x64 `
    -p:PublishSingleFile=true `
    -p:SelfContained=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:PublishReadyToRun=true `
    -o (Join-Path $dist "win-x64") `
    --nologo

# Compactar versão Portable em .zip
$zipPath = Join-Path $dist "FluiStream-v$Version-win-x64-portable.zip"
Write-Host "--> Gerando pacote zip: $zipPath..." -ForegroundColor Yellow
Compress-Archive -Path (Join-Path $dist "win-x64\*") -DestinationPath $zipPath -Force

# 3. Gerar Hashes Criptográficos
Write-Host "--> Gerando Hashes SHA-256 e SHA-512..." -ForegroundColor Yellow
$hashFiles = Get-ChildItem -Path $dist -Filter "*.zip"
$sha256Lines = @()
$sha512Lines = @()

foreach ($f in $hashFiles) {
    $h256 = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash
    $h512 = (Get-FileHash -Path $f.FullName -Algorithm SHA512).Hash
    $sha256Lines += "$h256  $($f.Name)"
    $sha512Lines += "$h512  $($f.Name)"
}

$sha256Lines | Out-File -FilePath (Join-Path $dist "SHA256SUMS.txt") -Encoding utf8
$sha512Lines | Out-File -FilePath (Join-Path $dist "SHA512SUMS.txt") -Encoding utf8

Write-Host "==========================================" -ForegroundColor Green
Write-Host "   Build concluído com sucesso em dist/   " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

