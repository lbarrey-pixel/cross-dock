// Gateway SEFAZ: faz as chamadas SOAP com certificado A1 usando OpenSSL (Node).
// O runtime das edge functions não fecha o mTLS com os servidores da SEFAZ; este serviço roda no Brasil.
// Não guarda nada: recebe a chamada pronta + certificado/chave a cada pedido, autenticado por token.
import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const TOKEN = process.env.GW_TOKEN || ''
const PORT = Number(process.env.PORT || 8080)
// A cadeia ICP-Brasil nem sempre está no repositório de CAs do sistema. Com GW_TLS_RELAXADO=1 o gateway
// repete a chamada sem validar o servidor; o padrão é recusar.
const TLS_RELAXADO = process.env.GW_TLS_RELAXADO === '1'
const LIMITE_CORPO = 512 * 1024
const HOSTS_PERMITIDOS = /\.fazenda\.gov\.br$|\.sefaz\.[a-z]{2}\.gov\.br$|\.svrs\.rs\.gov\.br$/

export const hostPermitido = (host) => HOSTS_PERMITIDOS.test(host)

export function igual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

function soap({ url, action, body, cert, key }, verificar) {
  return new Promise((ok, falha) => {
    const u = new URL(url)
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST',
      cert, key, minVersion: 'TLSv1.2', ciphers: 'DEFAULT@SECLEVEL=0', rejectUnauthorized: verificar,
      headers: { 'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`, 'Content-Length': Buffer.byteLength(body) },
      timeout: 45000,
    }, (res) => {
      const partes = []
      res.on('data', (c) => partes.push(c))
      res.on('end', () => ok({ status: res.statusCode, body: Buffer.concat(partes).toString('utf8') }))
    })
    req.on('timeout', () => req.destroy(new Error('tempo esgotado falando com a SEFAZ')))
    req.on('error', falha)
    req.end(body)
  })
}

async function lerCorpo(req) {
  const partes = []
  let total = 0
  for await (const c of req) {
    total += c.length
    if (total > LIMITE_CORPO) throw new Error('corpo grande demais')
    partes.push(c)
  }
  return Buffer.concat(partes).toString('utf8')
}

export const servidor = http.createServer(async (req, res) => {
  const responder = (st, obj) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
  if (req.method === 'GET' && req.url === '/health') return responder(200, { ok: true })
  if (req.method !== 'POST' || req.url !== '/soap') return responder(404, { erro: 'não encontrado' })
  if (!TOKEN || !igual(req.headers['x-token'] || '', TOKEN)) return responder(401, { erro: 'token inválido' })
  let p
  try { p = JSON.parse(await lerCorpo(req)) } catch { return responder(400, { erro: 'json inválido' }) }
  let host
  try { host = new URL(p.url).hostname } catch { return responder(400, { erro: 'url inválida' }) }
  if (!hostPermitido(host)) return responder(400, { erro: 'destino não permitido' })
  try {
    return responder(200, { ...(await soap(p, true)), tls_verificado: true })
  } catch (e) {
    const cadeia = /certificate|issuer|self.signed|UNABLE_TO/i.test(`${e.code} ${e.message}`)
    if (cadeia && TLS_RELAXADO) {
      try { return responder(200, { ...(await soap(p, false)), tls_verificado: false }) } catch (e2) { return responder(502, { erro: `${e2.code} ${e2.message}` }) }
    }
    return responder(502, { erro: `${e.code || ''} ${e.message}` })
  }
})

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  servidor.listen(PORT, () => console.log('sefaz-gw na porta', PORT))
}
