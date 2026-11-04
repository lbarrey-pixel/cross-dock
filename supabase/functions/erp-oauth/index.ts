// Autorização OAuth2 do ERP. GET ?iniciar=1 redireciona para o login do ERP;
// ele volta com ?code=... e os tokens ficam guardados só no banco.
import { admin, credencial, escaparHtml, estado, salvarEstado, servir } from "../_shared/comum.ts";
import { configErp, redirectUri, trocarCodigo } from "../_shared/erp.ts";

const pagina = (titulo: string, msg: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escaparHtml(titulo)}</title>
<body style="font-family:system-ui;max-width:520px;margin:15vh auto;padding:0 20px;color:#0b1f3a">
<h2>${escaparHtml(titulo)}</h2><p>${escaparHtml(msg)}</p><p>Pode fechar esta aba e voltar ao CrossDock.</p></body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

servir(async (req) => {
  const url = new URL(req.url);
  const sb = admin();
  try {
    if (url.searchParams.get("iniciar")) {
      const clientId = await credencial(sb, "erp_client_id");
      if (!clientId) return pagina("Falta configurar", "Cadastre o Client ID e o Client Secret do ERP em Configurações.");
      const state = crypto.randomUUID();
      await salvarEstado(sb, "erp_oauth_state", { state, em: Date.now() });
      const auth = new URL(`${configErp().auth}/auth`);
      auth.searchParams.set("client_id", clientId);
      auth.searchParams.set("redirect_uri", redirectUri());
      auth.searchParams.set("scope", "openid");
      auth.searchParams.set("response_type", "code");
      auth.searchParams.set("state", state);
      return Response.redirect(auth.toString(), 302);
    }
    const code = url.searchParams.get("code");
    if (code) {
      const st = await estado(sb, "erp_oauth_state");
      if (!st || st.state !== url.searchParams.get("state") || Date.now() - st.em > 15 * 60_000) {
        return pagina("Autorização inválida", "O pedido de autorização expirou. Tente conectar de novo.");
      }
      await salvarEstado(sb, "erp_oauth_state", null);
      await trocarCodigo(sb, code);
      return pagina("ERP conectado", "O CrossDock já pode ler os pedidos e as notas do ERP.");
    }
    return pagina("CrossDock · ERP", "Use o botão Conectar ERP em Configurações.");
  } catch (e) {
    return pagina("Erro ao conectar", (e as Error).message);
  }
});
