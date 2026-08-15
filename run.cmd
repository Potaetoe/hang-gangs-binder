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
rem
rem RUN_CMD_REPO is captured here, once, before anything below can move
rem it: :agent_init below re-invokes this file from a COPY sitting
rem outside this directory, and %~dp0 inside that copy resolves to
rem wherever the copy lives, not to this checkout. Every verb sets it
rem harmlessly; only agent-init reads it back.
setlocal EnableExtensions
cd /d "%~dp0"
if not defined RUN_CMD_REPO set "RUN_CMD_REPO=%CD%"

set "PY="
call py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY call python3 --version >nul 2>nul && set "PY=python3"
if not defined PY call python --version >nul 2>nul && set "PY=python"
if not defined PY (
  echo No working Python found ^(the Microsoft Store stub does not count^).
  echo Install one from python.org or enable the py launcher.
  exit /b 1
)

if "%~1"=="session-open" goto :session_open
if "%~1"=="agent-init" goto :agent_init
if "%~1"=="agent-park" goto :agent_park
if "%~1"=="check" goto :check
if "%~1"=="gate" goto :gate
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

:session_open
rem Mirrors ./run session-open - see the reasoning there, and the whole
rem argument in tools\session_open.py's own module docstring. Plain
rem label, unlike agent-init below: this verb never touches a file
rem run.cmd itself is checked out as, so none of the self-rewrite
rem hazard that verb's copy-and-call dance exists to survive applies
rem here.
%PY% tools\session_open.py
exit /b %ERRORLEVEL%

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
rem
rem SELF-RENORMALIZATION HAZARD. This file is itself eol-pinned
rem (`*.cmd text eol=crlf`, .gitattributes), so on a stale worktree the
rem call below can renormalize THIS FILE - delete it and re-check it
rem out - while cmd.exe is still reading it to run the next line.
rem Reproduced in a throwaway harness on 2026-08-13: cmd.exe's read
rem position desynced against the new bytes, which duplicated one
rem line's execution and truncated another into a bogus command
rem ("'ER-REWRITE' is not recognized"). The fix routes the actual work
rem through a disposable COPY of this file, so the copy of cmd.exe
rem interpreting the script is never the file agent_init.py might
rem rewrite; git only knows this checkout's run.cmd, so the copy is
rem never itself a renormalization target.
rem
rem Delayed expansion is switched on for THIS LABEL ONLY, never for the
rem file (see the top comment for why not) - the call-and-report line
rem below has to stay on one line to get the same read-ahead protection
rem a parenthesized block gets (measured there too), and on one line
rem `%ERRORLEVEL%` reads the value from BEFORE that line ran, not
rem after; `!ERRORLEVEL!` is the one that reads it fresh. The verb's
rem own arguments never reach that line un-substituted, so the `!`-eats
rem -arguments trap the top comment describes does not apply here.
if defined RUN_CMD_AGENT_INIT_VIA_COPY goto :agent_init_run
setlocal EnableDelayedExpansion
set "RUN_CMD_AGENT_INIT_VIA_COPY=1"
rem UNIQUE PER INVOCATION - fixes the collision review-0.9-m0-s7-2026-
rem 08-13 found and reproduced live (finding R1). A fixed %TEMP% path
rem is the same file for every worktree on the machine, and this fleet
rem runs several agents at once: while agent A's cmd.exe holds that
rem path open for the whole runtime of agent-init (npm ci included),
rem agent B's `copy /y` overwrites it under A - Windows allows the
rem overwrite, so the `if errorlevel 1` guard below never fires, and A
rem desyncs against bytes it never asked to run, reporting EXITCODE=0
rem having initialized nothing. The worktree directory's own name is
rem already distinct per agent - only one worktree may hold a given
rem branch (the checkout contract above) - so it alone kills the
rem cross-worktree case the review measured; %RANDOM% is layered on
rem top only for the narrower case of two invocations racing inside
rem the SAME worktree, which the directory tag alone cannot separate.
for %%W in ("%RUN_CMD_REPO%") do set "RUN_CMD_AGENT_INIT_TAG=%%~nW"
set "RUN_CMD_AGENT_INIT_COPY=%TEMP%\hgb-run-agent-init-copy-%RUN_CMD_AGENT_INIT_TAG%-%RANDOM%.cmd"
copy /y "%~f0" "%RUN_CMD_AGENT_INIT_COPY%" >nul
if errorlevel 1 (
  echo Could not stage a safe copy of run.cmd for agent-init - refusing
  echo rather than risk this file rewriting itself while still read.
  exit /b 1
)
rem The whole sequence after the risky call stays on this ONE line, on
rem purpose, for the same read-ahead reason argued above: cmd.exe
rem buffers a full physical line before executing anything on it, so
rem this line's bytes are already read before `call` can trigger the
rem rewrite the copy exists to survive. Splitting the cleanup onto its
rem own line would read that line AFTER the call returns - from
rem whatever this file has become by then - which is the exact desync
rem this comment block exists to prevent. The status is saved to a
rem name of its own BEFORE the best-effort `del` runs (finding R4), so
rem a delete that fails (permissions, another process still holding the
rem copy) can never overwrite the real exit code with its own. Never
rem masking the real exit code is the whole point of doing this at all
rem - deleting is cleanup, not part of the contract, so its own success
rem or failure stays off the screen and off the exit code both.
call "%RUN_CMD_AGENT_INIT_COPY%" agent-init %2 %3 %4 & set "RUN_CMD_AGENT_INIT_STATUS=!ERRORLEVEL!" & del /f /q "%RUN_CMD_AGENT_INIT_COPY%" >nul 2>nul & exit /b !RUN_CMD_AGENT_INIT_STATUS!

:agent_init_run
rem Reached only inside the copy, which is never a renormalization
rem target, so plain %ERRORLEVEL% is correct and safe here as
rem everywhere else in this file.
cd /d "%RUN_CMD_REPO%"
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

:gate
rem The 0.9 gate (tests/run.mjs) - see its own header, including the
rem preflight seam that is its stage zero. `check` above is the OLD
rem gate; the two run side by side under the #228 ruling until `check`
rem has no surfaces left to guard. node rather than %PY%: tests/run.mjs
rem is what every arm here answers to, and it is JavaScript.
node tests\run.mjs
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
echo   session-open ^| agent-init ^| agent-park ^| bootstrap ^| build ^| check
echo   gate ^| docs ^| live ^| serve ^| serve-root ^| keygen ^| demo ^| bake
echo run with no arguments from a POSIX shell ^(./run^) for descriptions
exit /b 2
