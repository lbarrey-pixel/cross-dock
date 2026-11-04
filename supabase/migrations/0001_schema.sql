-- CrossDock: esquema completo (schema public).
-- Roda no Supabase e num Postgres 16 comum (CI, docker-compose) com o stub em supabase/tests/stub_supabase.sql.
-- Dois papéis: 'operador' (quem vende e fatura) e 'cd' (equipe do centro de distribuição parceiro).

-- ===========================================================================
-- 1. Extensões
-- ===========================================================================
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
-- pg_cron e pg_net só existem no Supabase; fora dele os agendamentos da seção 10 são pulados.
do $$ begin
  create extension if not exists pg_cron;
exception when others then raise notice 'pg_cron indisponível: agendamentos não serão criados'; end $$;
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net indisponível'; end $$;

-- ===========================================================================
-- 2. Tabelas
-- ===========================================================================

-- Quem pode entrar e com qual papel. A linha vira perfil quando o usuário cria a conta (trigger).
create table public.convites (
  email text primary key,
  nome text not null,
  papel text not null check (papel in ('operador', 'cd')),
  criado_em timestamptz default now()
);

create table public.perfis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text,
  papel text not null check (papel in ('operador', 'cd')),
  criado_em timestamptz default now()
);

create table public.config (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz default now()
);

-- Tokens, credenciais e cursores das integrações. Sem policy: só service_role e funções security definer.
create table public.integracoes_estado (
  chave text primary key,
  valor jsonb,
  atualizado_em timestamptz default now()
);

create table public.pedidos (
  id bigserial primary key,
  erp_id bigint unique,
  numero integer not null unique,
  numero_oc_cliente text,
  data_pedido date,
  cliente text,
  cnpj text,
  entrega jsonb,
  cep_entrega text,
  cidade text,
  uf text,
  total numeric,
  situacao_erp text,
  -- false = pedido saiu do fluxo do CD (segue entrega direta); fica no histórico.
  no_fluxo boolean not null default true,
  excluido_por uuid references auth.users(id),
  motivo_exclusao text,
  excluido_em timestamptz,
  importado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

create table public.pedido_marcadores (
  pedido_id bigint primary key references public.pedidos(id) on delete cascade,
  marcadores jsonb not null default '[]'::jsonb
);

create table public.itens_pedido (
  id bigserial primary key,
  pedido_id bigint not null references public.pedidos(id) on delete cascade,
  erp_produto_id bigint,
  codigo text,
  descricao text not null,
  ncm text,
  unidade text,
  quantidade numeric not null check (quantidade > 0),
  valor_unitario numeric,
  no_fluxo boolean not null default true,
  excluido_por uuid references auth.users(id),
  motivo_exclusao text,
  excluido_em timestamptz,
  criado_em timestamptz default now()
);
create index itens_pedido_pedido_id_idx on public.itens_pedido (pedido_id);

create table public.enderecos (
  id bigserial primary key,
  codigo text not null unique,
  zona text,
  prateleira text,
  andar text,
  ativo boolean not null default true,
  criado_em timestamptz default now()
);

create table public.recebimentos (
  id bigserial primary key,
  conferente uuid default auth.uid() references auth.users(id),
  emitente_cnpj text,
  emitente_nome text,
  nf_numero text,
  nf_serie text,
  nf_chave text unique,
  nf_emissao timestamptz,
  nf_valor numeric,
  xml_path text,
  xml_origem text,
  pdf_path text,
  volumes_recebidos integer,
  fotos text[] not null default '{}',
  status text not null default 'aberto' check (status in ('aberto', 'conferido')),
  provisorio_sem_nf boolean not null default false,
  obs text,
  criado_em timestamptz default now()
);

create table public.itens_recebidos (
  id bigserial primary key,
  recebimento_id bigint not null references public.recebimentos(id) on delete cascade,
  n_item integer,
  codigo_fornecedor text,
  descricao text not null,
  ncm text,
  unidade text,
  qtd_nf numeric not null,
  qtd_conferida numeric,
  valor_unitario numeric,
  fotos text[] not null default '{}',
  endereco_id bigint references public.enderecos(id),
  bloqueado boolean not null default false,
  motivo_bloqueio text,
  especial text,
  conferido_em timestamptz,
  criado_em timestamptz default now()
);
create index itens_recebidos_recebimento_id_idx on public.itens_recebidos (recebimento_id);

-- Casamento: item recebido × item do pedido. Sugerido por regra ou IA, confirmado pelo operador.
create table public.casamentos (
  id bigserial primary key,
  item_recebido_id bigint not null references public.itens_recebidos(id) on delete cascade,
  item_pedido_id bigint not null references public.itens_pedido(id) on delete cascade,
  qtd numeric not null check (qtd > 0),
  origem text not null check (origem in ('ia', 'regra', 'manual')),
  confianca text check (confianca in ('alta', 'media', 'baixa')),
  motivo text,
  status text not null default 'sugerido' check (status in ('sugerido', 'confirmado', 'rejeitado')),
  confirmado_por uuid references auth.users(id),
  confirmado_em timestamptz,
  criado_em timestamptz default now()
);
create index casamentos_item_pedido_id_idx on public.casamentos (item_pedido_id);
create index casamentos_item_recebido_id_idx on public.casamentos (item_recebido_id);

-- Memória dos casamentos confirmados: alimenta a pontuação das próximas sugestões.
create table public.casamento_memoria (
  id bigserial primary key,
  emitente_cnpj text,
  codigo_fornecedor text,
  descricao_nf text,
  codigo_produto text,
  descricao_produto text,
  vezes integer not null default 1,
  atualizado_em timestamptz default now()
);

create table public.consolidacoes (
  id bigserial primary key,
  pedido_id bigint not null references public.pedidos(id),
  tipo text not null default 'total' check (tipo in ('total', 'parcial', 'devolucao')),
  motivo_parcial text,
  status text not null default 'aguardando_consolidacao'
    check (status in ('aguardando_consolidacao', 'consolidado', 'nf_emitida', 'embarcado', 'entregue', 'cancelada')),
  solicitado_por uuid default auth.uid() references auth.users(id),
  solicitado_em timestamptz default now(),
  peso_bruto numeric,
  peso_liquido numeric,
  qtd_volumes integer,
  cubagem_m3 numeric,
  volumetria_em timestamptz,
  volumetria_por uuid references auth.users(id),
  nf_numero text,
  nf_chave text,
  nf_xml_path text,
  danfe_path text,
  nf_conferida boolean,
  nf_divergencias jsonb,
  nf_coletada_em timestamptz,
  embarcado_em timestamptz,
  embarcado_por uuid references auth.users(id),
  entregue_em timestamptz,
  previsao_entrega date,
  cte_chave text,
  cte_numero text,
  cte_valor numeric,
  cte_peso_taxado numeric,
  cte_componentes jsonb,
  cte_xml_path text,
  atualizado_em timestamptz default now()
);
create index consolidacoes_pedido_id_idx on public.consolidacoes (pedido_id);

create table public.consolidacao_itens (
  id bigserial primary key,
  consolidacao_id bigint not null references public.consolidacoes(id) on delete cascade,
  casamento_id bigint not null references public.casamentos(id),
  qtd numeric not null check (qtd > 0),
  separado boolean not null default false,
  separado_por uuid references auth.users(id),
  separado_em timestamptz
);

create table public.volumes (
  id bigserial primary key,
  consolidacao_id bigint not null references public.consolidacoes(id) on delete cascade,
  seq integer not null,
  comprimento_cm numeric,
  largura_cm numeric,
  altura_cm numeric,
  peso_kg numeric,
  foto text,
  descartado boolean not null default false,
  criado_em timestamptz default now()
);

create table public.cotacoes_frete (
  id bigserial primary key,
  consolidacao_id bigint not null references public.consolidacoes(id) on delete cascade,
  valor numeric,
  prazo_dias integer,
  peso_taxado numeric,
  componentes jsonb,
  payload jsonb,
  validade date,
  erro text,
  descartada boolean not null default false,
  criado_em timestamptz default now()
);

create table public.rastreios (
  id bigserial primary key,
  consolidacao_id bigint not null references public.consolidacoes(id) on delete cascade,
  data_evento timestamptz,
  situacao text,
  local text,
  previsao date,
  payload jsonb,
  criado_em timestamptz default now()
);

create table public.ocorrencias (
  id bigserial primary key,
  tipo text not null check (tipo in ('divergencia_qtd', 'avaria', 'sem_nf', 'item_errado', 'nf_saida_divergente', 'outro')),
  recebimento_id bigint references public.recebimentos(id),
  item_recebido_id bigint references public.itens_recebidos(id),
  consolidacao_id bigint references public.consolidacoes(id),
  descricao text,
  fotos text[] not null default '{}',
  aberta_por uuid default auth.uid() references auth.users(id),
  status text not null default 'aberta' check (status in ('aberta', 'resolvida')),
  resolucao text,
  criado_em timestamptz default now(),
  resolvida_em timestamptz
);

-- XML baixado da SEFAZ (NF-e de entrada e CT-e), indexado pela chave de acesso.
create table public.documentos_fiscais (
  chave text primary key,
  tipo text not null check (tipo in ('nfe', 'cte')),
  nsu text,
  xml_path text,
  dados jsonb,
  criado_em timestamptz not null default now()
);

create table public.eventos (
  id bigserial primary key,
  entidade text not null,
  entidade_id bigint,
  acao text not null,
  ator uuid default auth.uid(),
  dados jsonb,
  criado_em timestamptz default now()
);

-- ===========================================================================
-- 3. Papéis (usadas pelas policies e pelas RPCs)
-- ===========================================================================
create or replace function public.is_operador() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'operador' from perfis where user_id = auth.uid()), false)
$$;

create or replace function public.is_cd() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'cd' from perfis where user_id = auth.uid()), false)
$$;

create or replace function public.is_membro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where user_id = auth.uid())
$$;

create or replace function public.papel_atual() returns text
language sql stable security definer set search_path = public as $$
  select papel from perfis where user_id = auth.uid()
$$;

-- O CD só vê um pedido depois que o operador abriu uma consolidação para ele.
create or replace function public.pedido_liberado_cd(p bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from consolidacoes c where c.pedido_id = p and c.status <> 'cancelada')
$$;

-- ===========================================================================
-- 4. Views (security_invoker: respeitam as policies de quem consulta)
-- ===========================================================================

create view public.v_itens_recebidos_saldo with (security_invoker = true) as
select ir.*,
  r.emitente_nome, r.emitente_cnpj, r.nf_numero, r.nf_chave, r.criado_em as recebido_em, r.provisorio_sem_nf,
  e.codigo as endereco_codigo,
  coalesce(cc.q, 0) as qtd_casada,
  coalesce(ir.qtd_conferida, ir.qtd_nf) - coalesce(cc.q, 0) as qtd_sem_dono,
  exists (select 1 from casamentos c where c.item_recebido_id = ir.id and c.status = 'sugerido') as tem_sugestao
from itens_recebidos ir
join recebimentos r on r.id = ir.recebimento_id
left join enderecos e on e.id = ir.endereco_id
left join lateral (select sum(c.qtd) as q from casamentos c where c.item_recebido_id = ir.id and c.status = 'confirmado') cc on true;

-- Quantidade de cada item do pedido em cada estágio do fluxo.
create view public.v_itens_status with (security_invoker = true) as
with cas as (
  select item_pedido_id, sum(qtd) as qtd_casada from casamentos where status = 'confirmado' group by item_pedido_id
), sug as (
  select item_pedido_id, sum(qtd) as qtd_sugerida from casamentos where status = 'sugerido' group by item_pedido_id
), cons as (
  select ca.item_pedido_id,
    sum(ci.qtd) filter (where co.status = 'aguardando_consolidacao') as ag,
    sum(ci.qtd) filter (where co.status = 'consolidado') as cs,
    sum(ci.qtd) filter (where co.status = 'nf_emitida') as nf,
    sum(ci.qtd) filter (where co.status = 'embarcado') as em,
    sum(ci.qtd) filter (where co.status = 'entregue') as en
  from consolidacao_itens ci
  join consolidacoes co on co.id = ci.consolidacao_id and co.status <> 'cancelada'
  join casamentos ca on ca.id = ci.casamento_id
  group by ca.item_pedido_id
), base as (
  select ip.*,
    coalesce(cas.qtd_casada, 0) as qtd_casada_,
    coalesce(sug.qtd_sugerida, 0) as qtd_sugerida_,
    case when ip.no_fluxo then greatest(ip.quantidade - coalesce(cas.qtd_casada, 0), 0) else 0 end as falta,
    cons.ag, cons.cs, cons.nf, cons.em, cons.en
  from itens_pedido ip
  left join cas on cas.item_pedido_id = ip.id
  left join sug on sug.item_pedido_id = ip.id
  left join cons on cons.item_pedido_id = ip.id
)
select id as item_pedido_id, pedido_id, descricao, codigo, unidade, quantidade, valor_unitario, no_fluxo,
  qtd_casada_ as qtd_casada,
  falta - least(falta, qtd_sugerida_) as q_aguardando_recebimento,
  greatest(qtd_casada_ - coalesce(ag, 0) - coalesce(cs, 0) - coalesce(nf, 0) - coalesce(em, 0) - coalesce(en, 0), 0) as q_disponivel,
  coalesce(ag, 0) as q_aguardando_consolidacao,
  coalesce(cs, 0) as q_consolidado,
  coalesce(nf, 0) as q_nf_emitida,
  coalesce(em, 0) as q_embarcado,
  coalesce(en, 0) as q_entregue,
  least(falta, qtd_sugerida_) as q_aguardando_casamento
from base;

create view public.v_pedidos_resumo with (security_invoker = true) as
select p.id, p.numero, p.numero_oc_cliente, p.cliente, p.cnpj, p.cidade, p.uf, p.total, p.data_pedido, p.no_fluxo, p.importado_em,
  count(s.item_pedido_id) filter (where s.no_fluxo) as itens,
  coalesce(sum(s.quantidade) filter (where s.no_fluxo), 0) as q_total,
  coalesce(sum(s.q_aguardando_recebimento), 0) as q_aguardando_recebimento,
  coalesce(sum(s.q_aguardando_casamento), 0) as q_aguardando_casamento,
  coalesce(sum(s.q_disponivel), 0) as q_disponivel,
  coalesce(sum(s.q_aguardando_consolidacao), 0) as q_aguardando_consolidacao,
  coalesce(sum(s.q_consolidado), 0) as q_consolidado,
  coalesce(sum(s.q_nf_emitida), 0) as q_nf_emitida,
  coalesce(sum(s.q_embarcado), 0) as q_embarcado,
  coalesce(sum(s.q_entregue), 0) as q_entregue,
  current_date - coalesce(p.data_pedido, p.importado_em::date) as dias
from pedidos p
left join v_itens_status s on s.pedido_id = p.id
group by p.id;

-- Frete cotado (última cotação válida) × cobrado no CT-e, por consolidação.
create view public.v_frete_benchmark with (security_invoker = true) as
select co.id as consolidacao_id, p.numero as pedido, p.uf, p.cidade, co.embarcado_em,
  date_trunc('month', coalesce(co.embarcado_em, co.volumetria_em))::date as mes,
  co.peso_bruto, co.cubagem_m3, co.qtd_volumes,
  -- Fator de cubagem rodoviário usual: 300 kg/m³.
  greatest(co.peso_bruto, co.cubagem_m3 * 300) as peso_taxavel_estimado,
  cf.valor as cotado, cf.componentes as cotado_componentes, cf.peso_taxado as cotado_peso_taxado,
  co.cte_valor as cobrado, co.cte_componentes as cobrado_componentes, co.cte_peso_taxado as cobrado_peso_taxado,
  (select sum(ip.valor_unitario * ci.qtd) from consolidacao_itens ci
     join casamentos ca on ca.id = ci.casamento_id
     join itens_pedido ip on ip.id = ca.item_pedido_id
   where ci.consolidacao_id = co.id) as valor_mercadoria
from consolidacoes co
join pedidos p on p.id = co.pedido_id
left join lateral (
  select * from cotacoes_frete c
  where c.consolidacao_id = co.id and not c.descartada and c.valor is not null
  order by c.criado_em desc limit 1
) cf on true
where co.status <> 'cancelada';

-- ===========================================================================
-- 5. Funções utilitárias
-- ===========================================================================

-- Chave de acesso NF-e (modelo 55) / CT-e (modelo 57): 44 dígitos e DV módulo 11.
create or replace function public.chave_valida(p_chave text, p_modelo text) returns boolean
language plpgsql immutable as $$
declare c text := regexp_replace(coalesce(p_chave, ''), '[^0-9]', '', 'g'); s int := 0; p int := 2; i int; dv int;
begin
  if length(c) <> 44 or substr(c, 21, 2) <> p_modelo then return false; end if;
  for i in reverse 43..1 loop
    s := s + substr(c, i, 1)::int * p;
    p := case when p = 9 then 2 else p + 1 end;
  end loop;
  dv := 11 - (s % 11);
  if dv >= 10 then dv := 0; end if;
  return dv = substr(c, 44, 1)::int;
end $$;

create or replace function public.log_evento(p_ent text, p_id bigint, p_acao text, p_dados jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into eventos (entidade, entidade_id, acao, ator, dados) values (p_ent, p_id, p_acao, auth.uid(), p_dados)
$$;

-- Convite → perfil, quando o e-mail já tem conta.
create or replace function public.convite_aplicar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (user_id, nome, email, papel)
  select u.id, new.nome, u.email, new.papel from auth.users u where lower(u.email) = lower(new.email)
  on conflict (user_id) do update set papel = excluded.papel, nome = excluded.nome;
  return new;
end $$;

create trigger convite_aplicar after insert or update on public.convites
  for each row execute function public.convite_aplicar();

-- ===========================================================================
-- 6. Regras de negócio (RPCs security definer; a checagem de papel é feita aqui)
-- ===========================================================================

create or replace function public.confirmar_casamento(p_id bigint, p_qtd numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare c casamentos; disp_rec numeric; disp_ped numeric;
begin
  if not is_operador() then raise exception 'Somente o operador valida casamentos'; end if;
  select * into c from casamentos where id = p_id for update;
  if c.status <> 'sugerido' then raise exception 'Casamento não está como sugerido'; end if;
  if p_qtd is not null then c.qtd := p_qtd; end if;
  select qtd_sem_dono into disp_rec from v_itens_recebidos_saldo where id = c.item_recebido_id;
  -- Saldo do item do pedido ainda sem casamento validado (inclui o que está só sugerido).
  select q_aguardando_recebimento + q_aguardando_casamento into disp_ped from v_itens_status where item_pedido_id = c.item_pedido_id;
  if c.qtd > disp_rec then raise exception 'Quantidade maior que o saldo recebido (%)', disp_rec; end if;
  if c.qtd > disp_ped then raise exception 'Quantidade maior que o saldo do item do pedido (%)', disp_ped; end if;
  if exists (select 1 from itens_recebidos where id = c.item_recebido_id and bloqueado) then raise exception 'Item recebido está bloqueado'; end if;
  update casamentos set status = 'confirmado', qtd = c.qtd, confirmado_por = auth.uid(), confirmado_em = now() where id = p_id;
  insert into casamento_memoria (emitente_cnpj, codigo_fornecedor, descricao_nf, codigo_produto, descricao_produto)
  select r.emitente_cnpj, ir.codigo_fornecedor, ir.descricao, ip.codigo, ip.descricao
  from itens_recebidos ir join recebimentos r on r.id = ir.recebimento_id, itens_pedido ip
  where ir.id = c.item_recebido_id and ip.id = c.item_pedido_id;
  -- Outras sugestões para o mesmo item recebido que não cabem mais no saldo caem.
  update casamentos s set status = 'rejeitado' where s.item_recebido_id = c.item_recebido_id and s.status = 'sugerido'
    and s.qtd > (select qtd_sem_dono from v_itens_recebidos_saldo where id = c.item_recebido_id);
  perform log_evento('casamento', p_id, 'confirmado', jsonb_build_object('qtd', c.qtd));
end $$;

create or replace function public.rejeitar_casamento(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_operador() then raise exception 'Somente o operador'; end if;
  if exists (select 1 from consolidacao_itens ci join consolidacoes co on co.id = ci.consolidacao_id
             where ci.casamento_id = p_id and co.status <> 'cancelada') then
    raise exception 'Casamento já está em consolidação'; end if;
  update casamentos set status = 'rejeitado' where id = p_id;
  perform log_evento('casamento', p_id, 'rejeitado');
end $$;

create or replace function public.casar_manual(p_item_recebido bigint, p_item_pedido bigint, p_qtd numeric) returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if not is_operador() then raise exception 'Somente o operador'; end if;
  insert into casamentos (item_recebido_id, item_pedido_id, qtd, origem, confianca, motivo)
  values (p_item_recebido, p_item_pedido, p_qtd, 'manual', null, 'Atribuído manualmente') returning id into nid;
  perform confirmar_casamento(nid);
  return nid;
end $$;

create or replace function public.criar_consolidacao(p_pedido bigint, p_tipo text, p_motivo text, p_itens jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint; it jsonb; cas casamentos; usado numeric;
begin
  if not is_operador() then raise exception 'Somente o operador pede consolidação'; end if;
  if p_tipo = 'parcial' and coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do parcial'; end if;
  insert into consolidacoes (pedido_id, tipo, motivo_parcial) values (p_pedido, p_tipo, p_motivo) returning id into nid;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into cas from casamentos where id = (it->>'casamento_id')::bigint;
    if cas.status <> 'confirmado' then raise exception 'Casamento % não confirmado', cas.id; end if;
    if (select pedido_id from itens_pedido where id = cas.item_pedido_id) <> p_pedido then raise exception 'Casamento de outro pedido'; end if;
    select coalesce(sum(ci.qtd), 0) into usado from consolidacao_itens ci join consolidacoes co on co.id = ci.consolidacao_id
      where ci.casamento_id = cas.id and co.status <> 'cancelada';
    if (it->>'qtd')::numeric > cas.qtd - usado then raise exception 'Quantidade acima do disponível'; end if;
    insert into consolidacao_itens (consolidacao_id, casamento_id, qtd) values (nid, cas.id, (it->>'qtd')::numeric);
  end loop;
  if not exists (select 1 from consolidacao_itens where consolidacao_id = nid) then raise exception 'Nenhum item'; end if;
  perform log_evento('consolidacao', nid, 'solicitada', jsonb_build_object('tipo', p_tipo));
  return nid;
end $$;

create or replace function public.cancelar_consolidacao(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_operador() then raise exception 'Somente o operador'; end if;
  if (select status from consolidacoes where id = p_id) not in ('aguardando_consolidacao', 'consolidado') then
    raise exception 'Só é possível cancelar antes da NF'; end if;
  update consolidacoes set status = 'cancelada', atualizado_em = now() where id = p_id;
  perform log_evento('consolidacao', p_id, 'cancelada');
end $$;

create or replace function public.reabrir_consolidacao(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_operador() then raise exception 'Somente o operador'; end if;
  if (select status from consolidacoes where id = p_id) not in ('aguardando_consolidacao', 'consolidado') then
    raise exception 'Só é possível reabrir antes da NF'; end if;
  update volumes set descartado = true where consolidacao_id = p_id;
  update cotacoes_frete set descartada = true where consolidacao_id = p_id;
  update consolidacao_itens set separado = false, separado_por = null, separado_em = null where consolidacao_id = p_id;
  update consolidacoes set status = 'aguardando_consolidacao', peso_bruto = null, peso_liquido = null, qtd_volumes = null,
    cubagem_m3 = null, volumetria_em = null, volumetria_por = null, atualizado_em = now() where id = p_id;
  perform log_evento('consolidacao', p_id, 'reaberta');
end $$;

create or replace function public.marcar_separado(p_item bigint, p_sep boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_membro() then raise exception 'Sem acesso'; end if;
  if (select co.status from consolidacao_itens ci join consolidacoes co on co.id = ci.consolidacao_id where ci.id = p_item) <> 'aguardando_consolidacao' then
    raise exception 'Consolidação não está em separação'; end if;
  update consolidacao_itens set separado = p_sep,
    separado_por = case when p_sep then auth.uid() end,
    separado_em = case when p_sep then now() end
  where id = p_item;
end $$;

-- Volumes: [{c, l, a, peso, foto}], medidas em cm e kg.
create or replace function public.informar_volumetria(p_id bigint, p_volumes jsonb, p_peso_liquido numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare v jsonb; i int := 0;
begin
  if not is_membro() then raise exception 'Sem acesso'; end if;
  if (select status from consolidacoes where id = p_id) <> 'aguardando_consolidacao' then raise exception 'Consolidação não está em separação'; end if;
  if exists (select 1 from consolidacao_itens where consolidacao_id = p_id and not separado) then raise exception 'Há itens não separados'; end if;
  if jsonb_array_length(p_volumes) = 0 then raise exception 'Informe ao menos um volume'; end if;
  update volumes set descartado = true where consolidacao_id = p_id;
  for v in select * from jsonb_array_elements(p_volumes) loop
    i := i + 1;
    insert into volumes (consolidacao_id, seq, comprimento_cm, largura_cm, altura_cm, peso_kg, foto)
    values (p_id, i, (v->>'c')::numeric, (v->>'l')::numeric, (v->>'a')::numeric, (v->>'peso')::numeric, v->>'foto');
  end loop;
  update consolidacoes set status = 'consolidado', qtd_volumes = i,
    peso_bruto = (select sum(peso_kg) from volumes where consolidacao_id = p_id and not descartado),
    peso_liquido = p_peso_liquido,
    cubagem_m3 = (select round(sum(comprimento_cm * largura_cm * altura_cm) / 1000000.0, 4) from volumes where consolidacao_id = p_id and not descartado),
    volumetria_em = now(), volumetria_por = auth.uid(), atualizado_em = now()
  where id = p_id;
  perform log_evento('consolidacao', p_id, 'volumetria', p_volumes);
end $$;

-- Registra a NF de saída e confere com a volumetria. Devolve a lista de divergências (vazia = conferida).
-- Chamada pelo operador na tela ou pela sincronização com o ERP (service_role).
create or replace function public.registrar_nf_saida(p_id bigint, p_numero text, p_chave text, p_xml_path text, p_danfe_path text,
  p_qvol integer, p_peso_b numeric, p_peso_l numeric, p_dest_cnpj text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare co consolidacoes; div jsonb := '[]'::jsonb; ped pedidos;
begin
  if not (is_operador() or coalesce(auth.role(), '') = 'service_role') then raise exception 'Somente o operador'; end if;
  select * into co from consolidacoes where id = p_id;
  if co.status <> 'consolidado' then raise exception 'Consolidação precisa estar Consolidada'; end if;
  select * into ped from pedidos where id = co.pedido_id;
  if p_qvol is distinct from co.qtd_volumes then div := div || jsonb_build_object('campo', 'volumes', 'nf', p_qvol, 'cd', co.qtd_volumes); end if;
  if p_peso_b is null or abs(p_peso_b - co.peso_bruto) > 0.05 then div := div || jsonb_build_object('campo', 'peso_bruto', 'nf', p_peso_b, 'cd', co.peso_bruto); end if;
  if regexp_replace(coalesce(p_dest_cnpj, ''), '[^0-9]', '', 'g') <> regexp_replace(coalesce(ped.cnpj, ''), '[^0-9]', '', 'g') then
    div := div || jsonb_build_object('campo', 'destinatario', 'nf', p_dest_cnpj, 'pedido', ped.cnpj); end if;
  if not chave_valida(p_chave, '55') then div := div || jsonb_build_object('campo', 'chave', 'nf', p_chave); end if;
  update consolidacoes set status = 'nf_emitida', nf_numero = p_numero, nf_chave = p_chave, nf_xml_path = p_xml_path, danfe_path = p_danfe_path,
    peso_liquido = coalesce(peso_liquido, p_peso_l), nf_conferida = (jsonb_array_length(div) = 0), nf_divergencias = div,
    nf_coletada_em = now(), atualizado_em = now()
  where id = p_id;
  perform log_evento('consolidacao', p_id, 'nf_registrada', jsonb_build_object('divergencias', div));
  return div;
end $$;

-- Expedição pela leitura do DACTE. Se o CT-e já foi baixado da SEFAZ, completa o frete realizado na hora.
create or replace function public.registrar_expedicao(p_id bigint, p_cte_chave text) returns void
language plpgsql security definer set search_path = public as $$
declare co consolidacoes; c text := regexp_replace(coalesce(p_cte_chave, ''), '[^0-9]', '', 'g'); d documentos_fiscais;
begin
  if not is_membro() then raise exception 'Sem acesso'; end if;
  select * into co from consolidacoes where id = p_id;
  if co.status <> 'nf_emitida' then raise exception 'O pedido ainda não foi faturado'; end if;
  if not coalesce(co.nf_conferida, false) then raise exception 'NF não conferida com a volumetria: expedição bloqueada'; end if;
  if not chave_valida(c, '57') then raise exception 'Código de barras não é de um DACTE válido'; end if;
  update consolidacoes set status = 'embarcado', embarcado_em = now(), embarcado_por = auth.uid(), cte_chave = c, atualizado_em = now() where id = p_id;
  select * into d from documentos_fiscais where chave = c and tipo = 'cte';
  if found and d.dados is not null then
    update consolidacoes set cte_numero = d.dados->>'numero', cte_valor = (d.dados->>'valor')::numeric,
      cte_peso_taxado = nullif(d.dados->>'peso_taxado', '')::numeric, cte_componentes = d.dados->'componentes', cte_xml_path = d.xml_path
    where id = p_id;
  end if;
  perform log_evento('consolidacao', p_id, 'expedida', jsonb_build_object('cte_chave', c));
end $$;

create or replace function public.registrar_cte(p_id bigint, p_chave text, p_numero text, p_valor numeric, p_peso_taxado numeric,
  p_componentes jsonb, p_xml_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_membro() then raise exception 'Sem acesso'; end if;
  update consolidacoes set cte_chave = p_chave, cte_numero = p_numero, cte_valor = p_valor, cte_peso_taxado = p_peso_taxado,
    cte_componentes = p_componentes, cte_xml_path = p_xml_path, atualizado_em = now() where id = p_id;
  perform log_evento('consolidacao', p_id, 'cte_registrado', jsonb_build_object('valor', p_valor));
end $$;

-- Tira itens (ou o pedido inteiro) do fluxo do CD. Só o que ainda não chegou.
create or replace function public.excluir_do_fluxo(p_pedido bigint, p_itens bigint[], p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare alvo bigint[];
begin
  if not is_operador() then raise exception 'Somente o operador'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Motivo obrigatório'; end if;
  if exists (select 1 from consolidacoes where pedido_id = p_pedido and status in ('nf_emitida', 'embarcado', 'entregue')) then
    raise exception 'Pedido com NF emitida não pode ser excluído'; end if;
  alvo := coalesce(p_itens, array(select id from itens_pedido where pedido_id = p_pedido and no_fluxo));
  if exists (select 1 from casamentos where item_pedido_id = any(alvo) and status = 'confirmado') then
    raise exception 'Há itens já recebidos no CD; exclua só os itens que ainda não chegaram'; end if;
  update casamentos set status = 'rejeitado' where item_pedido_id = any(alvo) and status = 'sugerido';
  update itens_pedido set no_fluxo = false, motivo_exclusao = p_motivo, excluido_por = auth.uid(), excluido_em = now()
    where id = any(alvo) and pedido_id = p_pedido;
  if not exists (select 1 from itens_pedido where pedido_id = p_pedido and no_fluxo) then
    update pedidos set no_fluxo = false, motivo_exclusao = p_motivo, excluido_por = auth.uid(), excluido_em = now() where id = p_pedido;
  end if;
  perform log_evento('pedido', p_pedido, 'excluido_do_fluxo', jsonb_build_object('itens', alvo, 'motivo', p_motivo));
end $$;

create or replace function public.reincluir_no_fluxo(p_pedido bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_operador() then raise exception 'Somente o operador'; end if;
  update itens_pedido set no_fluxo = true, motivo_exclusao = null, excluido_por = null, excluido_em = null where pedido_id = p_pedido;
  update pedidos set no_fluxo = true, motivo_exclusao = null, excluido_por = null, excluido_em = null where id = p_pedido;
  perform log_evento('pedido', p_pedido, 'reincluido');
end $$;

-- O que o CD ainda vai receber, agregado por item.
create or replace function public.cd_itens_esperados() returns table (descricao text, codigo text, unidade text, qtd numeric)
language sql stable security definer set search_path = public as $$
  select v.descricao, v.codigo, v.unidade, sum(v.q_aguardando_recebimento)
  from v_itens_status v join pedidos p on p.id = v.pedido_id
  where is_membro() and p.no_fluxo and v.no_fluxo and v.q_aguardando_recebimento > 0
  group by 1, 2, 3 order by 1
$$;

-- ===========================================================================
-- 7. Integrações: credenciais e status (valores nunca voltam para a tela)
-- ===========================================================================
create or replace function public.salvar_credencial(p_chave text, p_valor text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_operador() then raise exception 'Somente o operador'; end if;
  if p_chave not in ('erp_client_id', 'erp_client_secret',
                     'transportadora_usuario', 'transportadora_senha', 'transportadora_company_id',
                     'llm_api_url', 'llm_api_key', 'llm_model', 'sefaz_gw_url', 'sefaz_gw_token') then
    raise exception 'Chave inválida'; end if;
  insert into integracoes_estado (chave, valor, atualizado_em) values ('cred:' || p_chave, to_jsonb(p_valor), now())
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
end $$;

create or replace function public.status_integracoes() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when is_operador() then jsonb_build_object(
    'credenciais', (select coalesce(jsonb_agg(replace(chave, 'cred:', '')), '[]') from integracoes_estado where chave like 'cred:%' and valor is not null and valor <> '""'::jsonb),
    'erp_conectado', exists (select 1 from integracoes_estado where chave = 'erp_tokens'),
    'erp_ultima_sync', (select valor from integracoes_estado where chave = 'erp_ultima_sync'),
    'transportadora_ultimo_rastreio', (select valor from integracoes_estado where chave = 'transportadora_ultimo_rastreio'),
    'sefaz_certificado', (select valor from integracoes_estado where chave = 'sefaz_cert_info'),
    'sefaz_cte_sync', (select valor from integracoes_estado where chave = 'sefaz_cte_sync')
  ) else null end
$$;

-- ===========================================================================
-- 8. Dados de demonstração (pedidos >= 990000)
-- ===========================================================================
create or replace function public.seed_demo() returns text
language plpgsql security definer set search_path = public as $$
declare p1 bigint; p2 bigint;
begin
  if not is_operador() then raise exception 'Somente o operador'; end if;
  if exists (select 1 from pedidos where numero >= 990000) then return 'demo já existe'; end if;
  insert into pedidos (numero, numero_oc_cliente, data_pedido, cliente, cnpj, entrega, cep_entrega, cidade, uf, total, situacao_erp)
  values (990001, 'PO-DEMO-01', current_date - 5, 'CLIENTE DEMO LOGISTICA LTDA', '45678912000155',
    '{"endereco":"Av. Demonstração","numero":"100","municipio":"São Paulo","uf":"SP","cep":"01000000"}', '01000000', 'São Paulo', 'SP', 3139.80, '0')
  returning id into p1;
  insert into pedido_marcadores values (p1, '[{"descricao":"https://loja.example.com/jogo-de-chaves-4380000"}]');
  insert into itens_pedido (pedido_id, codigo, descricao, unidade, quantidade, valor_unitario) values
    (p1, 'JCH-4380000', 'JOGO DE CHAVES COMBINADAS 4380000 12 PECAS', 'UN', 2, 520.00),
    (p1, 'FITA-352', 'FITA CREPE ALTA PERFORMANCE VERDE 48X40', 'UN', 24, 18.90),
    (p1, 'CAM-1023', 'CAMERA IP BULLET 2MP POE MOD 1023', 'UN', 3, 499.00);
  insert into pedidos (numero, numero_oc_cliente, data_pedido, cliente, cnpj, entrega, cep_entrega, cidade, uf, total, situacao_erp)
  values (990002, null, current_date - 2, 'INDUSTRIA DEMO S.A.', '78901234000105',
    '{"endereco":"Rua Exemplo","numero":"55","municipio":"Campinas","uf":"SP","cep":"13000000"}', '13000000', 'Campinas', 'SP', 1639.60, '0')
  returning id into p2;
  insert into pedido_marcadores values (p2, '[]');
  insert into itens_pedido (pedido_id, codigo, descricao, unidade, quantidade, valor_unitario) values
    (p2, 'SD-5225', 'CAMERA SPEED DOME 5225 SD IR STARLIGHT', 'UN', 1, 1639.60);
  return 'ok';
end $$;

create or replace function public.limpar_demo() returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_operador() then raise exception 'Somente o operador'; end if;
  update pedidos set no_fluxo = false, motivo_exclusao = 'demo' where numero >= 990000;
  return 'ok';
end $$;

-- ===========================================================================
-- 9. RLS
-- ===========================================================================
alter table public.casamento_memoria enable row level security;
alter table public.casamentos enable row level security;
alter table public.config enable row level security;
alter table public.consolidacao_itens enable row level security;
alter table public.consolidacoes enable row level security;
alter table public.convites enable row level security;
alter table public.cotacoes_frete enable row level security;
alter table public.documentos_fiscais enable row level security;
alter table public.enderecos enable row level security;
alter table public.eventos enable row level security;
alter table public.integracoes_estado enable row level security;  -- sem policy de propósito
alter table public.itens_pedido enable row level security;
alter table public.itens_recebidos enable row level security;
alter table public.ocorrencias enable row level security;
alter table public.pedido_marcadores enable row level security;
alter table public.pedidos enable row level security;
alter table public.perfis enable row level security;
alter table public.rastreios enable row level security;
alter table public.recebimentos enable row level security;
alter table public.volumes enable row level security;

-- Operador: tudo nas tabelas de pedido/casamento/consolidação. CD: leitura do que foi liberado, escrita no que é do armazém.
create policy perfis_operador on public.perfis for all using (is_operador()) with check (is_operador());
create policy perfis_le on public.perfis for select using (user_id = auth.uid() or is_operador());
create policy convites_operador on public.convites for all using (is_operador()) with check (is_operador());
create policy config_operador on public.config for all using (is_operador()) with check (is_operador());
create policy config_le on public.config for select using (is_membro());

create policy pedidos_operador on public.pedidos for all using (is_operador()) with check (is_operador());
create policy pedidos_cd on public.pedidos for select using (is_cd() and pedido_liberado_cd(id));
create policy marcadores_operador on public.pedido_marcadores for all using (is_operador()) with check (is_operador());
create policy itens_pedido_operador on public.itens_pedido for all using (is_operador()) with check (is_operador());
create policy itens_pedido_cd on public.itens_pedido for select using (is_cd() and pedido_liberado_cd(pedido_id));

create policy enderecos_rw on public.enderecos for all using (is_membro()) with check (is_membro());
create policy receb_rw on public.recebimentos for all using (is_membro()) with check (is_membro());
create policy itrec_rw on public.itens_recebidos for all using (is_membro()) with check (is_membro());
create policy oco_rw on public.ocorrencias for all using (is_membro()) with check (is_membro());

create policy cas_operador on public.casamentos for all using (is_operador()) with check (is_operador());
create policy cas_cd on public.casamentos for select using (is_cd() and status = 'confirmado');
create policy mem_operador on public.casamento_memoria for all using (is_operador()) with check (is_operador());

create policy cons_operador on public.consolidacoes for all using (is_operador()) with check (is_operador());
create policy cons_cd_le on public.consolidacoes for select using (is_cd());
create policy consit_operador on public.consolidacao_itens for all using (is_operador()) with check (is_operador());
create policy consit_cd on public.consolidacao_itens for select using (is_cd());
create policy vol_rw on public.volumes for all using (is_membro()) with check (is_membro());
create policy cot_le on public.cotacoes_frete for select using (is_membro());
create policy ras_le on public.rastreios for select using (is_membro());
create policy docfis_operador_le on public.documentos_fiscais for select using (is_operador());

create policy ev_ins on public.eventos for insert with check (is_membro());
create policy ev_le on public.eventos for select using (is_operador());

-- ===========================================================================
-- 10. Grants
-- Policies só valem para quem tem grant na tabela: anon não tem nada; authenticated tem o
-- necessário e o RLS decide linha a linha; service_role (edge functions) passa por cima do RLS.
-- ===========================================================================
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;

grant usage on schema public to authenticated, service_role;
grant select, insert, update on all tables in schema public to authenticated;
revoke all on public.integracoes_estado from authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
-- Só funções chamadas por trigger não precisam de execute direto.
revoke execute on function public.convite_aplicar() from authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ===========================================================================
-- 11. Storage (só no Supabase)
-- ===========================================================================
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('documentos', 'documentos', false), ('fotos', 'fotos', false)
    on conflict (id) do nothing;
    execute $p$create policy crossdock_storage_ins on storage.objects for insert to authenticated
      with check (bucket_id in ('fotos', 'documentos') and public.is_membro())$p$;
    execute $p$create policy crossdock_storage_le on storage.objects for select to authenticated
      using (bucket_id in ('fotos', 'documentos') and public.is_membro())$p$;
  end if;
end $$;

-- ===========================================================================
-- 12. Agendamentos (pg_cron + pg_net). URL do projeto e segredo do cron vêm do Vault:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<mesmo valor de CRON_SECRET das edge functions>', 'cron_secret');
-- As edge functions aceitam a chamada pelo cabeçalho x-cron-secret (sem usuário logado).
-- ===========================================================================
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('crossdock-erp-sync', '*/15 10-23 * * 1-6', $j$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/erp-sync',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 120000)
    $j$);
    perform cron.schedule('crossdock-transportadora-rastreio', '0 */2 * * *', $j$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/transportadora',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        body := '{"acao":"rastrear"}'::jsonb, timeout_milliseconds := 120000)
    $j$);
    perform cron.schedule('crossdock-sefaz-cte', '17 * * * *', $j$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/sefaz',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        body := '{"acao":"cte_sync"}'::jsonb, timeout_milliseconds := 120000)
    $j$);
  else
    raise notice 'pg_cron/pg_net ausentes: agendamentos pulados';
  end if;
end $$;
