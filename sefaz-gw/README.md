# sefaz-gw

Gateway mínimo para as chamadas SOAP à SEFAZ (Distribuição DF-e, Recepção de Evento) com certificado A1.

As edge functions rodam em um runtime cujo cliente TLS não fecha o handshake mTLS com os servidores da SEFAZ.
O gateway recebe a chamada já montada (URL, action, corpo XML, cadeia e chave PEM), abre a conexão com o OpenSSL do
Node e devolve status e corpo. Não guarda nada.

- `POST /soap` autenticado pelo cabeçalho `x-token` (variável `GW_TOKEN`, comparação em tempo constante).
- Só aceita destinos `*.fazenda.gov.br`, `*.sefaz.<uf>.gov.br` e `*.svrs.rs.gov.br`.
- A validação do servidor fica ligada. Se a cadeia ICP-Brasil não estiver no repositório de CAs da imagem,
  `GW_TLS_RELAXADO=1` permite repetir a chamada sem validar (o corpo vai assinado, mas avalie o risco).
- `GET /health`.

```bash
npm test                        # node:test, sem rede
GW_TOKEN=troque-isto npm start  # porta 8080
docker build -t sefaz-gw . && docker run -p 8080:8080 -e GW_TOKEN=troque-isto sefaz-gw
```

Depois de publicado, grave a URL em `integracoes_estado` (`sefaz_gw_url`) e o token em `cred:sefaz_gw_token`
pela tela de Configurações.
