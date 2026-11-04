import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { sb } from './lib/supabase'
import { AvisoProvider, Carregando } from './components/ui'
import { LayoutOperador, LayoutCd } from './components/Layout'
import Login from './pages/Login'
import Painel from './pages/operador/Painel'
import Casamentos from './pages/operador/Casamentos'
import SemDono from './pages/operador/SemDono'
import Frete from './pages/operador/Frete'
import Config from './pages/operador/Config'
import CdInicio from './pages/cd/Inicio'
import Receber from './pages/cd/Receber'
import Enderecar from './pages/cd/Enderecar'
import Separacao from './pages/cd/Separacao'
import Expedicao from './pages/cd/Expedicao'
import Enderecos from './pages/cd/Enderecos'

export type Perfil = { user_id: string; nome: string; email: string; papel: 'operador' | 'cd' }

export default function App() {
  const [autenticacao, setAutenticacao] = useState<Session | null | undefined>(undefined)
  const [carregado, setCarregado] = useState<{ uid: string; perfil: Perfil | null } | null>(null)

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setAutenticacao(data.session))
    const { data } = sb.auth.onAuthStateChange((_e, s) => setAutenticacao(s))
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!autenticacao) return
    const uid = autenticacao.user.id
    sb.from('perfis').select('*').eq('user_id', uid).maybeSingle().then(({ data }) => setCarregado({ uid, perfil: (data as Perfil) ?? null }))
  }, [autenticacao])
  // Perfil ainda não carregado para o usuário atual = undefined (evita mostrar o perfil de quem saiu).
  const perfil = autenticacao && carregado?.uid === autenticacao.user.id ? carregado.perfil : undefined

  if (autenticacao === undefined || (autenticacao && perfil === undefined)) return <Carregando />
  if (!autenticacao) return <AvisoProvider><Login /></AvisoProvider>
  if (!perfil) return (
    <div className="max-w-md mx-auto mt-[20vh] card p-6 text-sm">
      <div className="font-semibold text-lg mb-2">Acesso pendente</div>
      <p className="text-tinta2">O e-mail {autenticacao.user.email} ainda não foi convidado. Peça para o operador cadastrar você em Configurações.</p>
      <button className="btn mt-4" onClick={() => sb.auth.signOut()}>Sair</button>
    </div>
  )

  return (
    <AvisoProvider>
      <BrowserRouter>
        <Routes>
          {perfil.papel === 'operador' && (
            <Route path="/operador" element={<LayoutOperador perfil={perfil} />}>
              <Route index element={<Painel />} />
              <Route path="casamentos" element={<Casamentos />} />
              <Route path="sem-dono" element={<SemDono />} />
              <Route path="frete" element={<Frete />} />
              <Route path="config" element={<Config />} />
            </Route>
          )}
          <Route path="/cd" element={<LayoutCd perfil={perfil} />}>
            <Route index element={<CdInicio />} />
            <Route path="receber" element={<Receber />} />
            <Route path="enderecar" element={<Enderecar />} />
            <Route path="separacao" element={<Separacao />} />
            <Route path="expedicao" element={<Expedicao />} />
            <Route path="enderecos" element={<Enderecos />} />
          </Route>
          <Route path="*" element={<Navigate to={perfil.papel === 'operador' ? '/operador' : '/cd'} replace />} />
        </Routes>
      </BrowserRouter>
    </AvisoProvider>
  )
}
