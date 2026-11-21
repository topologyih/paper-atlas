#!/usr/bin/env python3
"""Serve the built site for the desktop app. Binds to localhost only."""

from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
from pathlib import Path


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".css": "text/css",
        ".wasm": "application/wasm",
    }

    def log_message(self, fmt: str, *args) -> None:
        return


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--port", type=int, default=47321)
    args = parser.parse_args()
    root = str(Path(args.root).resolve())
    handler = functools.partial(Handler, directory=root)
    with Server(("127.0.0.1", args.port), handler) as httpd:
        httpd.serve_forever()


if __name__ == "__main__":
    main()
