import { useState } from 'react'
import { ArrowLeft, Check, Plus, Trash2 } from 'lucide-react'
import { funcao, rpc, sb } from '../../lib/supabase'
import { dataHora, num } from '../../lib/fmt'
import { Badge, Carregando, Foto, FotosInput, Vazio, useAcao, useAvisoSaida, useCarregar } from '../../components/ui'
import { BotaoMedirAR } from '../../components/MedidorAR'

export default function Separacao() {
  const [aberta, setAberta] = useState<number | null>(null)
  const { dados, recarregar } = useCarregar(async () => {
    const { data } = await sb.from('consolidacoes').select('*, pedidos(numero, cliente, cidade, uf), consolidacao_itens(id, separado)')
      .eq('status', 'aguardando_consolidacao').order('solicitado_em')
    return data ?? []
  })
  if (aberta) return <Detalhe id={aberta} voltar={() => { setAberta(null); recarregar() }} />
  if (!dados) return <Carregando />
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Separação e embalagem</h1>
      {dados.length === 0 ? <Vazio>Nenhuma ordem de consolidação do operador.</Vazio> : dados.map((c: any) => {
        const sep = c.consolidacao_itens.filter((i: any) => i.separado).length
        return (
          <button key={c.id} onClick={() => setAberta(c.id)} className="card p-4 w-full text-left">
            <div className="flex justify-between gap-2"><span className="font-semibold">Pedido #{c.pedidos?.numero}</span><Badge tom={c.tipo === 'parcial' ? 'ambar' : 'azul'}>{c.tipo}</Badge></div>
            <div className="text-sm text-tinta2">{c.pedidos?.cliente} · {c.pedidos?.cidade}/{c.pedidos?.uf}</div>
            <div className="text-xs text-tinta3 mt-1">{sep} de {c.consolidacao_itens.length} itens separados · ordem de {dataHora(c.solicitado_em)}</div>
          </button>
        )
      })}
    </div>
  )
}

type Vol = { c: string; l: string; a: string; peso: string; foto: string[] }

function Detalhe({ id, voltar }: { id: number; voltar: () => void }) {
  const { ocupado, rodar } = useAcao()
  const [vols, setVols] = useState<Vol[]>([{ c: '', l: '', a: '', peso: '', foto: [] }])
  const [pesoL, setPesoL] = useState('')
  useAvisoSaida(vols.some((v) => v.c || v.l || v.a || v.peso || v.foto.length))
  const { dados, recarregar } = useCarregar(async () => {
    const { data, error } = await sb.from('consolidacoes').select(`*, pedidos(numero, cliente, cidade, uf),
      consolidacao_itens(id, qtd, separado, casamentos(itens_pedido(descricao, unidade), itens_recebidos(descricao, fotos, unidade, enderecos(codigo))))`).eq('id', id).single()
    if (error) throw new Error(error.message)
    return data
  }, [id])
  if (!dados) return <Carregando />
  const itens = [...dados.consolidacao_itens].sort((a: any, b: any) =>
    String(a.casamentos?.itens_recebidos?.enderecos?.codigo ?? 'ZZ').localeCompare(String(b.casamentos?.itens_recebidos?.enderecos?.codigo ?? 'ZZ')))
  const todos = itens.every((i: any) => i.separado)
  const updV = (i: number, p: Partial<Vol>) => setVols(vols.map((v, j) => (j === i ? { ...v, ...p } : v)))
  const nb = (s: string) => Number(String(s).replace(',', '.'))
  const valido = vols.every((v) => nb(v.c) > 0 && nb(v.l) > 0 && nb(v.a) > 0 && nb(v.peso) > 0)
  return (
    <div className="space-y-4">
      <button className="text-azul text-sm inline-flex items-center gap-1" onClick={voltar}><ArrowLeft size={16} />Voltar</button>
      <div>
        <h1 className="text-xl font-semibold">Pedido #{dados.pedidos?.numero}</h1>
        <div className="text-sm text-tinta2">{dados.pedidos?.cliente} · {dados.pedidos?.cidade}/{dados.pedidos?.uf} · {dados.tipo}{dados.motivo_parcial ? ` (${dados.motivo_parcial})` : ''}</div>
      </div>
      <div className="card divide-y divide-linha">
        {itens.map((i: any) => {
          const r = i.casamentos?.itens_recebidos
          return (
            <button key={i.id} disabled={ocupado} onClick={() => rodar(async () => { await rpc('marcar_separado', { p_item: i.id, p_sep: !i.separado }); recarregar() })}
              className={`w-full text-left p-4 flex gap-3 items-center ${i.separado ? 'bg-verde-50/60' : ''}`}>
              <div className={`w-7 h-7 rounded-full border-2 grid place-items-center shrink-0 ${i.separado ? 'bg-verde border-verde text-white' : 'border-linha'}`}>{i.separado && <Check size={16} />}</div>
              {r?.fotos?.[0] && <Foto caminho={r.fotos[0]} className="w-12 h-12" />}
              <div className="flex-1 min-w-0 text-sm"><div className="font-medium">{r?.descricao}</div><div className="text-xs text-tinta3">{i.casamentos?.itens_pedido?.descricao}</div></div>
              <div className="text-right"><div className="num font-semibold text-lg">{r?.enderecos?.codigo ?? '–'}</div><div className="num text-sm">{num(i.qtd, 2)} {r?.unidade}</div></div>
            </button>
          )
        })}
      </div>

      {todos && (
        <div className="space-y-3">
          <h2 className="font-semibold">Volumetria</h2>
          {vols.map((v, i) => (
            <div key={i} className="card p-4 space-y-3">
              <div className="flex justify-between items-center"><span className="font-medium">Volume {i + 1}</span>{vols.length > 1 && <button className="btn !p-2" onClick={() => setVols(vols.filter((_, j) => j !== i))}><Trash2 size={16} /></button>}</div>
              <div className="grid grid-cols-4 gap-2">
                {(['c', 'l', 'a'] as const).map((k) => <div key={k}><label className="rotulo">{k === 'c' ? 'Compr.' : k === 'l' ? 'Larg.' : 'Alt.'} cm</label><input className="campo num" inputMode="decimal" value={v[k]} onChange={(e) => updV(i, { [k]: e.target.value })} /></div>)}
                <div><label className="rotulo">Peso kg</label><input className="campo num" inputMode="decimal" value={v.peso} onChange={(e) => updV(i, { peso: e.target.value })} /></div>
              </div>
              <BotaoMedirAR onMedido={(m) => updV(i, { c: String(m.c), l: String(m.l), a: String(m.a) })} />
              <FotosInput valor={v.foto} onChange={(f) => updV(i, { foto: f })} pasta="volumes" rotulo="Volume" />
            </div>
          ))}
          <button className="btn w-full" onClick={() => setVols([...vols, { c: '', l: '', a: '', peso: '', foto: [] }])}><Plus size={16} />Adicionar volume</button>
          <div><label className="rotulo">Peso líquido total (kg, opcional)</label><input className="campo num" inputMode="decimal" value={pesoL} onChange={(e) => setPesoL(e.target.value)} /></div>
          <div className="text-sm text-tinta2">{vols.length} volume(s) · {num(vols.reduce((s, v) => s + Number(v.peso.replace(',', '.') || 0), 0), 2)} kg</div>
          <button className="btn btn-primario btn-grande w-full" disabled={ocupado || !valido} onClick={() => rodar(async () => {
            const n = (s: string) => Number(s.replace(',', '.'))
            await rpc('informar_volumetria', { p_id: id, p_volumes: vols.map((v) => ({ c: n(v.c), l: n(v.l), a: n(v.a), peso: n(v.peso), foto: v.foto[0] ?? null })), p_peso_liquido: pesoL ? n(pesoL) : null })
            funcao('transportadora', { acao: 'cotar', consolidacao_id: id }).catch(() => {})
            voltar()
          }, 'Pedido consolidado. O operador já pode faturar.')}>Concluir consolidação</button>
        </div>
      )}
    </div>
  )
}
