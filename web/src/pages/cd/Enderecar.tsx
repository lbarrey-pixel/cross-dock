import { useState } from 'react'
import { sb } from '../../lib/supabase'
import { num } from '../../lib/fmt'
import { Carregando, Foto, Vazio, useAcao, useCarregar } from '../../components/ui'
import { BotaoLeitor } from '../../components/Leitor'

export default function Enderecar() {
  const { ocupado, rodar } = useAcao()
  const [cod, setCod] = useState<Record<number, string>>({})
  const { dados, recarregar } = useCarregar(async () => {
    const [it, en] = await Promise.all([
      sb.from('itens_recebidos').select('*, recebimentos(emitente_nome, nf_numero)').is('endereco_id', null).order('id'),
      sb.from('enderecos').select('*').eq('ativo', true).order('codigo'),
    ])
    return { itens: it.data ?? [], ends: en.data ?? [] }
  })
  if (!dados) return <Carregando />
  const salvar = (id: number) => rodar(async () => {
    const c = (cod[id] ?? '').trim().toUpperCase()
    let e = dados.ends.find((x: any) => x.codigo.toUpperCase() === c)
    if (!e) {
      if (!c) throw new Error('Informe o local')
      if (!confirm(`Local ${c} não existe. Cadastrar agora?`)) return
      const r = await sb.from('enderecos').insert({ codigo: c }).select('*').single()
      if (r.error) throw new Error(r.error.message); e = r.data
    }
    const { error } = await sb.from('itens_recebidos').update({ endereco_id: e.id }).eq('id', id)
    if (error) throw new Error(error.message)
    recarregar()
  }, 'Item armazenado')
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold">Armazenagem</h1><p className="text-sm text-tinta2 mt-1">Guarde cada item e registre o local. Depois disso ele aguarda o casamento com um pedido.</p></div>
      <datalist id="enderecos">{dados.ends.map((e: any) => <option key={e.id} value={e.codigo} />)}</datalist>
      {dados.itens.length === 0 ? <Vazio>Todos os itens recebidos já têm local registrado.</Vazio> : dados.itens.map((i: any) => (
        <div key={i.id} className="card p-4 space-y-3">
          <div className="flex gap-3">
            {i.fotos?.[0] && <Foto caminho={i.fotos[0]} />}
            <div className="text-sm min-w-0"><div className="font-medium">{i.descricao}</div>
              <div className="text-xs text-tinta3">{num(i.qtd_conferida ?? i.qtd_nf, 2)} {i.unidade} · {i.recebimentos?.emitente_nome} · NF {i.recebimentos?.nf_numero ?? '–'}</div></div>
          </div>
          <div className="flex gap-2">
            <input className="campo uppercase num text-lg" list="enderecos" placeholder="ex.: F-04" value={cod[i.id] ?? ''} onChange={(e) => setCod({ ...cod, [i.id]: e.target.value })} />
            <BotaoLeitor onLido={(v) => setCod({ ...cod, [i.id]: v })} />
            <button className="btn btn-primario" disabled={ocupado} onClick={() => salvar(i.id)}>Guardar</button>
          </div>
        </div>
      ))}
    </div>
  )
}
