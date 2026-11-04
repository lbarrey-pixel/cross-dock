-- Confere as policies e as RPCs com os dois papéis do seed. Falha (exit != 0) se algo não bater.
\set ON_ERROR_STOP 1

do $$ begin
  assert chave_valida('35260111122233000183550010000000011000000017', '55'), 'chave de NF-e válida rejeitada';
  assert not chave_valida('35260111122233000183550010000000011000000018', '55'), 'DV errado aceito';
  assert not chave_valida('35260111122233000183550010000000011000000017', '57'), 'modelo errado aceito';
  assert chave_valida('35260199988877000108570010000001231000001238', '57'), 'chave de CT-e válida rejeitada';
end $$;

set role authenticated;

-- Operador: vê pedidos, confirma casamentos, abre consolidação.
set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$ begin
  assert is_operador(), 'papel do operador não reconhecido';
  assert (select count(*) from pedidos) = 2, 'operador deveria ver os 2 pedidos da demo';
  assert (select count(*) from v_pedidos_resumo where no_fluxo) = 2, 'resumo não enxerga os pedidos';
  assert (select count(*) from integracoes_estado) = 0 or false, 'integracoes_estado não deveria ser legível';
exception when insufficient_privilege then
  null; -- esperado: integracoes_estado não tem grant para authenticated
end $$;

-- Simula a chegada de uma NF com 2 unidades do primeiro item do pedido 990001.
insert into recebimentos (id, emitente_cnpj, emitente_nome, nf_numero, nf_chave, status)
values (1, '11122233000183', 'FORNECEDOR DEMO LTDA', '1', '35260111122233000183550010000000011000000017', 'conferido');
insert into itens_recebidos (id, recebimento_id, n_item, codigo_fornecedor, descricao, qtd_nf, qtd_conferida, valor_unitario)
values (1, 1, 1, '4380000', 'JOGO CHAVES COMBINADAS 4380000', 2, 2, 300);
insert into casamentos (id, item_recebido_id, item_pedido_id, qtd, origem, confianca, motivo)
select 1, 1, ip.id, 2, 'regra', 'alta', 'teste' from itens_pedido ip where ip.codigo = 'JCH-4380000';
select confirmar_casamento(1);
do $$ begin
  assert (select status from casamentos where id = 1) = 'confirmado', 'casamento não confirmou';
  assert (select q_disponivel from v_itens_status where item_pedido_id = (select item_pedido_id from casamentos where id = 1)) = 2, 'q_disponivel errado';
  assert (select count(*) from casamento_memoria) = 1, 'memória não gravada';
end $$;

-- Antes da consolidação o CD não enxerga o pedido.
set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$ begin
  assert is_cd(), 'papel do CD não reconhecido';
  assert (select count(*) from pedidos) = 0, 'CD viu pedido sem consolidação';
  assert (select count(*) from casamentos) = 1, 'CD deveria ver o casamento confirmado';
  assert (select count(*) from itens_recebidos) = 1, 'CD deveria ver o item recebido';
  begin
    perform criar_consolidacao((select id from pedidos where numero = 990001), 'total', null, '[{"casamento_id":1,"qtd":2}]');
    raise exception 'CD conseguiu criar consolidação';
  exception when raise_exception then
    if sqlerrm not like 'Somente o operador%' then raise; end if;
  end;
  begin
    perform seed_demo();
    raise exception 'CD conseguiu chamar seed_demo';
  exception when raise_exception then
    if sqlerrm not like 'Somente o operador%' then raise; end if;
  end;
  begin
    insert into pedidos (numero, cliente) values (1, 'intruso');
    raise exception 'CD conseguiu inserir pedido';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Operador abre a consolidação; a partir daí o CD vê o pedido e separa.
set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
select criar_consolidacao((select id from pedidos where numero = 990001), 'parcial', 'teste', '[{"casamento_id":1,"qtd":2}]') as consolidacao;

set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$ declare ci bigint; co bigint; begin
  assert (select count(*) from pedidos) = 1, 'CD deveria ver o pedido liberado';
  assert (select count(*) from consolidacoes) = 1, 'CD deveria ver a consolidação';
  select id, consolidacao_id into ci, co from consolidacao_itens limit 1;
  perform marcar_separado(ci, true);
  perform informar_volumetria(co, '[{"c":40,"l":30,"a":20,"peso":3.5}]', 3.0);
  assert (select status from consolidacoes where id = co) = 'consolidado', 'volumetria não consolidou';
  assert (select cubagem_m3 from consolidacoes where id = co) = 0.024, 'cubagem errada';
  -- Sem NF conferida, não expede.
  begin
    perform registrar_expedicao(co, '35260199988877000108570010000001231000001238');
    raise exception 'expediu sem NF';
  exception when raise_exception then
    if sqlerrm not like 'O pedido ainda não foi faturado%' then raise; end if;
  end;
end $$;

-- Operador registra a NF de saída coerente com a volumetria; CD expede lendo o DACTE.
set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$ declare co bigint; div jsonb; begin
  select id into co from consolidacoes limit 1;
  div := registrar_nf_saida(co, '77', '35260111122233000183550010000000011000000017', 'nf-saida/x.xml', null, 1, 3.5, 3.0, '45678912000155');
  assert jsonb_array_length(div) = 0, 'NF coerente marcada como divergente: ' || div::text;
  assert (select nf_conferida from consolidacoes where id = co), 'nf_conferida deveria ser true';
end $$;

set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$ declare co bigint; begin
  select id into co from consolidacoes limit 1;
  perform registrar_expedicao(co, '35260199988877000108570010000001231000001238');
  assert (select status from consolidacoes where id = co) = 'embarcado', 'não expediu';
  assert (select q_embarcado from v_pedidos_resumo where numero = 990001) = 2, 'resumo não reflete o embarque';
end $$;

-- Sem perfil: nada.
set request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000ffff","role":"authenticated"}';
do $$ begin
  assert (select count(*) from pedidos) = 0, 'desconhecido viu pedidos';
  assert (select count(*) from recebimentos) = 0, 'desconhecido viu recebimentos';
  assert (select count(*) from config) = 0, 'desconhecido viu config';
end $$;

-- Anônimo não tem grant em nada.
set role anon;
reset request.jwt.claims;
do $$ begin
  begin perform count(*) from pedidos; raise exception 'anon leu pedidos';
  exception when insufficient_privilege then null; end;
  begin perform seed_demo(); raise exception 'anon executou seed_demo';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select 'RLS ok' as resultado;
