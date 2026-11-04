import { describe, expect, it } from 'vitest'
import { chaveFormatada, chaveValida, extrairChave } from './chave'

const NFE = '35260111122233000183550010000000011000000017'
const CTE = '35260199988877000108570010000001231000001238'

describe('chaveValida', () => {
  it('aceita chaves com DV correto e o modelo certo', () => {
    expect(chaveValida(NFE, '55')).toBe(true)
    expect(chaveValida(CTE, '57')).toBe(true)
  })
  it('recusa DV errado, modelo trocado e tamanho diferente', () => {
    expect(chaveValida(NFE.slice(0, 43) + '8', '55')).toBe(false)
    expect(chaveValida(NFE, '57')).toBe(false)
    expect(chaveValida(NFE.slice(1), '55')).toBe(false)
  })
  it('ignora separadores', () => {
    expect(chaveValida(chaveFormatada(NFE), '55')).toBe(true)
  })
})

describe('extrairChave', () => {
  it('acha os 44 dígitos dentro de uma URL de QR code', () => {
    expect(extrairChave(`https://consulta.example.com/nfe?p=${NFE}|2|1|1`)).toBe(NFE)
  })
  it('sem sequência de 44 dígitos devolve só os dígitos', () => {
    expect(extrairChave('1234 5678')).toBe('12345678')
  })
})
