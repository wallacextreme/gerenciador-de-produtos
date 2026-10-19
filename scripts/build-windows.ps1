# ==============================================================================
# GestaoPro - Script de Geracao de Instaladores Windows (.exe e .msi)
# ==============================================================================
$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "   GestaoPro - Gerando Instaladores Windows" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# Cria pasta de saida de facil acesso na raiz do projeto
$OutputDir = Join-Path $PSScriptRoot "..\dist-installers"
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# 1. Compila o instalador .exe (NSIS)
Write-Host "`n[1/2] Compilando instalador executavel (.exe via NSIS)..." -ForegroundColor Yellow
bun x tauri build -b nsis
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERRO] Falha ao compilar instalador .exe." -ForegroundColor Red
    exit 1
}

# 2. Compila o instalador .msi (WiX)
Write-Host "`n[2/2] Compilando instalador corporativo (.msi via WiX)..." -ForegroundColor Yellow
bun x tauri build -b msi
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERRO] Falha ao compilar instalador .msi." -ForegroundColor Red
    exit 1
}

# 3. Copia os instaladores para a pasta dist-installers
$NsisDir = Join-Path $PSScriptRoot "..\src-tauri\target\release\bundle\nsis"
$MsiDir  = Join-Path $PSScriptRoot "..\src-tauri\target\release\bundle\msi"

Get-ChildItem -Path $NsisDir -Filter "*.exe" | Copy-Item -Destination $OutputDir -Force
Get-ChildItem -Path $MsiDir -Filter "*.msi" | Copy-Item -Destination $OutputDir -Force

Write-Host "`n[OK] Instaladores gerados com sucesso!" -ForegroundColor Green
Write-Host "Arquivos disponiveis na pasta: $OutputDir" -ForegroundColor Cyan
Get-ChildItem -Path $OutputDir | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
