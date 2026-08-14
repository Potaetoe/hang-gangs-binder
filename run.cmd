@echo off
rem One entry point for the Python tooling on Windows shells. The
rem Microsoft Store python stub exits nonzero on --version, which is
rem what lets the probe below skip it. POSIX shells use ./run instead.
rem
rem DELAYED EXPANSION IS LOAD-BEARING HERE, and it is the reason every
rem verb below ends in `exit /b !ERRORLEVEL!` rather than a bare
rem `exit /b`. A bare one inside a parenthesized block reports SUCCESS
rem for a failed command when the batch file is launched from
rem PowerShell: measured on 2026-08-13 with a two-line reproduction, a
rem verb whose command exited 7 gave $LASTEXITCODE 0 through the block
rem form and 7 through this one. Every verb here was affected,
rem including `check` - so a Windows shell could read a FAILING gate as
rem a passing one, which is this repository's worst failure shape.
rem `%ERRORLEVEL%` cannot be used instead: cmd expands it when it
rem PARSES the block, which is before the command inside has run.
setlocal EnableExtensions EnableDelayedExpansion
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

if "%~1"=="agent-init" (
  rem Mirrors ./run agent-init - see the reasoning there, and the whole
  rem argument in tools/agent_init.py.
  rem
  rem %2 %3 %4 rather than a shift, for the reason the demo block below
  rem gives: cmd expands the arguments when it parses the block. Four
  rem slots because --ports takes a value and --reclaim rides beside it.
  rem
  rem The exit code matters more here than anywhere else in this file:
  rem `agent-init --verify` is what the gate's first stage asks, and a
  rem refusal that reports success is a gate that runs on an
  rem uninitialized worktree.
  %PY% tools\agent_init.py init %2 %3 %4 & exit /b !ERRORLEVEL!
)
if "%~1"=="agent-park" (
  rem Mirrors ./run agent-park - the death protocol. See there.
  %PY% tools\agent_init.py park %2 %3 & exit /b !ERRORLEVEL!
)
if "%~1"=="check" ( %PY% tools\check.py & exit /b !ERRORLEVEL! )
if "%~1"=="docs" ( %PY% tools\check_docs.py & exit /b !ERRORLEVEL! )
rem Mirrors ./run build - see the reasoning there, including why this one
rem is node rather than %PY% and why dist/ is committed.
if "%~1"=="build" ( node tools\build_web.mjs & exit /b !ERRORLEVEL! )
rem Mirrors ./run live - read-only, offline, and it contacts nothing.
if "%~1"=="live" ( %PY% tools\check_live.py --report & exit /b !ERRORLEVEL! )
if "%~1"=="serve" (
  echo Open http://127.0.0.1:8124  ^(127.0.0.1, not localhost - #72^)
  %PY% -m http.server 8124 --directory apps\web
  exit /b !ERRORLEVEL!
)
if "%~1"=="serve-root" (
  echo Site at http://127.0.0.1:8124/apps/web/, harness under /dev/,
  echo key tools under /tools/
  %PY% -m http.server 8124 --directory .
  exit /b !ERRORLEVEL!
)
if "%~1"=="keygen" (
  echo Open http://127.0.0.1:8125/keygen.html
  %PY% -m http.server 8125 --directory tools
  exit /b !ERRORLEVEL!
)
if "%~1"=="demo" (
  rem Mirrors ./run demo - see the reasoning there, including why this
  rem one is node rather than %PY%.
  rem
  rem %2 %3 rather than a shift: inside a parenthesized block cmd expands
  rem the arguments when it PARSES the block, so a shift here would move
  rem nothing and --port would silently never arrive.
  echo Open http://127.0.0.1:8126/  ^(127.0.0.1, not localhost - #72^)
  node dev\demo-server.mjs %2 %3
  exit /b !ERRORLEVEL!
)
if "%~1"=="bake" (
  rem Mirrors ./run bake - see the reasoning there, including that this
  rem writes a directory and deploys nothing.
  rem
  rem %2 %3 rather than a shift, for the reason the demo block above
  rem gives: cmd expands arguments when it parses the block.
  node dev\demo-bake.mjs %2 %3
  exit /b !ERRORLEVEL!
)
if "%~1"=="bootstrap" (
  rem Mirrors ./run bootstrap - see the reasoning there, including why
  rem the probe is the eslint binary rather than the directory.
  rem
  rem The exit code here is the closing echo's, as it was before the
  rem delayed-expansion fix above: this verb's answer is what it prints,
  rem and nothing reads its status. `./run agent-init` is the verb whose
  rem status is a contract.
  if not exist node_modules\.bin\eslint ( call npm ci --ignore-scripts ) else ( echo node_modules present - nothing to install )
  %PY% --version
  node --version
  echo gate-ready: .\run check
  exit /b !ERRORLEVEL!
)

echo usage: .\run ^<command^>
echo   agent-init ^| agent-park ^| bootstrap ^| build ^| check ^| docs ^| live
echo   serve ^| serve-root ^| keygen ^| demo ^| bake
echo run with no arguments from a POSIX shell ^(./run^) for descriptions
exit /b 2
