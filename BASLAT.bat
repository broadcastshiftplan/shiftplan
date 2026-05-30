@echo off
chcp 65001 > nul
title Nobet Cizelgesi v6
echo.
echo  ============================================
echo   Nobet Cizelgesi Yonetim Sistemi v6.0
echo  ============================================
echo.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo HATA: Node.js bulunamadi!
    echo https://nodejs.org adresinden LTS surumunu kurun.
    pause & exit /b 1
)
if not exist "node_modules" (
    echo Ilk kurulum yapiliyor...
    npm install
    echo.
)
if not exist ".env" (
    copy .env.example .env > nul
    echo .env dosyasi olusturuldu.
    echo Lutfen .env dosyasini acip JWT_SECRET degerini degistirin!
    echo.
)
echo Aciliyor: http://localhost:3000
echo Admin: ADMIN_USER / ADMIN_PASS (.env dosyasindaki degerler)
echo Durdurmak icin bu pencereyi kapatin.
echo.
start "" "http://localhost:3000"
node server.js
pause
