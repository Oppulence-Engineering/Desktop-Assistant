package main

// DEV-ONLY SIGNING KEY — NOT A SECRET, NOT FOR ANY REAL DEPLOYMENT.
//
// devstack is a local stand-in for the OIDC IdP. It used to generate a fresh RSA
// key at every start, which invalidated every token already issued: rebuilding
// any part of this binary silently signed the developer out of the desktop app
// and 401'd every API call, so each dogfooding iteration began with a
// re-authentication detour. Now that `kubectl apply` correctly rolls the
// devstack pod whenever the image changes, that happened on every single build.
//
// Deriving the key from a fixed seed does not work: crypto/rsa deliberately
// consumes a variable number of bytes from the entropy source
// (randutil.MaybeReadByte) specifically to stop callers depending on
// deterministic generation. A checked-in key is the remaining way to make it
// stable.
//
// Nothing this key signs is trusted anywhere but a local kind cluster, and
// devstack auto-approves every authorization request without a login, so it is
// already catastrophic to expose regardless of which key it holds. Never point a
// real deployment at this binary.
//
// Set DEVSTACK_EPHEMERAL_KEY=1 to generate a throwaway key per start instead,
// e.g. to exercise the key-rotation path deliberately.
const devSigningKeyPEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCog+WLosx8JO3V
Z98C+E5E2z5Zrr433ACXyVIzK7XTuEQjviGwyXv8y0xtMAJvffUuW/ordLh9kR5D
biWVH/sdGE4HskwT77YjgAvGTXCvcGzgEdGCHoihBfxxb49BGKj9FQXiG4jKS8wA
HHA+jWuObBDbuhFps1NJ+W4A5w0sV9OPsjpFIUms5IZI4I/PLybMzdLSdGy8OpyR
//4gFXzTmffo5GnMOEbMvUY0i4MMXMVhCg862F2ghgwQBGFZvIxgfoUkiJuxvNRt
OwC1TXMoGaBO0s+1xSTbNLnIr2SRqqsOWOmsMYye4HfcBZBtTkVQUPvlCGg1Tfxb
/UpvqzpXAgMBAAECggEAASs92cfpg5u9K2bK2dPStZDDw1sX8xek+870sZz5aBxc
gXCQytyK7jtgYb2C6gN4qOqqA8hafNx91j/njAiqjqgb50FdKVVw8P9MlZwoTowI
5U3NiaNTYhj1iFMax+I3Tqu2D7x0wkDf8fxAg96Qdjty3nzq7ZqSo4e5M9GZrZen
fGVVswr3qv3jc278CngtC8JyNd+mI3G4ayRmKwRZiHf6pL2g7cA0IyhWUW6zDveQ
B6+Nx+Y6+U+P6O8EVDzvXSM6XCh6BWCRnKNpnyzN6vbiC8TsTHlzfPnjjVYRD9be
V9QJ0OCjo+yCbu2O7jAgo2KfHTyMVcTO4Xr/2bMY6QKBgQDUO6ML1HqkQ5cQ68j8
McqvN18xL3RAt3fde96LPgVeMt0CgngKLg1NhtTcKC7cyqFwQtvYiEhTCXPzTyoh
aaYWwVuGuOeyfh8C1oT9W2De2qDkz6eezvsPO2rjP33rkWOCOE5NzMszFRA1Lw6r
wZOwN6DZzNxMBFS2ltLKqqnWOwKBgQDLREeqkSmRf9o3sDDDVop4S7j7VSRuTZjQ
ZUwSdzoLeJR2Zw73kAPXu3KtTazmpESgNmeAxpqWR7R+EC7MA6YOo98jQdLQ9OOn
PLVqhivvjDQ/6oTqgur+EeRYfiUyjMMr0o97tXjBEBewk/dPlWVsCXMlcMYy/RW9
N4yivZn+lQKBgDvy3Itq6Xmc3f8ZmxwhtG7p5Smvjdb5/BHD+4i5bCq/k04yLFYz
y+4qN9Y4Q4R6eD+Noyv20vchpG8F3ZCylwe2dnQHpur0VS4oCkjGlwZcGzaGsYJa
VPBoiDjIpnj0CHewD+5J+tvjB0D+mdZKR71u+TCMfW27i3JICCLXMkIhAoGBAIsS
5JXnTDGo8H05p6N/Cq7T4HTWBF8T6IJtTGc1/BjtH2cDjFIFzxtDvWqlwq7rpaiY
kKijOhGobe3y1JHxzSQnKvzMhJlDdJ9wAhAoTNdRbk5s/xQVDwNW6o1BgeHcPY02
O8XAnCY8BHlkQ8nHxeTtckMjrfglAUK9RxPx9fMhAoGASrnl02UGtdq9jDaH1X/Q
HUImJ+2kS1NZXJvAEUj+UOM1lx01YuHhGv1RQIdGo0noamunHeqyxrjAzYEjTTnh
V0+KWQjbgAB4UxGvTa4YAL+3/rTDL/k25sWUCwUzhEVKCxU6+Du1cYm6YAfyYGmJ
U1h2J/GSGqD1szzFJ+FVQ0c=
-----END PRIVATE KEY-----`
