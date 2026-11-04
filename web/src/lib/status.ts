// Os 8 status do item do pedido, na ordem do fluxo.
export const ESTAGIOS = [
  { chave: 'q_aguardando_recebimento', nome: 'Aguardando recebimento', curto: 'Aguard. receb.', cor: '#D5DBE4' },
  { chave: 'q_aguardando_casamento', nome: 'Aguardando casamento', curto: 'Aguard. casamento', cor: '#F3C98B' },
  { chave: 'q_disponivel', nome: 'Disponível', curto: 'Disponível', cor: '#B9D3FB' },
  { chave: 'q_aguardando_consolidacao', nome: 'Em consolidação', curto: 'Em consolid.', cor: '#8AB6F8' },
  { chave: 'q_consolidado', nome: 'Consolidado', curto: 'Consolidado', cor: '#5B9BFF' },
  { chave: 'q_nf_emitida', nome: 'Faturado', curto: 'Faturado', cor: '#2F7BEF' },
  { chave: 'q_embarcado', nome: 'Expedido', curto: 'Expedido', cor: '#1659C6' },
  { chave: 'q_entregue', nome: 'Entregue', curto: 'Entregue', cor: '#3F8F24' },
] as const

// Códigos internos da consolidação → nomes do fluxo.
export const STATUS_CONSOLIDACAO: Record<string, { nome: string; cor: string }> = {
  aguardando_consolidacao: { nome: 'Em consolidação', cor: 'bg-azul-50 text-azul' },
  consolidado: { nome: 'Consolidado', cor: 'bg-azul-50 text-azul' },
  nf_emitida: { nome: 'Faturado', cor: 'bg-azul-50 text-azul' },
  embarcado: { nome: 'Expedido', cor: 'bg-azul-50 text-azul' },
  entregue: { nome: 'Entregue', cor: 'bg-verde-50 text-verde' },
  cancelada: { nome: 'Cancelada', cor: 'bg-fundo text-tinta3' },
}

export type Resumo = {
  id: number; numero: number; numero_oc_cliente: string | null; cliente: string; cnpj: string; cidade: string; uf: string
  total: number; data_pedido: string; no_fluxo: boolean; itens: number; q_total: number; dias: number
  q_aguardando_recebimento: number; q_aguardando_casamento: number; q_disponivel: number; q_aguardando_consolidacao: number; q_consolidado: number
  q_nf_emitida: number; q_embarcado: number; q_entregue: number
}

// Próximo passo de um pedido.
export function proximoPasso(r: Resumo): { texto: string; tom: 'acao' | 'alerta' | 'neutro' | 'ok' } {
  const faltam = Number(r.q_aguardando_recebimento) + Number(r.q_aguardando_casamento ?? 0)
  if (r.q_total === 0) return { texto: 'Sem itens no fluxo', tom: 'neutro' }
  if (r.q_entregue === r.q_total) return { texto: 'Entregue', tom: 'ok' }
  if (r.q_consolidado > 0) return { texto: 'Faturar no ERP', tom: 'alerta' }
  if (r.q_aguardando_casamento > 0) return { texto: 'Validar casamento', tom: 'acao' }
  if (r.q_disponivel > 0 && faltam === 0) return { texto: 'Ordem de consolidação', tom: 'acao' }
  if (r.q_aguardando_consolidacao > 0) return { texto: 'CD separando e embalando', tom: 'neutro' }
  if (r.q_nf_emitida > 0) return { texto: 'Aguardando expedição', tom: 'neutro' }
  if (r.q_embarcado > 0) return { texto: 'Em trânsito', tom: 'neutro' }
  if (r.q_disponivel > 0) return { texto: `Consolidação parcial possível · faltam ${fmtQ(faltam)}`, tom: 'neutro' }
  return { texto: `Aguardando ${fmtQ(r.q_aguardando_recebimento)} un.`, tom: 'neutro' }
}
const fmtQ = (n: number) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
