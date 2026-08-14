@echo off
rem One entry point for the Python tooling on Windows shells. The
rem Microsoft Store python stub exits nonzero on --version, which is
rem what lets the probe below skip it. POSIX shells use ./run instead.
rem
rem EVERY VERB DISPATCHES TO A LABEL, AND THAT SHAPE IS LOAD-BEARING.
rem The obvious form, `if "%~1"=="check" ( <command> & exit /b
rem %ERRORLEVEL% )`, cannot work: cmd expands a parenthesized block when
rem it PARSES the block, which is before the command inside it has run,
rem so the status reported is whatever ERRORLEVEL held on the way in. A
rem bare `exit /b` there is worse - measured on 2026-08-13, a verb whose
rem command exited 7 reported $LASTEXITCODE 0 when this file was
rem launched from PowerShell. `check` is one of these verbs, so a
rem Windows shell could read a FAILING gate as a passing one, which is
rem this repository's worst failure shape.
rem
rem Delayed expansion answers that and charges for it: with it enabled
rem cmd eats `!` out of every argument passing through, so an argument
rem `a!b!c` arrives as `ac`, silently - measured the same day, on this
rem file's own dispatch line. No verb here takes an argument likely to
rem hold one today, and a launcher that quietly rewrites its arguments
rem is a trap laid for the verb that does.
rem
rem A label costs neither. A line outside a parenthesized block is
rem parsed as it executes, so `exit /b %ERRORLEVEL%` on a line of its
rem own reads the value the line above it set.
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

if "%~1"=="agent-init" goto :agent_init
if "%~1"=="agent-park" goto :agent_park
if "%~1"=="check" goto :check
if "%~1"=="docs" goto :docs
if "%~1"=="build" goto :build
if "%~1"=="live" goto :live
if "%~1"=="serve" goto :serve
if "%~1"=="serve-root" goto :serve_root
if "%~1"=="keygen" goto :keygen
if "%~1"=="demo" goto :demo
if "%~1"=="bake" goto :bake
if "%~1"=="bootstrap" goto :bootstrap
goto :usage

:agent_init
rem Mirrors ./run agent-init - see the reasoning there, and the whole
rem argument in tools/agent_init.py.
rem
rem Positional forwarding rather than a shift, because the verb is
rem matched by %~1 and cmd has no way to pass the rest along by name.
rem Four slots because --ports takes a value and --reclaim rides beside
rem it.
rem
rem The exit code matters more here than anywhere else in this file:
rem `agent-init --verify` is what the gate's first stage asks, and a
rem refusal that reports success is a gate that runs on an
rem uninitialized worktree.
%PY% tools\agent_init.py init %2 %3 %4
exit /b %ERRORLEVEL%

:agent_park
rem Mirrors ./run agent-park - the death protocol. See there. Two slots
rem so --verify reaches the script: on this verb it is the dry run of a
rem destructive act, and an agent that asks the question must not be
rem answered with the act.
%PY% tools\agent_init.py park %2 %3
exit /b %ERRORLEVEL%

:check
%PY% tools\check.py
exit /b %ERRORLEVEL%

:docs
%PY% tools\check_docs.py
exit /b %ERRORLEVEL%

:build
rem Mirrors ./run build - see the reasoning there, including why this one
rem is node rather than %PY% and why dist/ is committed.
node tools\build_web.mjs
exit /b %ERRORLEVEL%

:live
rem Mirrors ./run live - read-only, offline, and it contacts nothing.
%PY% tools\check_live.py --report
exit /b %ERRORLEVEL%

:serve
echo Open http://127.0.0.1:8124  ^(127.0.0.1, not localhost - #72^)
%PY% -m http.server 8124 --directory apps\web
exit /b %ERRORLEVEL%

:serve_root
echo Site at http://127.0.0.1:8124/apps/web/, harness under /dev/,
echo key tools under /tools/
%PY% -m http.server 8124 --directory .
exit /b %ERRORLEVEL%

:keygen
echo Open http://127.0.0.1:8125/keygen.html
%PY% -m http.server 8125 --directory tools
exit /b %ERRORLEVEL%

:demo
rem Mirrors ./run demo - see the reasoning there, including why this
rem one is node rather than %PY%. --port arrives through %2 %3; a
rem positional port is silently ignored by the server itself, so the
rem banner it prints is the thing to read.
echo Open http://127.0.0.1:8126/  ^(127.0.0.1, not localhost - #72^)
node dev\demo-server.mjs %2 %3
exit /b %ERRORLEVEL%

:bake
rem Mirrors ./run bake - see the reasoning there, including that this
rem writes a directory and deploys nothing.
node dev\demo-bake.mjs %2 %3
exit /b %ERRORLEVEL%

:bootstrap
rem Mirrors ./run bootstrap - see the reasoning there, including why
rem the probe is the eslint binary rather than the directory.
rem
rem The status this verb exits with is node's, because `echo` does not
rem touch ERRORLEVEL and node --version is the last command that sets
rem it - measured rather than assumed. Nothing reads it: this verb's
rem answer is what it prints, and the shell twin in ./run ends the same
rem sequence on its echo, so the two launchers agree on the printout and
rem not on the status. It is left as node's rather than forced to zero
rem because a missing node is the one thing that would make the printed
rem answer a lie. `./run agent-init` is the verb whose status is a
rem contract.
if not exist node_modules\.bin\eslint ( call npm ci --ignore-scripts ) else ( echo node_modules present - nothing to install )
%PY% --version
node --version
echo gate-ready: .\run check
exit /b %ERRORLEVEL%

:usage
echo usage: .\run ^<command^>
echo   agent-init ^| agent-park ^| bootstrap ^| build ^| check ^| docs ^| live
echo   serve ^| serve-root ^| keygen ^| demo ^| bake
echo run with no arguments from a POSIX shell ^(./run^) for descriptions
exit /b 2
