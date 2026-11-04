// Tipos escritos à mão para as linhas que as telas leem (views e consultas com embed).
// Só os campos usados; os nomes seguem as colunas de supabase/migrations/0001_schema.sql.

export type Pedido = {
  id: number; numero: number; numero_oc_cliente: string | null; data_pedido: string | null
  cliente: string | null; cnpj: string | null; cep_entrega: string | null; cidade: string | null; uf: string | null
  total: number | null; no_fluxo: boolean; motivo_exclusao: string | null
  entrega: { endereco?: string; numero?: string } | null
}

export type ItemStatus = {
  item_pedido_id: number; pedido_id: number; descricao: string; codigo: string | null; unidade: string | null
  quantidade: number; valor_unitario: number | null; no_fluxo: boolean; qtd_casada: number
  q_aguardando_recebimento: number; q_aguardando_casamento: number; q_disponivel: number
  q_aguardando_consolidacao: number; q_consolidado: number; q_nf_emitida: number; q_embarcado: number; q_entregue: number
}

export type ItemRecebidoSaldo = {
  id: number; recebimento_id: number; descricao: string; codigo_fornecedor: string | null; unidade: string | null
  qtd_nf: number; qtd_conferida: number | null; qtd_sem_dono: number; emitente_nome: string | null; nf_numero: string | null
  endereco_codigo: string | null; fotos: string[]
}

export type Casamento = {
  id: number; item_recebido_id: number; item_pedido_id: number; qtd: number
  origem: 'ia' | 'regra' | 'manual'; confianca: 'alta' | 'media' | 'baixa' | null; motivo: string | null
  status: 'sugerido' | 'confirmado' | 'rejeitado'; itens_pedido: { pedido_id: number; descricao: string }
}

export type Volume = {
  id: number; seq: number; comprimento_cm: number | null; largura_cm: number | null; altura_cm: number | null
  peso_kg: number | null; descartado: boolean
}

export type CotacaoFrete = {
  id: number; valor: number | null; prazo_dias: number | null; erro: string | null; descartada: boolean
  payload: { resposta?: unknown } | null
}
export type Rastreio = { id: number; data_evento: string | null; situacao: string | null }

export type Consolidacao = {
  id: number; pedido_id: number; tipo: 'total' | 'parcial' | 'devolucao'; motivo_parcial: string | null
  status: 'aguardando_consolidacao' | 'consolidado' | 'nf_emitida' | 'embarcado' | 'entregue' | 'cancelada'
  peso_bruto: number | null; qtd_volumes: number | null; cubagem_m3: number | null
  nf_numero: string | null; nf_chave: string | null; nf_xml_path: string | null; danfe_path: string | null
  nf_conferida: boolean | null; nf_divergencias: { campo: string }[] | null
  solicitado_em: string | null; cte_chave: string | null; cte_numero: string | null; cte_valor: number | null; previsao_entrega: string | null
  consolidacao_itens: { id: number; casamento_id: number; qtd: number; separado: boolean }[]
  volumes: Volume[]; cotacoes_frete: CotacaoFrete[]; rastreios: Rastreio[]
}

export type Marcador = string | { descricao?: string }

export type PedidoDetalheDados = {
  p: Pedido; marc: Marcador[]; itens: ItemStatus[]; cas: Casamento[]; cons: Consolidacao[]
  rec: Map<number, ItemRecebidoSaldo>
}

export type RespostaFuncao = { ok: boolean; erro?: string }
