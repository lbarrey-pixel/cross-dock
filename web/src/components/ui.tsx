import { useCallback, useEffect, useRef, useState, createContext, useContext, type ReactNode } from 'react'
import { Camera, Loader2, X } from 'lucide-react'
import { ESTAGIOS } from '../lib/status'
import { comprimir, enviarArquivo, urlAssinada } from '../lib/supabase'

export function useCarregar<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const recarregar = useCallback(async () => {
    setCarregando(true)
    try { setDados(await fn()); setErro(null) } catch (e) { setErro((e as Error).message) } finally { setCarregando(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { recarregar() }, [recarregar])
  return { dados, erro, carregando, recarregar }
}

const AvisoCtx = createContext<(msg: string, tipo?: 'ok' | 'erro') => void>(() => {})
export const useAviso = () => useContext(AvisoCtx)
export function AvisoProvider({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const mostrar = useCallback((msg: string, tipo: 'ok' | 'erro' = 'ok') => {
    setAviso({ msg, tipo }); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setAviso(null), 4500)
  }, [])
  return (
    <AvisoCtx.Provider value={mostrar}>
      {children}
      {aviso && (
        <div className={`fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-xl shadow-lg text-sm max-w-[92vw] ${aviso.tipo === 'erro' ? 'bg-rose text-white' : 'bg-navy text-white'}`}>
          {aviso.msg}
        </div>
      )}
    </AvisoCtx.Provider>
  )
}

// Executa uma ação, mostra erro ou sucesso.
export function useAcao() {
  const avisar = useAviso()
  const [ocupado, setOcupado] = useState(false)
  const rodar = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    setOcupado(true)
    try { await fn(); if (ok) avisar(ok) ; return true } catch (e) { avisar((e as Error).message, 'erro'); return false } finally { setOcupado(false) }
  }, [avisar])
  return { ocupado, rodar }
}

export function Badge({ children, tom = 'neutro' }: { children: ReactNode; tom?: 'neutro' | 'azul' | 'verde' | 'ambar' | 'rose' }) {
  const cls = { neutro: 'bg-fundo text-tinta2', azul: 'bg-azul-50 text-azul', verde: 'bg-verde-50 text-verde', ambar: 'bg-ambar-50 text-ambar', rose: 'bg-rose-50 text-rose' }[tom]
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
}

export function BarraStatus({ q, alto = 10 }: { q: Record<string, unknown>; alto?: number }) {
  const total = ESTAGIOS.reduce((s, e) => s + Number(q[e.chave] ?? 0), 0)
  if (!total) return <div className="rounded-full bg-fundo" style={{ height: alto }} />
  return (
    <div className="flex rounded-full overflow-hidden bg-fundo" style={{ height: alto }} role="img"
      aria-label={ESTAGIOS.filter((e) => q[e.chave]).map((e) => `${e.nome}: ${q[e.chave]}`).join(', ')}>
      {ESTAGIOS.map((e) => Number(q[e.chave]) > 0 && (
        <div key={e.chave} title={`${e.nome}: ${Number(q[e.chave]).toLocaleString('pt-BR')}`} style={{ width: `${(Number(q[e.chave]) / total) * 100}%`, background: e.cor }} />
      ))}
    </div>
  )
}

export function Legenda() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-tinta2">
      {ESTAGIOS.map((e) => (
        <span key={e.chave} className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: e.cor }} />{e.curto}</span>
      ))}
    </div>
  )
}

export function Painel({ titulo, children, onFechar, largura = 'max-w-2xl' }: { titulo: ReactNode; children: ReactNode; onFechar: () => void; largura?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onFechar])
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-navy/30" onClick={onFechar} />
      <div className={`relative bg-white w-full ${largura} h-full overflow-y-auto shadow-2xl`}>
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-linha px-5 py-4 flex items-center justify-between z-10">
          <div className="font-semibold text-lg">{titulo}</div>
          <button className="btn !p-2" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Carregando() {
  return <div className="flex items-center gap-2 text-tinta3 text-sm py-10 justify-center"><Loader2 className="animate-spin" size={18} />Carregando</div>
}
export function Vazio({ children }: { children: ReactNode }) {
  return <div className="text-center text-tinta3 text-sm py-12">{children}</div>
}
export function Erro({ msg }: { msg: string }) {
  return <div className="card p-4 text-rose text-sm">{msg}</div>
}

export function Titulo({ children, sub, acoes }: { children: ReactNode; sub?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
        {sub && <p className="text-tinta2 text-sm mt-1">{sub}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </div>
  )
}

export function Foto({ caminho, className = 'w-14 h-14' }: { caminho: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { urlAssinada('fotos', caminho).then(setUrl) }, [caminho])
  if (!url) return <div className={`${className} rounded-lg bg-fundo`} />
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} className={`${className} rounded-lg object-cover border border-linha`} alt="" /></a>
}

export function FotosInput({ valor, onChange, pasta, rotulo = 'Foto' }: { valor: string[]; onChange: (v: string[]) => void; pasta: string; rotulo?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const avisar = useAviso()
  return (
    <div className="flex flex-wrap items-center gap-2">
      {valor.map((c) => <Foto key={c} caminho={c} />)}
      <button type="button" className="btn !min-w-14 !h-14 !px-2 !py-0 flex-col !gap-0 text-[10px]" onClick={() => ref.current?.click()} disabled={enviando}>
        {enviando ? <Loader2 className="animate-spin" size={18} /> : <Camera size={18} />}{rotulo}
      </button>
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple hidden onChange={async (e) => {
        const files = Array.from(e.target.files ?? []); if (!files.length) return
        setEnviando(true)
        try {
          const novos: string[] = []
          for (const f of files) novos.push(await enviarArquivo('fotos', pasta, await comprimir(f)))
          onChange([...valor, ...novos])
        } catch (err) { avisar((err as Error).message, 'erro') } finally { setEnviando(false); e.target.value = '' }
      }} />
    </div>
  )
}

export function Doc({ caminho, children }: { caminho?: string | null; children: ReactNode }) {
  if (!caminho) return null
  return (
    <button className="btn" onClick={async () => { const u = await urlAssinada('documentos', caminho); if (u) window.open(u, '_blank') }}>{children}</button>
  )
}

// Avisa antes de sair/recarregar a página quando há trabalho não salvo.
export function useAvisoSaida(ativo: boolean) {
  useEffect(() => {
    if (!ativo) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [ativo])
}
