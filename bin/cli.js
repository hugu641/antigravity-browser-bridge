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

function setupExtension() {
  console.log(`\n${c.yellow}[3/3]${c.reset} Configuration de l'extension de navigation...`);
  const copied = copyToClipboard(EXT_DIR);

  console.log(`
${c.green}${c.bold}✨ INSTALLATION TERMINÉE AVEC SUCCÈS !${c.reset}

Pour activer l'extension dans votre navigateur :

1. Ouvrez ${c.bold}Brave${c.reset} ou ${c.bold}Chrome${c.reset} et allez sur :
   ${c.cyan}brave://extensions/${c.reset}   ou   ${c.cyan}chrome://extensions/${c.reset}

2. Activez le ${c.bold}[Mode développeur]${c.reset} (en haut à droite).

3. Cliquez sur ${c.bold}[Charger l'extension non empaquetée]${c.reset} (en haut à gauche).

4. ${copied ? `${c.green}${c.bold}LE CHEMIN DU DOSSIER A ÉTÉ COPIÉ DANS VOTRE PRESSE-PAPIER !${c.reset}\n   Faites simplement ${c.bold}Ctrl+V${c.reset} dans la barre de sélection.` : `Sélectionnez le dossier : ${c.bold}${EXT_DIR}${c.reset}`}
`);

  // Ouvrir automatiquement l'URL des extensions si possible
  try {
    if (process.platform === 'win32') {
      execSync('start brave://extensions/ || start chrome://extensions/', { stdio: 'ignore' });
    }
  } catch (_) {}
}

const args = process.argv.slice(2);
const command = args[0];

if (command === 'start') {
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
