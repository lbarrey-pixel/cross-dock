import { useState } from 'react'
import { rpc, sb } from '../../lib/supabase'
import { brl, cnpj, data, num } from '../../lib/fmt'
import { Badge, Carregando, Erro, Foto, Painel, Titulo, Vazio, useAcao, useCarregar } from '../../components/ui'

export default function SemDono() {
  const [alvo, setAlvo] = useState<any | null>(null)
  const { dados, erro, carregando, recarregar } = useCarregar(async () => {
    const { data, error } = await sb.from('v_itens_recebidos_saldo').select('*').gt('qtd_sem_dono', 0).order('recebido_em', { ascending: false })
    if (error) throw new Error(error.message)
    return data ?? []
  })
  return (
    <>
      <Titulo sub="Recebido no CD e ainda sem pedido de venda. Case manualmente ou aguarde a sugestão da IA.">Itens sem pedido</Titulo>
      {erro && <Erro msg={erro} />}
      {carregando && !dados ? <Carregando /> : !dados?.length ? <Vazio>Tudo que está no CD tem dono.</Vazio> : (
        <div className="card overflow-x-auto">
          <table className="tabela">
            <thead><tr><th></th><th>Item recebido</th><th>Fornecedor / NF</th><th className="text-right">Sem pedido</th><th>Local</th><th></th></tr></thead>
            <tbody>
              {dados.map((r: any) => (
                <tr key={r.id}>
                  <td className="w-16">{r.fotos?.[0] && <Foto caminho={r.fotos[0]} />}</td>
                  <td><div>{r.descricao}</div><div className="text-xs text-tinta3">cód. {r.codigo_fornecedor ?? '–'} · NCM {r.ncm ?? '–'} · custo {brl(r.valor_unitario)}</div>
                    <div className="flex gap-1 mt-1">{r.bloqueado && <Badge tom="rose">bloqueado: {r.motivo_bloqueio}</Badge>}{r.tem_sugestao && <Badge tom="azul">tem sugestão</Badge>}</div></td>
                  <td className="text-sm"><div>{r.emitente_nome}</div><div className="text-xs text-tinta3">{cnpj(r.emitente_cnpj)} · NF {r.nf_numero ?? 'sem NF'} · {data(r.recebido_em)}</div></td>
                  <td className="text-right num">{num(r.qtd_sem_dono, 2)} {r.unidade}</td>
                  <td className="num">{r.endereco_codigo ?? '–'}</td>
                  <td><button className="btn" disabled={r.bloqueado} onClick={() => setAlvo(r)}>Atribuir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {alvo && <Atribuir r={alvo} onFechar={() => { setAlvo(null); recarregar() }} />}
    </>
  )
}

function Atribuir({ r, onFechar }: { r: any; onFechar: () => void }) {
  const [busca, setBusca] = useState('')
  const [escolhido, setEscolhido] = useState<any | null>(null)
  const [qtd, setQtd] = useState<number>(Number(r.qtd_sem_dono))
  const { ocupado, rodar } = useAcao()
  const { dados } = useCarregar(async () => {
    const { data } = await sb.from('v_itens_status').select('*, pedidos(numero, cliente, no_fluxo)').or('q_aguardando_recebimento.gt.0,q_aguardando_casamento.gt.0').eq('no_fluxo', true)
    return (data ?? []).filter((i: any) => i.pedidos?.no_fluxo)
  })
  const b = busca.toLowerCase()
  const lista = (dados ?? []).filter((i: any) => !b || `${i.pedidos.numero} ${i.pedidos.cliente} ${i.descricao} ${i.codigo}`.toLowerCase().includes(b)).slice(0, 50)
  return (
    <Painel titulo="Atribuir a um pedido" onFechar={onFechar}>
      <div className="text-sm mb-4"><b>{r.descricao}</b><div className="text-tinta2">{num(r.qtd_sem_dono, 2)} {r.unidade} sem pedido · {r.emitente_nome}</div></div>
      <input className="campo mb-3" placeholder="Buscar pedido, cliente ou item" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
      <div className="card divide-y divide-linha max-h-[50vh] overflow-y-auto">
        {lista.map((i: any) => (
          <button key={i.item_pedido_id} onClick={() => { setEscolhido(i); setQtd(Math.min(Number(r.qtd_sem_dono), Number(i.q_aguardando_recebimento) + Number(i.q_aguardando_casamento ?? 0))) }}
            className={`w-full text-left p-3 text-sm ${escolhido?.item_pedido_id === i.item_pedido_id ? 'bg-azul-50' : 'hover:bg-fundo'}`}>
            <div className="font-medium">{i.descricao}</div>
            <div className="text-xs text-tinta2">#{i.pedidos.numero} · {i.pedidos.cliente} · aguardando {num(Number(i.q_aguardando_recebimento) + Number(i.q_aguardando_casamento ?? 0), 2)} {i.unidade} · venda {brl(i.valor_unitario)}</div>
          </button>
        ))}
        {!lista.length && <div className="p-4 text-sm text-tinta3">Nenhum item de pedido aguardando recebimento.</div>}
      </div>
      {escolhido && (
        <div className="flex items-end gap-3 mt-4">
          <div><label className="rotulo">Quantidade</label><input type="number" step="any" className="campo !w-32" value={qtd} onChange={(e) => setQtd(Number(e.target.value))} /></div>
          <button className="btn btn-primario" disabled={ocupado || qtd <= 0} onClick={() => rodar(async () => {
            await rpc('casar_manual', { p_item_recebido: r.id, p_item_pedido: escolhido.item_pedido_id, p_qtd: qtd }); onFechar()
          }, 'Item atribuído ao pedido')}>Casar com #{escolhido.pedidos.numero}</button>
        </div>
      )}
    </Painel>
  )
}
