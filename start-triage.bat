@echo off
setlocal

rem Restarts the PA Email Triage dev server and opens it in Edge (app mode).
rem System tools are called by absolute path so a PATH that contains Git Bash
rem (or similar) can't shadow them with a Unix build of the same name.

set PORT=3000
set URL=http://localhost:%PORT%
set SYS=%SystemRoot%\System32
set PS=%SYS%\WindowsPowerShell\v1.0\powershell.exe
rem Must match the <title> set in app/layout.js — used to find the open window.
set APPTITLE=Gabriel Email Triage Tool
cd /d "%~dp0"

echo Closing any existing triage browser window...
rem The app is opened with --app= so it gets its own Edge window whose title is
rem EXACTLY the page title (no " - Microsoft Edge" suffix). Match exactly so we
rem only ever close the app window, never a regular Edge window that happens to
rem have the triage tab active. Closed gracefully, like clicking X.
%PS% -NoProfile -Command "Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '%APPTITLE%' } | ForEach-Object { $_.CloseMainWindow() | Out-Null }" >nul 2>&1

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
echo Opening %URL% in Edge (app window)...
start msedge --app=%URL%
exit /b 0
