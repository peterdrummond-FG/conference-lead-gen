// Least-privilege invocation profile per skill (audit A1/A4/A5).
//
// Every headless `claude -p` call in this project ingests content supplied by
// someone outside it: OCR'd business cards texted in by any phone bound to an
// event, Whisper transcripts of that audio, web search results, and notes a
// rep pasted from somewhere else. Before this file existed, those sessions ran
// with `--dangerously-skip-permissions` and no tool scoping at all, which
// meant they inherited the operator's entire account-level MCP fleet --
// Gmail, Google Drive, Supabase project admin, and a WRITE-CAPABLE Zoho CRM
// connector. A single instruction printed on a business card had all of that
// in reach.
//
// runClaudeRaw passes --strict-mcp-config (no MCP server outside `mcpConfig`
// is loaded), --allowedTools, and a computed --disallowedTools. See the
// VERIFIED BEHAVIOUR note below for which of those actually enforces what.
// This is the FIRST line of defence; the data-vs-instructions anchors in each
// SKILL.md are the second. Prose is not a control.
//
// KNOWN RESIDUAL GAP: a per-command allow like 'Bash(sips:*)' does not, on
// its own, confine Bash to that command under --dangerously-skip-permissions
// -- so process-cards/locate-cards effectively have a general shell. What
// bounds them instead is that they hold no credential (the POST moved to the
// caller, audit A2) and run in AGENT_WORKDIR, which contains only a
// .claude/skills symlink. Worth revisiting if the CLI gains a hard
// per-command Bash restriction.
//
// Adding a skill without adding it here is a hard error at invocation time --
// see runSkill. That is deliberate: a new skill should not be able to run
// unsandboxed just because someone forgot this file.

// Zoho's read-only MCP connector, declared in mcp/zoho-readonly.json. The
// tool prefix follows the server name in that file: mcp__<server>__<tool>.
const ZOHO_READONLY_TOOLS = [
  'mcp__zoho_readonly__ZohoCRM_executeCOQLQuery',
  'mcp__zoho_readonly__ZohoCRM_getRecords',
  'mcp__zoho_readonly__ZohoCRM_getRecord',
  'mcp__zoho_readonly__ZohoCRM_getRelatedRecords',
  'mcp__zoho_readonly__ZohoCRM_searchRecords',
  'mcp__zoho_readonly__ZohoCRM_getRecordCount',
  // match-contact's documented recovery path: "if a query errors (e.g. a
  // field name mismatch), confirm the real API name via a fields/module-
  // metadata tool and retry once".
  'mcp__zoho_readonly__ZohoCRM_getFields',
  'mcp__zoho_readonly__ZohoCRM_getModuleByApiName',
  'mcp__zoho_readonly__ZohoCRM_getModules',
];

// VERIFIED BEHAVIOUR, 2026-09-14 -- this matters and is easy to get wrong:
//
//   * --strict-mcp-config DOES exclude every MCP server not named in the
//     --mcp-config file. Probed: a session started this way listed no Gmail,
//     Drive, Supabase or Zoho tools at all.
//   * --allowedTools does NOT restrict BUILT-IN tools when combined with
//     --dangerously-skip-permissions. A session with `--allowedTools Read`
//     still had Bash, Write, Edit, Agent and Workflow available. It reads as
//     an additional-permissions list, not an exclusive allowlist.
//   * --disallowedTools DOES remove a built-in. Probed: with Bash denied, the
//     session had no shell tool and could not run a command.
//
// So the deny list below is the actual control for built-ins, and the allow
// list documents intent (and still matters for MCP tools). Do not assume the
// allow list alone sandboxes anything -- it does not.
// Enumerated by probing a sandboxed session and reading back what it still
// had (the first pass missed the scheduling/remote-trigger family entirely).
// Re-probe after a CLI upgrade: a newly-added built-in is allowed by default,
// so this list is the thing that goes stale. The
// check-skill-profiles.mjs guard re-runs that probe.
const ALL_BUILTIN_TOOLS = [
  'Agent', 'Artifact', 'ArtifactCheck', 'ArtifactComments', 'ArtifactData',
  'Bash', 'BashOutput', 'CronCreate', 'CronDelete', 'CronList', 'DesignSync',
  'Edit', 'EnterPlanMode', 'EnterWorktree', 'ExitPlanMode', 'ExitWorktree',
  'Glob', 'Grep', 'KillShell', 'ListAgents', 'ListPlugins', 'Monitor',
  'NotebookEdit', 'PushNotification', 'Read', 'RemoteTrigger',
  'ReportFindings', 'ScheduleWakeup', 'SearchPlugins', 'SearchSkills',
  'SendMessage', 'SendUserFile', 'ShareOnboardingGuide', 'Skill',
  'SuggestPluginInstall', 'SuggestSkills', 'Task', 'TaskOutput', 'TaskStop',
  'TodoWrite', 'ToolSearch', 'WebFetch', 'WebSearch', 'Workflow', 'Write',
];

// MCP namespaces that must never be reachable, belt-and-braces behind
// --strict-mcp-config.
const DENIED_MCP = [
  'mcp__zoho__*',        // the write-capable Zoho CRM connector
  'mcp__supabase__*',    // project admin
  'mcp__gmail__*',
  'mcp__google_drive__*',
];

// Everything the profile didn't ask for, explicitly denied.
function denyListFor(allowed) {
  const allowedSet = new Set(
    allowed.map((t) => (t.includes('(') ? t.slice(0, t.indexOf('(')) : t)),
  );
  return [...ALL_BUILTIN_TOOLS.filter((t) => !allowedSet.has(t)), ...DENIED_MCP];
}

export const SKILL_PROFILES = {
  // --- Text-only skills: read one temp JSON file, print one JSON object. ---
  // No network, no MCP, no shell. These handle the least-structured and
  // least-trustworthy input in the system (raw Whisper transcripts, rep-typed
  // notes), so they get the smallest possible surface.
  'classify-contact-intent': {
    allowedTools: ['Read'],
    mcpConfig: null,
  },
  'attribute-voice-memo': {
    allowedTools: ['Read'],
    mcpConfig: null,
  },
  'extract-note-contacts': {
    allowedTools: ['Read'],
    mcpConfig: null,
  },

  // --- Web research only. No Zoho (the skill says so itself: "It never
  // touches Zoho itself, and must never be talked into trying"), no shell,
  // no writes. ---
  'research-contact': {
    allowedTools: ['Read', 'WebSearch', 'WebFetch'],
    mcpConfig: null,
  },

  // --- The only skill permitted to reach Zoho, and only the read-only
  // connector. Its SKILL.md promises it never writes; this is what actually
  // enforces that (audit A5). ---
  'match-contact': {
    allowedTools: ['Read', ...ZOHO_READONLY_TOOLS],
    mcpConfig: 'mcp/zoho-readonly.json',
  },

  // --- Image skills: read the photo, shell out to sips/bc for crops, write
  // crop files. No network tool: the POST to contacts-from-ocr moved OUT of
  // the skill and into agent.mjs/watch-cards.command (audit A2), so the model
  // never holds the service-role key and has nowhere to send one. ---
  'process-cards': {
    allowedTools: ['Read', 'Write', 'Bash(sips:*)', 'Bash(bc:*)'],
    mcpConfig: null,
  },
  'locate-cards': {
    allowedTools: ['Read', 'Write', 'Bash(sips:*)', 'Bash(bc:*)'],
    mcpConfig: null,
  },
};

export function profileFor(skillName) {
  const profile = SKILL_PROFILES[skillName];
  if (!profile) {
    throw new Error(
      `No tool profile declared for skill '${skillName}' in skill-profiles.mjs — ` +
      `refusing to invoke it unsandboxed. Add one (most skills need only ['Read']).`,
    );
  }
  return { ...profile, disallowedTools: denyListFor(profile.allowedTools) };
}
