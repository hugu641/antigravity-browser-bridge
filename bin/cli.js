#!/usr/bin/env node

/**
 * Antigravity Browser Bridge - CLI & NPX Installer
 * Permet l'installation en 1 seule commande : npx antigravity-browser-bridge
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT_DIR, 'extension');
const SKILL_FILE = path.join(ROOT_DIR, '.agent', 'skills', 'browser-operator', 'SKILL.md');

// Couleurs ANSI
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
};

function banner() {
  console.log(`
${c.cyan}${c.bold}================================================================${c.reset}
  ${c.magenta}✦${c.reset} ${c.bold}Antigravity Browser Bridge${c.reset} — ${c.dim}Installeur NPX${c.reset}
${c.cyan}${c.bold}================================================================${c.reset}
`);
}

function copyToClipboard(text) {
  try {
    if (process.platform === 'win32') {
      execSync('clip', { input: text });
      return true;
    } else if (process.platform === 'darwin') {
      execSync('pbcopy', { input: text });
      return true;
    } else {
      execSync('xclip -selection clipboard', { input: text });
      return true;
    }
  } catch (_) {
    return false;
  }
}

function installSkill() {
  console.log(`${c.yellow}[1/3]${c.reset} Configuration du skill dans Antigravity...`);
  const homedir = os.homedir();
  const globalSkillDir = path.join(homedir, '.gemini', 'config', 'skills', 'browser-operator');

  try {
    if (!fs.existsSync(globalSkillDir)) {
      fs.mkdirSync(globalSkillDir, { recursive: true });
    }
    const dest = path.join(globalSkillDir, 'SKILL.md');
    fs.copyFileSync(SKILL_FILE, dest);
    console.log(`      ${c.green}✓${c.reset} Skill enregistré globalement dans :`);
    console.log(`        ${c.dim}${dest}${c.reset}`);
  } catch (err) {
    console.log(`      ${c.red}✗${c.reset} Erreur lors de la copie du skill : ${err.message}`);
  }
}

function installPythonDeps() {
  console.log(`\n${c.yellow}[2/3]${c.reset} Installation des dépendances Python (websockets, pillow)...`);
  const reqFile = path.join(ROOT_DIR, 'requirements.txt');
  try {
    execSync(`python -m pip install -r "${reqFile}" --quiet`, { stdio: 'inherit' });
    console.log(`      ${c.green}✓${c.reset} Dépendances Python installées avec succès.`);
  } catch (err) {
    console.log(`      ${c.yellow}!${c.reset} Note : Vérifiez que Python et pip sont bien installés.`);
  }
}

function findBrowser() {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ];
    return candidates.find(p => fs.existsSync(p));
  } else if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ];
    return candidates.find(p => fs.existsSync(p));
  } else {
    const candidates = ['brave-browser', 'google-chrome', 'chromium-browser', 'chromium'];
    for (const bin of candidates) {
      try {
        execSync(`which ${bin}`, { stdio: 'ignore' });
        return bin;
      } catch (_) {}
    }
  }
  return null;
}

function launchBrowserAuto() {
  const browser = findBrowser();
  if (!browser) {
    console.log(`${c.red}✗${c.reset} Aucun navigateur Chromium (Brave/Chrome/Edge) détecté automatiquement.`);
    return false;
  }

  const browserName = path.basename(browser).replace(/\.exe$/i, '');
  console.log(`\n🚀 Lancement automatique de ${c.bold}${browserName}${c.reset} avec l'extension activée...`);
  
  try {
    const child = spawn(browser, [`--load-extension=${EXT_DIR}`], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    console.log(`   ${c.green}✓${c.reset} Navigateur lancé ! L'extension est ${c.bold}${c.green}chargée automatiquement sans aucun clic${c.reset}.`);
    return true;
  } catch (err) {
    console.log(`   ${c.yellow}!${c.reset} Impossible de lancer automatiquement : ${err.message}`);
    return false;
  }
}

function setupExtension() {
  console.log(`\n${c.yellow}[3/3]${c.reset} Configuration de l'extension de navigation...`);
  const copied = copyToClipboard(EXT_DIR);

  console.log(`
${c.green}${c.bold}✨ INSTALLATION TERMINÉE !${c.reset}

${c.bold}Dernière étape (à faire 1 seule fois dans votre navigateur) :${c.reset}

${c.yellow}Note de sécurité Chromium :${c.reset} Pour protéger vos mots de passe et cookies,
Chromium exige une confirmation manuelle pour charger une extension locale.

1. Rendez-vous sur :
   ${c.cyan}brave://extensions/${c.reset}  ou  ${c.cyan}chrome://extensions/${c.reset}

2. Activez l'interrupteur ${c.bold}[Mode développeur]${c.reset} (en haut à droite).

3. Cliquez sur ${c.bold}[Charger l'extension non empaquetée]${c.reset} (en haut à gauche).

4. ${copied ? `${c.green}${c.bold}Le chemin du dossier est DÉJÀ dans votre presse-papier !${c.reset}\n   Faites simplement ${c.bold}Ctrl + V${c.reset} dans la fenêtre de sélection puis validez.` : `Sélectionnez le dossier : ${EXT_DIR}`}

${c.dim}Une fois chargée, l'extension reste active définitivement et le bridge est 100% autonome.${c.reset}
`);
}

const args = process.argv.slice(2);
const command = args[0];

if (command === 'launch' || command === 'browser' || command === 'open') {
  banner();
  launchBrowserAuto();
} else if (command === 'start') {
  banner();
  console.log(`Démarrage du serveur bridge...`);
  require('child_process').spawn('python', [path.join(ROOT_DIR, 'bridge', 'server.py')], { stdio: 'inherit' });
} else if (command === 'status') {
  banner();
  try {
    execSync('python bridge/cli.py status', { cwd: ROOT_DIR, stdio: 'inherit' });
  } catch (_) {}
} else if (command === 'stop') {
  banner();
  try {
    execSync('python bridge/cli.py stop-server', { cwd: ROOT_DIR, stdio: 'inherit' });
  } catch (_) {}
} else {
  // Mode installation par défaut
  banner();
  installSkill();
  installPythonDeps();
  setupExtension();
}
