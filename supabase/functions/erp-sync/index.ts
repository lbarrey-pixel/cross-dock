// Sincronização com o ERP.
// 1) Importa pedidos em aberto (situação 0) com número >= corte que ainda não estão no CrossDock.
//    Depois de importado, o pedido não é mais sincronizado.
// 2) Única mudança acompanhada: pedido que passou a faturado. Coleta DANFE e XML e
//    registra a NF na consolidação que está "consolidado".
import { admin, evento, exigir, json, salvarEstado, servir, soDigitos } from "../_shared/comum.ts";
import { criarClienteErp } from "../_shared/erp.ts";
import { lerNfeSaida } from "../_shared/nfe.ts";

const MAX_IMPORT = 8; // por execução, para respeitar o limite de requisições
const FATURADO = new Set([1, 7, 5, 6]); // faturada, pronto envio, enviada, entregue

servir(async (req) => {
  const negado = await exigir(req, ["operador"], true);
  if (negado) return negado;
  const sb = admin();
  const erp = criarClienteErp(sb);
  const log: string[] = [];
  try {
    const { data: cfg } = await sb.from("config").select("valor").eq("chave", "corte_pedido").single();
    const corte = Number(cfg?.valor ?? 0);

    // ---------- 1. importação ----------
    if (!corte) {
      log.push("Número de corte não definido: importação desligada.");
    } else {
      const novos: number[] = [];
      for (let offset = 0; offset < 500 && novos.length < MAX_IMPORT; offset += 100) {
        const lista = await erp.get("/pedidos", { situacao: 0, limit: 100, offset, orderBy: "desc" });
        const itens: any[] = lista?.itens ?? [];
        const candidatos = itens.filter((p) => Number(p.numeroPedido) >= corte);
        if (candidatos.length) {
          const { data: ja } = await sb.from("pedidos").select("erp_id").in("erp_id", candidatos.map((p) => p.id));
          const existentes = new Set((ja ?? []).map((x) => Number(x.erp_id)));
          for (const p of candidatos) if (!existentes.has(Number(p.id)) && novos.length < MAX_IMPORT) novos.push(p.id);
        }
        if (itens.length < 100) break;
      }
      for (const id of novos) {
        const p = await erp.get(`/pedidos/${id}`);
        let marcadores: any[] = [];
        try {
          marcadores = await erp.get(`/pedidos/${id}/marcadores`);
        } catch (e) {
          log.push(`Pedido ${p.numeroPedido}: sem marcadores (${(e as Error).message.slice(0, 80)})`);
        }
        const end = p.enderecoEntrega?.cep ? p.enderecoEntrega : p.cliente?.endereco ?? {};
        const { data: ped, error } = await sb.from("pedidos").insert({
          erp_id: p.id,
          numero: p.numeroPedido,
          numero_oc_cliente: p.numeroOrdemCompra || null,
          data_pedido: p.data || null,
          cliente: p.cliente?.nome,
          cnpj: p.cliente?.cpfCnpj,
          entrega: end,
          cep_entrega: soDigitos(end.cep) || null,
          cidade: end.municipio || null,
          uf: end.uf || null,
          total: p.valorTotalPedido,
          situacao_erp: String(p.situacao),
        }).select("id").single();
        if (error) { log.push(`Pedido ${p.numeroPedido}: ${error.message}`); continue; }
        await sb.from("pedido_marcadores").insert({ pedido_id: ped.id, marcadores: marcadores ?? [] });
        const itens = (p.itens ?? []).map((it: any) => ({
          pedido_id: ped.id,
          erp_produto_id: it.produto?.id ?? null,
          codigo: it.produto?.sku ?? null,
          descricao: it.produto?.descricao ?? "(sem descrição)",
          quantidade: it.quantidade,
          valor_unitario: it.valorUnitario,
        }));
        if (itens.length) await sb.from("itens_pedido").insert(itens);
        await evento(sb, "pedido", ped.id, "importado_do_erp", { numero: p.numeroPedido });
        log.push(`Pedido ${p.numeroPedido} importado com ${itens.length} itens.`);
      }
      if (!novos.length) log.push("Nenhum pedido novo.");
    }

    // ---------- 2. faturamento ----------
    const { data: aguardando } = await sb.from("consolidacoes")
      .select("id, pedido_id, pedidos!inner(erp_id, numero)")
      .eq("status", "consolidado");
    const porPedido = new Map<number, any[]>();
    for (const c of aguardando ?? []) {
      const k = c.pedido_id as number;
      porPedido.set(k, [...(porPedido.get(k) ?? []), c]);
    }
    for (const [, cons] of porPedido) {
      const erpId = (cons[0] as any).pedidos.erp_id;
      const numero = (cons[0] as any).pedidos.numero;
      if (!erpId) continue;
      const p = await erp.get(`/pedidos/${erpId}`);
      if (!FATURADO.has(Number(p.situacao)) || !p.idNotaFiscal) continue;
      if (cons.length > 1) {
        log.push(`Pedido ${numero}: faturado, mas há ${cons.length} consolidações prontas; anexe a NF manualmente.`);
        await evento(sb, "pedido", cons[0].pedido_id, "nf_ambigua", { consolidacoes: cons.map((c) => c.id) });
        continue;
      }
      const c = cons[0];
      const xmlResp = await erp.get(`/notas/${p.idNotaFiscal}/xml`);
      const xml: string = xmlResp?.xmlNfe ?? "";
      if (!xml) { log.push(`Pedido ${numero}: NF sem XML ainda.`); continue; }
      const nf = lerNfeSaida(xml);
      const xmlPath = `nf-saida/${nf.chave ?? p.idNotaFiscal}.xml`;
      await sb.storage.from("documentos").upload(xmlPath, new Blob([xml], { type: "application/xml" }), { upsert: true });
      let danfePath: string | null = null;
      try {
        const lk = await erp.get(`/notas/${p.idNotaFiscal}/link`);
        if (lk?.link) {
          danfePath = "url:" + lk.link;
          const pdf = await fetch(lk.link);
          if (pdf.ok && (pdf.headers.get("content-type") ?? "").includes("pdf")) {
            const caminho = `nf-saida/${nf.chave ?? p.idNotaFiscal}.pdf`;
            await sb.storage.from("documentos").upload(caminho, await pdf.blob(), { upsert: true, contentType: "application/pdf" });
            danfePath = caminho;
          }
        }
      } catch (e) { log.push(`Pedido ${numero}: DANFE não baixada (${(e as Error).message})`); }
      const { data: div, error } = await sb.rpc("registrar_nf_saida", {
        p_id: c.id, p_numero: nf.numero, p_chave: nf.chave, p_xml_path: xmlPath, p_danfe_path: danfePath,
        p_qvol: nf.qVol, p_peso_b: nf.pesoB, p_peso_l: nf.pesoL, p_dest_cnpj: nf.destCnpj,
      });
      if (error) log.push(`Pedido ${numero}: ${error.message}`);
      else log.push(`Pedido ${numero}: NF ${nf.numero} coletada${(div as any[])?.length ? " com divergências" : " e conferida"}.`);
    }

    await salvarEstado(sb, "erp_ultima_sync", { em: new Date().toISOString(), log });
    return json({ ok: true, log });
  } catch (e) {
    const msg = (e as Error).message;
    await salvarEstado(sb, "erp_ultima_sync", { em: new Date().toISOString(), erro: msg, log });
    return json({ ok: false, erro: msg, log });
  }
});
