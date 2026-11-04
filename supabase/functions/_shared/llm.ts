// Porta para o LLM usado como desempate no casamento. O restante do código só conhece ProvedorLLM;
// o adaptador HTTP fala com qualquer API de chat configurada por ambiente, e o fake serve aos testes.
import { SupabaseClient } from "@supabase/supabase-js";
import { credencial } from "./comum.ts";

export interface ProvedorLLM {
  completar(prompt: string): Promise<string>;
}

export class ProvedorHttp implements ProvedorLLM {
  constructor(
    private url: string,
    private chave: string,
    private modelo: string,
    private cabecalhosExtras: Record<string, string> = {},
    private maxTokens = 200,
  ) {}

  async completar(prompt: string): Promise<string> {
    const r = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.chave}`,
        "x-api-key": this.chave,
        ...this.cabecalhosExtras,
      },
      body: JSON.stringify({ model: this.modelo, max_tokens: this.maxTokens, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`LLM respondeu ${r.status}`);
    return textoDaResposta(await r.json());
  }
}

// Aceita os dois formatos comuns de resposta de chat: choices[0].message.content e content[0].text.
export function textoDaResposta(j: any): string {
  const t = j?.choices?.[0]?.message?.content ?? j?.content?.[0]?.text;
  if (typeof t !== "string") throw new Error("Resposta do LLM em formato desconhecido");
  return t;
}

export class ProvedorFake implements ProvedorLLM {
  chamadas: string[] = [];
  constructor(private resposta: string | ((prompt: string) => string)) {}
  completar(prompt: string): Promise<string> {
    this.chamadas.push(prompt);
    return Promise.resolve(typeof this.resposta === "function" ? this.resposta(prompt) : this.resposta);
  }
}

// Credenciais em integracoes_estado (cred:llm_*), com as variáveis de ambiente como reserva. Sem URL e chave: sem LLM.
export async function provedorConfigurado(sb: SupabaseClient): Promise<ProvedorLLM | null> {
  const url = (await credencial(sb, "llm_api_url")) ?? Deno.env.get("LLM_API_URL") ?? null;
  const chave = (await credencial(sb, "llm_api_key")) ?? Deno.env.get("LLM_API_KEY") ?? null;
  const modelo = (await credencial(sb, "llm_model")) ?? Deno.env.get("LLM_MODEL") ?? null;
  if (!url || !chave || !modelo) return null;
  let extras: Record<string, string> = {};
  const bruto = await credencial(sb, "llm_headers");
  if (bruto) { try { extras = JSON.parse(bruto); } catch { /* cabeçalhos extras inválidos: ignora */ } }
  return new ProvedorHttp(url, chave, modelo, extras);
}
