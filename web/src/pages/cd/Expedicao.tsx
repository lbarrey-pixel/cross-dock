import { useState } from 'react'
import { FileText, Keyboard } from 'lucide-react'
import { rpc, sb } from '../../lib/supabase'
import { brl, cnpj, data, num } from '../../lib/fmt'
import { chaveFormatada, chaveValida, extrairChave } from '../../lib/chave'
import { BotaoLeitor } from '../../components/Leitor'
import { Badge, Carregando, Doc, Vazio, useAcao, useAviso, useCarregar } from '../../components/ui'

export default function Expedicao() {
  const { dados, recarregar } = useCarregar(async () => {
    const [prontas, expedidas] = await Promise.all([
      sb.from('consolidacoes').select('*, pedidos(numero, cliente, cnpj, cidade, uf, entrega)').eq('status', 'nf_emitida').order('nf_coletada_em'),
      sb.from('consolidacoes').select('*, pedidos(numero, cliente, cidade, uf)').in('status', ['embarcado', 'entregue']).order('embarcado_em', { ascending: false }).limit(20),
    ])
    return { prontas: prontas.data ?? [], expedidas: expedidas.data ?? [] }
  })
  if (!dados) return <Carregando />
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Expedição</h1>
        <p className="text-sm text-tinta2 mt-1">Pedidos faturados pelo operador, com a NF conferida. Para expedir, leia o código de barras do DACTE.</p>
      </div>
      <section className="space-y-3">
        {dados.prontas.length === 0 ? <Vazio>Nenhum pedido faturado aguardando expedição.</Vazio> : dados.prontas.map((c: any) => (
          <Cartao key={c.id} c={c} feito={recarregar} />
        ))}
      </section>
      <section>
        <h2 className="font-semibold mb-2">Expedidos recentes</h2>
        <div className="card divide-y divide-linha">
          {dados.expedidas.length === 0 ? <div className="p-4 text-sm text-tinta3">Nenhuma expedição ainda.</div> : dados.expedidas.map((c: any) => (
            <div key={c.id} className="p-4 flex items-center gap-3 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium">#{c.pedidos?.numero} · NF {c.nf_numero}</div>
                <div className="text-xs text-tinta3">{c.pedidos?.cidade}/{c.pedidos?.uf} · expedido {data(c.embarcado_em)}{c.cte_numero ? ` · CT-e ${c.cte_numero}` : ''}</div>
              </div>
              {c.cte_valor != null ? <span className="num">{brl(c.cte_valor)}</span> : <Badge tom="neutro">aguardando XML do CT-e</Badge>}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Cartao({ c, feito }: { c: any; feito: () => void }) {
  const { ocupado, rodar } = useAcao()
  const avisar = useAviso()
  const [digitar, setDigitar] = useState(false)
  const [chave, setChave] = useState('')
  const expedir = (lido: string) => {
    const k = extrairChave(lido)
    if (!chaveValida(k, '57')) { avisar('Este código não é de um DACTE. Leia o código de barras do DACTE.', 'erro'); return }
    rodar(async () => { await rpc('registrar_expedicao', { p_id: c.id, p_cte_chave: k }); feito() }, `Pedido #${c.pedidos?.numero} expedido`)
  }
  return (
    <div className={`card p-4 space-y-3 ${c.nf_conferida ? '' : 'border-rose'}`}>
      <div className="flex justify-between gap-2"><span className="font-semibold">Pedido #{c.pedidos?.numero} · NF {c.nf_numero}</span>
        {c.nf_conferida ? <Badge tom="verde">NF conferida</Badge> : <Badge tom="rose">bloqueado</Badge>}</div>
      <div className="text-sm">
        <div>{c.pedidos?.cliente} · {cnpj(c.pedidos?.cnpj)}</div>
        <div className="text-tinta2">{c.pedidos?.entrega?.endereco}{c.pedidos?.entrega?.numero ? `, ${c.pedidos.entrega.numero}` : ''} · {c.pedidos?.cidade}/{c.pedidos?.uf}</div>
        <div className="text-tinta2 mt-1">{c.qtd_volumes} volumes · {num(c.peso_bruto, 2)} kg</div>
      </div>
      {!c.nf_conferida && <div className="text-sm text-rose">A NF não bate com a volumetria ({(c.nf_divergencias ?? []).map((d: any) => `${d.campo}: NF ${d.nf ?? '–'} × CD ${d.cd ?? d.pedido ?? '–'}`).join('; ')}). Aguarde o operador corrigir.</div>}
      <div className="flex flex-wrap gap-2">
        <Doc caminho={c.danfe_path}><FileText size={16} />DANFE</Doc>
        <Doc caminho={c.nf_xml_path}><FileText size={16} />XML</Doc>
      </div>
      {c.nf_conferida && (
        <div className="space-y-2">
          {ocupado ? <div className="text-sm text-azul">Registrando…</div> : <BotaoLeitor texto="Ler DACTE e expedir" onLido={expedir} />}
          {!digitar ? (
            <button className="text-sm text-azul inline-flex items-center gap-1" onClick={() => setDigitar(true)}><Keyboard size={15} />Digitar a chave do CT-e</button>
          ) : (
            <div className="flex gap-2">
              <input className="campo num" inputMode="numeric" placeholder="44 dígitos" value={chaveFormatada(chave)} onChange={(e) => setChave(e.target.value.replace(/\D/g, '').slice(0, 44))} />
              <button className="btn" disabled={ocupado || chave.length !== 44} onClick={() => expedir(chave)}>Expedir</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
