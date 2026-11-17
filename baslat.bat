@echo off
title EsoCAD Web Sunucusu
cd /d "I:\CABBAR\CEPNCZ\web_cepncz"
echo EsoCAD Web Sunucusu Baslatiliyor...
echo Adres: http://localhost:50080
start http://localhost:50080
node server.js
pause
