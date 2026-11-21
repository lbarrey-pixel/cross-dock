# CrossDock

Receiving by NF-e (Brazilian electronic invoice) access key, matching to sales orders, consolidation, outgoing invoice, and shipping for a distribution center (cross-docking) that operates for a B2B reseller.

![CI](https://img.shields.io/badge/ci-github%20actions-lightgrey) ![license](https://img.shields.io/badge/license-MIT-blue)

> This is a portfolio sample of a system running in production for a client. Brand and data here are fictional, and the full production code is private by contract.

## The problem

A B2B reseller buys from several suppliers and delivers to the end customer without holding its own inventory: the goods pass through a partner distribution center (CD), which receives them, checks them, groups what belongs to each sales order, and ships. What went wrong day to day:

- the supplier invoice arrives on paper, and the item description is almost never the one on the sales order;
- the CD does not know whether it already has everything for an order, and the operator does not know what has already arrived;
- the outgoing invoice is issued in the ERP without checking weight and volumes against what was actually packed;
- the freight charged shows up only weeks later, and nobody compares it with what was quoted.

CrossDock connects these loose ends. The CD reads the DANFE (printable NF-e document) barcode. An edge function fetches the official XML from SEFAZ (the Brazilian state tax authority) using the company's A1 certificate (a file-based Brazilian digital certificate), including the signed operation awareness event that unlocks the full XML. The system suggests which order each item belongs to, and the operator only confirms. From there the flow is guided: consolidate, pick, measure the volumes, invoice in the ERP, check the invoice against the volume measurements, ship by reading the DACTE (printable CT-e document), and finally compare quoted freight with the freight charged on the CT-e (electronic freight document).

## Flow

```
DANFE barcode ─▶ SEFAZ (official XML, operation awareness) ─▶ receiving + items
        ─▶ matching (rules + optional LLM) ─▶ operator confirms ─▶ consolidation ─▶ CD picks and measures
        ─▶ ERP invoices ─▶ outgoing invoice checked × volume measurements ─▶ shipping (DACTE) ─▶ CT-e downloaded from SEFAZ ─▶ quoted freight × charged
```

Two roles: `operador` (sells and invoices) and `cd` (the distribution center team). The CD sees an order only after the operator opens its consolidation.

## Stack

| Layer | Technology |
| --- | --- |
| Database | PostgreSQL 16 / Supabase: 20 tables, 4 views, `security definer` RPCs, RLS by role, `pg_cron` |
| Functions | Supabase Edge Functions (Deno + TypeScript), `node-forge` for the A1 certificate and XMLDSig |
| Gateway | Node 22, `node:https` with mTLS (`sefaz-gw`) |
| Web | React 19, TypeScript, Vite 8, Tailwind 4, supabase-js, react-router, recharts, `@zxing` (barcode reader), WebXR (volume measurement) |
| Tests | `deno test`, Vitest, `node:test`, SQL with asserts (`supabase/tests/rls.sql`) |
| Quality | oxlint, `tsc -b`, `deno lint`/`deno check`, GitHub Actions |

## How to run

### Database only (quick)

```bash
docker compose up -d db          # Postgres 16 with a Supabase stub, migration, and seed
docker compose run --rm rls      # policies and RPCs by role (supabase/tests/rls.sql)
```

Without Docker, on any Postgres 16:

```bash
createdb crossdock
for f in supabase/tests/stub_supabase.sql supabase/migrations/0001_schema.sql supabase/seed.sql supabase/tests/rls.sql; do
  psql -v ON_ERROR_STOP=1 -d crossdock -f $f
done
```

### Full application (local Supabase)

Requires the [Supabase CLI](https://supabase.com/docs/guides/local-development) and Docker.

```bash
supabase start                                   # applies the migration and seed (supabase/config.toml)
cp supabase/functions/.env.example supabase/functions/.env
supabase functions serve --env-file supabase/functions/.env

cd web
cp .env.example .env                             # URL and anon key from `supabase status`
npm ci && npm run dev
```

The seed creates `operador@example.com` and `cd@example.com` (development password `demo-crossdock`) and two demo orders. In Configurações (Settings), the operator registers the ERP and carrier credentials, the A1 certificate, and, optionally, an LLM. Without those integrations you can go through the whole flow with the demo orders: on receiving, use “Enviar o XML da nota” (“Upload the invoice XML”) with [`docs/exemplos/nfe-fornecedor.xml`](docs/exemplos/nfe-fornecedor.xml), which has items similar to those on order #990001.

### Tests

```bash
cd supabase/functions && deno task lint && deno task check && deno task test   # 29 tests
cd web && npm run lint && npx tsc -b && npm test && npm run build               # 11 tests
cd sefaz-gw && npm test                                                         # 3 tests
docker compose run --rm rls                                                     # SQL
```

## Structure

| Path | What it is |
| --- | --- |
| `supabase/migrations/0001_schema.sql` | complete schema: tables, views, RPCs, RLS, grants, storage, schedules |
| `supabase/seed.sql` | development data (users, config, addresses, demo orders) |
| `supabase/tests/` | Supabase stub for ordinary Postgres and RLS/RPC tests |
| `supabase/functions/_shared/` | CORS and authorization, ERP client, matching score, LLM port |
| `supabase/functions/sefaz/` | `lib.ts` (pure: access key with check digit, certificate, XMLDSig, SOAP, CT-e) and `index.ts` (actions) |
| `supabase/functions/erp-oauth`, `erp-sync` | OAuth2 authorization and sales-order import / outgoing-invoice collection |
| `supabase/functions/casamento-sugerir` | match suggestions |
| `supabase/functions/transportadora` | quoting and tracking on the carrier API |
| `sefaz-gw/` | mTLS gateway for SEFAZ |
| `web/` | site (PWA) for the operator (`/operador/*`) and the CD (`/cd/*`) |
| `docs/adr/` | architecture decisions |

## Decisions

- [Hand-built XMLDSig and a gateway for mTLS](docs/adr/0001-hand-built-xmldsig-and-mtls-gateway.md)
- [Business rules in `security definer` RPCs](docs/adr/0002-business-rules-in-security-definer-rpcs.md)
- [Explainable matching before the LLM](docs/adr/0003-explainable-matching-before-the-llm.md)
- [Roles via RLS](docs/adr/0004-roles-via-rls.md)

Details worth noting:

- NF-e/CT-e access key validated by a modulo-11 check digit in the browser, in the function, and in the database.
- Outgoing invoice checked against weight, volumes, and recipient before shipping is released.
- Matching is an explainable score (model codes, token similarity, listing URL, past confirmations, hard exclusions), with an optional LLM tie-breaker behind a provider interface. The operator always confirms.
- Business rules live in Postgres: `security definer` RPCs enforce quantities and state transitions; RLS and minimal grants separate the two roles (`operador`, `cd`).
- The LLM is a port (`ProvedorLLM`): any chat API configured by `LLM_API_URL`, `LLM_API_KEY`, and `LLM_MODEL` (OpenAI format or similar), with a fake adapter in the tests. The invoice text goes into the prompt as data, and the response passes through a strict extractor.
- The ERP client paces requests per invocation and retries at most 3 times when it hits a request limit. The Tiny/Olist ERP API v3 served as the example for the contract; the URLs come from `ERP_API_URL` and `ERP_AUTH_URL`.
- Credentials and tokens stay in `integracoes_estado`, with no policy: they never return to the browser.
