@echo off
chcp 65001 >nul
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-local-site.ps1"

if errorlevel 1 (
  echo.
  echo 사이트를 열지 못했습니다. 위의 오류 내용을 확인해 주세요.
  pause
)
