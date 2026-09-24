// Ported from local-agent/skill-runner.mjs as part of the n8n migration.
//
// Fallback JSON extraction for whenever a sub-workflow can't use Anthropic's
// native structured output / forced tool-use (see the migration plan,
// "Shared run-a-skill sub-workflow" — structured output is primary now that
// skills call the Messages API directly instead of parsing Claude Code CLI
// stdout; this brace-parsing behavior is kept only as a documented fallback,
// not the default path, since Anthropic's own JSON-schema-forced tool output
// makes this unnecessary in the common case).
//
// Prefers the LAST balanced JSON object in the text rather than the first.
// A model that reasons in prose before printing its answer can emit a
// JSON-looking fragment earlier — taking the first match silently parses
// that fragment instead, and every real field comes back undefined and is
// written as null.

function parseBalancedFrom(text, start) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return { value: JSON.parse(text.slice(start, i + 1)), end: i };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function extractJson(text) {
  const objects = [];
  let cursor = text.indexOf('{');
  while (cursor !== -1) {
    const parsed = parseBalancedFrom(text, cursor);
    if (parsed) {
      objects.push(parsed.value);
      cursor = text.indexOf('{', parsed.end + 1);
    } else {
      cursor = text.indexOf('{', cursor + 1);
    }
  }

  if (objects.length === 0) throw new Error('No JSON object found in skill output');
  if (objects.length > 1) {
    console.log(
      `${new Date().toISOString()} WARN skill output contained ${objects.length} JSON objects — using the last one`,
    );
  }
  return objects[objects.length - 1];
}
