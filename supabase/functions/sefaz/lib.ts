// Funções puras da integração com a SEFAZ (sem rede). O node-forge é injetado, o que mantém este módulo livre de
// imports e testável em qualquer runtime.

export const URL_DIST_NFE = "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
export const URL_EVENTO_AN = "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx";
export const URL_DIST_CTE = "https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx";

export function soDigitos(s: string | null | undefined) {
  return String(s ?? "").replace(/\D/g, "");
}

// Chave de acesso: 44 dígitos, modelo (55 NF-e, 57 CT-e) e DV módulo 11.
export function chaveValida(chave: string, modelo: "55" | "57"): boolean {
  const c = soDigitos(chave);
  if (c.length !== 44 || c.slice(20, 22) !== modelo) return false;
  let s = 0, p = 2;
  for (let i = 42; i >= 0; i--) { s += Number(c[i]) * p; p = p === 9 ? 2 : p + 1; }
  let dv = 11 - (s % 11); if (dv >= 10) dv = 0;
  return dv === Number(c[43]);
}

// ---------- Certificado A1 ----------
export function lerPfx(forge: any, pfxB64: string, senha: string) {
  const der = forge.util.decode64(pfxB64);
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, senha);
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const keyBags2 = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [];
  const chave = (keyBags[0] ?? keyBags2[0])?.key;
  if (!chave) throw new Error("Chave privada não encontrada no certificado");
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b: any) => b.cert).filter(Boolean);
  // O certificado da empresa é o que casa com a chave privada.
  const pub = forge.pki.setRsaPublicKey(chave.n, chave.e);
  const doTitular = certs.find((c: any) => c.publicKey.n.equals(pub.n)) ?? certs[0];
  if (!doTitular) throw new Error("Certificado não encontrado no arquivo");
  const cn = String(doTitular.subject.getField("CN")?.value ?? "");
  const cnpj = (cn.match(/(\d{14})/) ?? [])[1] ?? "";
  return {
    certPem: forge.pki.certificateToPem(doTitular),
    // Cadeia para o TLS: titular primeiro, depois as autoridades que vierem no arquivo.
    cadeiaPem: [doTitular, ...certs.filter((c: any) => c !== doTitular)].map((c: any) => forge.pki.certificateToPem(c)).join(""),
    keyPem: forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(chave))),
    titular: cn,
    cnpj,
    validade: doTitular.validity.notAfter.toISOString(),
  };
}

// ---------- XML ----------
export function dataHoraBrasil(d = new Date()) {
  const t = new Date(d.getTime() - 3 * 3600_000);
  return t.toISOString().slice(0, 19) + "-03:00";
}

// Evento 210210 (Ciência da Operação), já em forma canônica (C14N) para assinar.
export function infEventoCiencia(chave: string, cnpj: string, dh: string) {
  const id = `ID210210${chave}01`;
  const xml =
    `<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" Id="${id}"><cOrgao>91</cOrgao><tpAmb>1</tpAmb><CNPJ>${cnpj}</CNPJ>` +
    `<chNFe>${chave}</chNFe><dhEvento>${dh}</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento>`;
  return { id, xml };
}

// Assinatura XMLDSig envelopada (RSA-SHA1, C14N), como exige o leiaute da NF-e. O XML de entrada já precisa estar canônico.
export function assinar(forge: any, infCanonico: string, id: string, keyPem: string, certPem: string) {
  const sha1b64 = (s: string) => { const md = forge.md.sha1.create(); md.update(s, "utf8"); return forge.util.encode64(md.digest().bytes()); };
  const digest = sha1b64(infCanonico);
  const signedInfo =
    `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI="#${id}"><Transforms>` +
    `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform>` +
    `</Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const md = forge.md.sha1.create(); md.update(signedInfo, "utf8");
  const sig = forge.util.encode64(forge.pki.privateKeyFromPem(keyPem).sign(md));
  const certB64 = certPem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const siDoc = signedInfo.replace(' xmlns="http://www.w3.org/2000/09/xmldsig#"', "");
  return `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${siDoc}<SignatureValue>${sig}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${certB64}</X509Certificate></X509Data></KeyInfo></Signature>`;
}

export function envEvento(infCanonico: string, assinatura: string) {
  // Dentro de <evento> (que já declara o namespace da NF-e) o infEvento não repete o xmlns.
  const inf = infCanonico.replace(' xmlns="http://www.portalfiscal.inf.br/nfe"', "");
  return `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>${Date.now() % 1e15}</idLote>` +
    `<evento versao="1.00">${inf}${assinatura}</evento></envEvento>`;
}

export function soap(corpo: string) {
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>${corpo}</soap12:Body></soap12:Envelope>`;
}

export function corpoEvento(env: string) {
  return soap(`<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${env}</nfeDadosMsg>`);
}

export function corpoConsChNFe(cnpj: string, chave: string, ufAutor: string) {
  return soap(`<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>` +
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>${ufAutor}</cUFAutor><CNPJ>${cnpj}</CNPJ>` +
    `<consChNFe><chNFe>${chave}</chNFe></consChNFe></distDFeInt></nfeDadosMsg></nfeDistDFeInteresse>`);
}

export function corpoDistCte(cnpj: string, ultNSU: string, ufAutor: string) {
  return soap(`<cteDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe"><cteDadosMsg>` +
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/cte" versao="1.00"><tpAmb>1</tpAmb><cUFAutor>${ufAutor}</cUFAutor><CNPJ>${cnpj}</CNPJ>` +
    `<distNSU><ultNSU>${ultNSU.padStart(15, "0")}</ultNSU></distNSU></distDFeInt></cteDadosMsg></cteDistDFeInteresse>`);
}

// ---------- Leitura das respostas ----------
export function tag(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`));
  return m ? m[1] : null;
}
export function tags(xml: string, nome: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`, "g"))].map((m) => m[1]);
}

export function docZips(xml: string): { nsu: string; schema: string; b64: string }[] {
  return [...xml.matchAll(/<(?:\w+:)?docZip\s+([^>]*)>([^<]+)<\/(?:\w+:)?docZip>/g)].map((m) => ({
    nsu: (m[1].match(/NSU="(\d+)"/) ?? [])[1] ?? "",
    schema: (m[1].match(/schema="([^"]+)"/) ?? [])[1] ?? "",
    b64: m[2].trim(),
  }));
}

export async function gunzipB64(b64: string): Promise<string> {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const s = new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(s).text();
}

export function dadosCte(xml: string) {
  const inf = tag(xml, "infCte") ?? xml;
  const chave = tag(xml, "chCTe") ?? (xml.match(/Id="CTe(\d{44})"/) ?? [])[1] ?? "";
  const prest = tag(inf, "vPrest") ?? "";
  const componentes = tags(prest, "Comp").map((c) => ({ nome: tag(c, "xNome"), valor: Number(tag(c, "vComp") ?? 0) }));
  const infQ = tags(inf, "infQ").map((q) => ({ tipo: (tag(q, "tpMed") ?? "").toUpperCase(), qtd: Number(tag(q, "qCarga") ?? 0) }));
  const taxado = infQ.find((q) => q.tipo.includes("TAXADO") || q.tipo.includes("CALCULO") || q.tipo.includes("CÁLCULO"));
  return {
    chave,
    numero: tag(inf, "nCT"),
    valor: Number(tag(prest, "vTPrest") ?? 0),
    peso_taxado: taxado ? taxado.qtd : null,
    componentes,
    nfes: tags(inf, "chave"),
    emitente: tag(tag(inf, "emit") ?? "", "xNome"),
  };
}
