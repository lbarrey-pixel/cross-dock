import { useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { funcao, sb } from '../../lib/supabase'
import { proximoPasso, type Resumo } from '../../lib/status'
import { brl, data } from '../../lib/fmt'
import { BarraStatus, Carregando, Erro, Legenda, Titulo, Vazio, useAcao, useCarregar } from '../../components/ui'
import PedidoDetalhe from './PedidoDetalhe'

type Filtro = 'todos' | 'casar' | 'consolidar' | 'nf' | 'atraso'

export default function Painel() {
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState<number | null>(null)
  const { ocupado, rodar } = useAcao()

  const { dados, erro, carregando, recarregar } = useCarregar(async () => {
    const [res, sug, cons, atr] = await Promise.all([
      sb.from('v_pedidos_resumo').select('*').eq('no_fluxo', true).order('numero', { ascending: false }),
      sb.from('casamentos').select('id, itens_pedido!inner(pedido_id)').eq('status', 'sugerido'),
      sb.from('consolidacoes').select('pedido_id').eq('status', 'consolidado'),
      sb.from('consolidacoes').select('pedido_id').eq('status', 'embarcado').lt('previsao_entrega', new Date().toISOString().slice(0, 10)),
    ])
    if (res.error) throw new Error(res.error.message)
    return {
      pedidos: (res.data ?? []) as Resumo[],
      casar: new Set((sug.data ?? []).map((s: any) => s.itens_pedido.pedido_id as number)),
      nCasar: sug.data?.length ?? 0,
      nf: new Set((cons.data ?? []).map((c: any) => c.pedido_id as number)),
      atraso: new Set((atr.data ?? []).map((c: any) => c.pedido_id as number)),
    }
  })

  const ativos = useMemo(() => (dados?.pedidos ?? []).filter((p) => p.q_entregue < p.q_total || p.q_total === 0), [dados])
  const prontos = useMemo(() => ativos.filter((p) => p.q_disponivel > 0 && p.q_aguardando_recebimento === 0 && Number(p.q_aguardando_casamento ?? 0) === 0), [ativos])
  const lista = useMemo(() => {
    let l = ativos
    if (filtro === 'casar') l = l.filter((p) => dados!.casar.has(p.id))
    if (filtro === 'consolidar') l = prontos
    if (filtro === 'nf') l = l.filter((p) => dados!.nf.has(p.id))
    if (filtro === 'atraso') l = l.filter((p) => dados!.atraso.has(p.id))
    const b = busca.trim().toLowerCase()
    if (b) l = l.filter((p) => `${p.numero} ${p.cliente} ${p.numero_oc_cliente ?? ''} ${p.cidade}`.toLowerCase().includes(b))
    const peso = (p: Resumo) => { const t = proximoPasso(p).tom; return t === 'alerta' ? 0 : t === 'acao' ? 1 : 2 }
    return [...l].sort((a, b) => peso(a) - peso(b) || b.dias - a.dias)
  }, [ativos, prontos, filtro, busca, dados])

  const tiles: [Filtro, number, string, string][] = dados ? [
    ['casar', dados.nCasar, 'Casamentos', 'a validar'],
    ['consolidar', prontos.length, 'Pedidos prontos', 'para ordem de consolidação'],
    ['nf', dados.nf.size, 'Consolidados', 'a faturar'],
    ['atraso', dados.atraso.size, 'Expedições', 'com atraso'],
  ] : []

  return (
    <>
      <Titulo sub={`${ativos.length} pedidos em andamento`}
        acoes={<button className="btn" disabled={ocupado} onClick={() => rodar(async () => {
          const r = await funcao('erp-sync'); if (!r.ok) throw new Error(r.erro); await recarregar()
        }, 'Sincronização com o ERP concluída')}><RefreshCw size={16} className={ocupado ? 'animate-spin' : ''} />Sincronizar ERP</button>}>
        Painel
      </Titulo>
      {erro && <Erro msg={erro} />}
      {carregando && !dados ? <Carregando /> : dados && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {tiles.map(([f, n, a, b]) => (
              <button key={f} onClick={() => setFiltro(filtro === f ? 'todos' : f)}
                className={`card text-left p-4 transition ${filtro === f ? 'ring-2 ring-azul border-azul' : 'hover:border-[#c5ccd8]'}`}>
                <div className="num text-3xl font-semibold">{n}</div>
                <div className="text-sm text-tinta2 mt-1 leading-snug">{a}<br />{b}</div>
              </button>
            ))}
          </div>
          <div className="card">
            <div className="flex flex-wrap items-center gap-3 justify-between p-4 border-b border-linha">
              <Legenda />
              <label className="relative w-full sm:w-72">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-tinta3" />
                <input className="campo !pl-9" placeholder="Pedido, cliente, OC, cidade" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </label>
            </div>
            {lista.length === 0 ? <Vazio>{filtro === 'todos' ? 'Nenhum pedido no fluxo ainda. Defina o número de corte e conecte o ERP em Configurações.' : 'Nada aqui agora.'}</Vazio> : (
              <ul>
                {lista.map((p) => {
                  const passo = proximoPasso(p)
                  const recebidos = p.q_total - p.q_aguardando_recebimento
                  return (
                    <li key={p.id}>
                      <button onClick={() => setAberto(p.id)} className="w-full text-left grid md:grid-cols-[minmax(220px,1.2fr)_minmax(240px,1.5fr)_200px] gap-x-6 gap-y-2 items-center px-4 py-4 border-b border-linha last:border-0 hover:bg-fundo/60">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">#{p.numero} · {p.cliente}</div>
                          <div className="text-sm text-tinta2 truncate">{p.cidade}/{p.uf} · {p.dias} dias{p.numero_oc_cliente ? ` · OC ${p.numero_oc_cliente}` : ''}</div>
                        </div>
                        <div>
                          <BarraStatus q={p as any} />
                          <div className="text-xs text-tinta2 mt-1.5 num">{recebidos.toLocaleString('pt-BR')} de {Number(p.q_total).toLocaleString('pt-BR')} un. recebidas · {p.itens} itens · {brl(p.total)}</div>
                        </div>
                        <div className="md:text-right">
                          <span className={`inline-block rounded-full px-3 py-1.5 text-sm font-medium border ${
                            passo.tom === 'acao' ? 'bg-azul-50 border-azul text-azul' : passo.tom === 'alerta' ? 'bg-ambar-50 border-ambar text-ambar' : passo.tom === 'ok' ? 'bg-verde-50 border-verde text-verde' : 'border-linha text-tinta2'}`}>
                            {passo.texto}
                          </span>
                          {dados.casar.has(p.id) && <div className="text-xs text-azul mt-1">casamento a validar</div>}
                          {dados.atraso.has(p.id) && <div className="text-xs text-rose mt-1">passou da previsão</div>}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <p className="text-xs text-tinta3 mt-3">Pedidos entregues saem da lista. Pedido desde {data(ativos.at(-1)?.data_pedido)}.</p>
        </>
      )}
      {aberto && <PedidoDetalhe id={aberto} onFechar={() => { setAberto(null); recarregar() }} />}
    </>
  )
}
