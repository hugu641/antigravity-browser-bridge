@echo off
chcp 65001 >nul
title Antigravity Browser Bridge
echo ================================================================
echo    🌐 Antigravity Browser Bridge Server
echo ================================================================
echo.
echo  Serveur en cours d'exécution...
echo  - WebSocket : ws://127.0.0.1:8765
echo  - API REST  : http://127.0.0.1:8766
echo.
echo  Laissez cette fenêtre ouverte pendant que vous utilisez l'agent.
echo ================================================================
echo.
python "%~dp0bridge\server.py"
pause
