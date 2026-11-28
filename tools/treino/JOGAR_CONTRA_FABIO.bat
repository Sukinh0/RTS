@echo off
setlocal
cd /d "%~dp0..\rts_v1_pack"
if errorlevel 1 goto sem_projeto
where npm >nul 2>nul
if errorlevel 1 goto sem_node
if not exist node_modules\esbuild (
  echo Instalando dependencias, so na primeira vez...
  call npm ci
  if errorlevel 1 goto fim
)
echo O jogo abre no navegador. Feche esta janela para encerrar.
call npm run dev -- --open "/?ia=fabio"
goto fim
:sem_projeto
echo Nao achei a pasta rts_v1_pack ao lado desta pasta.
goto fim
:sem_node
echo Node.js nao encontrado. Instale em https://nodejs.org
:fim
echo.
pause
