// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { lerCte, lerNfeChegada, lerNfeSaida } from './xml'

const NFE = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe35260111122233000183550010000000011000000017" versao="4.00">
<ide><nNF>1</nNF><serie>1</serie><dhEmi>2026-01-10T09:00:00-03:00</dhEmi></ide>
<emit><CNPJ>11122233000183</CNPJ><xNome>FORNECEDOR DEMO LTDA</xNome></emit>
<dest><CNPJ>12345678000195</CNPJ></dest>
<det nItem="1"><prod><cProd>4380000</cProd><xProd>JOGO CHAVES COMBINADAS</xProd><NCM>82041100</NCM><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>300.00</vUnCom></prod></det>
<det nItem="2"><prod><cProd>FITA-1</cProd><xProd>FITA CREPE</xProd><NCM>48142000</NCM><uCom>CX</uCom><qCom>24.0000</qCom><vUnCom>10.50</vUnCom></prod></det>
<total><ICMSTot><vNF>852.00</vNF></ICMSTot></total>
<transp><vol><qVol>2</qVol><pesoL>1.5</pesoL><pesoB>2.0</pesoB></vol><vol><qVol>1</qVol><pesoL>1.5</pesoL><pesoB>1.5</pesoB></vol></transp>
</infNFe></NFe></nfeProc>`

describe('lerNfeChegada', () => {
  it('extrai cabeçalho e itens', () => {
    const nf = lerNfeChegada(NFE)
    expect(nf.chave).toBe('35260111122233000183550010000000011000000017')
    expect(nf.emitenteNome).toBe('FORNECEDOR DEMO LTDA')
    expect(nf.valor).toBe(852)
    expect(nf.itens).toHaveLength(2)
    expect(nf.itens[0]).toMatchObject({ n: 1, codigo: '4380000', qtd: 2, valorUnit: 300, ncm: '82041100' })
  })
  it('recusa XML que não é NF-e e XML quebrado', () => {
    expect(() => lerNfeChegada('<a/>')).toThrow('Não é um XML de NF-e')
    expect(() => lerNfeChegada('<a>')).toThrow('XML inválido')
  })
})

describe('lerNfeSaida', () => {
  it('soma volumes e pesos', () => {
    const nf = lerNfeSaida(NFE)
    expect(nf).toMatchObject({ qVol: 3, pesoB: 3.5, pesoL: 3, destCnpj: '12345678000195' })
  })
})

describe('lerCte', () => {
  const CTE = `<cteProc><CTe><infCte Id="CTe35260199988877000108570010000001231000001238"><ide><nCT>123</nCT></ide>
  <vPrest><vTPrest>1234.56</vTPrest><Comp><xNome>FRETE VALOR</xNome><vComp>1000.00</vComp></Comp></vPrest>
  <infCarga><infQ><tpMed>PESO BRUTO</tpMed><qCarga>80</qCarga></infQ><infQ><tpMed>PESO BASE DE CALCULO</tpMed><qCarga>120</qCarga></infQ></infCarga>
  <infDoc><infNFe><chave>35260111122233000183550010000000011000000017</chave></infNFe></infDoc></infCte></CTe></cteProc>`
  it('lê valor, componentes, peso taxado e NFs', () => {
    const c = lerCte(CTE)
    expect(c.numero).toBe('123')
    expect(c.valor).toBe(1234.56)
    expect(c.componentes).toEqual([{ nome: 'FRETE VALOR', valor: 1000 }])
    expect(c.pesoTaxado).toBe(120)
    expect(c.nfes).toEqual(['35260111122233000183550010000000011000000017'])
  })
})
