// Leitura de XML fiscal no navegador (NF-e e CT-e). Sem dependências.
const parse = (texto: string) => {
  const doc = new DOMParser().parseFromString(texto, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML inválido')
  return doc
}
const t = (el: Element | Document | null | undefined, nome: string) => el?.getElementsByTagName(nome)[0]?.textContent?.trim() ?? null
const todos = (el: Element | Document, nome: string) => Array.from(el.getElementsByTagName(nome))

export type NfeChegada = {
  chave: string | null; numero: string | null; serie: string | null; emissao: string | null; valor: number
  emitenteCnpj: string | null; emitenteNome: string | null; destCnpj: string | null
  itens: { n: number; codigo: string | null; descricao: string; ncm: string | null; unidade: string | null; qtd: number; valorUnit: number }[]
}

export function lerNfeChegada(texto: string): NfeChegada {
  const doc = parse(texto)
  const inf = doc.getElementsByTagName('infNFe')[0]
  if (!inf) throw new Error('Não é um XML de NF-e')
  const emit = doc.getElementsByTagName('emit')[0]
  const dest = doc.getElementsByTagName('dest')[0]
  return {
    chave: inf.getAttribute('Id')?.replace(/^NFe/, '') ?? null,
    numero: t(inf, 'nNF'), serie: t(inf, 'serie'), emissao: t(inf, 'dhEmi'),
    valor: Number(t(doc.getElementsByTagName('ICMSTot')[0], 'vNF') ?? 0),
    emitenteCnpj: t(emit, 'CNPJ') ?? t(emit, 'CPF'), emitenteNome: t(emit, 'xNome'),
    destCnpj: t(dest, 'CNPJ') ?? t(dest, 'CPF'),
    itens: todos(doc, 'det').map((d) => {
      const p = d.getElementsByTagName('prod')[0]
      return {
        n: Number(d.getAttribute('nItem')), codigo: t(p, 'cProd'), descricao: t(p, 'xProd') ?? '', ncm: t(p, 'NCM'),
        unidade: t(p, 'uCom'), qtd: Number(t(p, 'qCom') ?? 0), valorUnit: Number(t(p, 'vUnCom') ?? 0),
      }
    }),
  }
}

export function lerNfeSaida(texto: string) {
  const doc = parse(texto)
  const inf = doc.getElementsByTagName('infNFe')[0]
  if (!inf) throw new Error('Não é um XML de NF-e')
  const vols = todos(doc.getElementsByTagName('transp')[0] ?? doc, 'vol')
  const soma = (n: string) => vols.reduce((s, v) => s + Number(t(v, n) ?? 0), 0)
  const dest = doc.getElementsByTagName('dest')[0]
  return {
    chave: inf.getAttribute('Id')?.replace(/^NFe/, '') ?? null,
    numero: t(inf, 'nNF'),
    qVol: vols.length ? soma('qVol') : null,
    pesoB: vols.length ? Math.round(soma('pesoB') * 1000) / 1000 : null,
    pesoL: vols.length ? Math.round(soma('pesoL') * 1000) / 1000 : null,
    destCnpj: t(dest, 'CNPJ') ?? t(dest, 'CPF'),
  }
}

export function lerCte(texto: string) {
  const doc = parse(texto)
  const inf = doc.getElementsByTagName('infCte')[0]
  if (!inf) throw new Error('Não é um XML de CT-e')
  const prest = doc.getElementsByTagName('vPrest')[0]
  const componentes = todos(prest ?? doc, 'Comp').map((c) => ({ nome: t(c, 'xNome'), valor: Number(t(c, 'vComp') ?? 0) }))
  const qs = todos(doc, 'infQ').map((q) => ({ tipo: (t(q, 'tpMed') ?? '').toUpperCase(), q: Number(t(q, 'qCarga') ?? 0) }))
  const taxado = qs.find((q) => /TAXAD|BASE|CUBAD/.test(q.tipo)) ?? qs.find((q) => /PESO/.test(q.tipo))
  return {
    chave: inf.getAttribute('Id')?.replace(/^CTe/, '') ?? null,
    numero: t(inf, 'nCT'),
    valor: Number(t(prest, 'vTPrest') ?? 0),
    componentes,
    pesoTaxado: taxado?.q ?? null,
    nfes: todos(doc, 'infNFe').map((n) => t(n, 'chave')).filter(Boolean) as string[],
  }
}
