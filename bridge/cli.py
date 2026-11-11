"""
Antigravity Browser CLI
Interface en ligne de commande pour piloter Chrome via le bridge local.
Gère également le démarrage et l'arrêt silencieux du serveur sans ouvrir de fenêtre CMD.
"""

import sys
import os
import json
import base64
import argparse
import urllib.request
import urllib.error
import subprocess
import time

HTTP_URL = "http://127.0.0.1:8766"


def check_status():
    req = urllib.request.Request(f"{HTTP_URL}/status")
    try:
        with urllib.request.urlopen(req, timeout=3) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as e:
        return {"status": "error", "connected": False, "error": str(e)}


def start_server_silently():
    """Démarre le serveur bridge en arrière-plan sans ouvrir AUCUNE fenêtre CMD."""
    st = check_status()
    if st.get("status") == "ok":
        return {
            "status": "already_running",
            "connected": st.get("connected", False),
            "ws_port": st.get("ws_port"),
            "http_port": st.get("http_port")
        }

    server_script = os.path.abspath(os.path.join(os.path.dirname(__file__), "server.py"))
    exe = sys.executable

    creationflags = 0
    if sys.platform == "win32":
        # 0x08000000 = CREATE_NO_WINDOW (garantit aucune fenêtre de console CMD)
        creationflags = 0x08000000

    try:
        proc = subprocess.Popen(
            [exe, server_script],
            creationflags=creationflags,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            close_fds=True
        )
    except Exception as e:
        return {"status": "error", "error": f"Échec du lancement du serveur : {e}"}

    # Attente active du démarrage (max 6 secondes)
    start_time = time.time()
    while time.time() - start_time < 6:
        st = check_status()
        if st.get("status") == "ok":
            return {
                "status": "started",
                "pid": proc.pid,
                "connected": st.get("connected", False),
                "ws_port": st.get("ws_port"),
                "http_port": st.get("http_port")
            }
        time.sleep(0.3)

    return {"status": "started", "pid": proc.pid, "connected": False, "note": "Serveur lancé."}


def stop_server_cleanly():
    """Arrête proprement le serveur bridge."""
    # 1. Envoi de la commande /shutdown par HTTP
    try:
        req = urllib.request.Request(
            f"{HTTP_URL}/shutdown",
            data=b"{}",
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return {"status": "stopped", "detail": data}
    except Exception:
        pass

    # 2. Si le port est encore occupé sous Windows, nettoyer le process
    if sys.platform == "win32":
        try:
            out = subprocess.check_output('netstat -ano | findstr :8766', shell=True, text=True, stderr=subprocess.DEVNULL)
            for line in out.strip().splitlines():
                parts = line.strip().split()
                if len(parts) >= 5 and "LISTENING" in parts:
                    pid = parts[-1]
                    subprocess.run(f"taskkill /F /PID {pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    return {"status": "stopped"}


def call_bridge(action, params=None, timeout=35, auto_start=True):
    endpoint = f"{HTTP_URL}/action"
    payload = json.dumps({
        "action": action,
        "params": params or {},
        "timeout": timeout
    }).encode("utf-8")

    req = urllib.request.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json; charset=utf-8"}
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout + 5) as response:
            res_data = response.read().decode("utf-8")
            return json.loads(res_data)
    except urllib.error.URLError as e:
        # Si le serveur n'est pas lancé et que auto_start est activé, on le démarre silencieusement
        if auto_start:
            start_res = start_server_silently()
            if start_res.get("status") in ("started", "already_running"):
                # Laisser un court instant pour que l'extension reconnecte
                time.sleep(1.5)
                return call_bridge(action, params, timeout, auto_start=False)

        return {
            "status": "error",
            "error": f"Impossible de contacter le serveur bridge sur {HTTP_URL}. Détail: {e}"
        }


def main():
    parser = argparse.ArgumentParser(description="Antigravity Browser Controller CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Démarrage et arrêt du serveur
    subparsers.add_parser("start-server", aliases=["start"], help="Démarrer le serveur bridge silencieusement (sans fenêtre CMD)")
    subparsers.add_parser("stop-server", aliases=["stop"], help="Arrêter le serveur bridge")

    # Status
    subparsers.add_parser("status", help="Vérifier la connexion avec le bridge et l'extension Chrome")

    # Navigate
    nav_parser = subparsers.add_parser("navigate", help="Ouvrir ou naviguer vers une URL")
    nav_parser.add_argument("url", help="URL cible (ex: https://create.roblox.com)")
    nav_parser.add_argument("--project", "-p", help="Nom du projet pour ranger l'onglet dans un groupe [Projet]-antigravity")
    nav_parser.add_argument("--new-tab", "-n", action="store_true", help="Ouvrir dans un nouvel onglet")
    nav_parser.add_argument("--timeout", "-t", type=int, default=20, help="Délai d'attente max en secondes")

    # Screenshot
    snap_parser = subparsers.add_parser("screenshot", help="Prendre une capture d'écran de l'onglet actif")
    snap_parser.add_argument("--output", "-o", default="screenshot.png", help="Fichier de sortie (défaut: screenshot.png)")

    # Click
    click_parser = subparsers.add_parser("click", help="Cliquer sur un élément ou à des coordonnées")
    click_parser.add_argument("--x", type=int, help="Coordonnée X en pixels")
    click_parser.add_argument("--y", type=int, help="Coordonnée Y en pixels")
    click_parser.add_argument("--selector", "-s", help="Sélecteur CSS (ex: button.primary)")
    click_parser.add_argument("--text", help="Texte visible sur le bouton ou l'élément")

    # Type
    type_parser = subparsers.add_parser("type", help="Écrire du texte dans le champ ciblé ou actif")
    type_parser.add_argument("text", help="Texte à saisir")
    type_parser.add_argument("--selector", "-s", help="Sélecteur CSS du champ cible")
    type_parser.add_argument("--press-enter", "-e", action="store_true", help="Appuyer sur Entrée après la saisie")
    type_parser.add_argument("--clear", "-c", action="store_true", help="Vider le champ avant d'écrire")

    # Press key
    press_parser = subparsers.add_parser("press", help="Appuyer sur une touche spécifique")
    press_parser.add_argument("key", help="Touche (Enter, Escape, Tab, Backspace, ArrowDown, ArrowUp)")

    # Scroll
    scroll_parser = subparsers.add_parser("scroll", help="Faire défiler la page")
    scroll_parser.add_argument("--delta-y", "-y", type=int, default=500, help="Défilement vertical en px")
    scroll_parser.add_argument("--delta-x", "-x", type=int, default=0, help="Défilement horizontal en px")

    # Eval
    eval_parser = subparsers.add_parser("eval", help="Exécuter du JavaScript dans la page")
    eval_parser.add_argument("script", help="Expression ou code JavaScript")

    # Page-Info
    subparsers.add_parser("page-info", help="Inspecter l'état de la page, le titre, détection d'écran blanc et boutons")

    # Reload
    subparsers.add_parser("reload", help="Recharger la page active")

    # Wait
    wait_parser = subparsers.add_parser("wait", help="Attendre qu'un sélecteur ou texte apparaisse")
    wait_parser.add_argument("--selector", "-s", help="Sélecteur CSS à attendre")
    wait_parser.add_argument("--text", "-t", help="Texte à attendre dans la page")
    wait_parser.add_argument("--timeout", type=int, default=10, help="Timeout en secondes")

    # List-Tabs
    subparsers.add_parser("list-tabs", help="Lister les onglets et groupes ouverts")

    # Group-Tabs
    grp_parser = subparsers.add_parser("group-tabs", help="Ranger des onglets dans un groupe de projet")
    grp_parser.add_argument("--tabs", nargs="+", type=int, required=True, help="IDs des onglets à regrouper")
    grp_parser.add_argument("--project", "-p", default="Antigravity Cloud Web", help="Nom du projet")

    args = parser.parse_args()

    if args.command in ("start-server", "start"):
        res = start_server_silently()
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return

    if args.command in ("stop-server", "stop"):
        res = stop_server_cleanly()
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return

    if args.command == "status":
        res = check_status()
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return

    if args.command == "navigate":
        params = {"url": args.url}
        if args.project:
            params["project"] = args.project
        if args.new_tab:
            params["new_tab"] = True
        params["timeout_ms"] = args.timeout * 1000
        res = call_bridge("navigate", params)
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "screenshot":
        res = call_bridge("screenshot", {})
        if res.get("status") == "success":
            base64_data = res.get("result", {}).get("image_base64")
            if base64_data:
                out_path = os.path.abspath(args.output)
                with open(out_path, "wb") as f:
                    f.write(base64.b64decode(base64_data))
                print(json.dumps({
                    "status": "success",
                    "saved_to": out_path,
                    "tab_id": res.get("result", {}).get("tab_id")
                }, indent=2, ensure_ascii=False))
            else:
                print(json.dumps({"status": "error", "error": "Aucune donnée image reçue"}, indent=2))
        else:
            print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "click":
        params = {}
        if args.x is not None and args.y is not None:
            params["x"] = args.x
            params["y"] = args.y
        params["selector"] = args.selector if args.selector else ""
        if args.text:
            params["text"] = args.text
        res = call_bridge("click", params)
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "type":
        params = {"text": args.text}
        if args.selector:
            params["selector"] = args.selector
        if args.press_enter:
            params["press_enter"] = True
        if args.clear:
            params["clear"] = True
        res = call_bridge("type", params)
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "press":
        res = call_bridge("press_key", {"key": args.key})
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "scroll":
        res = call_bridge("scroll", {"deltaY": args.delta_y, "deltaX": args.delta_x})
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "eval":
        res = call_bridge("eval", {"script": args.script})
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "page-info":
        res = call_bridge("get_page_info", {})
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "reload":
        res = call_bridge("reload", {})
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "wait":
        params = {"timeout_ms": args.timeout * 1000}
        if args.selector:
            params["selector"] = args.selector
        if args.text:
            params["text"] = args.text
        res = call_bridge("wait_for", params)
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "list-tabs":
        res = call_bridge("list_tabs", {})
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "group-tabs":
        res = call_bridge("group_tabs", {"tab_ids": args.tabs, "project": args.project})
        print(json.dumps(res, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
