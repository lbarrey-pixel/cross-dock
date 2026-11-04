import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { BarChart3, Boxes, GitMerge, Home, LogOut, PackageOpen, Settings, Truck, Warehouse, HelpCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { sb } from '../lib/supabase'
import type { Perfil } from '../App'

function Logo({ claro = false }: { claro?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" className="w-8 h-8" alt="" />
      <div className="leading-tight">
        <div className={`font-semibold ${claro ? 'text-white' : ''}`}>CrossDock</div>
        <div className={`text-[11px] ${claro ? 'text-white/60' : 'text-tinta3'}`}>centro de distribuição</div>
      </div>
    </div>
  )
}

const ABAS_OPERADOR: { to: string; Icone: LucideIcon; texto: string }[] = [
  { to: '/operador', Icone: Home, texto: 'Painel' },
  { to: '/operador/casamentos', Icone: GitMerge, texto: 'Casamento' },
  { to: '/operador/sem-dono', Icone: HelpCircle, texto: 'Sem pedido' },
  { to: '/operador/frete', Icone: BarChart3, texto: 'Frete' },
  { to: '/operador/config', Icone: Settings, texto: 'Config' },
]
const ABAS_CD: { to: string; Icone: LucideIcon; texto: string }[] = [
  { to: '/cd', Icone: Home, texto: 'Início' },
  { to: '/cd/receber', Icone: PackageOpen, texto: 'Recebimento' },
  { to: '/cd/separacao', Icone: Boxes, texto: 'Separação' },
  { to: '/cd/expedicao', Icone: Truck, texto: 'Expedição' },
]

const Item = ({ to, icone, children }: { to: string; icone: ReactNode; children: ReactNode }) => (
  <NavLink to={to} end className={({ isActive }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${isActive ? 'bg-white/12 text-white' : 'text-white/70 hover:text-white hover:bg-white/6'}`}>
    {icone}{children}
  </NavLink>
)

export function LayoutOperador({ perfil }: { perfil: Perfil }) {
  const nav = useNavigate()
  return (
    <div className="min-h-full md:flex">
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 bg-navy text-white p-4 sticky top-0 h-screen">
        <Logo claro />
        <nav className="mt-8 flex flex-col gap-1">
          <Item to="/operador" icone={<Home size={18} />}>Painel</Item>
          <Item to="/operador/casamentos" icone={<GitMerge size={18} />}>Casamento</Item>
          <Item to="/operador/sem-dono" icone={<HelpCircle size={18} />}>Itens sem pedido</Item>
          <Item to="/operador/frete" icone={<BarChart3 size={18} />}>Frete</Item>
          <Item to="/operador/config" icone={<Settings size={18} />}>Configurações</Item>
        </nav>
        <div className="mt-6 pt-4 border-t border-white/10 flex flex-col gap-1">
          <Item to="/cd" icone={<Warehouse size={18} />}>Visão do CD</Item>
        </div>
        <div className="mt-auto text-xs text-white/60">
          <div className="text-white/90">{perfil.nome}</div>
          <button className="mt-2 inline-flex items-center gap-1.5 hover:text-white" onClick={async () => { await sb.auth.signOut(); nav('/') }}>
            <LogOut size={14} />Sair
          </button>
        </div>
      </aside>
      <header className="md:hidden bg-navy text-white px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <Logo claro />
        <button className="text-white/70 text-sm" onClick={async () => { await sb.auth.signOut(); nav('/') }}>Sair</button>
      </header>
      <main className="flex-1 min-w-0 p-4 md:p-8 pb-24 md:pb-8 max-w-[1400px]">
        <Outlet />
      </main>
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-linha grid grid-cols-5 text-[11px] z-30">
        {ABAS_OPERADOR.map(({ to, Icone, texto }) => (
          <NavLink key={to} to={to} end className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 ${isActive ? 'text-azul' : 'text-tinta3'}`}>
            <Icone size={20} />{texto}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export function LayoutCd({ perfil }: { perfil: Perfil }) {
  const nav = useNavigate()
  return (
    <div className="min-h-full">
      <header className="bg-navy text-white px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <Logo claro />
        <div className="flex items-center gap-3 text-sm">
          {perfil.papel === 'operador' && <NavLink to="/operador" className="text-white/80">Painel do operador</NavLink>}
          <button className="text-white/70" onClick={async () => { await sb.auth.signOut(); nav('/') }}>Sair</button>
        </div>
      </header>
      <main className="p-4 pb-28 max-w-2xl mx-auto">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-linha z-30" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-4 text-[11px] max-w-2xl mx-auto">
          {ABAS_CD.map(({ to, Icone, texto }) => (
            <NavLink key={to} to={to} end className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2.5 ${isActive ? 'text-azul' : 'text-tinta3'}`}>
              <Icone size={22} />{texto}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

