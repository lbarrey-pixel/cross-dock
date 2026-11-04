-- Dados iniciais para desenvolvimento: dois usuários (um por papel), configuração do CD,
-- locais do armazém e os pedidos de demonstração (seed_demo). Tudo fictício.
-- No Supabase, `supabase db reset` aplica este arquivo depois das migrations.

-- Senha de desenvolvimento: demo-crossdock (nunca usar fora do ambiente local).
insert into auth.users (id, email, encrypted_password, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000001', 'operador@example.com', crypt('demo-crossdock', gen_salt('bf')), now()),
  ('00000000-0000-4000-8000-000000000002', 'cd@example.com', crypt('demo-crossdock', gen_salt('bf')), now())
on conflict (id) do nothing;

-- O trigger de convites cria os perfis.
insert into public.convites (email, nome, papel) values
  ('operador@example.com', 'Ana Operadora', 'operador'),
  ('cd@example.com', 'Bruno do CD', 'cd')
on conflict (email) do nothing;

insert into public.config (chave, valor) values
  ('empresa_cnpj', '"12345678000195"'),
  ('cd_endereco',  '"Rua das Docas, 1200 - Galpão 7, Porto Novo - SP"'),
  ('cep_origem',   '"07000000"'),
  ('sefaz_uf_autor', '"35"'),
  ('corte_pedido', '0'),
  -- Linha de base do painel de frete: preencha com o seu histórico (R$ por CT-e, R$ por kg taxado, % sobre a NF).
  ('frete_base',   '{"porCte": 0, "porKg": 0, "sobreNf": 0}')
on conflict (chave) do nothing;

insert into public.enderecos (codigo, prateleira, andar, zona) values
  ('A-01', 'A', '01', 'recebimento'), ('A-02', 'A', '02', 'recebimento'),
  ('F-04', 'F', '04', 'estoque'), ('F-05', 'F', '05', 'estoque'), ('G-01', 'G', '01', 'volumosos')
on conflict (codigo) do nothing;

-- seed_demo exige o papel operador: assume a identidade do usuário acima só dentro deste bloco.
do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  perform public.seed_demo();
end $$;
