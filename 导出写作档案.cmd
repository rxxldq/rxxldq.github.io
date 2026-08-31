@echo off
setlocal
set "ARCHIVE_ROOT=%~dp0"
set "PYTHON_KIND="
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  set "PYTHON_KIND=bundled"
)
if not defined PYTHON_KIND (
  where py >nul 2>&1
  if not errorlevel 1 set "PYTHON_KIND=py"
)
if not defined PYTHON_KIND (
  where python >nul 2>&1
  if not errorlevel 1 set "PYTHON_KIND=python"
)
if not defined PYTHON_KIND goto python_not_found

if /I "%PYTHON_KIND%"=="bundled" "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" "%ARCHIVE_ROOT%scripts\export_archive.py"
if /I "%PYTHON_KIND%"=="py" py -3 "%ARCHIVE_ROOT%scripts\export_archive.py"
if /I "%PYTHON_KIND%"=="python" python "%ARCHIVE_ROOT%scripts\export_archive.py"
if errorlevel 1 goto export_failed
goto successful

:python_not_found
echo Python was not found. Install Python 3 or run this from Codex, then try again.
echo.
echo This window will stay open so you can read the message.
pause
exit /b 1

:export_failed
echo.
echo Export failed. This window will stay open so you can read the message.
pause
exit /b 1

:successful
echo.
echo Export complete. The five files are in the output folder.
exit /b 0
endlocal
