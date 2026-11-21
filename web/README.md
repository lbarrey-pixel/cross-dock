# CrossDock · web

CrossDock site (PWA). Two areas on the same Supabase client:

- `/operador/*`: orders dashboard, match validation, items with no order, freight analysis, and settings (credentials, certificate, users).
- `/cd/*`: screens designed for a phone in the warehouse: receiving by barcode, location assignment, picking with volume measurement, shipping by reading the DACTE (printable document for the CT-e, the Brazilian electronic freight document).

The area shown comes from the role in `perfis`; the real authorization is the database (RLS and RPCs), not this code.

## Run

```bash
cp .env.example .env     # VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm ci
npm run dev              # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run lint` | oxlint |
| `npx tsc -b` | type check |
| `npm test` | Vitest: access key, XML reading (jsdom), the order's next step |
| `npm run build` | `tsc -b` and the Vite production build |

## Structure

| Path | Contents |
| --- | --- |
| `src/App.tsx` | session, profile, and routes by role |
| `src/pages/operador/` | Painel, PedidoDetalhe, Casamentos, SemDono, Frete, Config |
| `src/pages/cd/` | Início, Receber, Endereçar, Separação, Expedição, Endereços |
| `src/components/` | Layout, UI components, `Leitor` (camera and barcode), `MedidorAR` (WebXR, Android with ARCore only) |
| `src/lib/` | Supabase client, access key (modulo-11 check digit), in-browser reading of NF-e (Brazilian electronic invoice) and CT-e, flow stages, view types |

## Notes

- `MedidorAR` uses the WebXR hit-test API to measure boxes; without device support, the button explains and the measurements are typed in.
- Photos are reduced in the browser before upload (longer side 1600 px).
- The types in `src/lib/tipos.ts` are written by hand for the views and queries the screens use.
