@echo off
setlocal

rem Restarts the PA Email Triage dev server and opens it in Edge.
rem System tools are called by absolute path so a PATH that contains Git Bash
rem (or similar) can't shadow them with a Unix build of the same name.

set PORT=3000
set URL=http://localhost:%PORT%
set SYS=%SystemRoot%\System32
cd /d "%~dp0"

echo Stopping anything already listening on port %PORT%...
for /f "tokens=5" %%p in ('%SYS%\netstat.exe -ano ^| %SYS%\findstr.exe /r /c:"LISTENING" ^| %SYS%\findstr.exe /r /c:":%PORT% "') do (
    %SYS%\taskkill.exe /f /pid %%p >nul 2>&1
)

echo Starting dev server...
start "PA Email Triage - dev server" cmd /k "npm run dev"

echo Waiting for %URL% to respond...
set /a TRIES=0
:wait
set /a TRIES+=1
%SYS%\curl.exe --silent --head --max-time 2 %URL% >nul 2>&1
if not errorlevel 1 goto ready
if %TRIES% geq 60 (
    echo.
    echo Server did not respond after 60 tries. Check the dev server window.
    pause
    exit /b 1
)
rem ping as a ~1s sleep: timeout.exe refuses to run when stdin is redirected
%SYS%\ping.exe -n 2 127.0.0.1 >nul
goto wait

:ready
echo Opening %URL% in Edge...
start msedge "%URL%"
exit /b 0
