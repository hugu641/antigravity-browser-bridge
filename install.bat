@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ================================================================
echo    🚀 Installation - Antigravity Browser Bridge
echo ================================================================
echo.

:: 1. Vérification de Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERREUR] Python n'a pas été trouvé sur votre système.
    echo Veuillez installer Python (3.10 ou supérieur) depuis python.org en cochant "Add Python to PATH".
    pause
    exit /b 1
)

echo [1/3] Installation des dépendances Python...
python -m pip install -r "%~dp0requirements.txt" --quiet
if %errorlevel% neq 0 (
    echo [AVERTISSEMENT] Erreur lors de l'installation automatique avec pip.
) else (
    echo       Dépendances installées avec succès.
)
echo.

:: 2. Installation du Skill Global Antigravity
echo [2/3] Configuration du Skill Antigravity...
set "GLOBAL_SKILL_DIR=%USERPROFILE%\.gemini\config\skills\browser-operator"
if not exist "%GLOBAL_SKILL_DIR%" (
    mkdir "%GLOBAL_SKILL_DIR%" >nul 2>nul
)
copy /y "%~dp0.agent\skills\browser-operator\SKILL.md" "%GLOBAL_SKILL_DIR%\SKILL.md" >nul 2>nul
echo       Skill "browser-operator" configuré dans Antigravity.
echo.

:: 3. Préparation pour le navigateur
echo [3/3] Configuration de l'extension Navigateur...
set "EXT_DIR=%~dp0extension"

:: Copier le chemin absolu dans le presse-papier
echo %EXT_DIR%| clip
echo.
echo ================================================================
echo   ✨ INSTALLATION RÉUSSIE !
echo ================================================================
echo.
echo  Il ne vous reste plus qu'à activer l'extension dans votre navigateur :
echo.
echo   1. Ouvrez votre navigateur (Brave, Chrome ou Edge) et tapez :
echo        brave://extensions/   ou   chrome://extensions/
echo.
echo   2. Activez le [Mode développeur] (interrupteur en haut à droite).
echo.
echo   3. Cliquez sur [Charger l'extension non empaquetée] (en haut à gauche).
echo.
echo   4. Le chemin du dossier a été COPIÉ DANS VOTRE PRESSE-PAPIER !
echo      Faites simplement Ctrl+V dans la barre d'adresse de la fenêtre,
echo      ou sélectionnez le dossier :
echo      %EXT_DIR%
echo.
echo ================================================================
echo.
set /p START_NOW="Voulez-vous lancer le serveur maintenant ? (O/n) : "
if /i "!START_NOW!"=="" set START_NOW=O
if /i "!START_NOW!"=="O" (
    echo.
    echo Lancement du serveur...
    start "" "%~dp0start.bat"
)

echo.
pause
