# MCP configs for headless skill invocations

`claude -p` is invoked with `--strict-mcp-config`, so the operator's
account-level MCP connectors (Gmail, Drive, Supabase admin, the write-capable
Zoho CRM connector) are **not** loaded. Only a config named explicitly in
`local-agent/skill-profiles.mjs` is.

- `zoho-readonly.json` — the read-only Zoho CRM connector, the only external
  service any skill may reach. Used solely by `match-contact`, whose SKILL.md
  promises it never writes to Zoho; this config plus that skill's
  `allowedTools` list is what enforces the promise (audit A5).

The URL carries a per-installation token. It is not a secret on the level of
the service-role key, but treat it as a credential: it grants read access to
the org's CRM.

If Zoho ever needs re-provisioning, replace the URL here — do **not** add the
write-capable connector, and do not widen `match-contact`'s allowlist to a
server wildcard.
