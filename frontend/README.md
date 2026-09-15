# Conference Lead Gen — frontend

Vue 3 + Quasar SPA, deployed on Vercel. Talks only to Supabase Edge Functions;
there is no same-origin API.

See the repo root `README.md` for what the system does and `CLAUDE.md` for the
rules that matter when changing it.

## Setup

```bash
npm install
cp .env.example .env    # then fill in the three values
npm run dev
```

**All three env vars are required** — there is deliberately no fallback in the
source. A missing or misspelled value fails the build rather than silently
pointing a dev build at the production project, which is what the old defaults
did (audit S8).

| Var | Local | Deployed |
|---|---|---|
| `VITE_SUPABASE_URL` | `http://127.0.0.1:54321` | `https://<ref>.supabase.co` |
| `VITE_FUNCTIONS_BASE_URL` | `…:54321/functions/v1` | `https://<ref>.supabase.co/functions/v1` |
| `VITE_SUPABASE_ANON_KEY` | from `supabase status` | the project's anon key |

The anon key is safe to ship in a public build — it only satisfies the Edge
Functions gateway's own JWT check. The real privilege boundary is
`requireUser()` and the role checks inside each function.

## Scripts

```bash
npm run dev         # quasar dev, HMR
npm run build       # production build -> dist/spa
npm run typecheck   # vue-tsc --noEmit  (runs in CI)
```

## Routes

| Route | Access |
|---|---|
| `/login` | public; the default landing page |
| `/intake`, `/booth`, `/session` | **public** — the attendee form and its QR aliases |
| `/privacy`, `/terms` | **public** — required by the Twilio A2P 10DLC campaign |
| `/review` | any logged-in role; a `sales` rep sees only their own contacts |
| `/notes` | any logged-in role; paste a typed note |
| `/setup` | any logged-in role |
| `/export` | `admin` / `solutionsSuccess` only |

Routing is `history` mode, not hash. `vercel.json` rewrites everything to
`index.html`, and `router/index.ts` upgrades legacy `/#/booth` URLs from QR
slides already printed and handed out.

## Things that will bite you

- **The CSP lives in `index.html`** as a `<meta>` tag (`script-src 'self'`, no
  `unsafe-inline`). It is load-bearing — `router/index.ts` works around it
  rather than loosening it. `vercel.json` adds the headers a meta tag cannot
  express, notably `frame-ancestors`.
- **Export is two-phase.** `export-csv` reserves a batch and returns its id in
  `X-Export-Batch-Id`; the client must POST that to `export-confirm` once the
  blob is actually in hand, or those leads come back on the next export. Don't
  "simplify" that away — marking them synced up front is how leads got lost.
- **The kiosk lock is a display mode, not a security boundary.** It sets a
  `localStorage` flag while the session stays live underneath. Tracked as audit
  N2.
