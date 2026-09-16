@echo off
setlocal
if exist "C:\Program Files\Git\bin\bash.exe" (
  "C:\Program Files\Git\bin\bash.exe" "%~dp0build.sh" %*
  exit /b %errorlevel%
)
if exist "C:\Program Files (x86)\Git\bin\bash.exe" (
  "C:\Program Files (x86)\Git\bin\bash.exe" "%~dp0build.sh" %*
  exit /b %errorlevel%
)
bash "%~dp0build.sh" %*
exit /b %errorlevel%
