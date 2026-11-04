import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { sb } from '../../lib/supabase'
import { brl, data, num } from '../../lib/fmt'
import { Carregando, Erro, Titulo, Vazio, useCarregar } from '../../components/ui'

const COTADO = '#1F6FEB', COBRADO = '#B7791F'
// Linha de base do histórico próprio (R$ por CT-e, R$ por kg taxado, % sobre a NF), em config.frete_base.
const BASE_ZERADA = { porCte: 0, porKg: 0, sobreNf: 0 }
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export default function Frete() {
  const { dados, erro, carregando } = useCarregar(async () => {
    const [fretes, cfg] = await Promise.all([
      sb.from('v_frete_benchmark').select('*').order('embarcado_em', { ascending: false }),
      sb.from('config').select('valor').eq('chave', 'frete_base').maybeSingle(),
    ])
    if (fretes.error) throw new Error(fretes.error.message)
    return { linhas: fretes.data ?? [], base: { ...BASE_ZERADA, ...(cfg.data?.valor as Partial<typeof BASE_ZERADA> | undefined) } }
  })
  const base = dados?.base ?? BASE_ZERADA
  const calc = useMemo(() => {
    const l = (dados?.linhas ?? []) as any[]
    const comCte = l.filter((x) => x.cobrado != null)
    const soma = (a: any[], k: string) => a.reduce((s, x) => s + Number(x[k] ?? 0), 0)
    const kgTax = (x: any) => Number(x.cobrado_peso_taxado ?? x.peso_taxavel_estimado ?? 0)
    const ambos = comCte.filter((x) => x.cotado != null)
    const porMes = new Map<string, { mes: string; cotado: number; cobrado: number; n: number }>()
    for (const x of l) {
      if (!x.mes) continue
      const k = x.mes.slice(0, 7)
      const o = porMes.get(k) ?? { mes: `${MESES[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`, cotado: 0, cobrado: 0, n: 0 }
      o.cotado += Number(x.cotado ?? 0); o.cobrado += Number(x.cobrado ?? 0); o.n++
      porMes.set(k, o)
    }
    const porUf = new Map<string, { uf: string; kg: number; valor: number }>()
    for (const x of comCte) {
      const o = porUf.get(x.uf) ?? { uf: x.uf, kg: 0, valor: 0 }
      o.kg += kgTax(x); o.valor += Number(x.cobrado); porUf.set(x.uf, o)
    }
    return {
      total: l.length, comCte: comCte.length,
      porCte: comCte.length ? soma(comCte, 'cobrado') / comCte.length : null,
      porKg: comCte.length ? soma(comCte, 'cobrado') / Math.max(1, comCte.reduce((s, x) => s + kgTax(x), 0)) : null,
      sobreNf: comCte.length ? (soma(comCte, 'cobrado') / Math.max(1, soma(comCte, 'valor_mercadoria'))) * 100 : null,
      desvio: ambos.length ? ((soma(ambos, 'cobrado') - soma(ambos, 'cotado')) / soma(ambos, 'cotado')) * 100 : null,
      meses: [...porMes.entries()].sort().map(([, v]) => v),
      ufs: [...porUf.values()].map((u) => ({ uf: u.uf, rsKg: u.kg ? u.valor / u.kg : 0 })).sort((a, b) => b.rsKg - a.rsKg),
      linhas: l,
    }
  }, [dados])

  return (
    <>
      <Titulo sub="Frete cotado na API da transportadora × realizado no CT-e. Só análise e acompanhamento.">Frete</Titulo>
      {erro && <Erro msg={erro} />}
      {carregando && !dados ? <Carregando /> : !calc.total ? <Vazio>Sem consolidações ainda. Os números aparecem a partir da primeira volumetria.</Vazio> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile r="por CT-e" v={brl(calc.porCte)} b={base.porCte ? `base ${brl(base.porCte)}` : undefined} />
            <Tile r="por kg taxado" v={brl(calc.porKg)} b={base.porKg ? `base ${brl(base.porKg)}` : undefined} />
            <Tile r="sobre o valor da NF" v={calc.sobreNf == null ? '–' : `${num(calc.sobreNf, 1)}%`} b={base.sobreNf ? `base ${num(base.sobreNf, 1)}%` : undefined} />
            <Tile r="realizado vs cotado" v={calc.desvio == null ? '–' : `${calc.desvio > 0 ? '+' : ''}${num(calc.desvio, 1)}%`} b={`${calc.comCte} CT-es de ${calc.total} expedições`} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card p-4">
              <h3 className="font-semibold text-sm mb-3">Cotado e realizado por mês (R$)</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={calc.meses} barGap={2}>
                  <CartesianGrid vertical={false} stroke="#E3E7ED" />
                  <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#4A5568' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#4A5568' }} axisLine={false} tickLine={false} width={60} tickFormatter={(v) => Number(v).toLocaleString('pt-BR')} />
                  <Tooltip formatter={(v: any) => brl(Number(v))} cursor={{ fill: '#F6F7F9' }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="cotado" name="Cotado" fill={COTADO} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="cobrado" name="Realizado" fill={COBRADO} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card p-4">
              <h3 className="font-semibold text-sm mb-3">R$ por kg taxado, por UF de destino</h3>
              {calc.ufs.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={calc.ufs} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid horizontal={false} stroke="#E3E7ED" />
                    <XAxis type="number" tick={{ fontSize: 12, fill: '#4A5568' }} axisLine={false} tickLine={false} tickFormatter={(v) => `R$ ${v}`} />
                    <YAxis type="category" dataKey="uf" tick={{ fontSize: 12, fill: '#4A5568' }} axisLine={false} tickLine={false} width={32} />
                    <Tooltip formatter={(v: any) => brl(Number(v))} cursor={{ fill: '#F6F7F9' }} />
                    <Bar dataKey="rsKg" name="R$/kg" fill={COBRADO} radius={[0, 4, 4, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <Vazio>Aparece quando os CT-es das expedições chegarem da SEFAZ.</Vazio>}
            </div>
          </div>
          <div className="card overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Pedido</th><th>Destino</th><th>Expedição</th><th className="text-right">Peso</th><th className="text-right">Cotado</th><th className="text-right">Realizado</th><th className="text-right">Diferença</th></tr></thead>
              <tbody>
                {calc.linhas.map((x: any) => (
                  <tr key={x.consolidacao_id}>
                    <td>#{x.pedido}</td><td>{x.cidade}/{x.uf}</td><td>{data(x.embarcado_em)}</td>
                    <td className="text-right num">{num(x.peso_bruto, 1)} kg</td>
                    <td className="text-right num">{brl(x.cotado)}</td><td className="text-right num">{brl(x.cobrado)}</td>
                    <td className="text-right num">{x.cotado != null && x.cobrado != null ? brl(x.cobrado - x.cotado) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

const Tile = ({ r, v, b }: { r: string; v: string; b?: string }) => (
  <div className="card p-4"><div className="num text-2xl font-semibold">{v}</div><div className="text-sm text-tinta2">{r}</div><div className="text-xs text-tinta3 mt-1">{b}</div></div>
)
