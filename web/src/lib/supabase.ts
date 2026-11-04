import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
export const sb = createClient(SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY as string)

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export async function funcao<T = any>(nome: string, body?: unknown): Promise<T> {
  const { data, error } = await sb.functions.invoke(nome, { body: body ?? {} })
  if (error) throw new Error(error.message)
  return data as T
}

export async function enviarArquivo(bucket: 'fotos' | 'documentos', pasta: string, arquivo: Blob, nome?: string) {
  const ext = nome?.split('.').pop() || (arquivo.type.includes('png') ? 'png' : arquivo.type.includes('pdf') ? 'pdf' : arquivo.type.includes('xml') ? 'xml' : 'jpg')
  const caminho = `${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await sb.storage.from(bucket).upload(caminho, arquivo, { contentType: arquivo.type || undefined })
  if (error) throw new Error(error.message)
  return caminho
}

export async function urlAssinada(bucket: 'fotos' | 'documentos', caminho?: string | null) {
  if (!caminho) return null
  if (caminho.startsWith('url:')) return caminho.slice(4)
  const { data } = await sb.storage.from(bucket).createSignedUrl(caminho, 3600)
  return data?.signedUrl ?? null
}

// Reduz fotos do celular antes de enviar (lado maior 1600 px, JPEG 0,8).
export async function comprimir(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  const img = await createImageBitmap(file)
  const escala = Math.min(1, 1600 / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return await new Promise((r) => c.toBlob((b) => r(b ?? file), 'image/jpeg', 0.8))
}
