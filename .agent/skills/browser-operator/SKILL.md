---
name: browser-operator
description: Piloter directement la session Google Chrome active de l'utilisateur via l'extension Antigravity Browser Bridge. Permet d'ouvrir des onglets, ranger dans des groupes d'onglets ([Projet]-antigravity), inspecter le DOM, analyser visuellement la page, détecter et recharger les écrans blancs, cliquer avec précision, taper du texte, et extraire des données (Roblox Creator Hub, ChatGPT, formulaires, etc.).
---

# Browser Operator Skill (Antigravity Bridge)

Ce skill permet à l'agent d'agir en tant qu'opérateur humain direct dans le navigateur Google Chrome / Brave de l'utilisateur, en utilisant sa session active (comptes déjà connectés, cookies, état de session), avec un cycle de vie 100% autonome et silencieux.

---

## 1. Cycle de Vie Autonome (Zéro CMD visible pour l'utilisateur)

L'agent gère le démarrage et l'arrêt du bridge sans jamais déranger l'utilisateur avec une fenêtre d'invite de commandes :

1. **Vérifier si le bridge tourne :**
   ```powershell
   python bridge/cli.py status
   ```
2. **Si non démarré, lancer en arrière-plan :**
   Exécuter `python bridge/server.py` en tâche daemon d'arrière-plan (`IsDaemon: true`). Aucune fenêtre CMD ne s'affiche sur le bureau de l'utilisateur.
   Attendre 1 à 2 secondes que l'extension active se reconnecte (`"connected": true`).
3. **Exécuter les actions demandées** (navigation, clics, frappes, extraction).
4. **Arrêter systématiquement le bridge une fois fini :**
   Dès que la tâche sur le navigateur est terminée, éteindre immédiatement le bridge :
   ```powershell
   python bridge/cli.py stop-server
   ```
   Le serveur se coupe proprement et libère les ports.

---

## 2. Commandes CLI Disponibles

Toutes les commandes se lancent via `python bridge/cli.py <commande>` :

| Commande | Exemple | Description |
| :--- | :--- | :--- |
| **status** | `python bridge/cli.py status` | Vérifie si le bridge tourne et si l'extension est connectée. |
| **start-server** | `python bridge/cli.py start-server` | Démarre le serveur silencieusement sans fenêtre CMD. |
| **stop-server** | `python bridge/cli.py stop-server` | Éteint proprement le serveur local bridge. |
| **navigate** | `python bridge/cli.py navigate "https://..." --project "MonProjet"` | Ouvre l'URL et classe l'onglet dans le groupe `[MonProjet]-antigravity`. |
| **page-info** | `python bridge/cli.py page-info` | Récupère le titre, l'URL, l'indicateur d'écran blanc (`is_blank`) et la liste des boutons/liens avec coordonnées `(x, y)`. |
| **screenshot** | `python bridge/cli.py screenshot -o screen.png` | Prend une capture d'écran de l'onglet actif. |
| **click** | `python bridge/cli.py click --selector "button.submit"`<br>`python bridge/cli.py click --text "Créer"`<br>`python bridge/cli.py click --x 450 --y 230` | Effectue un clic souris natif. |
| **type** | `python bridge/cli.py type "Mon Pass" --selector "#name" --press-enter` | Saisit du texte dans un champ. |
| **press** | `python bridge/cli.py press Enter` | Envoie une touche unitaire (`Enter`, `Escape`, `Tab`, `Backspace`, etc.). |
| **scroll** | `python bridge/cli.py scroll -y 500` | Fait défiler la page de `y` pixels vers le bas (ou négatif vers le haut). |
| **eval** | `python bridge/cli.py eval "document.title"` | Évalue une expression JavaScript et renvoie le résultat. |
| **wait** | `python bridge/cli.py wait --text "Succès" --timeout 15` | Attend qu'un élément ou texte apparaisse. |
| **reload** | `python bridge/cli.py reload` | Recharge l'onglet courant (crucial en cas d'écran blanc). |
| **list-tabs** | `python bridge/cli.py list-tabs` | Liste tous les onglets et groupes d'onglets ouverts. |

---

## 3. Protocole d'Exécution et Boucle Autonome

Lorsqu'une tâche web est demandée, suivre scrupuleusement ces étapes :

### Étape 1 : Démarrage du bridge
Vérifier `cli.py status`. Si nécessaire, démarrer le bridge en tâche de fond sans afficher de CMD.

### Étape 2 : Détection du Projet et Regroupement des Onglets
**RÈGLE CRUCIALE DE RANGEMENT :**
1. **Nom du groupe de projet :** Le nom du groupe DOIT être le nom du projet/workspace en cours (ex: `Antigravity Cloud Web`). S'il n'y a pas de projet explicite, déduire le nom depuis le titre ou contexte de la conversation.
2. **Tous les onglets dans LE MÊME groupe :** Tous les onglets ouverts pour cette session (YouTube, Roblox, ChatGPT, doc, etc.) doivent être regroupés ensemble sous **`[NomDuProjet]-antigravity`** (ex: `Antigravity Cloud Web-antigravity`). Ne JAMAIS créer de groupes isolés par site web (`YouTube-antigravity`, `Roblox-antigravity`, etc.).
3. Commande de navigation :
```powershell
python bridge/cli.py navigate "https://target-url.com" --project "NomDuProjet" --new-tab
```
L'extension réutilise automatiquement le groupe d'onglets existant pour ce projet et y ajoute le nouvel onglet.

### Étape 3 : Inspection & Détection d'Écran Blanc
Interroger l'état de la page :
```powershell
python bridge/cli.py page-info
```
- **Si `is_blank: true`** ou texte vide :
  1. Attendre 2 secondes.
  2. Si toujours blanc, lancer : `python bridge/cli.py reload`.
  3. Réinspecter.

### Étape 4 : Ciblage et Action
1. Consulter la liste `interactive_elements` renvoyée par `page-info` pour trouver le bouton ou champ cible avec son libellé ou ses coordonnées `(x, y)`.
2. Cliquer ou taper du texte :
   - Par texte ou sélecteur : `python bridge/cli.py click --text "Créer un pass"`
   - Ou par coordonnées : `python bridge/cli.py click --x 512 --y 340`
   - Pour remplir un champ : `python bridge/cli.py type "50" --selector "input[name='price']"`

### Étape 5 : Extraction du résultat et Coupure du bridge
1. Extraire l'ID, URL, ou le résultat demandé via `eval` ou `page-info`.
2. **Couper le bridge systématiquement :**
   ```powershell
   python bridge/cli.py stop-server
   ```
3. Retourner le résultat extrait clairement à l'utilisateur.
