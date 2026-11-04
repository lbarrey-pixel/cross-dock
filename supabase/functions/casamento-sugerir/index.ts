// Sugere casamentos entre itens recebidos (NF de chegada) e itens de pedido aguardando recebimento.
// Regras explicáveis primeiro (modelo, memória, marcadores, valor, data); o LLM só desempata casos
// que não saíram com confiança alta e só se estiver configurado. Nada é confirmado aqui: o operador confirma.
import { admin, exigir, json, servir } from "../_shared/comum.ts";
import {
  Candidato, classificar, Confianca, extrairResposta, ItemRecebido, montarPrompt, pontuarCandidatos, textoMarcadores,
} from "../_shared/casamento.ts";
import { provedorConfigurado } from "../_shared/llm.ts";

servir(async (req) => {
  const negado = await exigir(req, ["operador", "cd"]);
  if (negado) return negado;
  const sb = admin();
  const body = await req.json().catch(() => ({}));

  let q = sb.from("v_itens_recebidos_saldo").select("*").gt("qtd_sem_dono", 0).eq("bloqueado", false);
  if (body.recebimento_id) q = q.eq("recebimento_id", Number(body.recebimento_id));
  const { data: recebidos } = await q;
  const alvo = ((recebidos ?? []) as (ItemRecebido & { tem_sugestao: boolean })[]).filter((r) => !r.tem_sugestao);
  if (!alvo.length) return json({ ok: true, sugeridos: 0, analisados: 0 });

  const { data: abertos } = await sb.from("v_itens_status")
    .select("item_pedido_id, pedido_id, descricao, codigo, unidade, valor_unitario, q_aguardando_recebimento")
    .gt("q_aguardando_recebimento", 0).eq("no_fluxo", true);
  const pedIds = [...new Set((abertos ?? []).map((a: any) => a.pedido_id))];
  const ids = pedIds.length ? pedIds : [0];
  const { data: peds } = await sb.from("pedidos").select("id, numero, data_pedido, no_fluxo").in("id", ids);
  const { data: marcs } = await sb.from("pedido_marcadores").select("*").in("pedido_id", ids);
  const { data: memoria } = await sb.from("casamento_memoria").select("*").limit(5000);

  const pedidos = new Map((peds ?? []).filter((p: any) => p.no_fluxo).map((p: any) => [p.id, p]));
  const marcadores = new Map((marcs ?? []).map((m: any) => [m.pedido_id, textoMarcadores(m.marcadores)]));
  const base = ((abertos ?? []) as Candidato[]).filter((a) => pedidos.has(a.pedido_id));
  const ctx = { pedidos, marcadores, memoria: memoria ?? [] };
  const llm = await provedorConfigurado(sb);

  let sugeridos = 0;
  for (const r of alvo) {
    const pontuados = pontuarCandidatos(r, base, ctx);
    let confianca: Confianca | null = classificar(pontuados);
    if (!confianca) continue;
    let escolha = pontuados[0];
    let origem = "regra";
    let motivo = escolha.motivos.join("; ");

    if (llm && confianca !== "alta") {
      const top = pontuados.slice(0, 6);
      try {
        const texto = await llm.completar(montarPrompt(r, top, marcadores));
        const resp = extrairResposta(texto, top.map((t) => t.candidato.item_pedido_id));
        if (resp?.id === null) continue; // o LLM recusou todos os candidatos
        if (resp) {
          escolha = top.find((t) => t.candidato.item_pedido_id === resp.id)!;
          confianca = resp.confianca;
          origem = "ia";
          motivo = `IA: ${resp.motivo}${escolha.motivos.length ? " · " + escolha.motivos.join("; ") : ""}`;
        }
      } catch (e) {
        console.warn("LLM indisponível, mantendo a regra:", (e as Error).message);
      }
    }
    const qtd = Math.min(Number(r.qtd_sem_dono), Number(escolha.candidato.q_aguardando_recebimento));
    const { error } = await sb.from("casamentos").insert({
      item_recebido_id: r.id, item_pedido_id: escolha.candidato.item_pedido_id, qtd, origem, confianca, motivo,
    });
    if (!error) sugeridos++;
  }
  return json({ ok: true, sugeridos, analisados: alvo.length });
});
