export const brl = (v?: number | null, d = 2) =>
  v === null || v === undefined || isNaN(Number(v)) ? '–' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: d, maximumFractionDigits: d })
export const num = (v?: number | null, d = 0) =>
  v === null || v === undefined || isNaN(Number(v)) ? '–' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
export const data = (v?: string | null) => (v ? new Date(v.length <= 10 ? v + 'T12:00' : v).toLocaleDateString('pt-BR') : '–')
export const dataHora = (v?: string | null) =>
  v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–'
export const cnpj = (v?: string | null) => {
  const d = (v ?? '').replace(/\D/g, '')
  return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : v ?? '–'
}
