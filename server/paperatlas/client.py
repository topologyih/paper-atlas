"""OpenAlex client with a disk cache, backoff, and a polite request interval."""

from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API_ROOT = "https://api.openalex.org"
USER_AGENT = "PaperAtlas/1.0 (literature visualization; respects OpenAlex rate limits)"

SELECT = ",".join(
    [
        "id",
        "doi",
        "display_name",
        "publication_year",
        "publication_date",
        "type",
        "cited_by_count",
        "is_retracted",
        "ids",
        "open_access",
        "primary_location",
        "locations",
        "topics",
        "authorships",
        "referenced_works",
        "related_works",
        "abstract_inverted_index",
    ]
)


class OpenAlexError(RuntimeError):
    def __init__(self, message: str, status: int | None = None, payload: str | None = None):
        super().__init__(message)
        self.status = status
        self.payload = payload or ""


class OpenAlexClient:
    def __init__(
        self,
        cache_dir: str | Path,
        *,
        refresh: bool = False,
        api_key: str | None = None,
        mailto: str | None = None,
        min_interval: float = 0.25,
    ):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.refresh = refresh
        self.api_key = api_key if api_key is not None else os.environ.get("OPENALEX_API_KEY", "")
        self.mailto = mailto if mailto is not None else os.environ.get("OPENALEX_MAILTO", "")
        self.min_interval = min_interval
        self.api_calls = 0
        self.cache_hits = 0
        self.last_headers: dict[str, str] = {}
        self._last_at = 0.0

    def get(self, path: str, params: dict | None = None) -> dict:
        url = self.build_url(path, params)
        key = hashlib.sha256(url.encode("utf-8")).hexdigest()
        cache_path = self.cache_dir / f"{key}.json"
        if cache_path.exists() and not self.refresh:
            self.cache_hits += 1
            return json.loads(cache_path.read_text(encoding="utf-8"))
        payload = self._fetch(url)
        cache_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return payload

    def build_url(self, path: str, params: dict | None) -> str:
        query = {key: "" if value is None else str(value) for key, value in (params or {}).items()}
        if self.api_key:
            query["api_key"] = self.api_key
        if self.mailto:
            query["mailto"] = self.mailto
        base = path if path.startswith("http") else API_ROOT + path
        if not query:
            return base
        return base + ("&" if "?" in base else "?") + urllib.parse.urlencode(sorted(query.items()))

    def _fetch(self, url: str) -> dict:
        delay = 1.0
        last = "unknown error"
        for _attempt in range(5):
            self._wait()
            request = urllib.request.Request(
                url,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    self.api_calls += 1
                    self.last_headers = {key.lower(): value for key, value in response.headers.items()}
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as error:
                self.api_calls += 1
                body = error.read().decode("utf-8", "replace")
                self.last_headers = {key.lower(): value for key, value in (error.headers or {}).items()}
                paused = "search temporarily unavailable" in body.lower() or "anonymous search is paused" in body.lower()
                if paused:
                    raise OpenAlexError("OpenAlex 标题检索暂不可用", status=error.code, payload=body) from error
                if error.code == 429 and "insufficient budget" in body.lower():
                    raise OpenAlexError(
                        "OpenAlex 今日额度已用完。匿名额度按 IP 共享，大约每天 0.10 美元。",
                        status=error.code,
                        payload=body,
                    ) from error
                if error.code in (429, 500, 502, 503, 504):
                    retry_after = self.last_headers.get("retry-after", "")
                    wait = float(retry_after) if retry_after.replace(".", "", 1).isdigit() else delay
                    time.sleep(min(max(wait, 0.5), 25))
                    delay = min(delay * 2, 25)
                    last = f"HTTP {error.code}: {body[:240]}"
                    continue
                raise OpenAlexError(f"OpenAlex HTTP {error.code}", status=error.code, payload=body) from error
            except urllib.error.URLError as error:
                time.sleep(delay)
                delay = min(delay * 2, 25)
                last = str(error.reason)
                continue
        raise OpenAlexError(f"OpenAlex 请求失败：{last}")

    def _wait(self) -> None:
        elapsed = time.monotonic() - self._last_at
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)
        self._last_at = time.monotonic()
