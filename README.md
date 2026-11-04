# CrossDock

Recebimento por chave de NF-e, casamento com pedidos de venda, consolidação, NF de saída e expedição para um centro de distribuição (cross-docking) que opera para um revendedor B2B.

![CI](https://img.shields.io/badge/ci-github%20actions-lightgrey) ![licença](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)

## O problema

Um revendedor B2B compra de vários fornecedores e entrega ao cliente final sem manter estoque próprio: a mercadoria passa por um centro de distribuição (CD) parceiro, que recebe, confere, junta o que pertence a cada pedido de venda e despacha. O que dava errado no dia a dia:

- a NF do fornecedor chega em papel, e a descrição do item quase nunca é a do pedido de venda;
- o CD não sabe se já tem tudo de um pedido, e o operador não sabe o que já chegou;
- a NF de saída é emitida no ERP sem conferir peso e volumes com o que foi realmente embalado;
- o frete cobrado só aparece semanas depois, e ninguém compara com o que foi cotado.

O CrossDock liga essas pontas. O CD lê o código de barras da DANFE, o sistema busca o XML oficial na SEFAZ, sugere a que pedido cada item pertence, e o operador só confirma. Daí em diante o fluxo é guiado: consolidar, separar, medir os volumes, faturar no ERP, conferir a NF contra a volumetria, expedir lendo o DACTE e, por fim, comparar frete cotado com o cobrado no CT-e.

## Fluxo

```
código de barras da DANFE ─▶ SEFAZ (XML oficial, ciência da operação) ─▶ recebimento + itens
        ─▶ casamento (regras + LLM opcional) ─▶ operador confirma ─▶ consolidação ─▶ CD separa e mede
        ─▶ ERP fatura ─▶ NF de saída conferida × volumetria ─▶ expedição (DACTE) ─▶ CT-e baixado da SEFAZ ─▶ frete cotado × cobrado
```

Dois papéis: `operador` (vende e fatura) e `cd` (equipe do centro de distribuição). O CD só vê um pedido depois que o operador abre a consolidação dele.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Banco | PostgreSQL 16 / Supabase: 20 tabelas, 4 views, RPCs `security definer`, RLS por papel, `pg_cron` |
| Funções | Supabase Edge Functions (Deno + TypeScript), `node-forge` para certificado A1 e XMLDSig |
| Gateway | Node 22, `node:https` com mTLS (`sefaz-gw`) |
| Web | React 19, TypeScript, Vite 8, Tailwind 4, supabase-js, react-router, recharts, `@zxing` (leitor de código de barras), WebXR (medição de volumes) |
| Testes | `deno test`, Vitest, `node:test`, SQL com asserts (`supabase/tests/rls.sql`) |
| Qualidade | oxlint, `tsc -b`, `deno lint`/`deno check`, GitHub Actions |

## Como rodar

### Só o banco (rápido)

```bash
docker compose up -d db          # Postgres 16 com stub do Supabase, migration e seed
docker compose run --rm rls      # policies e RPCs por papel (supabase/tests/rls.sql)
```

Sem Docker, com um Postgres 16 qualquer:

```bash
createdb crossdock
for f in supabase/tests/stub_supabase.sql supabase/migrations/0001_schema.sql supabase/seed.sql supabase/tests/rls.sql; do
  psql -v ON_ERROR_STOP=1 -d crossdock -f $f
done
```

### Aplicação completa (Supabase local)

Precisa da [CLI do Supabase](https://supabase.com/docs/guides/local-development) e de Docker.

```bash
supabase start                                   # aplica migration e seed (supabase/config.toml)
cp supabase/functions/.env.example supabase/functions/.env
supabase functions serve --env-file supabase/functions/.env

cd web
cp .env.example .env                             # URL e anon key de `supabase status`
npm ci && npm run dev
```

O seed cria `operador@example.com` e `cd@example.com` (senha de desenvolvimento `demo-crossdock`) e dois pedidos de demonstração. Em Configurações, o operador cadastra credenciais do ERP e da transportadora, o certificado A1 e, opcionalmente, um LLM. Sem essas integrações dá para percorrer o fluxo inteiro com os pedidos de demonstração: no recebimento, use “Enviar o XML da nota” com [`docs/exemplos/nfe-fornecedor.xml`](docs/exemplos/nfe-fornecedor.xml), que traz itens parecidos com os do pedido #990001.

### Testes

```bash
cd supabase/functions && deno task lint && deno task check && deno task test   # 29 testes
cd web && npm run lint && npx tsc -b && npm test && npm run build               # 11 testes
cd sefaz-gw && npm test                                                         # 3 testes
docker compose run --rm rls                                                     # SQL
```

## Estrutura

| Caminho | O que é |
| --- | --- |
| `supabase/migrations/0001_schema.sql` | esquema completo: tabelas, views, RPCs, RLS, grants, storage, agendamentos |
| `supabase/seed.sql` | dados de desenvolvimento (usuários, config, endereços, pedidos de demonstração) |
| `supabase/tests/` | stub do Supabase para Postgres comum e testes de RLS/RPC |
| `supabase/functions/_shared/` | CORS e autorização, cliente do ERP, pontuação do casamento, porta do LLM |
| `supabase/functions/sefaz/` | `lib.ts` (puro: chave com DV, certificado, XMLDSig, SOAP, CT-e) e `index.ts` (ações) |
| `supabase/functions/erp-oauth`, `erp-sync` | autorização OAuth2 e importação de pedidos / coleta da NF de saída |
| `supabase/functions/casamento-sugerir` | sugestão de casamentos |
| `supabase/functions/transportadora` | cotação e rastreio na API da transportadora |
| `sefaz-gw/` | gateway mTLS para a SEFAZ |
| `web/` | site (PWA) do operador (`/operador/*`) e do CD (`/cd/*`) |
| `docs/adr/` | decisões de arquitetura |

## Decisões

- [Assinatura XMLDSig à mão e gateway para o mTLS](docs/adr/0001-xmldsig-manual-e-gateway-mtls.md)
- [Regras de negócio em RPCs `security definer`](docs/adr/0002-regras-em-rpcs-security-definer.md)
- [Casamento explicável antes do LLM](docs/adr/0003-casamento-explicavel-antes-do-llm.md)
- [Papéis via RLS](docs/adr/0004-papeis-via-rls.md)

Detalhes que valem citar:

- Chave de acesso NF-e/CT-e validada por dígito verificador módulo 11 no navegador, na função e no banco.
- NF de saída conferida contra peso, volumes e destinatário antes de liberar a expedição.
- O LLM é uma porta (`ProvedorLLM`): qualquer API de chat configurada por `LLM_API_URL`, `LLM_API_KEY` e `LLM_MODEL` (formato OpenAI ou semelhante), com adaptador fake nos testes. O texto da NF entra no prompt como dado e a resposta passa por um extrator estrito.
- O cliente do ERP controla o ritmo por invocação e tenta no máximo 3 vezes em caso de limite de requisições. A API v3 do ERP Tiny/Olist serviu de exemplo para o contrato; os endereços vêm de `ERP_API_URL` e `ERP_AUTH_URL`.
- Credenciais e tokens ficam em `integracoes_estado`, sem policy: nunca voltam para o navegador.

> Versão de portfólio. O sistema roda em produção para um cliente; aqui marca e dados são fictícios, e o código em produção é privado por contrato.

## English

**CrossDock** is a cross-docking system: a distribution center receives supplier goods against NF-e (Brazilian e-invoice) access keys, matches them to customer sales orders, consolidates, checks the outgoing invoice against measured volumes and ships.

- **Receiving**: the warehouse scans the DANFE barcode; an edge function fetches the official XML from the tax authority (SEFAZ) using the company's A1 certificate, including the signed "operation awareness" event that unlocks the full XML.
- **Matching**: explainable scoring (model codes, token similarity, listing URL, past confirmations, hard exclusions) with an optional LLM tie-breaker behind a provider interface. The operator always confirms.
- **Business rules live in Postgres**: `security definer` RPCs enforce quantities and state transitions; RLS and minimal grants separate the two roles (`operador`, `cd`).
- **Outbound**: the ERP invoice is imported and checked against volumes and weight; shipping is blocked until it matches. CT-e documents are synced from SEFAZ to compare quoted vs. charged freight.
- **Stack**: PostgreSQL 16 / Supabase, Deno edge functions, a small Node mTLS gateway, React 19 + Vite + Tailwind 4. Tests: Deno (29), Vitest (11), node:test (3) and SQL asserts for RLS.

Run it: `docker compose up -d db && docker compose run --rm rls` for the database, or `supabase start` plus `supabase functions serve` plus `npm run dev` in `web/` for the full app (see the Portuguese section above).

*Portfolio version. The system runs in production for a client; brand and data here are fictional, and the production code is private by contract.*
