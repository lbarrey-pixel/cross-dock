import { useState } from 'react'
import { sb } from '../../lib/supabase'
import { Carregando, useAcao, useCarregar } from '../../components/ui'

export default function Enderecos() {
  const { ocupado, rodar } = useAcao()
  const [n, setN] = useState({ prateleira: '', andar: '', zona: '' })
  const { dados, recarregar } = useCarregar(async () => (await sb.from('enderecos').select('*').order('codigo')).data ?? [])
  if (!dados) return <Carregando />
  const codigo = n.prateleira ? `${n.prateleira.toUpperCase()}${n.andar ? '-' + n.andar.padStart(2, '0') : ''}` : ''
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Locais do armazém</h1>
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div><label className="rotulo">Prateleira</label><input className="campo uppercase" value={n.prateleira} onChange={(e) => setN({ ...n, prateleira: e.target.value })} placeholder="F" /></div>
          <div><label className="rotulo">Andar</label><input className="campo" inputMode="numeric" value={n.andar} onChange={(e) => setN({ ...n, andar: e.target.value })} placeholder="4" /></div>
          <div><label className="rotulo">Zona</label><input className="campo" value={n.zona} onChange={(e) => setN({ ...n, zona: e.target.value })} placeholder="opcional" /></div>
        </div>
        <button className="btn btn-primario w-full" disabled={ocupado || !codigo} onClick={() => rodar(async () => {
          const { error } = await sb.from('enderecos').insert({ codigo, prateleira: n.prateleira.toUpperCase(), andar: n.andar, zona: n.zona || null })
          if (error) throw new Error(error.message); setN({ prateleira: '', andar: '', zona: '' }); recarregar()
        }, `Local ${codigo} cadastrado`)}>Cadastrar {codigo}</button>
      </div>
      <div className="card divide-y divide-linha">
        {dados.map((e: any) => <div key={e.id} className="p-3 flex justify-between text-sm"><span className="num font-medium">{e.codigo}</span><span className="text-tinta3">{e.zona ?? ''}</span></div>)}
      </div>
    </div>
  )
}
