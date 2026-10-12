# CKH Connect — frontend

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

npm is the package manager (`package-lock.json`, and Vercel runs `npm install`).
`pnpm-workspace.yaml` is a leftover from the Quasar scaffold and is not used.
Node 22.18 or newer is needed to run the tests (they import `.ts` files directly).

**All three env vars are required** — there is deliberately no fallback in the
source. A missing or misspelled value does not fail the build (`npm run build`
succeeds without a `.env`); it throws when the page loads, so you see a blank app
and the error in the browser console. That is deliberate: it stops a dev build
silently pointing at the production project, which is what the old defaults did.

| Var | Local | Deployed |
|---|---|---|
| `VITE_SUPABASE_URL` | `http://127.0.0.1:54321` (a local `supabase start`) or the project URL | `https://<ref>.supabase.co` |
| `VITE_FUNCTIONS_BASE_URL` | `…:54321/functions/v1` | `https://<ref>.supabase.co/functions/v1` |
| `VITE_SUPABASE_ANON_KEY` | from `supabase status`, or the project's anon key | the project's anon key |

There is no local Supabase stack set up for this project, so day-to-day development
points these at the real project (the anon key and URL are public; what you can do
is limited by your login's role). Changes to Edge Functions or the database are made
against that project, not locally: see `docs/RUNBOOKS.md`. The n8n pipelines cannot
run locally at all.

The anon key is safe to ship in a public build — it only satisfies the Edge
Functions gateway's own JWT check. The real privilege boundary is
`requireUser()` and the role checks inside each function.

## Scripts

```bash
npm run dev         # quasar dev, HMR
npm run build       # production build -> dist/spa
npm run typecheck   # vue-tsc --noEmit  (runs in CI)
npm test            # node --test on src/utils/*.test.mjs and src/components/tour/*.test.mjs
```

The tests cover the pure logic (the Contacts list rules, voice-memo wording, institution
picker, tour copy and scene lengths). Several also read source files under
`supabase/` and `n8n/` as text, to keep a screen's wording true to the code behind
it, so run them from a full checkout, not from `frontend/` alone.

## Routes

| Route | Access |
|---|---|
| `/login` | public; the default landing page |
| `/connect`, `/booth`, `/session` | **public** — the attendee form and its QR aliases. Signed-in staff reach it from the **Kiosk** tab; only the label changed, the URL is printed on QR codes and must not |
| `/privacy`, `/terms` | **public** — required by the Twilio A2P 10DLC campaign |
| `/contacts` | any logged-in role; one list of every lead, unconfirmed first (`ContactsPage.vue`; its rules are in `utils/contactsList.ts`). A `sales` rep sees only their own contacts. Held voice memos and failed items sit in a closed section on the same page. (`/review` redirects here with its query kept: old bookmarks and texted links use it.) |
| `/notes` | any logged-in role; paste a typed note covering several people |
| `/setup` | any logged-in role: two sections, "You send contacts in" (choose your conference, link your phone) and "Other people add themselves" (your QR code, the Kiosk) |
| `/reset-password` | **public** — the landing page of a password-reset email link |
| `/connect/<repSlug>` | **public** — a rep's own QR link; redirects to `/connect` with the rep in the query |
| `/tour-preview` | development only (`import.meta.env.DEV`) — previews the onboarding tour |
| `/admin` | `admin` / `solutionsSuccess` only — activate/end conferences, manage the team and each rep's "Working at" conference |
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
  `localStorage` flag while the session stays live underneath, so the PIN keeps a
  casual passer-by out of the signed-in tabs and nothing more.
