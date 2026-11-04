// Cliente de um ERP com API REST v3 e OAuth2. Os endereços da API e da autorização vêm do ambiente.
// O ritmo é controlado por instância: cada invocação da edge function cria o seu cliente, sem estado global.
import { SupabaseClient } from "@supabase/supabase-js";
import { credencial, estado, salvarEstado, sleep } from "./comum.ts";

const MAX_TENTATIVAS = 3;

export function configErp() {
  const api = Deno.env.get("ERP_API_URL");
  const auth = Deno.env.get("ERP_AUTH_URL");
  if (!api || !auth) throw new Error("ERP_API_URL e ERP_AUTH_URL não configuradas");
  return { api: api.replace(/\/$/, ""), auth: auth.replace(/\/$/, "") };
}

export const redirectUri = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/erp-oauth`;

async function pedirToken(sb: SupabaseClient, params: Record<string, string>) {
  const clientId = await credencial(sb, "erp_client_id");
  const secret = await credencial(sb, "erp_client_secret");
  if (!clientId || !secret) throw new Error("Client ID/Secret do ERP não configurados");
  const r = await fetch(`${configErp().auth}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: clientId, client_secret: secret }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ERP recusou o pedido de token (${r.status})`);
  const agora = Date.now();
  await salvarEstado(sb, "erp_tokens", {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expira_em: agora + (j.expires_in ?? 14400) * 1000 - 60_000,
    refresh_expira_em: agora + (j.refresh_expires_in ?? 86400) * 1000 - 60_000,
  });
  return j.access_token as string;
}

export const trocarCodigo = (sb: SupabaseClient, code: string) =>
  pedirToken(sb, { grant_type: "authorization_code", redirect_uri: redirectUri(), code });

async function tokenValido(sb: SupabaseClient): Promise<string> {
  const t = await estado(sb, "erp_tokens");
  if (!t) throw new Error("ERP não conectado: autorize em Configurações");
  if (Date.now() < t.expira_em) return t.access_token;
  if (Date.now() > t.refresh_expira_em) throw new Error("Autorização do ERP expirou: reconecte em Configurações");
  return await pedirToken(sb, { grant_type: "refresh_token", refresh_token: t.refresh_token });
}

export type ClienteErp = { get: (caminho: string, params?: Record<string, string | number>) => Promise<any> };

// intervaloMs: a conta do ERP costuma aceitar ~30 req/min, divididas com outras integrações.
export function criarClienteErp(sb: SupabaseClient, intervaloMs = 3000): ClienteErp {
  let ultima = 0;
  return {
    async get(caminho, params) {
      const url = new URL(configErp().api + caminho);
      for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));
      for (let tentativa = 1; ; tentativa++) {
        const espera = ultima + intervaloMs - Date.now();
        if (espera > 0) await sleep(espera);
        ultima = Date.now();
        const tk = await tokenValido(sb);
        const r = await fetch(url, { headers: { Authorization: `Bearer ${tk}`, Accept: "application/json" } });
        if (r.status === 429 && tentativa < MAX_TENTATIVAS) {
          await sleep(20_000 * tentativa);
          continue;
        }
        const txt = await r.text();
        if (!r.ok) throw new Error(`ERP ${caminho} ${r.status}: ${txt.slice(0, 300)}`);
        try { return JSON.parse(txt); } catch { return txt; }
      }
    },
  };
}
