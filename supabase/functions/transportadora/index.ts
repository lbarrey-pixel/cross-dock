// Integração com a API da transportadora (exemplo: "Transportes Horizonte"). Endereço em TRANSPORTADORA_API_URL.
// POST {acao:"cotar", consolidacao_id}  -> cotação com a volumetria informada pelo CD
// POST {acao:"rastrear"}                 -> eventos das NFs embarcadas (também executado pelo agendamento)
// O valor cobrado do CT-e NÃO vem por esta API: entra pelo XML do CT-e (sefaz cte_sync ou upload).
import { admin, credencial, exigir, json, salvarEstado, servir, soDigitos } from "../_shared/comum.ts";

function baseUrl() {
  const u = Deno.env.get("TRANSPORTADORA_API_URL");
  if (!u) throw new Error("TRANSPORTADORA_API_URL não configurada");
  return u.replace(/\/$/, "");
}

async function configTexto(sb: any, chave: string): Promise<string> {
  const { data } = await sb.from("config").select("valor").eq("chave", chave).maybeSingle();
  const v = soDigitos(data?.valor);
  if (!v) throw new Error(`Configuração '${chave}' ausente`);
  return v;
}

async function token(sb: any): Promise<string> {
  const username = await credencial(sb, "transportadora_usuario");
  const password = await credencial(sb, "transportadora_senha");
  const companyId = (await credencial(sb, "transportadora_company_id")) ?? "1";
  if (!username || !password) throw new Error("Credenciais da transportadora não configuradas");
  const r = await fetch(`${baseUrl()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", username, password, companyId }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Token da transportadora recusado (HTTP ${r.status})`);
  return j.access_token as string;
}

async function cidadeId(tk: string, cep: string): Promise<number | null> {
  try {
    const r = await fetch(`${baseUrl()}/cidades/por-cep?cep=${soDigitos(cep)}`, { headers: { Authorization: `Bearer ${tk}` } });
    if (!r.ok) return null;
    const j = await r.json();
    return Number(j?.CityId ?? j?.cityId ?? j?.Id ?? j?.id ?? 0) || null;
  } catch {
    return null; // sem o id da cidade a cotação ainda pode funcionar só pelo CEP
  }
}

const num = (v: any) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s) || null;
};

async function cotar(sb: any, id: number) {
  const { data: co } = await sb.from("consolidacoes").select("*, pedidos(cep_entrega, cnpj)").eq("id", id).single();
  if (!co) throw new Error("Consolidação não encontrada");
  const { data: vols } = await sb.from("volumes").select("*").eq("consolidacao_id", id).eq("descartado", false);
  const { data: bench } = await sb.from("v_frete_benchmark").select("valor_mercadoria").eq("consolidacao_id", id).single();
  const origem = await configTexto(sb, "cep_origem");
  const cnpjEmpresa = await configTexto(sb, "empresa_cnpj");
  const destino = soDigitos(co.pedidos?.cep_entrega);
  if (!destino) throw new Error("Pedido sem CEP de entrega");
  const tk = await token(sb);
  const corpo = {
    OriginZipCode: origem,
    OriginCityId: await cidadeId(tk, origem),
    DestinationZipCode: destino,
    DestinationCityId: await cidadeId(tk, destino),
    TotalWeight: Number(co.peso_bruto ?? 0),
    EletronicInvoiceValue: Number(bench?.valor_mercadoria ?? 0),
    CustomerTaxIdRegistration: cnpjEmpresa,
    ReceiverCpfcnp: soDigitos(co.pedidos?.cnpj),
    Packs: (vols ?? []).map((v: any) => ({
      AmountPackages: 1, Weight: Number(v.peso_kg), Length: Number(v.comprimento_cm), Height: Number(v.altura_cm), Width: Number(v.largura_cm),
    })),
  };
  const r = await fetch(`${baseUrl()}/cotacao`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  const registro: any = { consolidacao_id: id, payload: { pedido: corpo, resposta: j } };
  if (!r.ok) registro.erro = `HTTP ${r.status}`;
  else {
    registro.valor = num(j.FreightValue ?? j.Value ?? j.TotalValue);
    registro.prazo_dias = Number(j.DeliveryTime ?? j.ExpectedDeliveryDays ?? 0) || null;
    registro.peso_taxado = num(j.CalculatedWeight ?? j.TaxedWeight);
    registro.componentes = j.Freight ?? null;
  }
  const { error } = await sb.from("cotacoes_frete").insert(registro);
  if (error) throw new Error(`Cotação não gravada: ${error.message}`);
  return registro;
}

async function rastrear(sb: any) {
  const { data: embarcadas } = await sb.from("consolidacoes").select("id, nf_numero, embarcado_em, cte_numero")
    .eq("status", "embarcado").not("nf_numero", "is", null);
  if (!embarcadas?.length) return { atualizadas: 0 };
  const cnpjEmpresa = await configTexto(sb, "empresa_cnpj");
  const inicio = new Date(Math.min(...embarcadas.map((e: any) => new Date(e.embarcado_em).getTime())) - 86400000);
  const fim = new Date(Date.now() + 86400000);
  const tk = await token(sb);
  const resultados: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const u = new URL(`${baseUrl()}/rastreio`);
    u.searchParams.set("TaxIdRegistration", cnpjEmpresa);
    u.searchParams.set("StartDate", inicio.toISOString().slice(0, 10));
    u.searchParams.set("EndDate", fim.toISOString().slice(0, 10));
    u.searchParams.set("Page", String(page));
    u.searchParams.set("AmountByPage", "100");
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tk}` } });
    if (!r.ok) throw new Error(`Rastreio HTTP ${r.status}`);
    const j = await r.json();
    const lista = Array.isArray(j) ? j : j?.Items ?? j?.items ?? [];
    resultados.push(...lista);
    if (lista.length < 100) break;
  }
  let atualizadas = 0;
  for (const co of embarcadas) {
    const nfNum = String(Number(soDigitos(co.nf_numero)));
    const doc = resultados.find((t: any) =>
      [t.FiscalDocumentNumber, ...(t.ListFiscalDocument ?? [])].some((n: any) => String(Number(soDigitos(n))) === nfNum));
    if (!doc) continue;
    const { data: ja } = await sb.from("rastreios").select("payload").eq("consolidacao_id", co.id);
    const vistos = new Set((ja ?? []).map((x: any) => x.payload?.HistoricId ?? x.payload?.Date));
    for (const ev of doc.Events ?? []) {
      const k = ev.HistoricId ?? ev.Date;
      if (vistos.has(k)) continue;
      await sb.from("rastreios").insert({
        consolidacao_id: co.id, data_evento: ev.OccurrenceDate ?? ev.Date, situacao: ev.Description, payload: ev,
      });
    }
    const upd: any = { cte_numero: co.cte_numero ?? doc.CTeNumber };
    if (doc.EmissionDate && doc.ExpectedDeliveryDays) {
      const prev = new Date(doc.EmissionDate);
      prev.setDate(prev.getDate() + Number(doc.ExpectedDeliveryDays));
      upd.previsao_entrega = prev.toISOString().slice(0, 10);
    }
    if (doc.NewDateSchedule) upd.previsao_entrega = String(doc.NewDateSchedule).slice(0, 10);
    const entregue = (doc.Events ?? []).find((e: any) => String(e.ProcedaCode) === "01" || /entregue/i.test(e.Description ?? ""));
    if (entregue) { upd.status = "entregue"; upd.entregue_em = entregue.OccurrenceDate ?? entregue.Date; }
    await sb.from("consolidacoes").update(upd).eq("id", co.id);
    atualizadas++;
  }
  await salvarEstado(sb, "transportadora_ultimo_rastreio", { em: new Date().toISOString(), atualizadas });
  return { atualizadas };
}

servir(async (req) => {
  const body = await req.json().catch(() => ({}));
  const sb = admin();
  try {
    if (body.acao === "cotar") {
      const negado = await exigir(req, ["operador", "cd"]);
      if (negado) return negado;
      return json({ ok: true, cotacao: await cotar(sb, Number(body.consolidacao_id)) });
    }
    if (body.acao === "rastrear") {
      const negado = await exigir(req, ["operador"], true);
      if (negado) return negado;
      return json({ ok: true, ...(await rastrear(sb)) });
    }
    return json({ ok: false, erro: "ação desconhecida" }, 400);
  } catch (e) {
    return json({ ok: false, erro: (e as Error).message });
  }
});
