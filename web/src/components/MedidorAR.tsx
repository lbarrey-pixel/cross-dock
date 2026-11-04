import { useEffect, useRef, useState } from 'react'
import { Ruler, X } from 'lucide-react'

// Medição do volume com a câmera (realidade aumentada, WebXR + hit-test).
// Funciona no Chrome do Android com ARCore. No iPhone o Safari não tem WebXR: o botão avisa e o operador digita.
export type Medidas = { c: number; l: number; a: number }

const ETAPAS = [
  { chave: 'c', nome: 'Comprimento', dica: 'Toque num canto da tampa da caixa e depois no canto do outro lado, no lado mais comprido.' },
  { chave: 'l', nome: 'Largura', dica: 'Agora os dois cantos do lado mais curto da tampa.' },
  { chave: 'a', nome: 'Altura', dica: 'Toque no chão, encostado na caixa, e depois na tampa, logo acima.' },
] as const

export function BotaoMedirAR({ onMedido }: { onMedido: (m: Medidas) => void }) {
  const [suporte, setSuporte] = useState<'sim' | 'nao' | '?'>('?')
  const [aberto, setAberto] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  useEffect(() => {
    const xr = (navigator as any).xr
    const consulta: Promise<boolean> = xr?.isSessionSupported ? xr.isSessionSupported('immersive-ar') : Promise.resolve(false)
    consulta.then((ok) => setSuporte(ok ? 'sim' : 'nao')).catch(() => setSuporte('nao'))
  }, [])
  return (
    <>
      <button type="button" className="btn w-full" onClick={() => {
        if (suporte === 'sim') setAberto(true)
        else setAviso('Este aparelho não mede pela câmera no navegador (precisa de Android com Chrome e ARCore). Meça com trena ou com o app de medida do celular e digite as medidas.')
      }}><Ruler size={16} />Medir com a câmera</button>
      {aviso && <div className="text-xs text-ambar bg-ambar-50 rounded-lg p-2">{aviso}</div>}
      {aberto && <MedicaoAR onFim={(m) => { setAberto(false); if (m) onMedido(m) }} />}
    </>
  )
}

function MedicaoAR({ onFim }: { onFim: (m: Medidas | null) => void }) {
  const overlay = useRef<HTMLDivElement>(null)
  const [pontos, setPontos] = useState(0)
  const [medidas, setMedidas] = useState<Partial<Record<'c' | 'l' | 'a', number>>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [mirando, setMirando] = useState(false)
  const ctl = useRef<{ desfazer: () => void; encerrar: () => void } | null>(null)
  const etapa = Math.min(Math.floor(pontos / 2), 2)
  const pronto = pontos >= 6

  useEffect(() => {
    let session: any = null
    let encerrado = false
    ;(async () => {
      try {
        const THREE = await import('three')
        const xr = (navigator as any).xr
        session = await xr.requestSession('immersive-ar', {
          requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: overlay.current },
        })
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(window.devicePixelRatio)
        renderer.xr.enabled = true
        renderer.xr.setReferenceSpaceType('local')
        await renderer.xr.setSession(session)
        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera()
        scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 3))

        const reticle = new THREE.Mesh(
          new THREE.RingGeometry(0.012, 0.018, 32).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0x5b9bff }),
        )
        reticle.matrixAutoUpdate = false
        reticle.visible = false
        scene.add(reticle)

        const marcados: InstanceType<typeof THREE.Vector3>[] = []
        const objetos: InstanceType<typeof THREE.Object3D>[] = []
        const matPonto = new THREE.MeshBasicMaterial({ color: 0xf08a3c })
        const matLinha = new THREE.LineBasicMaterial({ color: 0xf08a3c })

        const recalcular = () => {
          const m: Partial<Record<'c' | 'l' | 'a', number>> = {}
          for (let i = 0; i + 1 < marcados.length; i += 2) {
            const [p, q] = [marcados[i], marcados[i + 1]]
            const k = ETAPAS[i / 2].chave
            // Comprimento e largura na horizontal; altura na vertical.
            const cm = k === 'a' ? Math.abs(q.y - p.y) * 100 : Math.hypot(q.x - p.x, q.z - p.z) * 100
            m[k] = Math.round(cm)
          }
          setMedidas(m)
          setPontos(marcados.length)
        }

        session.addEventListener('select', () => {
          if (!reticle.visible || marcados.length >= 6) return
          const p = new THREE.Vector3().setFromMatrixPosition(reticle.matrix)
          marcados.push(p)
          const esfera = new THREE.Mesh(new THREE.SphereGeometry(0.008, 16, 16), matPonto)
          esfera.position.copy(p); scene.add(esfera); objetos.push(esfera)
          if (marcados.length % 2 === 0) {
            const a = marcados[marcados.length - 2]
            const linha = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, p]), matLinha)
            scene.add(linha); objetos.push(linha)
          }
          recalcular()
        })

        ctl.current = {
          desfazer: () => {
            if (!marcados.length) return
            const removerLinha = marcados.length % 2 === 0
            marcados.pop()
            for (let n = removerLinha ? 2 : 1; n > 0; n--) { const o = objetos.pop(); if (o) scene.remove(o) }
            recalcular()
          },
          encerrar: () => { session?.end().catch(() => {}) },
        }

        const viewer = await session.requestReferenceSpace('viewer')
        const hitSource = await session.requestHitTestSource({ space: viewer })
        renderer.setAnimationLoop((_t: number, frame: any) => {
          if (!frame) return
          const ref = renderer.xr.getReferenceSpace()
          const hits = frame.getHitTestResults(hitSource)
          if (hits.length) {
            const pose = hits[0].getPose(ref)
            reticle.visible = true
            reticle.matrix.fromArray(pose.transform.matrix)
          } else reticle.visible = false
          setMirando(reticle.visible)
          renderer.render(scene, camera)
        })
        session.addEventListener('end', () => {
          renderer.setAnimationLoop(null); hitSource?.cancel?.(); renderer.dispose()
          if (!encerrado) onFim(null)
        })
      } catch (e) {
        setErro('Não consegui abrir a câmera em modo de medição: ' + (e as Error).message)
      }
    })()
    return () => { encerrado = true; session?.end().catch(() => {}) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const usar = () => {
    const m = medidas as Medidas
    ctl.current?.encerrar()
    onFim({ c: m.c, l: m.l, a: m.a })
  }

  return (
    <div ref={overlay} className="fixed inset-0 z-50 pointer-events-none" style={{ background: 'transparent' }}>
      <div className="absolute inset-0 grid place-items-center">
        <div className={`w-6 h-6 rounded-full border-2 ${mirando ? 'border-white' : 'border-white/30'}`} />
      </div>
      {/* Toques nos painéis não contam como marcação de ponto (beforexrselect). */}
      <div className="absolute top-0 inset-x-0 p-3 pointer-events-auto" ref={(el) => el?.addEventListener('beforexrselect', (e) => e.preventDefault())}>
        <div className="bg-black/70 text-white rounded-xl p-3 space-y-2">
          <div className="flex justify-between items-start gap-2">
            <div className="text-sm">
              {erro ? <span className="text-rose-300">{erro}</span>
                : pronto ? <b>Medição concluída. Confira e use as medidas.</b>
                : <><b>{ETAPAS[etapa].nome}</b> · {ETAPAS[etapa].dica}</>}
              {!erro && !pronto && <div className="text-white/70 text-xs mt-1">{mirando ? 'Mire e toque na tela para marcar o ponto.' : 'Mova o celular devagar sobre a caixa e o chão até aparecer o círculo azul.'}</div>}
            </div>
            <button className="p-1" onClick={() => { ctl.current?.encerrar(); onFim(null) }} aria-label="Fechar"><X size={20} /></button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center num">
            {ETAPAS.map((e) => (
              <div key={e.chave} className={`rounded-lg py-1 ${medidas[e.chave] != null ? 'bg-white/20' : 'bg-white/5'}`}>
                <div className="text-[10px] text-white/70">{e.nome}</div>
                <div className="text-lg">{medidas[e.chave] != null ? `${medidas[e.chave]} cm` : '–'}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute bottom-0 inset-x-0 p-3 pointer-events-auto flex gap-2" ref={(el) => el?.addEventListener('beforexrselect', (e) => e.preventDefault())}>
        <button className="btn flex-1" disabled={!pontos} onClick={() => ctl.current?.desfazer()}>Desfazer ponto</button>
        <button className="btn btn-primario flex-1" disabled={!pronto} onClick={usar}>Usar medidas</button>
      </div>
    </div>
  )
}
