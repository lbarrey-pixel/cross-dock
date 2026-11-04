import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileUp, Keyboard, Loader2 } from 'lucide-react'
import { enviarArquivo, funcao, sb } from '../../lib/supabase'
import { brl, cnpj, num } from '../../lib/fmt'
import { lerNfeChegada, type NfeChegada } from '../../lib/xml'
import { chaveFormatada, chaveValida, extrairChave } from '../../lib/chave'
import { BotaoLeitor } from '../../components/Leitor'
import { FotosInput, useAcao, useAviso, useAvisoSaida } from '../../components/ui'

type Linha = {
  n: number; codigo: string | null; descricao: string; ncm: string | null; unidade: string | null; qtdNf: number; valorUnit: number | null
  qtd: number; fotos: string[]; avaria: boolean; obs: string; especial: string
}
const ESPECIAIS = ['', 'bateria de lítio', 'químico/tinta', 'carga longa', 'acima de 100 kg']

export default function Receber() {
  const nav = useNavigate()
  const avisar = useAviso()
  const { ocupado, rodar } = useAcao()
  const [buscando, setBuscando] = useState(false)
  const [falhaSefaz, setFalhaSefaz] = useState<string | null>(null)
  const [digitar, setDigitar] = useState(false)
  const [chaveDigitada, setChaveDigitada] = useState('')
  const [nf, setNf] = useState<NfeChegada | null>(null)
  const [xmlPath, setXmlPath] = useState<string | null>(null)
  const [origem, setOrigem] = useState<'sefaz' | 'upload'>('sefaz')
  const [volumes, setVolumes] = useState<number>(1)
  const [fotosEmb, setFotosEmb] = useState<string[]>([])
  const [linhas, setLinhas] = useState<Linha[]>([])
  useAvisoSaida(!!nf)

  const usarNf = (d: NfeChegada, path: string | null, o: 'sefaz' | 'upload') => {
    setNf(d); setXmlPath(path); setOrigem(o); setFalhaSefaz(null); setDigitar(false)
    setLinhas(d.itens.map((i) => ({ n: i.n, codigo: i.codigo, descricao: i.descricao, ncm: i.ncm, unidade: i.unidade, qtdNf: i.qtd, valorUnit: i.valorUnit, qtd: i.qtd, fotos: [], avaria: false, obs: '', especial: '' })))
  }

  const buscarChave = async (lido: string) => {
    const chave = extrairChave(lido)
    if (!chaveValida(chave, '55')) { avisar('Este código não é a chave de uma NF-e. Leia o código de barras da DANFE.', 'erro'); return }
    setBuscando(true); setFalhaSefaz(null)
    try {
      const r = await funcao('sefaz', { acao: 'nfe', chave })
      if (!r?.ok) throw new Error(r?.erro ?? 'Falha ao consultar a SEFAZ')
      if (r.status !== 'ok') { setFalhaSefaz(r.mensagem); return }
      usarNf(lerNfeChegada(r.xml), r.xml_path, 'sefaz')
    } catch (e) {
      const m = (e as Error).message
      if (m.includes('já foi recebida')) avisar(m, 'erro'); else setFalhaSefaz(m)
    } finally { setBuscando(false) }
  }

  const carregarXml = async (f: File) => {
    try {
      const d = lerNfeChegada(await f.text())
      const dup = d.chave ? await sb.from('recebimentos').select('id').eq('nf_chave', d.chave).maybeSingle() : null
      if (dup?.data) { avisar('Esta NF já foi recebida', 'erro'); return }
      usarNf(d, await enviarArquivo('documentos', 'nf-chegada', f, 'nf.xml'), 'upload')
    } catch (e) { avisar((e as Error).message, 'erro') }
  }
  const upd = (i: number, p: Partial<Linha>) => setLinhas(linhas.map((l, j) => (j === i ? { ...l, ...p } : l)))

  const salvar = () => rodar(async () => {
    if (!nf) throw new Error('Leia a DANFE primeiro')
    if (!fotosEmb.length) throw new Error('Tire ao menos uma foto da embalagem como chegou')
    if (linhas.some((l) => !l.fotos.length)) throw new Error('Tire ao menos uma foto de cada item')
    const { data: rec, error } = await sb.from('recebimentos').insert({
      emitente_cnpj: nf.emitenteCnpj, emitente_nome: nf.emitenteNome,
      nf_numero: nf.numero, nf_serie: nf.serie, nf_chave: nf.chave, nf_emissao: nf.emissao, nf_valor: nf.valor,
      xml_path: xmlPath, xml_origem: origem, volumes_recebidos: volumes, fotos: fotosEmb, status: 'conferido', provisorio_sem_nf: false,
    }).select('id').single()
    if (error) throw new Error(error.message)
    const { data: itens, error: e2 } = await sb.from('itens_recebidos').insert(linhas.map((l) => ({
      recebimento_id: rec.id, n_item: l.n, codigo_fornecedor: l.codigo, descricao: l.descricao, ncm: l.ncm, unidade: l.unidade,
      qtd_nf: l.qtdNf, qtd_conferida: l.qtd, valor_unitario: l.valorUnit, fotos: l.fotos,
      bloqueado: l.avaria, motivo_bloqueio: l.avaria ? `avaria: ${l.obs}` : null,
      especial: l.especial || null, conferido_em: new Date().toISOString(),
    }))).select('id, qtd_nf, qtd_conferida')
    if (e2) throw new Error(e2.message)
    const ocorr = (itens ?? []).flatMap((it: any, i: number) => {
      const o: any[] = []
      if (Number(it.qtd_conferida) !== Number(it.qtd_nf)) o.push({ tipo: 'divergencia_qtd', recebimento_id: rec.id, item_recebido_id: it.id, descricao: `NF ${it.qtd_nf}, recebido ${it.qtd_conferida}`, fotos: linhas[i].fotos })
      if (linhas[i].avaria) o.push({ tipo: 'avaria', recebimento_id: rec.id, item_recebido_id: it.id, descricao: linhas[i].obs, fotos: linhas[i].fotos })
      return o
    })
    if (ocorr.length) await sb.from('ocorrencias').insert(ocorr)
    funcao('casamento-sugerir', { recebimento_id: rec.id }).catch(() => {})
    nav('/cd/enderecar')
  }, 'Recebimento registrado. Agora faça a armazenagem dos itens.')

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Recebimento</h1>

      {!nf && (
        <div className="space-y-3">
          <div className="card p-5 space-y-3 text-center">
            <div className="font-semibold">1. Ler a DANFE</div>
            <p className="text-sm text-tinta2">Leia o código de barras da DANFE (vale a simplificada). O sistema busca a nota oficial na SEFAZ: fornecedor, itens e quantidades entram sozinhos.</p>
            {buscando ? (
              <div className="flex items-center justify-center gap-2 text-azul py-3"><Loader2 className="animate-spin" size={20} />Buscando a nota na SEFAZ…</div>
            ) : (
              <BotaoLeitor texto="Ler código de barras da DANFE" grande onLido={buscarChave} />
            )}
            {!digitar ? (
              <button className="text-sm text-azul inline-flex items-center gap-1" onClick={() => setDigitar(true)}><Keyboard size={15} />Digitar a chave de acesso</button>
            ) : (
              <div className="space-y-2 text-left">
                <label className="rotulo">Chave de acesso (44 dígitos)</label>
                <input className="campo num" inputMode="numeric" value={chaveFormatada(chaveDigitada)} onChange={(e) => setChaveDigitada(e.target.value.replace(/\D/g, '').slice(0, 44))} />
                <button className="btn w-full" disabled={buscando || chaveDigitada.length !== 44} onClick={() => buscarChave(chaveDigitada)}>Buscar nota</button>
              </div>
            )}
          </div>
          {falhaSefaz && (
            <div className="card p-4 space-y-3 border-ambar">
              <div className="text-sm text-ambar">{falhaSefaz}</div>
              <label className="btn w-full cursor-pointer"><FileUp size={16} />Enviar o XML da nota (alternativa)
                <input type="file" accept=".xml,text/xml,application/xml" hidden onChange={(e) => e.target.files?.[0] && carregarXml(e.target.files[0])} />
              </label>
            </div>
          )}
        </div>
      )}

      {nf && (
        <>
          <div className="card p-4 text-sm">
            <div className="font-semibold">{nf.emitenteNome}</div>
            <div className="text-tinta2">{cnpj(nf.emitenteCnpj)} · NF {nf.numero} · {brl(nf.valor)}</div>
            <div className="text-xs text-tinta3 break-all mt-1">{nf.chave} · {origem === 'sefaz' ? 'XML oficial da SEFAZ' : 'XML enviado'}</div>
            <button className="text-azul text-sm mt-2" onClick={() => { setNf(null); setLinhas([]) }}>Trocar NF</button>
          </div>

          <div className="card p-4 space-y-3">
            <div className="font-semibold">2. Embalagem como chegou</div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-tinta2">Volumes</span>
              <button className="btn !w-11 !h-11 text-lg" onClick={() => setVolumes(Math.max(1, volumes - 1))}>−</button>
              <span className="num text-2xl w-10 text-center">{volumes}</span>
              <button className="btn !w-11 !h-11 text-lg" onClick={() => setVolumes(volumes + 1)}>+</button>
            </div>
            <FotosInput valor={fotosEmb} onChange={setFotosEmb} pasta="volumes" rotulo="Embalagem" />
          </div>

          <div className="space-y-3">
            <div className="font-semibold">3. Conferência item a item</div>
            {linhas.map((l, i) => (
              <div key={i} className={`card p-4 space-y-3 ${l.qtd !== l.qtdNf || l.avaria ? 'border-ambar' : ''}`}>
                <div className="text-sm"><div className="font-medium">{l.descricao}</div><div className="text-xs text-tinta3">cód. {l.codigo} · NCM {l.ncm} · na NF: {num(l.qtdNf, 2)} {l.unidade}</div></div>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-tinta2">Recebido</label>
                  <input type="number" inputMode="decimal" step="any" className="campo !w-28 text-right num text-lg" value={l.qtd} onChange={(e) => upd(i, { qtd: Number(e.target.value) })} />
                  <span className="text-sm text-tinta2">{l.unidade}</span>
                  {l.qtd !== l.qtdNf && <span className="text-xs text-ambar">diferente da NF</span>}
                </div>
                <FotosInput valor={l.fotos} onChange={(f) => upd(i, { fotos: f })} pasta="itens" rotulo="Item" />
                <div className="flex flex-wrap gap-3 items-center text-sm">
                  <label className="inline-flex items-center gap-2"><input type="checkbox" className="w-5 h-5" checked={l.avaria} onChange={(e) => upd(i, { avaria: e.target.checked })} />Avaria</label>
                  <select className="campo !w-auto" value={l.especial} onChange={(e) => upd(i, { especial: e.target.value })}>
                    {ESPECIAIS.map((s) => <option key={s} value={s}>{s || 'Item comum'}</option>)}
                  </select>
                </div>
                {l.avaria && <input className="campo" placeholder="Descreva a avaria" value={l.obs} onChange={(e) => upd(i, { obs: e.target.value })} />}
              </div>
            ))}
          </div>
          <button className="btn btn-primario btn-grande w-full" disabled={ocupado} onClick={salvar}>Concluir recebimento</button>
        </>
      )}
    </div>
  )
}
