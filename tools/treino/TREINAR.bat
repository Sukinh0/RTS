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
set "HORAS=3"
set /p "HORAS=Quantas horas de treino? [Enter = 3] "
set "HORAS=%HORAS:,=.%"
set "SAIDA=%~dp0resultados"
rem Abre o relatorio alguns segundos depois do inicio.
start "" /min cmd /c "timeout /t 15 >nul & if exist "%SAIDA%\relatorio.html" start "" "%SAIDA%\relatorio.html""
call npm run train -- "--hours=%HORAS%" "--out=%SAIDA%"
goto fim
:sem_projeto
echo Nao achei a pasta rts_v1_pack ao lado desta pasta.
goto fim
:sem_node
echo Node.js nao encontrado. Instale em https://nodejs.org
:fim
echo.
pause
