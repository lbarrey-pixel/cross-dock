# 0002. Regras de negócio em RPCs security definer

## Contexto
O fluxo recebimento, casamento, consolidação, NF de saída e expedição tem invariantes que não podem depender do
cliente: quantidade casada não passa do recebido, NF só entra com a consolidação concluída, expedição só com a NF
conferida contra a volumetria. Há dois clientes (o site e as edge functions) e dois papéis.

## Decisão
As transições vivem em funções PL/pgSQL `security definer` com `search_path` fixo (`confirmar_casamento`,
`criar_consolidacao`, `informar_volumetria`, `registrar_nf_saida`, `registrar_expedicao`, ...). Cada função verifica o
papel (`is_operador()`, `is_membro()`) e registra o evento. As tabelas ficam com `select/insert/update` para
`authenticated` filtrados por RLS; o cliente nunca monta a transição com updates soltos. Quantidades por estágio saem
de views `security_invoker`, que respeitam as policies de quem consulta.

## Consequências
- As regras têm uma única implementação e são testadas no banco (`supabase/tests/rls.sql`), sem subir a aplicação.
- Mudar uma regra é mudar uma migration, não só o front.
- A lógica fica no Postgres, o que acopla o projeto a ele; para este domínio (consistência de estoque) é o ponto.
