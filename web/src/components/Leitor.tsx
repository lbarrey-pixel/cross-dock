import { useEffect, useRef, useState } from 'react'
import { ScanLine, X } from 'lucide-react'

// Leitura de código de barras/QR pela câmera do celular.
// Usa o leitor nativo do navegador (Chrome/Android) e, onde ele não existe (iPhone), a biblioteca ZXing.
export function BotaoLeitor({ onLido, texto, grande = false }: { onLido: (v: string) => void; texto?: string; grande?: boolean }) {
  const [aberto, setAberto] = useState(false)
  const temCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  if (!temCamera) return null
  return (
    <>
      <button type="button" className={texto ? `btn btn-primario w-full ${grande ? 'btn-grande' : ''}` : 'btn !px-3'} onClick={() => setAberto(true)} aria-label={texto ?? 'Ler código'}>
        <ScanLine size={grande ? 22 : 18} />{texto}
      </button>
      {aberto && <Leitor onLido={(v) => { setAberto(false); onLido(v) }} onFechar={() => setAberto(false)} />}
    </>
  )
}

function Leitor({ onLido, onFechar }: { onLido: (v: string) => void; onFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    let stream: MediaStream | null = null
    let parar = false
    let controleZxing: { stop: () => void } | null = null
    ;(async () => {
      try {
        if ('BarcodeDetector' in window) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } })
          if (!video.current) return
          video.current.srcObject = stream
          await video.current.play()
          const det = new (window as any).BarcodeDetector({ formats: ['code_128', 'qr_code', 'code_39', 'ean_13', 'itf'] })
          while (!parar) {
            try {
              const r = await det.detect(video.current)
              if (r[0]?.rawValue) { onLido(String(r[0].rawValue).trim()); break }
            } catch { /* quadro ruim */ }
            await new Promise((ok) => setTimeout(ok, 200))
          }
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          const { DecodeHintType, BarcodeFormat } = await import('@zxing/library')
          const dicas = new Map()
          dicas.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.EAN_13])
          dicas.set(DecodeHintType.TRY_HARDER, true)
          const leitor = new BrowserMultiFormatReader(dicas)
          if (!video.current || parar) return
          controleZxing = await leitor.decodeFromConstraints({ video: { facingMode: 'environment', width: { ideal: 1920 } } }, video.current, (res) => {
            if (res && !parar) { parar = true; controleZxing?.stop(); onLido(res.getText().trim()) }
          })
        }
      } catch (e) {
        setErro((e as Error).name === 'NotAllowedError' ? 'Permita o uso da câmera para ler o código.' : 'Não consegui abrir a câmera.')
      }
    })()
    return () => { parar = true; controleZxing?.stop(); stream?.getTracks().forEach((t) => t.stop()) }
  }, [onLido])
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <video ref={video} className="flex-1 object-cover" playsInline muted />
      <div className="absolute inset-x-6 top-1/3 h-36 border-2 border-white/80 rounded-2xl" />
      <div className="absolute inset-x-0 top-[calc(33%+10rem)] text-center text-white/90 text-sm px-6">
        {erro ?? 'Aponte para o código de barras, deitado dentro do quadro'}
      </div>
      <button className="absolute top-4 right-4 btn !p-2" onClick={onFechar} aria-label="Fechar"><X size={20} /></button>
    </div>
  )
}
