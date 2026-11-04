# CrossDock · web

Site (PWA) do CrossDock. Duas áreas sobre o mesmo cliente Supabase:

- `/operador/*`: painel de pedidos, validação de casamentos, itens sem pedido, análise de frete e configurações (credenciais, certificado, usuários).
- `/cd/*`: telas pensadas para celular no armazém: recebimento por código de barras, endereçamento, separação com volumetria, expedição lendo o DACTE.

A área exibida vem do papel em `perfis`; a autorização de verdade é do banco (RLS e RPCs), não deste código.

## Rodar

```bash
cp .env.example .env     # VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm ci
npm run dev              # http://localhost:5173
```

| Comando | O que faz |
| --- | --- |
| `npm run lint` | oxlint |
| `npx tsc -b` | checagem de tipos |
| `npm test` | Vitest: chave de acesso, leitura de XML (jsdom), próximo passo do pedido |
| `npm run build` | `tsc -b` e build de produção do Vite |

## Estrutura

| Caminho | Conteúdo |
| --- | --- |
| `src/App.tsx` | sessão, perfil e rotas por papel |
| `src/pages/operador/` | Painel, PedidoDetalhe, Casamentos, SemDono, Frete, Config |
| `src/pages/cd/` | Início, Receber, Endereçar, Separação, Expedição, Endereços |
| `src/components/` | Layout, componentes de UI, `Leitor` (câmera e código de barras), `MedidorAR` (WebXR, só Android com ARCore) |
| `src/lib/` | cliente Supabase, chave de acesso (DV módulo 11), leitura de NF-e/CT-e no navegador, estágios do fluxo, tipos das views |

## Notas

- `MedidorAR` usa a API WebXR de hit-test para medir caixas; sem suporte do aparelho, o botão explica e as medidas são digitadas.
- Fotos são reduzidas no navegador antes do envio (lado maior 1600 px).
- Os tipos em `src/lib/tipos.ts` são escritos à mão para as views e consultas que as telas usam.
