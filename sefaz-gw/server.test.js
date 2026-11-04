import test from 'node:test'
import assert from 'node:assert/strict'
import { hostPermitido, igual, servidor } from './server.js'

test('só aceita destinos da SEFAZ', () => {
  assert.ok(hostPermitido('www1.nfe.fazenda.gov.br'))
  assert.ok(hostPermitido('www1.cte.fazenda.gov.br'))
  assert.ok(hostPermitido('nfe.svrs.rs.gov.br'))
  assert.ok(!hostPermitido('fazenda.gov.br.evil.example.com'))
  assert.ok(!hostPermitido('169.254.169.254'))
  assert.ok(!hostPermitido('localhost'))
})

test('comparação de token em tempo constante', () => {
  assert.ok(igual('abc', 'abc'))
  assert.ok(!igual('abc', 'abd'))
  assert.ok(!igual('abc', 'abcd'))
})

test('rotas: health, 404 e recusa sem token', async () => {
  await new Promise((ok) => servidor.listen(0, ok))
  const base = `http://127.0.0.1:${servidor.address().port}`
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200)
    assert.equal((await fetch(`${base}/outra`)).status, 404)
    const r = await fetch(`${base}/soap`, { method: 'POST', body: '{}' })
    assert.equal(r.status, 401)
  } finally {
    servidor.close()
  }
})
