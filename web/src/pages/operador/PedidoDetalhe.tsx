import { useMemo, useState } from 'react'
import { ExternalLink, FileText, PackagePlus, RotateCcw, Trash2, Upload } from 'lucide-react'
import { enviarArquivo, funcao, rpc, sb } from '../../lib/supabase'
import { ESTAGIOS, STATUS_CONSOLIDACAO } from '../../lib/status'
import { brl, cnpj, data, dataHora, num } from '../../lib/fmt'
import { lerNfeSaida } from '../../lib/xml'
import type { Casamento, Consolidacao, ItemRecebidoSaldo, ItemStatus, Marcador, Pedido, PedidoDetalheDados } from '../../lib/tipos'
import { Badge, BarraStatus, Carregando, Doc, Erro, Foto, Painel, useAcao, useCarregar } from '../../components/ui'

export default function PedidoDetalhe({ id, onFechar }: { id: number; onFechar: () => void }) {
  const [modo, setModo] = useState<'ver' | 'consolidar' | 'excluir'>('ver')
  const { dados, erro, carregando, recarregar } = useCarregar(async () => {
    const [p, m, itens, cas, cons] = await Promise.all([
      sb.from('pedidos').select('*').eq('id', id).single(),
      sb.from('pedido_marcadores').select('marcadores').eq('pedido_id', id).maybeSingle(),
      sb.from('v_itens_status').select('*').eq('pedido_id', id).order('item_pedido_id'),
      sb.from('casamentos').select('*, itens_pedido!inner(pedido_id, descricao)').eq('itens_pedido.pedido_id', id).neq('status', 'rejeitado'),
      sb.from('consolidacoes').select('*, consolidacao_itens(*), volumes(*), cotacoes_frete(*), rastreios(*)').eq('pedido_id', id).order('id'),
    ])
    if (p.error) throw new Error(p.error.message)
    const casamentos = (cas.data ?? []) as Casamento[]
    const recIds = casamentos.map((c) => c.item_recebido_id)
    const rec = recIds.length ? await sb.from('v_itens_recebidos_saldo').select('*').in('id', recIds) : { data: [] }
    const recebidos = (rec.data ?? []) as ItemRecebidoSaldo[]
    const dados: PedidoDetalheDados = {
      p: p.data as Pedido, marc: (m.data?.marcadores ?? []) as Marcador[], itens: (itens.data ?? []) as ItemStatus[],
      cas: casamentos, cons: (cons.data ?? []) as Consolidacao[], rec: new Map(recebidos.map((r) => [r.id, r])),
    }
    return dados
  }, [id])

  return (
    <Painel largura="max-w-4xl" onFechar={onFechar} titulo={dados ? <>Pedido #{dados.p.numero}</> : 'Pedido'}>
      {erro && <Erro msg={erro} />}
      {carregando && !dados ? <Carregando /> : dados && (
        modo === 'consolidar' ? <NovaConsolidacao d={dados} onPronto={() => { setModo('ver'); recarregar() }} /> :
        modo === 'excluir' ? <Excluir d={dados} onPronto={() => { setModo('ver'); recarregar() }} /> :
        <Visao d={dados} recarregar={recarregar} setModo={setModo} />
      )}
    </Painel>
  )
}

function Visao({ d, recarregar, setModo }: { d: PedidoDetalheDados; recarregar: () => void; setModo: (m: 'consolidar' | 'excluir') => void }) {
  const { p, itens, cas, cons, marc, rec } = d
  const { ocupado, rodar } = useAcao()
  const disponivel = itens.reduce((s, i) => s + Number(i.q_disponivel), 0)
  const temNf = cons.some((c) => ['nf_emitida', 'embarcado', 'entregue'].includes(c.status))
  const excluidos = itens.filter((i) => !i.no_fluxo)
  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="font-semibold text-base">{p.cliente}</div>
          <div className="text-tinta2">{cnpj(p.cnpj)}</div>
          <div className="text-tinta2 mt-1">{p.entrega?.endereco}{p.entrega?.numero ? `, ${p.entrega.numero}` : ''} · {p.cidade}/{p.uf} · CEP {p.cep_entrega ?? '–'}</div>
        </div>
        <div className="sm:text-right">
          <div>OC do cliente: <b>{p.numero_oc_cliente ?? '–'}</b></div>
          <div className="text-tinta2">Pedido em {data(p.data_pedido)} · {brl(p.total)}</div>
          {!p.no_fluxo && <Badge tom="rose">Fora do fluxo: {p.motivo_exclusao}</Badge>}
        </div>
      </div>
      {marc.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {marc.map((m, i) => {
            const t = typeof m === 'string' ? m : String(m?.descricao ?? '')
            return /^https?:/.test(t)
              ? <a key={i} href={t} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs rounded-full border border-linha px-2.5 py-1 text-azul max-w-full truncate"><ExternalLink size={12} />{t.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</a>
              : <Badge key={i}>{t}</Badge>
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primario" disabled={!disponivel} onClick={() => setModo('consolidar')}><PackagePlus size={16} />Ordem de consolidação</button>
        <button className="btn btn-perigo" disabled={temNf} onClick={() => setModo('excluir')}><Trash2 size={16} />Excluir do fluxo</button>
        {excluidos.length > 0 && <button className="btn" disabled={ocupado} onClick={() => rodar(async () => { await rpc('reincluir_no_fluxo', { p_pedido: p.id }); recarregar() }, 'Pedido reincluído no fluxo')}><RotateCcw size={16} />Reincluir</button>}
      </div>

      <section>
        <h3 className="font-semibold mb-2">Itens</h3>
        <div className="card overflow-x-auto">
          <table className="tabela">
            <thead><tr><th>Item</th><th className="text-right">Qtd</th><th className="w-56">Status</th></tr></thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.item_pedido_id} className={i.no_fluxo ? '' : 'opacity-50'}>
                  <td><div>{i.descricao}</div><div className="text-xs text-tinta3">{i.codigo} · {brl(i.valor_unitario)}/{i.unidade ?? 'un'}{!i.no_fluxo && ' · fora do fluxo'}</div></td>
                  <td className="text-right num">{num(i.quantidade, 2)}</td>
                  <td>
                    <BarraStatus q={i} alto={8} />
                    <div className="text-xs text-tinta2 mt-1">{ESTAGIOS.filter((e) => Number(i[e.chave]) > 0).map((e) => `${num(i[e.chave], 2)} ${e.curto.toLowerCase()}`).join(' · ') || '–'}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {cas.length > 0 && (
        <section>
          <h3 className="font-semibold mb-2">No CD</h3>
          <div className="card divide-y divide-linha">
            {cas.map((c) => {
              const r = rec.get(c.item_recebido_id)
              return (
                <div key={c.id} className="p-3 flex gap-3 items-start">
                  {r?.fotos?.[0] && <Foto caminho={r.fotos[0]} />}
                  <div className="text-sm flex-1 min-w-0">
                    <div className="truncate">{r?.descricao}</div>
                    <div className="text-xs text-tinta2">{r?.emitente_nome} · NF {r?.nf_numero ?? 'sem NF'} · {num(c.qtd, 2)} un. para “{c.itens_pedido.descricao}”</div>
                  </div>
                  <div className="text-right text-xs">
                    {c.status === 'sugerido' ? <Badge tom="azul">sugerido</Badge> : <Badge tom="verde">casado</Badge>}
                    <div className="mt-1 num font-medium">{r?.endereco_codigo ?? 'sem local'}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {cons.length > 0 && (
        <section>
          <h3 className="font-semibold mb-2">Consolidações</h3>
          <div className="space-y-3">{cons.map((c) => <CardConsolidacao key={c.id} c={c} pedido={p} recarregar={recarregar} />)}</div>
        </section>
      )}
    </div>
  )
}

function CardConsolidacao({ c, pedido, recarregar }: { c: Consolidacao; pedido: Pedido; recarregar: () => void }) {
  const { ocupado, rodar } = useAcao()
  const [anexando, setAnexando] = useState(false)
  const st = STATUS_CONSOLIDACAO[c.status]
  const vols = (c.volumes ?? []).filter((v) => !v.descartado)
  const cot = (c.cotacoes_frete ?? []).filter((x) => !x.descartada).sort((a, b) => b.id - a.id)[0]
  const eventos = [...(c.rastreios ?? [])].sort((a, b) => String(b.data_evento).localeCompare(String(a.data_evento)))
  return (
    <div className="card p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">Consolidação {c.id} · {c.tipo}{c.motivo_parcial ? ` (${c.motivo_parcial})` : ''}</div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${st?.cor}`}>{st?.nome}</span>
      </div>
      <div className="text-tinta2 mt-1">{c.consolidacao_itens.length} itens · ordem de {dataHora(c.solicitado_em)}</div>
      {c.qtd_volumes && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <Kpi r="Volumes" v={num(c.qtd_volumes)} /><Kpi r="Peso bruto" v={`${num(c.peso_bruto, 2)} kg`} />
          <Kpi r="Cubagem" v={`${num(c.cubagem_m3, 3)} m³`} /><Kpi r="Frete cotado" v={cot?.valor ? brl(cot.valor) : cot?.erro ? 'erro' : '–'} />
        </div>
      )}
      {vols.length > 0 && <div className="text-xs text-tinta2 mt-2">{vols.map((v) => `#${v.seq} ${num(v.comprimento_cm)}×${num(v.largura_cm)}×${num(v.altura_cm)} cm ${num(v.peso_kg, 2)} kg`).join(' · ')}</div>}
      {cot?.erro && <div className="text-xs text-rose mt-1">Cotação: {cot.erro} {JSON.stringify(cot.payload?.resposta ?? '').slice(0, 140)}</div>}
      {c.nf_numero && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span>NF {c.nf_numero}</span>
          {c.nf_conferida ? <Badge tom="verde">conferida com a volumetria</Badge> : <Badge tom="rose">divergente: {(c.nf_divergencias ?? []).map((x) => x.campo).join(', ')}</Badge>}
          <Doc caminho={c.danfe_path}><FileText size={14} />DANFE</Doc>
          <Doc caminho={c.nf_xml_path}><FileText size={14} />XML</Doc>
        </div>
      )}
      {c.cte_valor != null && <div className="mt-2">CT-e {c.cte_numero}: realizado {brl(c.cte_valor)}{cot?.valor ? ` · cotado ${brl(cot.valor)} · diferença ${brl(c.cte_valor - cot.valor)}` : ''}</div>}
      {c.previsao_entrega && <div className="mt-1 text-tinta2">Previsão de entrega {data(c.previsao_entrega)}</div>}
      {eventos.length > 0 && (
        <ol className="mt-3 border-l-2 border-linha pl-3 space-y-1">
          {eventos.slice(0, 6).map((e) => <li key={e.id}><span className="text-tinta3 num text-xs">{dataHora(e.data_evento)}</span> {e.situacao}</li>)}
        </ol>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        {['aguardando_consolidacao', 'consolidado'].includes(c.status) && <>
          <button className="btn" disabled={ocupado} onClick={() => rodar(async () => { await rpc('reabrir_consolidacao', { p_id: c.id }); recarregar() }, 'Consolidação reaberta')}>Reabrir</button>
          <button className="btn btn-perigo" disabled={ocupado} onClick={() => confirm('Cancelar esta consolidação? Os itens voltam para Disponível.') && rodar(async () => { await rpc('cancelar_consolidacao', { p_id: c.id }); recarregar() }, 'Consolidação cancelada')}>Cancelar</button>
        </>}
        {c.status === 'consolidado' && <>
          <button className="btn" disabled={ocupado} onClick={() => rodar(async () => { const r = await funcao('transportadora', { acao: 'cotar', consolidacao_id: c.id }); if (!r.ok) throw new Error(r.erro); recarregar() }, 'Frete cotado')}>Cotar frete</button>
          <button className="btn" onClick={() => setAnexando(true)}><Upload size={14} />Anexar NF manualmente</button>
        </>}
      </div>
      {anexando && <AnexarNf c={c} pedido={pedido} onPronto={() => { setAnexando(false); recarregar() }} />}
    </div>
  )
}

const Kpi = ({ r, v }: { r: string; v: string }) => <div className="bg-fundo rounded-lg px-3 py-2"><div className="text-xs text-tinta3">{r}</div><div className="num font-medium">{v}</div></div>

function AnexarNf({ c, onPronto }: { c: Consolidacao; pedido: Pedido; onPronto: () => void }) {
  const [xml, setXml] = useState<File | null>(null)
  const [pdf, setPdf] = useState<File | null>(null)
  const { ocupado, rodar } = useAcao()
  return (
    <div className="mt-3 bg-fundo rounded-xl p-3 space-y-2">
      <div className="text-xs text-tinta2">Use só se a coleta automática do ERP falhar.</div>
      <label className="rotulo">XML da NF-e</label><input type="file" accept=".xml" onChange={(e) => setXml(e.target.files?.[0] ?? null)} />
      <label className="rotulo">DANFE (PDF)</label><input type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
      <button className="btn btn-primario" disabled={!xml || ocupado} onClick={() => rodar(async () => {
        const nf = lerNfeSaida(await xml!.text())
        const xp = await enviarArquivo('documentos', 'nf-saida', xml!, 'nf.xml')
        const dp = pdf ? await enviarArquivo('documentos', 'nf-saida', pdf, 'danfe.pdf') : null
        const div = await rpc<{ campo: string }[]>('registrar_nf_saida', { p_id: c.id, p_numero: nf.numero, p_chave: nf.chave, p_xml_path: xp, p_danfe_path: dp, p_qvol: nf.qVol, p_peso_b: nf.pesoB, p_peso_l: nf.pesoL, p_dest_cnpj: nf.destCnpj })
        if (div?.length) throw new Error('NF registrada, mas diverge da volumetria: ' + div.map((x) => x.campo).join(', '))
        onPronto()
      }, 'NF registrada e conferida')}>Registrar NF</button>
    </div>
  )
}

function NovaConsolidacao({ d, onPronto }: { d: PedidoDetalheDados; onPronto: () => void }) {
  const confirmados = d.cas.filter((c) => c.status === 'confirmado')
  const usado = useMemo(() => {
    const m = new Map<number, number>()
    for (const co of d.cons) if (co.status !== 'cancelada') for (const ci of co.consolidacao_itens) m.set(ci.casamento_id, (m.get(ci.casamento_id) ?? 0) + Number(ci.qtd))
    return m
  }, [d])
  const linhas = confirmados.map((c) => ({ c, livre: Number(c.qtd) - (usado.get(c.id) ?? 0) })).filter((l) => l.livre > 0)
  const [sel, setSel] = useState<Record<number, number>>(Object.fromEntries(linhas.map((l) => [l.c.id, l.livre])))
  const [motivo, setMotivo] = useState('')
  const { ocupado, rodar } = useAcao()
  const faltaReceber = d.itens.some((i) => i.no_fluxo && Number(i.q_aguardando_recebimento) > 0)
  const tudoMarcado = linhas.every((l) => sel[l.c.id] === l.livre)
  const tipo = !faltaReceber && tudoMarcado ? 'total' : 'parcial'
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg">Nova consolidação</h3>
      <p className="text-sm text-tinta2">O CD vai separar, embalar e informar volumes e peso. Tipo: <b>{tipo}</b>{faltaReceber && ' (ainda há itens aguardando recebimento ou casamento)'}.</p>
      <div className="card divide-y divide-linha">
        {linhas.map((l) => {
          const r = d.rec.get(l.c.item_recebido_id)
          return (
            <label key={l.c.id} className="flex items-center gap-3 p-3 text-sm">
              <input type="checkbox" className="w-4 h-4" checked={!!sel[l.c.id]} onChange={(e) => setSel({ ...sel, [l.c.id]: e.target.checked ? l.livre : 0 })} />
              <div className="flex-1 min-w-0"><div className="truncate">{l.c.itens_pedido.descricao}</div><div className="text-xs text-tinta3">{r?.descricao} · {r?.endereco_codigo ?? 'sem local'}</div></div>
              <input type="number" className="campo !w-24 text-right" min={0} max={l.livre} step="any" value={sel[l.c.id] ?? 0} onChange={(e) => setSel({ ...sel, [l.c.id]: Math.min(l.livre, Number(e.target.value)) })} />
              <span className="text-xs text-tinta3 w-16">de {num(l.livre, 2)}</span>
            </label>
          )
        })}
      </div>
      {tipo === 'parcial' && <div><label className="rotulo">Motivo do parcial</label><input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: cliente pediu adiantamento" /></div>}
      <div className="flex gap-2">
        <button className="btn btn-primario" disabled={ocupado} onClick={() => rodar(async () => {
          const itens = Object.entries(sel).filter(([, q]) => q > 0).map(([k, q]) => ({ casamento_id: Number(k), qtd: q }))
          await rpc('criar_consolidacao', { p_pedido: d.p.id, p_tipo: tipo, p_motivo: motivo || null, p_itens: itens })
          onPronto()
        }, 'Consolidação enviada para o CD')}>Enviar para o CD</button>
        <button className="btn" onClick={onPronto}>Voltar</button>
      </div>
    </div>
  )
}

function Excluir({ d, onPronto }: { d: PedidoDetalheDados; onPronto: () => void }) {
  const elegiveis = d.itens.filter((i) => i.no_fluxo && Number(i.qtd_casada) === 0)
  const [sel, setSel] = useState<Set<number>>(new Set(elegiveis.map((i) => i.item_pedido_id)))
  const [motivo, setMotivo] = useState('')
  const { ocupado, rodar } = useAcao()
  const recebidos = d.itens.filter((i) => i.no_fluxo && Number(i.qtd_casada) > 0)
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg">Excluir do fluxo</h3>
      <p className="text-sm text-tinta2">Os itens excluídos seguem entrega direta, fora do CD. Só sai o que ainda não chegou ao CD. A exclusão não altera nada no ERP.</p>
      {recebidos.length > 0 && <div className="text-sm bg-ambar-50 text-ambar rounded-lg p-3">{recebidos.length} item(ns) já recebido(s) no CD seguem no fluxo.</div>}
      <div className="card divide-y divide-linha">
        {elegiveis.length === 0 ? <div className="p-4 text-sm text-tinta3">Nenhum item pode ser excluído.</div> : elegiveis.map((i) => (
          <label key={i.item_pedido_id} className="flex items-center gap-3 p-3 text-sm">
            <input type="checkbox" className="w-4 h-4" checked={sel.has(i.item_pedido_id)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(i.item_pedido_id); else s.delete(i.item_pedido_id); setSel(s) }} />
            <span className="flex-1">{i.descricao}</span><span className="num text-tinta2">{num(i.quantidade, 2)}</span>
          </label>
        ))}
      </div>
      <div><label className="rotulo">Motivo</label><input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: cliente retira na loja" /></div>
      <div className="flex gap-2">
        <button className="btn btn-primario" disabled={ocupado || !sel.size || !motivo.trim()} onClick={() => rodar(async () => {
          await rpc('excluir_do_fluxo', { p_pedido: d.p.id, p_itens: [...sel], p_motivo: motivo }); onPronto()
        }, 'Itens excluídos do fluxo')}>Excluir {sel.size} item(ns)</button>
        <button className="btn" onClick={onPronto}>Voltar</button>
      </div>
    </div>
  )
}
