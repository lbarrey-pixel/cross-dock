# 0004. Papéis via RLS, sem filtro no cliente

## Contexto
Duas equipes usam o mesmo banco: o operador (vende e fatura) e o CD (recebe, separa e expede). O CD não deve ver
valores de pedidos que ainda não foram liberados para ele, nem credenciais, nem o painel de frete.

## Decisão
Autorização no Postgres. `perfis` guarda o papel; `is_operador()`, `is_cd()` e `is_membro()` alimentam as policies.
O CD só enxerga um pedido depois que o operador abriu uma consolidação para ele (`pedido_liberado_cd`). O papel `anon`
não tem grant algum; `authenticated` tem os grants mínimos de tabela e `execute` nas RPCs, e o RLS decide por linha;
`integracoes_estado` (tokens e credenciais) não tem policy nem grant para `authenticated`, só `service_role` e funções
`security definer` a tocam. As edge functions repetem a checagem de papel (`papel_atual`) ou exigem o segredo do
agendador, e a origem do CORS vem de variável de ambiente.

## Consequências
- O front esconde menus por papel, mas a barreira real é o banco; um cliente adulterado não ganha acesso.
- Sem grant, uma policy correta não adianta, e com grant demais o RLS vira a única defesa. Por isso `rls.sql` testa os
  dois lados (operador vê, CD não cria consolidação, anônimo não lê).
- Adicionar um papel exige policies novas em cada tabela que ele toca.
