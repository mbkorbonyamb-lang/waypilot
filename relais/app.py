"""
Relais WayPilot pour l'audit express.

WooCommerce n'autorise la lecture de son API publique (Store API) que depuis le site de la
boutique : un navigateur sur la page WayPilot est bloqué (CORS). Ce relais lit le catalogue
public à sa place et le renvoie tel quel. Il ne reçoit aucune clé et ne conserve rien.

Garde-fous : GET uniquement, seul le chemin /wc/store/v1/products, paramètres filtrés,
HTTPS, adresses privées refusées (y compris après redirection), taille et débit limités.
"""
import ipaddress
import json
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "7860"))
TIMEOUT = 20
MAX_BYTES = 8 * 1024 * 1024
RATE_PER_MINUTE = 120
USER_AGENT = "WayPilot-audit/1.0 (+https://waypilot-waypilot.static.hf.space)"
HOST_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$")
ALLOWED = {
    "page": re.compile(r"^\d{1,4}$"),
    "per_page": re.compile(r"^(100|[1-9]\d?)$"),
    "include": re.compile(r"^\d{1,12}(,\d{1,12}){0,99}$"),
    "type": re.compile(r"^(simple|variable|variation|grouped|external)$"),
}

_hits = {}


def too_many(ip):
    now = time.time()
    recent = [t for t in _hits.get(ip, []) if now - t < 60]
    recent.append(now)
    _hits[ip] = recent
    if len(_hits) > 10000:
        _hits.clear()
    return len(recent) > RATE_PER_MINUTE


def clean_host(raw):
    """Nom d'hôte public, sans schéma, chemin ni port. Lève ValueError sinon."""
    s = (raw or "").strip().lower()
    s = re.sub(r"^https?://", "", s).split("/")[0]
    if not HOST_RE.match(s):
        raise ValueError("Adresse de boutique invalide.")
    check_public(s)
    return s


def check_public(host):
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise ValueError("Adresse de boutique introuvable.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise ValueError("Adresse non autorisée.")


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Suit les redirections (www, https) seulement vers une autre adresse publique en HTTPS."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urllib.parse.urlsplit(newurl)
        if u.scheme != "https" or not u.hostname:
            raise urllib.error.HTTPError(newurl, 400, "Redirection refusée", headers, fp)
        clean_host(u.hostname)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


opener = urllib.request.build_opener(SafeRedirect)


def store_urls(host, query):
    params = urllib.parse.urlencode(query)
    yield f"https://{host}/wp-json/wc/store/v1/products?{params}"
    # Permaliens « simples » : /wp-json/ n'existe pas, rest_route fonctionne.
    yield f"https://{host}/?rest_route=%2Fwc%2Fstore%2Fv1%2Fproducts&{params}"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with opener.open(req, timeout=TIMEOUT) as res:
        body = res.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError("Réponse trop volumineuse.")
        return res.status, body, res.headers.get("X-WP-TotalPages")


class Handler(BaseHTTPRequestHandler):
    server_version = "WayPilotRelais"

    def log_message(self, *args):
        pass  # aucun journal : ni adresses de boutiques, ni contenus

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Expose-Headers", "X-WP-TotalPages")

    def reply(self, status, body, total=None, ctype="application/json; charset=utf-8"):
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        if total:
            self.send_header("X-WP-TotalPages", total)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def error(self, status, message):
        self.reply(status, json.dumps({"message": message}, ensure_ascii=False).encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET")
        self.end_headers()

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        if u.path in ("/", "/sante"):
            return self.reply(200, b'{"ok":true}')
        if u.path != "/products":
            return self.error(404, "Chemin inconnu.")
        ip = (self.headers.get("X-Forwarded-For") or self.client_address[0]).split(",")[0].strip()
        if too_many(ip):
            return self.error(429, "Trop de requêtes, réessayez dans une minute.")
        q = urllib.parse.parse_qs(u.query)
        try:
            host = clean_host((q.get("site") or [""])[0])
        except ValueError as e:
            return self.error(400, str(e))
        query = {k: v[0] for k, v in q.items() if k in ALLOWED and ALLOWED[k].match(v[0])}
        query.setdefault("per_page", "100")
        last = None
        for url in store_urls(host, query):
            try:
                status, body, total = fetch(url)
                try:
                    json.loads(body)
                except ValueError:
                    last = (502, "Réponse inattendue de la boutique (pas du JSON).")
                    continue
                return self.reply(status, body, total)
            except urllib.error.HTTPError as e:
                last = (e.code if e.code in (401, 403, 404, 429) else 502, f"La boutique a répondu {e.code}.")
                if e.code != 404:
                    break
            except (urllib.error.URLError, socket.timeout, TimeoutError, ValueError) as e:
                last = (502, str(e) if isinstance(e, ValueError) else "La boutique n'a pas répondu.")
                break
        self.error(*last)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
