// Utilidades compartilhadas pelas edge functions.
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Origens permitidas vêm de ALLOWED_ORIGINS (lista separada por vírgula). Sem a variável, só o dev server local.
export function corsHeaders(origin: string | null, permitidas: string[]): Record<string, string> {
  const base: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
  if (origin && permitidas.includes(origin)) base["Access-Control-Allow-Origin"] = origin;
  return base;
}

function origensPermitidas(): string[] {
  const env = Deno.env.get("ALLOWED_ORIGINS");
  return (env ? env.split(",") : ["http://localhost:5173"]).map((s) => s.trim()).filter(Boolean);
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

// Envolve o handler: responde o preflight, aplica CORS e transforma exceção em 500 sem vazar detalhes.
export function servir(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    const cors = corsHeaders(req.headers.get("Origin"), origensPermitidas());
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let res: Response;
    try {
      res = await handler(req);
    } catch (e) {
      console.error(e);
      res = json({ ok: false, erro: "Erro interno" }, 500);
    }
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  });
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

// Cliente com a identidade de quem chamou (respeita RLS).
export function doUsuario(req: Request): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
}

export function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export type Quem = { via: "cron" | "usuario"; papel: "operador" | "cd" | null };

// Quem está chamando: o agendador (cabeçalho x-cron-secret) ou um usuário com perfil.
export async function identificar(req: Request): Promise<Quem | null> {
  const segredo = Deno.env.get("CRON_SECRET");
  const enviado = req.headers.get("x-cron-secret");
  if (segredo && enviado && igual(enviado, segredo)) return { via: "cron", papel: null };
  if (!req.headers.get("Authorization")) return null;
  const { data } = await doUsuario(req).rpc("papel_atual");
  return data ? { via: "usuario", papel: data as "operador" | "cd" } : null;
}

// Aceita o agendador ou um usuário com um dos papéis indicados. Devolve a resposta de erro, ou null se liberado.
export async function exigir(req: Request, papeis: ("operador" | "cd")[], aceitaCron = false): Promise<Response | null> {
  const q = await identificar(req);
  if (!q) return json({ ok: false, erro: "Sem acesso" }, 401);
  if (q.via === "cron") return aceitaCron ? null : json({ ok: false, erro: "Sem acesso" }, 403);
  return q.papel && papeis.includes(q.papel) ? null : json({ ok: false, erro: "Sem permissão para esta ação" }, 403);
}

export async function estado(sb: SupabaseClient, chave: string): Promise<any> {
  const { data } = await sb.from("integracoes_estado").select("valor").eq("chave", chave).maybeSingle();
  return data?.valor ?? null;
}

export async function salvarEstado(sb: SupabaseClient, chave: string, valor: unknown) {
  const { error } = await sb.from("integracoes_estado").upsert({ chave, valor, atualizado_em: new Date().toISOString() });
  if (error) throw new Error(`Não consegui gravar ${chave}: ${error.message}`);
}

export async function credencial(sb: SupabaseClient, nome: string): Promise<string | null> {
  const v = await estado(sb, "cred:" + nome);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function evento(sb: SupabaseClient, entidade: string, id: number | null, acao: string, dados?: unknown) {
  await sb.from("eventos").insert({ entidade, entidade_id: id, acao, ator: null, dados: dados ?? null });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

export function escaparHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
