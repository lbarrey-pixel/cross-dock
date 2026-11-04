import { Link } from 'react-router-dom'
import { Boxes, ChevronRight, MapPin, PackageOpen, Truck } from 'lucide-react'
import { rpc, sb } from '../../lib/supabase'
import { num } from '../../lib/fmt'
import { Carregando, useCarregar } from '../../components/ui'

export default function Inicio() {
  const { dados } = useCarregar(async () => {
    const [esp, semEnd, sep, exp] = await Promise.all([
      rpc<any[]>('cd_itens_esperados'),
      sb.from('itens_recebidos').select('id', { count: 'exact', head: true }).is('endereco_id', null),
      sb.from('consolidacoes').select('id', { count: 'exact', head: true }).eq('status', 'aguardando_consolidacao'),
      sb.from('consolidacoes').select('id', { count: 'exact', head: true }).eq('status', 'nf_emitida'),
    ])
    return { esp: esp ?? [], semEnd: semEnd.count ?? 0, sep: sep.count ?? 0, exp: exp.count ?? 0 }
  })
  if (!dados) return <Carregando />
  const atalhos = [
    { to: '/cd/receber', ic: <PackageOpen size={26} />, t: 'Recebimento', s: 'Ler a DANFE, fotografar e conferir', n: null },
    { to: '/cd/enderecar', ic: <MapPin size={26} />, t: 'Armazenagem', s: 'Itens recebidos sem local registrado', n: dados.semEnd },
    { to: '/cd/separacao', ic: <Boxes size={26} />, t: 'Separação e embalagem', s: 'Ordens de consolidação do operador', n: dados.sep },
    { to: '/cd/expedicao', ic: <Truck size={26} />, t: 'Expedição', s: 'Faturados: ler o DACTE e expedir', n: dados.exp },
  ]
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Operação do CD</h1>
      <div className="grid gap-3">
        {atalhos.map((a) => (
          <Link key={a.to} to={a.to} className="card p-4 flex items-center gap-4 active:scale-[.99] transition">
            <div className="w-12 h-12 rounded-xl bg-azul-50 text-azul grid place-items-center shrink-0">{a.ic}</div>
            <div className="flex-1 min-w-0"><div className="font-semibold">{a.t}</div><div className="text-sm text-tinta2">{a.s}</div></div>
            {a.n !== null && <span className={`num text-lg font-semibold ${a.n ? 'text-navy' : 'text-tinta3'}`}>{a.n}</span>}
            <ChevronRight className="text-tinta3" size={20} />
          </Link>
        ))}
      </div>
      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-semibold">Itens esperados</h2>
          <Link to="/cd/enderecos" className="text-sm text-azul">Locais do armazém</Link>
        </div>
        <div className="card divide-y divide-linha">
          {dados.esp.length === 0 ? <div className="p-4 text-sm text-tinta3">Nada esperado no momento.</div> : dados.esp.map((e: any, i: number) => (
            <div key={i} className="p-3 flex justify-between gap-3 text-sm">
              <div className="min-w-0"><div>{e.descricao}</div>{e.codigo && <div className="text-xs text-tinta3">{e.codigo}</div>}</div>
              <div className="num whitespace-nowrap">{num(e.qtd, 2)} {e.unidade ?? 'un'}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
