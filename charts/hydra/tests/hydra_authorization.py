#!/usr/bin/env python3
"""Exercise a generated broker client through a real Hydra v2 auth-code flow."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import sys
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import (
    HTTPCookieProcessor,
    HTTPRedirectHandler,
    Request,
    build_opener,
)

PUBLIC_URL = os.environ.get("HYDRA_PUBLIC_URL", "http://127.0.0.1:4444")
ADMIN_URL = os.environ.get("HYDRA_ADMIN_URL", "http://127.0.0.1:4445")
CLIENT_SECRET = os.environ.get("BROKER_CLIENT_SECRET", "deployment-contract-secret")
REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = REPO_ROOT / "charts/hydra/contracts/product-resource-servers.json"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


OPENER = build_opener(HTTPCookieProcessor(CookieJar()), NoRedirect())


def request(url: str, method: str = "GET", body: dict | None = None, headers: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = Request(url, data=data, method=method, headers=headers or {})
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        return OPENER.open(req, timeout=10)
    except HTTPError as error:
        if error.code in {301, 302, 303, 307, 308}:
            return error
        detail = error.read().decode(errors="replace")
        raise AssertionError(f"{method} {url} failed: {error.code} {detail}") from error


def json_request(url: str, method: str = "GET", body: dict | None = None) -> dict:
    with request(url, method, body) as response:
        return json.loads(response.read())


def challenge_from(location: str, name: str) -> str:
    values = parse_qs(urlparse(location).query).get(name)
    assert values and len(values) == 1, f"missing {name} in {location}"
    return values[0]


def as_set(value) -> set[str]:
    if isinstance(value, list):
        return set(value)
    if isinstance(value, str):
        return set(value.replace(",", " ").split())
    raise AssertionError(f"unexpected Hydra collection: {value!r}")


def main() -> int:
    contract = json.loads(CONTRACT_PATH.read_text())["environments"]["production"]
    products = contract["products"]
    assert products, "product verifier contract is empty"
    canvas = next(product for product in products if product["connector"] == "canvas")
    client_id = "solomon-connector-broker"
    redirect_uri = f"{contract['issuer']}/v1/connections/canvas/callback"
    requested_scopes = ["openid", "offline_access", *canvas["scopes"]]

    client = json_request(f"{ADMIN_URL}/admin/clients/{client_id}")
    assert client["client_id"] == client_id
    assert client["token_endpoint_auth_method"] == "client_secret_basic"
    assert set(client["redirect_uris"]) >= {redirect_uri}
    assert as_set(client["scope"]) >= set(requested_scopes)
    assert as_set(client["audience"]) >= {canvas["audience"]}

    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(24)
    auth_query = urlencode(
        {
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": " ".join(requested_scopes),
            "audience": canvas["audience"],
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    with request(f"{PUBLIC_URL}/oauth2/auth?{auth_query}") as response:
        login_location = response.headers["Location"]
    login_challenge = challenge_from(login_location, "login_challenge")
    login = json_request(
        f"{ADMIN_URL}/admin/oauth2/auth/requests/login/accept?login_challenge={login_challenge}",
        "PUT",
        {"subject": "deployment-contract-user", "remember": False},
    )

    with request(login["redirect_to"]) as response:
        consent_location = response.headers["Location"]
    consent_challenge = challenge_from(consent_location, "consent_challenge")
    consent_request = json_request(
        f"{ADMIN_URL}/admin/oauth2/auth/requests/consent?consent_challenge={consent_challenge}"
    )
    assert set(consent_request["requested_scope"]) == set(requested_scopes)
    assert set(consent_request["requested_access_token_audience"]) == {canvas["audience"]}
    consent = json_request(
        f"{ADMIN_URL}/admin/oauth2/auth/requests/consent/accept?consent_challenge={consent_challenge}",
        "PUT",
        {
            "grant_scope": requested_scopes,
            "grant_access_token_audience": [canvas["audience"]],
            "remember": False,
            "session": {
                "access_token": {"environment": "deployment-contract"},
                "id_token": {"email": "deployment-contract@example.invalid"},
            },
        },
    )
    with request(consent["redirect_to"]) as response:
        callback_location = response.headers["Location"]
    callback = urlparse(callback_location)
    assert f"{callback.scheme}://{callback.netloc}{callback.path}" == redirect_uri
    callback_query = parse_qs(callback.query)
    assert callback_query["state"] == [state]
    code = callback_query["code"][0]

    token_body = urlencode(
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": verifier,
        }
    ).encode()
    token_request = Request(
        f"{PUBLIC_URL}/oauth2/token",
        data=token_body,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic "
            + base64.b64encode(f"{client_id}:{CLIENT_SECRET}".encode()).decode(),
        },
    )
    try:
        with build_opener().open(token_request, timeout=10) as response:
            token = json.loads(response.read())
    except HTTPError as error:
        raise AssertionError(
            f"token exchange failed: {error.code} {error.read().decode(errors='replace')}"
        ) from error
    assert token["access_token"]
    assert token["token_type"].lower() == "bearer"
    assert set(token["scope"].split()) == set(requested_scopes)
    print("real Hydra v2 broker authorization-code flow passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Hydra authorization fixture failed: {error}", file=sys.stderr)
        raise
