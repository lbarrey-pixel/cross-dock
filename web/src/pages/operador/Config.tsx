import { useState } from 'react'
import { FileKey, Link2, Plus } from 'lucide-react'
import { funcao, rpc, sb, SUPABASE_URL } from '../../lib/supabase'
import { cnpj, data, dataHora } from '../../lib/fmt'
import { Badge, Carregando, Titulo, useAcao, useCarregar } from '../../components/ui'

const CREDS: [string, string, boolean][] = [
  ['erp_client_id', 'ERP · Client ID', false], ['erp_client_secret', 'ERP · Client Secret', true],
  ['transportadora_usuario', 'Transportadora · usuário', false], ['transportadora_senha', 'Transportadora · senha', true], ['transportadora_company_id', 'Transportadora · companyId (padrão 1)', false],
  ['llm_api_url', 'LLM · URL da API de chat (opcional)', false], ['llm_api_key', 'LLM · chave', true], ['llm_model', 'LLM · modelo', false],
  ['sefaz_gw_url', 'Gateway SEFAZ · URL (opcional)', false], ['sefaz_gw_token', 'Gateway SEFAZ · token', true],
]

export default function Config() {
  const { ocupado, rodar } = useAcao()
  const { dados, recarregar } = useCarregar(async () => {
    const [cfg, conv, st] = await Promise.all([
      sb.from('config').select('*'), sb.from('convites').select('*').order('criado_em'), rpc<any>('status_integracoes'),
    ])
    return { cfg: Object.fromEntries((cfg.data ?? []).map((c: any) => [c.chave, c.valor])), conv: conv.data ?? [], st }
  })
  const [corte, setCorte] = useState('')
  const [cred, setCred] = useState<Record<string, string>>({})
  const [novo, setNovo] = useState({ email: '', nome: '', papel: 'cd' })
  const [pfx, setPfx] = useState<File | null>(null)
  const [senhaPfx, setSenhaPfx] = useState('')
  if (!dados) return <Carregando />
  const redirect = `${SUPABASE_URL}/functions/v1/erp-oauth`
  const sync = dados.st?.erp_ultima_sync

  return (
    <>
      <Titulo>Configurações</Titulo>
      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card p-5">
          <h2 className="font-semibold">Entrada de pedidos</h2>
          <p className="text-sm text-tinta2 mt-1">Entram no fluxo os pedidos “Em aberto” do ERP com número igual ou maior que o corte. Zero desliga a importação.</p>
          <div className="flex gap-2 mt-4 items-end">
            <div className="flex-1"><label className="rotulo">Número de corte</label><input className="campo num" inputMode="numeric" placeholder={String(dados.cfg.corte_pedido ?? 0)} value={corte} onChange={(e) => setCorte(e.target.value)} /></div>
            <button className="btn btn-primario" disabled={ocupado || !corte} onClick={() => rodar(async () => {
              const { error } = await sb.from('config').upsert({ chave: 'corte_pedido', valor: Number(corte), atualizado_em: new Date().toISOString() })
              if (error) throw error; setCorte(''); recarregar()
            }, 'Corte salvo')}>Salvar</button>
          </div>
          <div className="text-sm mt-3">Corte atual: <b className="num">{String(dados.cfg.corte_pedido ?? 0)}</b> · CD: {String(dados.cfg.cd_endereco ?? '')}</div>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold">Integrações</h2>
          <div className="flex flex-wrap gap-2 mt-3">
            <Badge tom={dados.st?.erp_conectado ? 'verde' : 'ambar'}>ERP {dados.st?.erp_conectado ? 'conectado' : 'não conectado'}</Badge>
            {['transportadora_usuario', 'transportadora_senha'].every((c) => dados.st?.credenciais?.includes(c)) ? <Badge tom="verde">Transportadora configurada</Badge> : <Badge tom="ambar">Transportadora sem credenciais</Badge>}
            <Badge tom={dados.st?.credenciais?.includes('llm_api_key') ? 'verde' : 'neutro'}>IA {dados.st?.credenciais?.includes('llm_api_key') ? 'ligada' : 'só regras'}</Badge>
            <Badge tom={dados.st?.sefaz_certificado?.cnpj ? 'verde' : 'ambar'}>SEFAZ {dados.st?.sefaz_certificado?.cnpj ? 'com certificado' : 'sem certificado'}</Badge>
          </div>
          {sync && <div className="text-xs text-tinta2 mt-3">Última sincronização: {dataHora(sync.em)} {sync.erro ? <span className="text-rose">· {sync.erro}</span> : ''}<br />{(sync.log ?? []).slice(0, 3).join(' · ')}</div>}
          <div className="mt-4 text-sm bg-fundo rounded-lg p-3">
            <div className="text-xs text-tinta2 mb-1">URL de redirecionamento para cadastrar no aplicativo do ERP:</div>
            <code className="text-xs break-all">{redirect}</code>
          </div>
          <a className="btn btn-azul mt-3" href={`${redirect}?iniciar=1`} target="_blank" rel="noreferrer"><Link2 size={16} />Conectar ERP</a>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold">Certificado digital (SEFAZ)</h2>
          <p className="text-sm text-tinta2 mt-1">e-CNPJ A1 da empresa (.pfx). Com ele o sistema busca na SEFAZ o XML oficial das NF de origem lidas no CD e os CT-e das expedições. Ao buscar uma nota, registra a Ciência da Operação em nome da empresa, que é o que libera o XML completo.</p>
          {dados.st?.sefaz_certificado?.cnpj ? (
            <div className="mt-3 text-sm bg-fundo rounded-lg p-3">
              <div className="font-medium">{dados.st.sefaz_certificado.titular}</div>
              <div className="text-tinta2">CNPJ {cnpj(dados.st.sefaz_certificado.cnpj)} · válido até {data(dados.st.sefaz_certificado.validade)}</div>
              {dados.st?.sefaz_cte_sync && <div className="text-xs text-tinta3 mt-1">CT-e: última busca {dataHora(dados.st.sefaz_cte_sync.em)} · {dados.st.sefaz_cte_sync.novos} novos · {dados.st.sefaz_cte_sync.xMotivo}</div>}
            </div>
          ) : null}
          <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 mt-4 items-end">
            <div><label className="rotulo">Arquivo .pfx</label>
              <label className="btn w-full cursor-pointer"><FileKey size={16} />{pfx ? pfx.name : 'Escolher arquivo'}
                <input type="file" accept=".pfx,.p12,application/x-pkcs12" hidden onChange={(e) => setPfx(e.target.files?.[0] ?? null)} /></label></div>
            <div><label className="rotulo">Senha do certificado</label>
              <input className="campo" type="password" autoComplete="off" value={senhaPfx} onChange={(e) => setSenhaPfx(e.target.value)} /></div>
            <button className="btn btn-primario" disabled={ocupado || !pfx || !senhaPfx} onClick={() => rodar(async () => {
              const buf = new Uint8Array(await pfx!.arrayBuffer())
              let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
              const r = await funcao('sefaz', { acao: 'certificado', pfx_b64: btoa(bin), senha: senhaPfx })
              if (!r?.ok) throw new Error(r?.erro ?? 'Falha ao salvar o certificado')
              setPfx(null); setSenhaPfx(''); recarregar()
            }, 'Certificado salvo')}>Salvar</button>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold">Credenciais</h2>
          <p className="text-sm text-tinta2 mt-1">Ficam só no banco e nunca voltam para a tela. Preencha para salvar ou substituir.</p>
          <div className="space-y-3 mt-4">
            {CREDS.map(([k, rot, secreto]) => (
              <div key={k} className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="rotulo">{rot} {dados.st?.credenciais?.includes(k) && <span className="text-verde">· salvo</span>}</label>
                  <input className="campo" type={secreto ? 'password' : 'text'} autoComplete="off" value={cred[k] ?? ''} onChange={(e) => setCred({ ...cred, [k]: e.target.value })} />
                </div>
                <button className="btn" disabled={ocupado || !cred[k]} onClick={() => rodar(async () => {
                  await rpc('salvar_credencial', { p_chave: k, p_valor: cred[k] }); setCred({ ...cred, [k]: '' }); recarregar()
                }, 'Credencial salva')}>Salvar</button>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold">Usuários</h2>
          <p className="text-sm text-tinta2 mt-1">Convide pelo e-mail. A pessoa entra em “Primeiro acesso” com esse e-mail.</p>
          <ul className="divide-y divide-linha mt-3 text-sm">
            {dados.conv.map((c: any) => <li key={c.email} className="py-2 flex justify-between gap-2"><span>{c.nome} · <span className="text-tinta2">{c.email}</span></span><Badge tom={c.papel === 'operador' ? 'azul' : 'verde'}>{c.papel === 'operador' ? 'Operador' : 'CD'}</Badge></li>)}
          </ul>
          <div className="grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2 mt-3">
            <input className="campo" placeholder="Nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
            <input className="campo" placeholder="E-mail" type="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} />
            <select className="campo" value={novo.papel} onChange={(e) => setNovo({ ...novo, papel: e.target.value })}><option value="cd">CD</option><option value="operador">Operador</option></select>
            <button className="btn btn-primario" disabled={ocupado || !novo.email || !novo.nome} onClick={() => rodar(async () => {
              const { error } = await sb.from('convites').insert({ ...novo, email: novo.email.trim().toLowerCase() }); if (error) throw error
              setNovo({ email: '', nome: '', papel: 'cd' }); recarregar()
            }, 'Convite criado')}><Plus size={16} />Convidar</button>
          </div>
        </section>
        <section className="card p-5 lg:col-span-2">
          <h2 className="font-semibold">Dados de demonstração</h2>
          <p className="text-sm text-tinta2 mt-1">Cria dois pedidos de teste (#990001 e #990002) para exercitar recebimento, casamento, consolidação e expedição sem o ERP. “Tirar demo” coloca os dois fora do fluxo.</p>
          <div className="flex gap-2 mt-3">
            <button className="btn" disabled={ocupado} onClick={() => rodar(async () => { await rpc('seed_demo') }, 'Pedidos de demonstração criados')}>Criar demo</button>
            <button className="btn" disabled={ocupado} onClick={() => rodar(async () => { await rpc('limpar_demo') }, 'Demo removida do fluxo')}>Tirar demo</button>
          </div>
        </section>
      </div>
    </>
  )
}
