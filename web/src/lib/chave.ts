// Chave de acesso de NF-e (modelo 55) e CT-e (modelo 57): 44 dígitos com DV módulo 11.
export const soDigitos = (s: string) => String(s ?? '').replace(/\D/g, '')

export function chaveValida(chave: string, modelo: '55' | '57'): boolean {
  const c = soDigitos(chave)
  if (c.length !== 44 || c.slice(20, 22) !== modelo) return false
  let s = 0, p = 2
  for (let i = 42; i >= 0; i--) { s += Number(c[i]) * p; p = p === 9 ? 2 : p + 1 }
  let dv = 11 - (s % 11); if (dv >= 10) dv = 0
  return dv === Number(c[43])
}

// Leitura pode vir com prefixo (ex.: QR da NFC-e/CT-e com URL). Extrai a primeira sequência de 44 dígitos.
export function extrairChave(lido: string): string {
  const m = String(lido).match(/\d{44}/)
  return m ? m[0] : soDigitos(lido)
}

export const chaveFormatada = (c: string) => soDigitos(c).replace(/(\d{4})(?=\d)/g, '$1 ')
