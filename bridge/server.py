"""
Antigravity Browser Bridge Server
Fournit un serveur WebSocket (8765) pour l'extension Chrome
et un serveur HTTP REST (8766) pour le CLI et l'agent Antigravity.
"""

import asyncio
import json
import uuid
import sys
import os
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
import websockets

WS_HOST = "127.0.0.1"
WS_PORT = 8765
HTTP_PORT = 8766

# Variables partagées
active_websocket = None
pending_requests = {}  # req_id -> asyncio.Future
loop = None

async def ws_handler(websocket):
    global active_websocket
    active_websocket = websocket
    client_addr = websocket.remote_address
    print(f"[WebSocket] Extension Chrome connectée depuis {client_addr}")

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "ping":
                    await websocket.send(json.dumps({"type": "pong"}))
                    continue

                # Gestion des réponses aux commandes
                req_id = data.get("id")
                if req_id and req_id in pending_requests:
                    fut = pending_requests.pop(req_id)
                    if not fut.done():
                        fut.set_result(data)
                elif msg_type == "handshake":
                    print(f"[WebSocket] Handshake reçu : {data.get('client')} v{data.get('version')}")
            except Exception as e:
                print(f"[WebSocket] Erreur traitement message : {e}")
    except websockets.exceptions.ConnectionClosed:
        print("[WebSocket] Extension Chrome déconnectée.")
    finally:
        if active_websocket == websocket:
            active_websocket = None


async def send_command_to_extension(action, params=None, timeout=30):
    global active_websocket, loop
    if not active_websocket:
        return {
            "status": "error",
            "error": "L'extension Chrome n'est pas connectée. Veuillez ouvrir Chrome et vérifier que l'extension est active."
        }

    req_id = str(uuid.uuid4())
    fut = loop.create_future()
    pending_requests[req_id] = fut

    payload = {
        "id": req_id,
        "action": action,
        "params": params or {}
    }

    try:
        await active_websocket.send(json.dumps(payload))
        resp = await asyncio.wait_for(fut, timeout=timeout)
        return resp
    except asyncio.TimeoutError:
        pending_requests.pop(req_id, None)
        return {
            "status": "error",
            "error": f"Délai d'attente dépassé ({timeout}s) pour l'action '{action}'"
        }
    except Exception as e:
        pending_requests.pop(req_id, None)
        return {
            "status": "error",
            "error": str(e)
        }


class BridgeHTTPHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self._send_json(200, {"status": "ok"})

    def do_GET(self):
        if self.path == "/" or self.path == "/status":
            self._send_json(200, {
                "status": "ok",
                "connected": active_websocket is not None,
                "ws_port": WS_PORT,
                "http_port": HTTP_PORT
            })
        elif self.path == "/shutdown":
            self._send_json(200, {"status": "shutting_down"})
            def delayed_exit():
                import time
                time.sleep(0.5)
                os._exit(0)
            threading.Thread(target=delayed_exit, daemon=True).start()
        else:
            self._send_json(404, {"error": "Route introuvable"})

    def do_POST(self):
        if self.path == "/shutdown":
            self._send_json(200, {"status": "shutting_down"})
            def delayed_exit():
                import time
                time.sleep(0.5)
                os._exit(0)
            threading.Thread(target=delayed_exit, daemon=True).start()
            return

        if self.path == "/action":
            content_length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_length)
            try:
                body = json.loads(raw_body.decode("utf-8"))
            except Exception as e:
                self._send_json(400, {"error": f"JSON invalide : {e}"})
                return

            action = body.get("action")
            params = body.get("params", {})
            timeout = body.get("timeout", 30)

            if not action:
                self._send_json(400, {"error": "Paramètre 'action' requis"})
                return

            # Exécuter l'appel asynchrone sur la boucle de l'event loop
            coro = send_command_to_extension(action, params, timeout=timeout)
            future = asyncio.run_coroutine_threadsafe(coro, loop)
            try:
                result = future.result(timeout=timeout + 5)
                self._send_json(200, result)
            except Exception as e:
                self._send_json(500, {"status": "error", "error": str(e)})
        else:
            self._send_json(404, {"error": "Route introuvable"})

    def log_message(self, format, *args):
        # Réduire le bruit de log HTTP en mode normal
        pass


def run_http_server():
    server = HTTPServer(("127.0.0.1", HTTP_PORT), BridgeHTTPHandler)
    print(f"[HTTP] API REST active sur http://127.0.0.1:{HTTP_PORT}")
    server.serve_forever()


async def main():
    global loop
    loop = asyncio.get_running_loop()

    # Démarrer le serveur HTTP dans un thread séparé
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()

    print(f"==================================================")
    print(f" Antigravity Browser Bridge Server démarré")
    print(f" - WebSocket Extension : ws://{WS_HOST}:{WS_PORT}")
    print(f" - API HTTP / CLI      : http://127.0.0.1:{HTTP_PORT}")
    print(f"==================================================")

    async with websockets.serve(ws_handler, WS_HOST, WS_PORT):
        await asyncio.Future()  # Tourne indéfiniment


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nArrêt du serveur.")
