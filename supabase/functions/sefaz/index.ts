// Integração com a SEFAZ usando o certificado A1 da empresa.
// POST {acao:"certificado", pfx_b64, senha}  -> valida e guarda o certificado (operador)
// POST {acao:"nfe", chave}                   -> XML oficial da NF de origem pela chave lida na DANFE (operador ou CD)
// POST {acao:"cte_sync"}                     -> baixa os CT-e em que a empresa é parte e completa o frete realizado (operador ou agendamento)
// POST {acao:"diagnostico"}                  -> testa a conexão com os dois serviços de distribuição (operador ou agendamento)
import forge from "node-forge";
import { admin, credencial, estado, evento, exigir, json, salvarEstado, servir } from "../_shared/comum.ts";
import * as L from "./lib.ts";

type Cert = { cert: string; key: string; cadeia: string; cnpj: string; uf: string; gwUrl: string | null; gwToken: string | null };

// Chave sintética (CNPJ fictício, DV válido) para o diagnóstico: a SEFAZ responde "não encontrada", o que prova a conexão.
const CHAVE_DIAGNOSTICO = "35260111122233000183550010000000011000000017";

async function certificado(sb: any): Promise<Cert> {
  const cert = await credencial(sb, "sefaz_cert_pem");
  const key = await credencial(sb, "sefaz_key_pem");
  const cadeia = (await credencial(sb, "sefaz_cadeia_pem")) ?? cert;
  const info = await estado(sb, "sefaz_cert_info");
  if (!cert || !key || !info?.cnpj) throw new Error("Certificado digital não cadastrado. Cadastre em Configurações.");
  if (info.validade && new Date(info.validade) < new Date()) throw new Error("Certificado digital vencido.");
  const { data: cfg } = await sb.from("config").select("valor").eq("chave", "sefaz_uf_autor").maybeSingle();
  const uf = String(cfg?.valor ?? "");
  if (!/^\d{2}$/.test(uf)) throw new Error("Configuração 'sefaz_uf_autor' (código IBGE da UF) ausente");
  const gwUrl = await credencial(sb, "sefaz_gw_url");
  const gwToken = await credencial(sb, "sefaz_gw_token");
  return { cert, key, cadeia: cadeia!, cnpj: info.cnpj, uf, gwUrl, gwToken };
}

async function chamar(c: Cert, url: string, action: string, corpo: string): Promise<string> {
  if (c.gwUrl && c.gwToken) {
    // Gateway Node (sefaz-gw): fecha o mTLS com OpenSSL, que os servidores da SEFAZ aceitam.
    const r = await fetch(c.gwUrl.replace(/\/$/, "") + "/soap", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-token": c.gwToken },
      body: JSON.stringify({ url, action, body: corpo, cert: c.cadeia, key: c.key }),
      signal: AbortSignal.timeout(55_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Gateway SEFAZ: ${j.erro ?? r.status}`);
    if (j.status >= 400 && !String(j.body ?? "").includes("cStat")) throw new Error(`SEFAZ respondeu ${j.status}`);
    return String(j.body ?? "");
  }
  const client = (Deno as any).createHttpClient({ http1: true, http2: false, cert: c.cadeia, key: c.key });
  try {
    const r = await fetch(url, {
      method: "POST",
      body: corpo,
      headers: { "Content-Type": `application/soap+xml; charset=utf-8; action="${action}"` },
      signal: AbortSignal.timeout(40_000),
      client,
    } as any);
    const txt = await r.text();
    if (!r.ok && !txt.includes("cStat")) throw new Error(`SEFAZ respondeu ${r.status}`);
    return txt;
  } catch (e) {
    const m = (e as Error).message;
    if (/reset|handshake|certificate/i.test(m)) throw new Error(`A SEFAZ recusou a conexão (${new URL(url).host}). Detalhe: ${m.slice(0, 300)}`);
    throw e;
  } finally {
    client.close?.();
  }
}

const ACAO_DIST_NFE = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";
const ACAO_DIST_CTE = "http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe/cteDistDFeInteresse";
const ACAO_EVENTO = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento";

async function consultarChave(c: Cert, chave: string) {
  const r = await chamar(c, L.URL_DIST_NFE, ACAO_DIST_NFE, L.corpoConsChNFe(c.cnpj, chave, c.uf));
  const ret = L.tag(r, "retDistDFeInt") ?? r;
  return { cStat: L.tag(ret, "cStat") ?? "", xMotivo: L.tag(ret, "xMotivo") ?? "", docs: L.docZips(ret) };
}

async function manifestarCiencia(c: Cert, chave: string) {
  const { id, xml } = L.infEventoCiencia(chave, c.cnpj, L.dataHoraBrasil());
  const env = L.envEvento(xml, L.assinar(forge, xml, id, c.key, c.cert));
  const r = await chamar(c, L.URL_EVENTO_AN, ACAO_EVENTO, L.corpoEvento(env));
  const ret = L.tag(r, "retEvento") ?? r;
  const cStat = L.tag(ret, "cStat") ?? L.tag(r, "cStat") ?? "";
  // 135 registrado · 136 registrado sem vínculo · 573 já registrado (duplicidade)
  if (!["135", "136", "573"].includes(cStat)) throw new Error(`Manifestação recusada pela SEFAZ: ${cStat} ${L.tag(ret, "xMotivo") ?? ""}`);
  return cStat;
}

async function nfePorChave(sb: any, chaveBruta: string) {
  const chave = L.soDigitos(chaveBruta);
  if (!L.chaveValida(chave, "55")) throw new Error("Código lido não é uma chave de NF-e válida. Leia o código de barras da DANFE.");
  const { data: dup } = await sb.from("recebimentos").select("id").eq("nf_chave", chave).maybeSingle();
  if (dup) throw new Error("Esta NF já foi recebida.");
  const { data: cache } = await sb.from("documentos_fiscais").select("xml_path").eq("chave", chave).maybeSingle();
  if (cache?.xml_path) {
    const { data } = await sb.storage.from("documentos").download(cache.xml_path);
    if (data) return { status: "ok", chave, xml: await data.text(), xml_path: cache.xml_path };
  }
  const c = await certificado(sb);
  let r = await consultarChave(c, chave);
  if (r.cStat === "656") throw new Error("A SEFAZ limitou as consultas por excesso de pedidos. Tente de novo em 1 hora.");
  if (!r.docs.length) {
    return { status: "nao_encontrada", chave, mensagem: `A SEFAZ não devolveu esta NF para a empresa (${r.cStat} ${r.xMotivo}).` };
  }
  let proc = r.docs.find((d) => d.schema.startsWith("procNFe"));
  if (!proc && r.docs.some((d) => d.schema.startsWith("resNFe"))) {
    // A SEFAZ só entrega o XML completo depois da Ciência da Operação.
    await manifestarCiencia(c, chave);
    await evento(sb, "sefaz", null, "ciencia_operacao", { chave });
    for (const espera of [2500, 5000]) {
      await new Promise((ok) => setTimeout(ok, espera));
      r = await consultarChave(c, chave);
      proc = r.docs.find((d) => d.schema.startsWith("procNFe"));
      if (proc) break;
    }
    if (!proc) return { status: "aguardando", chave, mensagem: "Ciência da operação registrada; a SEFAZ libera o XML em instantes. Tente de novo." };
  }
  if (!proc) throw new Error(`SEFAZ: ${r.cStat} ${r.xMotivo}`);
  const xml = await L.gunzipB64(proc.b64);
  const xml_path = `sefaz/nfe/${chave}.xml`;
  await sb.storage.from("documentos").upload(xml_path, new Blob([xml], { type: "application/xml" }), { upsert: true });
  await sb.from("documentos_fiscais").upsert({ chave, tipo: "nfe", nsu: proc.nsu, xml_path });
  return { status: "ok", chave, xml, xml_path };
}

// Distribuição por NSU: o cursor fica em integracoes_estado e só avança depois de gravar os documentos da página.
async function cteSync(sb: any) {
  const c = await certificado(sb);
  const chaveCursor = `sefaz_cte_nsu:${c.uf}`;
  let ult = String((await estado(sb, chaveCursor)) ?? "0");
  let novos = 0, completados = 0, cStat = "", xMotivo = "";
  for (let volta = 0; volta < 10; volta++) {
    const r = await chamar(c, L.URL_DIST_CTE, ACAO_DIST_CTE, L.corpoDistCte(c.cnpj, ult, c.uf));
    const ret = L.tag(r, "retDistDFeInt") ?? r;
    cStat = L.tag(ret, "cStat") ?? "";
    xMotivo = L.tag(ret, "xMotivo") ?? "";
    if (cStat !== "138") break;
    for (const d of L.docZips(ret)) {
      if (!d.schema.startsWith("procCTe")) continue;
      const xml = await L.gunzipB64(d.b64);
      const dados = L.dadosCte(xml);
      if (!dados.chave) continue;
      const xml_path = `sefaz/cte/${dados.chave}.xml`;
      await sb.storage.from("documentos").upload(xml_path, new Blob([xml], { type: "application/xml" }), { upsert: true });
      await sb.from("documentos_fiscais").upsert({ chave: dados.chave, tipo: "cte", nsu: d.nsu, xml_path, dados });
      novos++;
      const { data: alvo } = await sb.from("consolidacoes").update({
        cte_numero: dados.numero, cte_valor: dados.valor, cte_peso_taxado: dados.peso_taxado, cte_componentes: dados.componentes,
        cte_xml_path: xml_path, atualizado_em: new Date().toISOString(),
      }).eq("cte_chave", dados.chave).is("cte_valor", null).select("id");
      completados += alvo?.length ?? 0;
    }
    ult = (L.tag(ret, "ultNSU") ?? ult).replace(/^0+/, "") || "0";
    const max = (L.tag(ret, "maxNSU") ?? "0").replace(/^0+/, "") || "0";
    await salvarEstado(sb, chaveCursor, ult);
    if (BigInt(ult) >= BigInt(max)) break;
  }
  const res = { em: new Date().toISOString(), cStat, xMotivo, novos, completados };
  await salvarEstado(sb, "sefaz_cte_sync", res);
  return res;
}

async function guardarCertificado(sb: any, pfxB64: string, senha: string) {
  if (!pfxB64 || !senha) throw new Error("Envie o arquivo .pfx e a senha");
  let info;
  try { info = L.lerPfx(forge, pfxB64, senha); } catch (e) {
    const m = (e as Error).message;
    throw new Error(/MAC|password/i.test(m) ? "Senha do certificado incorreta" : `Não consegui ler o certificado: ${m}`);
  }
  if (!info.cnpj) throw new Error("O certificado não traz CNPJ. Use um e-CNPJ A1.");
  if (new Date(info.validade) < new Date()) throw new Error("Este certificado está vencido.");
  await salvarEstado(sb, "cred:sefaz_cert_pem", info.certPem);
  await salvarEstado(sb, "cred:sefaz_key_pem", info.keyPem);
  await salvarEstado(sb, "cred:sefaz_cadeia_pem", info.cadeiaPem);
  const resumo = { titular: info.titular, cnpj: info.cnpj, validade: info.validade };
  await salvarEstado(sb, "sefaz_cert_info", resumo);
  await evento(sb, "sefaz", null, "certificado_cadastrado", resumo);
  return resumo;
}

servir(async (req) => {
  const sb = admin();
  const body = await req.json().catch(() => ({}));
  try {
    switch (body.acao) {
      case "cte_sync": {
        const negado = await exigir(req, ["operador"], true);
        return negado ?? json({ ok: true, ...(await cteSync(sb)) });
      }
      case "diagnostico": {
        const negado = await exigir(req, ["operador"], true);
        if (negado) return negado;
        const c = await certificado(sb);
        const out: Record<string, string> = { via: c.gwUrl ? "gateway" : "direto", certs_na_cadeia: String((c.cadeia.match(/BEGIN CERTIFICATE/g) ?? []).length) };
        const testes: [string, string, string, string][] = [
          ["nfe_dist", L.URL_DIST_NFE, ACAO_DIST_NFE, L.corpoConsChNFe(c.cnpj, CHAVE_DIAGNOSTICO, c.uf)],
          ["cte_dist", L.URL_DIST_CTE, ACAO_DIST_CTE, L.corpoDistCte(c.cnpj, "0", c.uf)],
        ];
        for (const [nome, url, acao, corpo] of testes) {
          try {
            const r = await chamar(c, url, acao, corpo);
            out[nome] = `${L.tag(r, "cStat") ?? ""} ${L.tag(r, "xMotivo") ?? r.slice(0, 200)}`.trim();
          } catch (e) { out[nome] = (e as Error).message; }
        }
        return json({ ok: true, ...out });
      }
      case "nfe": {
        const negado = await exigir(req, ["operador", "cd"]);
        return negado ?? json({ ok: true, ...(await nfePorChave(sb, String(body.chave ?? ""))) });
      }
      case "certificado": {
        const negado = await exigir(req, ["operador"]);
        return negado ?? json({ ok: true, certificado: await guardarCertificado(sb, String(body.pfx_b64 ?? ""), String(body.senha ?? "")) });
      }
      default:
        return json({ ok: false, erro: "ação desconhecida" }, 400);
    }
  } catch (e) {
    return json({ ok: false, erro: (e as Error).message });
  }
});
