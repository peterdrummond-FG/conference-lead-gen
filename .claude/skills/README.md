# The skills

Five skills, one folder each: `process-cards`, `extract-note-contacts`,
`attribute-voice-memo`, `research-contact`, `match-contact`.

**Editing a `SKILL.md` can be a production change, not a docs change.** Everything
after the frontmatter (the second `---`) is embedded verbatim as the live system
prompt of that skill's n8n workflow (`skill-<name>`), by
`n8n/scripts/build-skill-workflow.mjs`. n8n keeps a copy, not a reference: after you
change a body, regenerate, update the existing workflow in place, and republish
(`n8n/README.md`, "Changing things"). Until then git and production disagree.

The `name`/`description` frontmatter is stripped by the generator, so changing only
that has no effect on any workflow. Some body text still describes the retired laptop
runner (`claude -p`, a stdout JSON line, a watcher script); a runtime note that the
generator prepends tells the model which mechanics differ in n8n, so those lines are
harmless but are live prompt text. Leave them unless you are also regenerating.

A skill's output contract is the matching `n8n/schemas/*.schema.json`. A skill never
holds a credential and never writes: its pipeline does (`CLAUDE.md`, rules 1 to 3).
