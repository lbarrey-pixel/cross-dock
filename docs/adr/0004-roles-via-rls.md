# 0004. Roles via RLS, with no filter on the client

## Context
Two teams use the same database: the operator (sells and invoices) and the CD (distribution center; receives, picks, and ships). The CD must not see the values of orders that have not yet been released to it, nor credentials, nor the freight panel.

## Decision
Authorization is in Postgres. `perfis` stores the role; `is_operador()`, `is_cd()`, and `is_membro()` feed the policies. The CD sees an order only after the operator has opened a consolidation for it (`pedido_liberado_cd`). The `anon` role has no grants at all; `authenticated` has the minimum table grants and `execute` on the RPCs, and RLS decides row by row; `integracoes_estado` (tokens and credentials) has no policy and no grant for `authenticated`, and only `service_role` and `security definer` functions touch it. The edge functions repeat the role check (`papel_atual`) or require the scheduler secret, and the CORS origin comes from an environment variable.

## Consequences
- The front end hides menus by role, but the real barrier is the database; a tampered client gains no access.
- Without a grant, a correct policy does no good, and with too broad a grant RLS becomes the only defense. That is why `rls.sql` tests both sides (the operator can see, the CD cannot create a consolidation, anonymous cannot read).
- Adding a role requires new policies on every table it touches.
