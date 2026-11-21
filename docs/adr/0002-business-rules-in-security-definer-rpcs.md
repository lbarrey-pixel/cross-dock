# 0002. Business rules in security definer RPCs

## Context
The flow of receiving, matching, consolidation, outgoing invoice, and shipping has invariants that cannot depend on the client: matched quantity does not exceed what was received, an invoice is entered only when consolidation is complete, and shipping happens only with the invoice checked against the volume measurements. There are two clients (the site and the edge functions) and two roles.

## Decision
Transitions live in `security definer` PL/pgSQL functions with a fixed `search_path` (`confirmar_casamento`, `criar_consolidacao`, `informar_volumetria`, `registrar_nf_saida`, `registrar_expedicao`, ...). Each function checks the role (`is_operador()`, `is_membro()`) and records the event. The tables keep `select/insert/update` for `authenticated`, filtered by RLS; the client never builds the transition out of ad-hoc updates. Quantities by stage come from `security_invoker` views, which honor the policies of whoever is querying.

## Consequences
- The rules have a single implementation and are tested in the database (`supabase/tests/rls.sql`), without starting the application.
- Changing a rule means changing a migration, not only the front end.
- The logic lives in Postgres, which couples the project to it; for this domain (inventory consistency), that is the point.
