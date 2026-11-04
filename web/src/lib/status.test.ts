import { describe, expect, it } from 'vitest'
import { proximoPasso, type Resumo } from './status'

const base: Resumo = {
  id: 1, numero: 990001, numero_oc_cliente: null, cliente: 'Cliente Demo', cnpj: '', cidade: '', uf: '', total: 0, data_pedido: '', no_fluxo: true,
  itens: 1, q_total: 4, dias: 0, q_aguardando_recebimento: 0, q_aguardando_casamento: 0, q_disponivel: 0, q_aguardando_consolidacao: 0,
  q_consolidado: 0, q_nf_emitida: 0, q_embarcado: 0, q_entregue: 0,
}

describe('proximoPasso', () => {
  it('segue a ordem do fluxo', () => {
    expect(proximoPasso({ ...base, q_aguardando_recebimento: 4 }).texto).toBe('Aguardando 4 un.')
    expect(proximoPasso({ ...base, q_aguardando_casamento: 2, q_disponivel: 2 }).texto).toBe('Validar casamento')
    expect(proximoPasso({ ...base, q_disponivel: 4 }).texto).toBe('Ordem de consolidação')
    expect(proximoPasso({ ...base, q_consolidado: 4 }).texto).toBe('Faturar no ERP')
    expect(proximoPasso({ ...base, q_nf_emitida: 4 }).texto).toBe('Aguardando expedição')
    expect(proximoPasso({ ...base, q_embarcado: 4 }).texto).toBe('Em trânsito')
    expect(proximoPasso({ ...base, q_entregue: 4 })).toEqual({ texto: 'Entregue', tom: 'ok' })
  })
  it('pedido sem itens no fluxo', () => {
    expect(proximoPasso({ ...base, q_total: 0 }).tom).toBe('neutro')
  })
})
