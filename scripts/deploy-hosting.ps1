# ==============================================================================
# GestãoPro — Script de Deploy no Firebase Hosting
# ==============================================================================
$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "   GestãoPro — Publicando no Firebase Hosting" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Build da aplicação com variáveis de staging/produção
Write-Host "`n[1/2] Gerando build de producao com modo staging..." -ForegroundColor Yellow
bun x vite build --mode staging
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Erro durante o build do frontend. Abortando deploy." -ForegroundColor Red
    exit 1
}

# 2. Deploy no Firebase Hosting
Write-Host "`n[2/2] Enviando arquivos para o Firebase Hosting..." -ForegroundColor Yellow
firebase deploy --only hosting
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Erro durante o deploy no Firebase Hosting." -ForegroundColor Red
    exit 1
}

Write-Host "`n🎉 Publicacao concluida com sucesso!" -ForegroundColor Green
Write-Host "Acesse seu aplicativo em: https://gerenciador-produtos-staging.web.app" -ForegroundColor Cyan
