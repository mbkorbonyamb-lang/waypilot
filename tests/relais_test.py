# Lancer avec : python3 -m unittest discover -s tests -p "relais_test.py"
import json
import os
import socket
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "relais"))
import app  # noqa: E402

PUBLIC = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
PRIVATE = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", 443))]


_real = socket.getaddrinfo


def resolver(host, *a, **k):
    if host == "127.0.0.1":  # le serveur de test lui-même
        return _real(host, *a, **k)
    return PRIVATE if host == "interne.example" else PUBLIC


# Pas de proxy pour joindre le serveur de test local.
direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class RelaisTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def get(self, path):
        try:
            with direct.open(self.base + path) as r:
                return r.status, json.loads(r.read()), r.headers
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read()), e.headers

    def test_adresses_refusees(self):
        with mock.patch("socket.getaddrinfo", resolver):
            for bad in ("localhost", "127.0.0.1", "interne.example", "a b.com", "exemple.com:8080"):
                with self.assertRaises(ValueError, msg=bad):
                    app.clean_host(bad)
            self.assertEqual(app.clean_host("https://www.JAARAY.site/boutique"), "www.jaaray.site")

    def test_relais_filtre_les_parametres_et_expose_la_pagination(self):
        seen = []

        def fake_fetch(url):
            seen.append(url)
            return 200, b'[{"id":1}]', "3"

        with mock.patch("socket.getaddrinfo", resolver), mock.patch.object(app, "fetch", fake_fetch):
            status, body, headers = self.get("/products?site=jaaray.site&page=2&include=1,2&type=variation&consumer_key=x&search=y")
        self.assertEqual(status, 200)
        self.assertEqual(body, [{"id": 1}])
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertEqual(headers["X-WP-TotalPages"], "3")
        self.assertTrue(seen[0].startswith("https://jaaray.site/wp-json/wc/store/v1/products?"))
        self.assertIn("include=1%2C2", seen[0])
        self.assertNotIn("consumer_key", seen[0])
        self.assertNotIn("search", seen[0])

    def test_repli_rest_route_puis_erreur_claire(self):
        calls = []

        def fake_fetch(url):
            calls.append(url)
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)

        with mock.patch("socket.getaddrinfo", resolver), mock.patch.object(app, "fetch", fake_fetch):
            status, body, _ = self.get("/products?site=shop.example")
        self.assertEqual(status, 404)
        self.assertEqual(len(calls), 2)
        self.assertIn("rest_route", calls[1])

    def test_adresse_privee_et_chemin_inconnu(self):
        with mock.patch("socket.getaddrinfo", resolver):
            self.assertEqual(self.get("/products?site=interne.example")[0], 400)
            self.assertEqual(self.get("/autre")[0], 404)


if __name__ == "__main__":
    unittest.main()
