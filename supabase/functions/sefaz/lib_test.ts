import nodeAssert from "node:assert/strict";
const assert = (c: unknown, m?: string) => nodeAssert.ok(c, m);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepEqual(a, b);
const assertMatch = (s: string, r: RegExp) => nodeAssert.match(s, r);
const assertStringIncludes = (s: string, sub: string) => nodeAssert.ok(s.includes(sub), `esperava conter: ${sub}`);
const assertRejects = (f: () => Promise<unknown>) => nodeAssert.rejects(f);
import forge from "node-forge";
import * as L from "./lib.ts";

// Gera uma chave de acesso de 44 dígitos com o DV correto (módulo 11), independente da implementação testada.
function chaveComDv(base43: string): string {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  for (let i = 0; i < 43; i++) soma += Number(base43[42 - i]) * pesos[i % 8];
  const r = soma % 11;
  return base43 + (r < 2 ? 0 : 11 - r);
}
const base55 = (n: number) => `352601111222330001835500100000${String(n).padStart(6, "0")}1000${String(n).padStart(6, "0")}`.slice(0, 43);

Deno.test("chaveValida: DV módulo 11, modelo e tamanho", () => {
  for (let n = 1; n <= 50; n++) assert(L.chaveValida(chaveComDv(base55(n)), "55"), `chave ${n}`);
  const boa = chaveComDv(base55(7));
  assert(!L.chaveValida(boa.slice(0, 43) + ((Number(boa[43]) + 1) % 10), "55"), "DV adulterado");
  assert(!L.chaveValida(boa, "57"), "modelo errado");
  assert(!L.chaveValida(boa.slice(1), "55"), "43 dígitos");
  assert(L.chaveValida(boa.replace(/(\d{4})/g, "$1 "), "55"), "aceita espaços da leitura do código");
});

Deno.test("chaveValida: resto 0 e 1 viram DV 0", () => {
  // Procura bases cujo resto é 0 ou 1 para cobrir o ramo dv >= 10.
  let achou = 0;
  for (let n = 1; n < 2000 && achou < 2; n++) {
    const b = base55(n);
    const k = chaveComDv(b);
    if (k[43] === "0") { assert(L.chaveValida(k, "55")); achou++; }
  }
  assert(achou > 0);
});

function certificadoDeTeste(cnpj: string, senha: string) {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400_000);
  const attrs = [{ name: "commonName", value: `EMPRESA FICTICIA LTDA:${cnpj}` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: "3des" });
  const pfxB64 = forge.util.encode64(forge.asn1.toDer(p12).getBytes());
  return { keys, cert, pfxB64 };
}

Deno.test("lerPfx extrai titular, CNPJ, chave e validade; senha errada falha", () => {
  const { pfxB64 } = certificadoDeTeste("12345678000195", "segredo");
  const info = L.lerPfx(forge, pfxB64, "segredo");
  assertEquals(info.cnpj, "12345678000195");
  assertStringIncludes(info.titular, "EMPRESA FICTICIA");
  assertStringIncludes(info.certPem, "BEGIN CERTIFICATE");
  assertStringIncludes(info.keyPem, "PRIVATE KEY");
  assert(new Date(info.validade) > new Date());
  assertEquals((info.cadeiaPem.match(/BEGIN CERTIFICATE/g) ?? []).length, 1);
  try { L.lerPfx(forge, pfxB64, "errada"); throw new Error("não falhou"); } catch (e) {
    assertMatch((e as Error).message, /MAC|password|Invalid/i);
  }
});

Deno.test("assinar: estrutura XMLDSig, digest e assinatura RSA-SHA1 verificáveis", () => {
  const { pfxB64 } = certificadoDeTeste("12345678000195", "x");
  const info = L.lerPfx(forge, pfxB64, "x");
  const chave = chaveComDv(base55(1));
  const { id, xml } = L.infEventoCiencia(chave, "12345678000195", "2026-01-15T10:00:00-03:00");
  assertEquals(id, `ID210210${chave}01`);
  const sig = L.assinar(forge, xml, id, info.keyPem, info.certPem);

  assertMatch(sig, /^<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#"><SignedInfo>/);
  assertStringIncludes(sig, `<Reference URI="#${id}">`);
  assertStringIncludes(sig, 'Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"');
  assertStringIncludes(sig, 'Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"');
  assertStringIncludes(sig, "<X509Certificate>");

  // DigestValue = SHA-1 do infEvento canônico.
  const digest = sig.match(/<DigestValue>([^<]+)<\/DigestValue>/)![1];
  const md = forge.md.sha1.create(); md.update(xml, "utf8");
  assertEquals(digest, forge.util.encode64(md.digest().bytes()));

  // SignatureValue confere com a chave pública do certificado sobre o SignedInfo canônico
  // (ao canonicalizar, o SignedInfo herda o xmlns declarado no Signature).
  const signedInfo = sig.match(/<SignedInfo>[\s\S]*?<\/SignedInfo>/)![0].replace("<SignedInfo>", '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
  const valor = forge.util.decode64(sig.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)![1]);
  const mdSi = forge.md.sha1.create(); mdSi.update(signedInfo, "utf8");
  const pub = forge.pki.certificateFromPem(info.certPem).publicKey as forge.pki.rsa.PublicKey;
  assert(pub.verify(mdSi.digest().bytes(), valor), "assinatura não confere");

  // Alterar o conteúdo muda o digest.
  const outro = L.infEventoCiencia(chave, "12345678000196", "2026-01-15T10:00:00-03:00").xml;
  const md2 = forge.md.sha1.create(); md2.update(outro, "utf8");
  assert(forge.util.encode64(md2.digest().bytes()) !== digest);
});

Deno.test("envEvento: infEvento sem xmlns repetido, assinatura logo depois", () => {
  const { xml } = L.infEventoCiencia(chaveComDv(base55(2)), "12345678000195", "2026-01-15T10:00:00-03:00");
  const env = L.envEvento(xml, "<Signature/>");
  assertMatch(env, /^<envEvento xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe" versao="1\.00"><idLote>\d+<\/idLote><evento versao="1\.00"><infEvento Id="ID210210/);
  assert(!env.includes('<infEvento xmlns='));
  assert(env.endsWith("</infEvento><Signature/></evento></envEvento>"));
});

Deno.test("corpos SOAP carregam UF, CNPJ e NSU com zeros à esquerda", () => {
  const c = L.corpoDistCte("12345678000195", "42", "35");
  assertStringIncludes(c, "<cUFAutor>35</cUFAutor>");
  assertStringIncludes(c, "<ultNSU>000000000000042</ultNSU>");
  const n = L.corpoConsChNFe("12345678000195", "35260111122233000183550010000000011000000017", "35");
  assertStringIncludes(n, "<consChNFe><chNFe>35260111122233000183550010000000011000000017</chNFe></consChNFe>");
  assertStringIncludes(L.corpoEvento("<x/>"), "NFeRecepcaoEvento4");
});

async function gzipB64(texto: string): Promise<string> {
  const s = new Blob([texto]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(s).arrayBuffer());
  return btoa(String.fromCharCode(...bytes));
}

Deno.test("gunzipB64 desfaz o gzip (inclusive acentos)", async () => {
  const original = "<nfeProc><xNome>Indústria Exemplo São João</xNome></nfeProc>".repeat(20);
  assertEquals(await L.gunzipB64(await gzipB64(original)), original);
  await assertRejects(() => L.gunzipB64(btoa("isto não é gzip")));
});

Deno.test("docZips lê NSU, schema e conteúdo; tag/tags ignoram prefixo de namespace", async () => {
  const b64 = await gzipB64("<a/>");
  const resp = `<retDistDFeInt><cStat>138</cStat><loteDistDFeInt>` +
    `<docZip NSU="000000000000010" schema="resNFe_v1.01.xsd">${b64}</docZip>` +
    `<ns:docZip NSU="000000000000011" schema="procNFe_v4.00.xsd">${b64}</ns:docZip></loteDistDFeInt></retDistDFeInt>`;
  const docs = L.docZips(resp);
  assertEquals(docs.map((d) => [d.nsu, d.schema]), [["000000000000010", "resNFe_v1.01.xsd"], ["000000000000011", "procNFe_v4.00.xsd"]]);
  assertEquals(L.tag(resp, "cStat"), "138");
  assertEquals(L.tags("<x:v>1</x:v><v>2</v>", "v"), ["1", "2"]);
});

const chaveCte = chaveComDv("3526019998887700010857001000000123100000123".slice(0, 43));
const CTE_SINTETICO = `<?xml version="1.0"?><cteProc xmlns="http://www.portalfiscal.inf.br/cte"><CTe><infCte Id="CTe${chaveCte}" versao="4.00">
<ide><nCT>123</nCT></ide><emit><CNPJ>99988877000108</CNPJ><xNome>TRANSPORTES HORIZONTE LTDA</xNome></emit>
<vPrest><vTPrest>1234.56</vTPrest><Comp><xNome>FRETE VALOR</xNome><vComp>1000.00</vComp></Comp><Comp><xNome>PEDAGIO</xNome><vComp>234.56</vComp></Comp></vPrest>
<infCTeNorm><infCarga><infQ><cUnid>01</cUnid><tpMed>PESO BRUTO</tpMed><qCarga>80.0000</qCarga></infQ><infQ><cUnid>01</cUnid><tpMed>PESO BASE DE CALCULO</tpMed><qCarga>120.0000</qCarga></infQ>
</infCarga><infDoc><infNFe><chave>35260111122233000183550010000000011000000017</chave></infNFe></infDoc></infCTeNorm></infCte></CTe>
<protCTe><infProt><chCTe>${chaveCte}</chCTe></infProt></protCTe></cteProc>`;

Deno.test("dadosCte lê frete, componentes, peso taxado e NFs do CT-e sintético", () => {
  const d = L.dadosCte(CTE_SINTETICO);
  assertEquals(d.chave, chaveCte);
  assertEquals(d.numero, "123");
  assertEquals(d.valor, 1234.56);
  assertEquals(d.peso_taxado, 120);
  assertEquals(d.componentes, [{ nome: "FRETE VALOR", valor: 1000 }, { nome: "PEDAGIO", valor: 234.56 }]);
  assertEquals(d.nfes, ["35260111122233000183550010000000011000000017"]);
  assertEquals(d.emitente, "TRANSPORTES HORIZONTE LTDA");
});

Deno.test("dadosCte sem peso taxado devolve null", () => {
  const xml = CTE_SINTETICO.replace(/<infQ><cUnid>01<\/cUnid><tpMed>PESO BASE DE CALCULO<\/tpMed>.*?<\/infQ>/s, "");
  assertEquals(L.dadosCte(xml).peso_taxado, null);
});

Deno.test("dataHoraBrasil usa o fuso -03:00", () => {
  assertEquals(L.dataHoraBrasil(new Date("2026-01-15T13:00:00Z")), "2026-01-15T10:00:00-03:00");
});
