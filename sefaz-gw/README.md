# sefaz-gw

Minimal gateway for SOAP calls to SEFAZ (the Brazilian state tax authority) — Distribuição DF-e (distribution of electronic tax documents) and Recepção de Evento (event reception) — with an A1 certificate (a file-based Brazilian digital certificate).

The edge functions run in a runtime whose TLS client does not complete the mTLS handshake with the SEFAZ servers.
The gateway receives the call already assembled (URL, action, XML body, chain, and PEM key), opens the connection with Node's OpenSSL, and returns the status and body. It stores nothing.

- `POST /soap` authenticated by the `x-token` header (variable `GW_TOKEN`, constant-time comparison).
- Accepts only destinations `*.fazenda.gov.br`, `*.sefaz.<uf>.gov.br`, and `*.svrs.rs.gov.br`.
- Server validation stays on. If the ICP-Brasil (Brazilian PKI) chain is not in the image's CA store,
  `GW_TLS_RELAXADO=1` allows repeating the call without validation (the body is sent signed, but consider the risk).
- `GET /health`.

```bash
npm test                        # node:test, no network
GW_TOKEN=troque-isto npm start  # port 8080
docker build -t sefaz-gw . && docker run -p 8080:8080 -e GW_TOKEN=troque-isto sefaz-gw
```

After it is published, store the URL in `integracoes_estado` (`sefaz_gw_url`) and the token in `cred:sefaz_gw_token`
through the Configurações (Settings) screen.
