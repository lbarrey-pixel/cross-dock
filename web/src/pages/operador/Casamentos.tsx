import { useState } from 'react'
import { ArrowRight, Check, Sparkles, X } from 'lucide-react'
import { funcao, rpc, sb } from '../../lib/supabase'
import { brl, cnpj, num } from '../../lib/fmt'
import { Badge, Carregando, Erro, Foto, Titulo, Vazio, useAcao, useCarregar } from '../../components/ui'

const ORDEM = { baixa: 0, media: 1, alta: 2 } as Record<string, number>

export default function Casamentos() {
  const { ocupado, rodar } = useAcao()
  const { dados, erro, carregando, recarregar } = useCarregar(async () => {
    const { data, error } = await sb.from('casamentos')
      .select('*, itens_pedido(descricao, codigo, unidade, valor_unitario, quantidade, pedidos(numero, cliente))')
      .eq('status', 'sugerido')
    if (error) throw new Error(error.message)
    const ids = (data ?? []).map((c: any) => c.item_recebido_id)
    const { data: rec } = ids.length ? await sb.from('v_itens_recebidos_saldo').select('*').in('id', ids) : { data: [] }
    const m = new Map((rec ?? []).map((r: any) => [r.id, r]))
    return (data ?? []).map((c: any) => ({ ...c, r: m.get(c.item_recebido_id) }))
      .sort((a: any, b: any) => (ORDEM[a.confianca] ?? 0) - (ORDEM[b.confianca] ?? 0))
  })
  const [qtd, setQtd] = useState<Record<number, number>>({})

  return (
    <>
      <Titulo sub="Item que chegou no CD × item do pedido de venda. As de confiança baixa aparecem primeiro."
        acoes={<button className="btn" disabled={ocupado} onClick={() => rodar(async () => {
          const r = await funcao('casamento-sugerir'); recarregar(); return r
        }, 'Sugestões atualizadas')}><Sparkles size={16} />Buscar sugestões</button>}>
        Casamentos a validar
      </Titulo>
      {erro && <Erro msg={erro} />}
      {carregando && !dados ? <Carregando /> : !dados?.length ? <Vazio>Nenhum casamento esperando confirmação.</Vazio> : (
        <div className="space-y-3">
          {dados.map((c: any) => (
            <div key={c.id} className="card p-4">
              <div className="grid lg:grid-cols-[1fr_auto_1fr] gap-4 items-start">
                <div className="flex gap-3 min-w-0">
                  {c.r?.fotos?.[0] && <Foto caminho={c.r.fotos[0]} className="w-16 h-16" />}
                  <div className="min-w-0 text-sm">
                    <div className="text-xs text-tinta3 mb-0.5">Chegou no CD</div>
                    <div className="font-medium">{c.r?.descricao}</div>
                    <div className="text-xs text-tinta2 mt-1">{c.r?.emitente_nome} · {cnpj(c.r?.emitente_cnpj)} · NF {c.r?.nf_numero ?? '–'}</div>
                    <div className="text-xs text-tinta2">cód. {c.r?.codigo_fornecedor ?? '–'} · NCM {c.r?.ncm ?? '–'} · {num(c.r?.qtd_sem_dono, 2)} {c.r?.unidade} sem dono · custo {brl(c.r?.valor_unitario)} · {c.r?.endereco_codigo ?? 'sem endereço'}</div>
                  </div>
                </div>
                <ArrowRight className="hidden lg:block text-tinta3 mt-6" />
                <div className="text-sm min-w-0">
                  <div className="text-xs text-tinta3 mb-0.5">Pedido #{c.itens_pedido?.pedidos?.numero} · {c.itens_pedido?.pedidos?.cliente}</div>
                  <div className="font-medium">{c.itens_pedido?.descricao}</div>
                  <div className="text-xs text-tinta2 mt-1">cód. {c.itens_pedido?.codigo ?? '–'} · pedido {num(c.itens_pedido?.quantidade, 2)} {c.itens_pedido?.unidade} · venda {brl(c.itens_pedido?.valor_unitario)}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-linha">
                <Badge tom={c.confianca === 'alta' ? 'verde' : c.confianca === 'media' ? 'azul' : 'ambar'}>confiança {c.confianca}</Badge>
                <span className="text-xs text-tinta2 flex-1 min-w-[200px]">{c.origem === 'ia' ? '' : 'Regra: '}{c.motivo}</span>
                <label className="text-sm flex items-center gap-2">Qtd
                  <input type="number" step="any" className="campo !w-24 text-right" value={qtd[c.id] ?? c.qtd} onChange={(e) => setQtd({ ...qtd, [c.id]: Number(e.target.value) })} />
                </label>
                <button className="btn btn-perigo" disabled={ocupado} onClick={() => rodar(async () => { await rpc('rejeitar_casamento', { p_id: c.id }); recarregar() }, 'Sugestão rejeitada; o item fica sem dono')}><X size={16} />Não é este</button>
                <button className="btn btn-primario" disabled={ocupado} onClick={() => rodar(async () => { await rpc('confirmar_casamento', { p_id: c.id, p_qtd: qtd[c.id] ?? null }); recarregar() }, 'Casamento validado')}><Check size={16} />Validar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
