import { useState } from 'react'
import { sb } from '../lib/supabase'
import { useAviso } from '../components/ui'

export default function Login() {
  const [modo, setModo] = useState<'entrar' | 'criar' | 'esqueci'>('entrar')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const avisar = useAviso()

  async function enviar(e: React.FormEvent) {
    e.preventDefault(); setOcupado(true)
    try {
      if (modo === 'entrar') {
        const { error } = await sb.auth.signInWithPassword({ email, password: senha })
        if (error) throw error
      } else if (modo === 'criar') {
        const { error, data } = await sb.auth.signUp({ email, password: senha, options: { emailRedirectTo: window.location.origin } })
        if (error) throw error
        if (!data.session) avisar('Conta criada. Confirme pelo link enviado ao seu e-mail.')
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        if (error) throw error
        avisar('Enviamos um link para redefinir a senha.')
      }
    } catch (err) { avisar((err as Error).message, 'erro') } finally { setOcupado(false) }
  }

  return (
    <div className="min-h-full grid md:grid-cols-2">
      <div className="hidden md:flex bg-navy text-white p-12 flex-col justify-between">
        <div className="flex items-center gap-3"><img src="/favicon.svg" className="w-10 h-10" alt="" /><span className="text-xl font-semibold">CrossDock</span></div>
        <div>
          <h1 className="text-4xl font-semibold leading-tight max-w-md">Recebimento, consolidação e expedição no centro de distribuição parceiro.</h1>
          <p className="text-white/60 mt-4 max-w-md">Cada item que chega é conferido, fotografado, endereçado e casado com o pedido de venda. Nada sai sem NF.</p>
        </div>
        <div className="text-white/40 text-sm">Operador e CD, no mesmo fluxo</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={enviar} className="w-full max-w-sm">
          <div className="md:hidden flex items-center gap-3 mb-8"><img src="/favicon.svg" className="w-10 h-10" alt="" /><span className="text-xl font-semibold">CrossDock</span></div>
          <h2 className="text-2xl font-semibold">{modo === 'entrar' ? 'Entrar' : modo === 'criar' ? 'Primeiro acesso' : 'Recuperar senha'}</h2>
          <p className="text-tinta2 text-sm mt-1 mb-6">{modo === 'criar' ? 'Use o e-mail em que você foi convidado.' : 'Acesso para o operador e para a equipe do CD.'}</p>
          <label className="rotulo">E-mail</label>
          <input className="campo mb-4" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {modo !== 'esqueci' && <>
            <label className="rotulo">Senha</label>
            <input className="campo mb-6" type="password" autoComplete={modo === 'criar' ? 'new-password' : 'current-password'} required minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)} />
          </>}
          <button className="btn btn-primario btn-grande w-full" disabled={ocupado}>{modo === 'entrar' ? 'Entrar' : modo === 'criar' ? 'Criar conta' : 'Enviar link'}</button>
          <div className="flex justify-between text-sm mt-5 text-azul">
            <button type="button" onClick={() => setModo(modo === 'criar' ? 'entrar' : 'criar')}>{modo === 'criar' ? 'Já tenho conta' : 'Primeiro acesso'}</button>
            <button type="button" onClick={() => setModo('esqueci')}>Esqueci a senha</button>
          </div>
        </form>
      </div>
    </div>
  )
}
