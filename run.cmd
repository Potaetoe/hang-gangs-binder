@echo off
rem One entry point for the Python tooling on Windows shells. The
rem Microsoft Store python stub exits nonzero on --version, which is
rem what lets the probe below skip it. POSIX shells use ./run instead.
setlocal EnableExtensions
cd /d "%~dp0"

set "PY="
call py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY call python3 --version >nul 2>nul && set "PY=python3"
if not defined PY call python --version >nul 2>nul && set "PY=python"
if not defined PY (
  echo No working Python found ^(the Microsoft Store stub does not count^).
  echo Install one from python.org or enable the py launcher.
  exit /b 1
)

if "%~1"=="check" ( %PY% tools\check.py & exit /b )
if "%~1"=="docs" ( %PY% tools\check_docs.py & exit /b )
rem Mirrors ./run live - read-only, offline, and it contacts nothing.
if "%~1"=="live" ( %PY% tools\check_live.py --report & exit /b )
if "%~1"=="serve" (
  echo Open http://127.0.0.1:8124  ^(127.0.0.1, not localhost - #72^)
  %PY% -m http.server 8124 --directory apps\web
  exit /b
)
if "%~1"=="serve-root" (
  echo Site at http://127.0.0.1:8124/apps/web/, harness under /dev/,
  echo key tools under /tools/
  %PY% -m http.server 8124 --directory .
  exit /b
)
if "%~1"=="keygen" (
  echo Open http://127.0.0.1:8125/keygen.html
  %PY% -m http.server 8125 --directory tools
  exit /b
)
if "%~1"=="demo" (
  rem Mirrors ./run demo - see the reasoning there, including why this
  rem one is node rather than %PY%.
  rem
  rem %2 %3 rather than a shift: inside a parenthesized block cmd expands
  rem the arguments when it PARSES the block, so a shift here would move
  rem nothing and --port would silently never arrive.
  echo Open http://127.0.0.1:8126/dev/demo.html  ^(127.0.0.1, not localhost - #72^)
  node dev\demo-server.mjs %2 %3
  exit /b
)
if "%~1"=="bake" (
  rem Mirrors ./run bake - see the reasoning there, including that this
  rem writes a directory and deploys nothing.
  rem
  rem %2 %3 rather than a shift, for the reason the demo block above
  rem gives: cmd expands arguments when it parses the block.
  node dev\demo-bake.mjs %2 %3
  exit /b
)
if "%~1"=="bootstrap" (
  rem Mirrors ./run bootstrap - see the reasoning there, including why
  rem the probe is the eslint binary rather than the directory.
  if not exist node_modules\.bin\eslint ( call npm ci --ignore-scripts ) else ( echo node_modules present - nothing to install )
  %PY% --version
  node --version
  echo gate-ready: .\run check
  exit /b
)

echo usage: .\run ^<command^>
echo   bootstrap ^| check ^| docs ^| live ^| serve ^| serve-root ^| keygen ^| demo ^| bake
echo run with no arguments from a POSIX shell ^(./run^) for descriptions
exit /b 2
