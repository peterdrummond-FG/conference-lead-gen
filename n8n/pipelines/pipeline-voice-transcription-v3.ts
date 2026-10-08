import { workflow, node, trigger, sticky, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

const SUPABASE_URL = 'https://yrvppufkerbjpvrxniot.supabase.co';
const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
// Same assertion twilio-webhook makes before uploading -- re-checked here
// because this value crosses DB -> n8n -> Storage URL.
const STORAGE_KEY_RE = '^sms/[0-9a-f-]{36}\\.[a-z0-9]{1,5}$';
const SAMPLE_ID = '7d2e3b64-3a9f-4c54-8e6f-1c8d6a1fab22';
const SAMPLE_EVENT = '5b0c1d42-1e7d-4a32-8c4d-9a6b4e8f0c33';
const SAMPLE_CONTACT = '0b8f0b3e-3a33-4a4f-9d3f-4b9b1d1f7c20';
const LINK_MAX_ATTEMPTS = 20;
// V3: AMR -> MP3 conversion by the community node n8n-nodes-ffmpeg-audio that the
// n8n admin installed (Resource: Audio, Operation: Convert Audio). It works on the
// item's binary data directly, so unlike the v1 ffmpeg-command node there is no
// scratch folder, no Execute Command and no file-access setting, and unlike v2
// there is no external service or credential. Verified 2026-10-08 on
// workflow.flippengroup.com with a stored memo: same transcript as the saved one.
// Two things found by running it: its 'm4a' output fails ("Output format m4a is
// not available": fluent-ffmpeg looks for a muxer called m4a, ffmpeg's is 'ipod'),
// so we use MP3, which OpenAI accepts; and it always returns the file in binary
// property 'data', whatever the input property was called.
// At this attempt, if no existing candidate has matched yet, ask
// attribute-voice-memo to additionally judge whether the transcript alone
// justifies creating a brand-new contact (see Attribution Input,
// Has Candidates?, and Create Voice Memo Contact below) — mirrors
// LINK_FALLBACK_ATTEMPT in local-agent/agent.mjs.
const LINK_FALLBACK_ATTEMPT = 3;


const ATTRIBUTION_INPUT_JS = "const ctx = $('Link Context').item.json;\nlet rows = null;\nif ($json.statusCode === 200) {\n  try { const raw = $json.data ?? $json.body; const b = typeof raw === 'string' ? JSON.parse(raw) : raw; rows = Array.isArray(b) ? b : null; } catch (e) { rows = null; }\n}\nreturn { json: Object.assign({}, ctx, {\n  fetchOk: rows !== null,\n  candidateRows: (rows ?? []).map(c => ({ id: c.id, interaction_notes: c.interaction_notes ?? null })),\n  candidates: (rows ?? []).map(c => ({ contactId: c.id, firstName: c.first_name ?? '', lastName: c.last_name ?? '', email: c.email ?? '', phone: c.phone ?? '', title: c.title ?? '' })),\n  extractFallbackContact: ctx.linkAttempts === " + LINK_FALLBACK_ATTEMPT + "\n}) };";

const PLAN_EXCERPTS_JS = "// One item per (contact, excerpt). append_contact_interaction_notes is atomic\n// and idempotent (an excerpt already in the notes is left alone), so a retry\n// never duplicates text. An id the skill returned that was not a candidate is\n// ignored.\nconst ctx = $('Attribution Input').item.json;\nconst ids = new Set(ctx.candidateRows.map(c => c.id));\nconst seen = new Set();\nconst excerpts = [];\nfor (const r of ($json.data?.results ?? [])) {\n  if (typeof r.excerpt !== 'string' || r.excerpt.trim() === '' || !ids.has(r.contactId)) continue;\n  const key = r.contactId + '|' + r.excerpt;\n  if (seen.has(key)) continue;\n  seen.add(key);\n  excerpts.push({ messageId: ctx.messageId, linkAttempts: ctx.linkAttempts, contactId: r.contactId, excerpt: r.excerpt });\n}\nreturn { json: { messageId: ctx.messageId, linkAttempts: ctx.linkAttempts, excerpts } };";

const TALLY_LINKS_JS = "// A memo is 'linked' only when every excerpt it produced landed. If an append\n// failed (a transient DB error, or the contact was deleted), the memo stays\n// 'unlinked' with the successes recorded and the retry sweep re-runs it -- the\n// append is idempotent, so the ones already attached do not double. At the\n// attempt cap, anything that landed counts as linked; nothing at all goes to a\n// human via no_candidate_found.\nconst excerpts = $('Split Out Excerpts').all();\nconst byMessage = new Map();\n$input.all().forEach((r, i) => {\n  const e = (excerpts[r.pairedItem?.item ?? i] ?? {}).json ?? {};\n  if (!byMessage.has(e.messageId)) byMessage.set(e.messageId, { linkAttempts: e.linkAttempts, ids: new Set(), failures: 0 });\n  const t = byMessage.get(e.messageId);\n  const ok = r.json.statusCode === 200 && Array.isArray(r.json.body) && r.json.body.length === 1 && r.json.body[0].id === e.contactId;\n  if (ok) t.ids.add(e.contactId); else t.failures++;\n});\nreturn [...byMessage.entries()].map(([messageId, t]) => {\n  const atCap = t.linkAttempts >= " + LINK_MAX_ATTEMPTS + ";\n  const ids = [...t.ids];\n  const status = t.failures === 0 ? 'linked' : (atCap ? (ids.length ? 'linked' : 'no_candidate_found') : 'unlinked');\n  return { json: { messageId, linkAttempts: t.linkAttempts, matched_contact_ids: ids, link_status: status } };\n});";

// Only reached when attribution found no existing candidate AND
// extractFallbackContact was true AND the skill judged the transcript
// sufficient (Has Extracted Contact? = true). A create failure (network,
// validation) must not be silently swallowed as 'handled' -- it falls back to
// the same unmatched/no_candidate_found choice as any other unmatched attempt,
// same reasoning as local-agent's postVoiceMemoContact catch.
const CONTACT_CREATED_ROW_JS = "const ctx = $('Attribution Input').item.json;\nconst res = $json;\nconst ok = typeof res.statusCode === 'number' && res.statusCode >= 200 && res.statusCode < 300 && res.body?.id;\nif (!ok) {\n  const atCap = ctx.linkAttempts >= " + LINK_MAX_ATTEMPTS + ";\n  return { json: { messageId: ctx.messageId, linkAttempts: ctx.linkAttempts, matched_contact_ids: [], link_status: atCap ? 'no_candidate_found' : 'unlinked' } };\n}\nreturn { json: { messageId: ctx.messageId, linkAttempts: ctx.linkAttempts, matched_contact_ids: [res.body.id], link_status: 'contact_created' } };";

// ---------------------------------------------------------------- triggers

const dbWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Audio Message Changed (DB Webhook)',
    position: [200, 200],
    parameters: {
      httpMethod: 'POST',
      path: 'ckh-voice-transcription',
      authentication: 'headerAuth',
      responseMode: 'onReceived',
      options: { noResponseBody: true }
    },
    credentials: { httpHeaderAuth: newCredential('Supabase DB Webhook Secret') }
  },
  output: [{ body: { type: 'UPDATE', table: 'inbound_messages', record: { id: SAMPLE_ID } } }]
});

const webhookMessageId = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Webhook Message Id',
    position: [420, 200],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [
        { id: 'messageId', name: 'messageId', value: expr("{{ String($json.body?.record?.id ?? '') }}"), type: 'string' }
      ] }
    }
  },
  output: [{ messageId: SAMPLE_ID }]
});

const backstop = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.4,
  config: {
    name: 'Backstop Every 5 Minutes',
    position: [200, 460],
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } }
  },
  output: [{}]
});

const resetStale = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Reset Stale Claims',
    position: [420, 400],
    alwaysOutputData: true,
    parameters: {
      method: 'POST',
      url: SUPABASE_URL + '/rest/v1/rpc/reconcile_stale_inbound_messages',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: { stale_minutes: 30 }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{}]
});

const retryTransient = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Retry Transient Failures',
    position: [640, 400],
    executeOnce: true,
    alwaysOutputData: true,
    parameters: {
      method: 'POST',
      url: SUPABASE_URL + '/rest/v1/rpc/reconcile_retryable_failed_inbound_messages',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: { max_attempts: 10, retry_delay_minutes: 5 }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{}]
});

const findPending = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Find Pending Audio',
    position: [860, 400],
    executeOnce: true,
    parameters: {
      method: 'GET',
      url: SUPABASE_URL + '/rest/v1/inbound_messages',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [
        { name: 'select', value: 'id' },
        { name: 'kind', value: 'eq.audio' },
        { name: 'status', value: 'eq.pending_transcription' },
        { name: 'storage_path', value: 'not.is.null' },
        { name: 'order', value: 'received_at' },
        { name: 'limit', value: '5' }
      ] }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID }]
});

const backstopMessageId = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Backstop Message Id',
    position: [1080, 400],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [
        { id: 'messageId', name: 'messageId', value: expr("{{ String($json.id ?? '') }}"), type: 'string' }
      ] }
    }
  },
  output: [{ messageId: SAMPLE_ID }]
});

// ----------------------------------------------------------- transcription

const validMessageId = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Valid Message Id',
    position: [1300, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.messageId }}'), operator: { type: 'string', operation: 'regex' }, rightValue: UUID_RE }],
        combinator: 'and'
      }
    }
  },
  output: [{ messageId: SAMPLE_ID }]
});

const fetchMessage = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Fetch Audio Message',
    position: [1520, 300],
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'inbound_messages',
      returnAll: false,
      limit: 1,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.messageId }}') },
        { keyName: 'kind', condition: 'eq', keyValue: 'audio' },
        { keyName: 'status', condition: 'eq', keyValue: 'pending_transcription' }
      ] }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, kind: 'audio', status: 'pending_transcription', storage_path: 'sms/' + SAMPLE_ID + '.m4a', processing_attempts: 0, link_attempts: 0, event_id: SAMPLE_EVENT, from_phone: '+15551234567' }]
});

// twilio-webhook inserts the row, uploads, then sets storage_path in a second
// UPDATE -- a row with no path yet isn't ready, not broken.
const readyToTranscribe = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Uploaded Yet?',
    position: [1740, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr("{{ typeof $json.storage_path === 'string' && $json.storage_path !== '' }}"), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  },
  output: [{ id: SAMPLE_ID, storage_path: 'sms/' + SAMPLE_ID + '.m4a', processing_attempts: 0 }]
});

const claimRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Claim Audio Row',
    position: [1960, 300],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ messageId: $json.id, status: 'processing', claimed_at: $now.toISO(), processing_attempts: ($json.processing_attempts ?? 0) + 1, last_processing_attempt_at: $now.toISO() }) }}")
    }
  },
  output: [{ messageId: SAMPLE_ID, status: 'processing', processing_attempts: 1 }]
});

const claimMessage = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Claim Audio Message',
    position: [2180, 300],
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'inbound_messages',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.messageId }}') },
        { keyName: 'status', condition: 'eq', keyValue: 'pending_transcription' }
      ] },
      dataToSend: 'autoMapInputData',
      inputsToIgnore: 'messageId'
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, status: 'processing', storage_path: 'sms/' + SAMPLE_ID + '.m4a', processing_attempts: 1, link_attempts: 0, event_id: SAMPLE_EVENT, from_phone: '+15551234567' }]
});

const safePath = ifElse({
  version: 2.3,
  config: {
    name: 'Safe Storage Path?',
    position: [2400, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          { leftValue: expr('{{ $json.storage_path }}'), operator: { type: 'string', operation: 'regex' }, rightValue: STORAGE_KEY_RE },
          // The id is used in claim and write filters below. It came from our
          // own row, but it crossed DB -> n8n, so it is re-checked here rather
          // than trusted because of where it came from.
          { leftValue: expr('{{ $json.id }}'), operator: { type: 'string', operation: 'regex' }, rightValue: UUID_RE }
        ],
        combinator: 'and'
      }
    }
  }
});

// No name hints are sent to the transcription: tested 2026-10-07, both
// gpt-4o-transcribe and whisper-1 heard a noisy-room memo's name ("Chad
// Schmeller") correctly without them, so the roster fetch that used to build a
// prompt is gone. Everything after the claim reads the memo's id, attempt
// number and storage path from here.
const runContext = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Run Context',
    position: [2620, 200],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ messageId: $json.id, claimedAttempts: $json.processing_attempts, storagePath: $json.storage_path }) }}")
    }
  },
  output: [{ messageId: SAMPLE_ID, claimedAttempts: 1, storagePath: 'sms/' + SAMPLE_ID + '.amr' }]
});

const downloadAudio = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Download Audio',
    position: [3280, 200],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: expr("{{ '" + SUPABASE_URL + "/storage/v1/object/voice-memos/' + $json.storagePath }}"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      options: {
        response: { response: { responseFormat: 'file', outputPropertyName: 'audio' } },
        timeout: 60000
      }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{}]
});

const downloaded = ifElse({
  version: 2.3,
  config: {
    name: 'Downloaded?',
    position: [3500, 200],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ !$json.error && !!$binary?.audio }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

// Community node n8n-nodes-ffmpeg-audio. 16 kHz is what speech models want and
// keeps the file small; bit rate stays 'keep' (the node's lowest choice is 64k,
// above what a phone memo needs). Input is the 'audio' property Download Audio
// made; the result lands in 'data'. A failure arrives in $json.error through
// continue-on-error, which Converted? routes to Conversion Failed Row.
const convertAudio = node({
  type: 'n8n-nodes-ffmpeg-audio.ffmpeg',
  version: 1,
  config: {
    name: 'Convert Audio',
    position: [3728, 208],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'audio',
      operation: 'convertAudio',
      binaryPropertyName: 'audio',
      convertOutputFormat: 'mp3',
      convertBitRate: 'keep',
      convertSampleRate: '16000',
      convertOutputFileName: 'memo',
      timeoutSeconds: 60
    }
  },
  output: [{}]
});

const converted = ifElse({
  version: 2.3,
  config: {
    name: 'Converted?',
    position: [3940, 200],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ !$json.error && !!$binary?.data }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

// Transient on purpose: a converter outage or a node problem is fixed
// outside the memo, after which the backstop's retry (bounded at 10) picks it up
// again. A genuinely un-convertible memo (not AMR, corrupt) uses up those
// retries and ends 'failed' where a person sees it, never half-written.
const conversionFailedRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Conversion Failed Row',
    position: [4160, 416],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ messageId: $('Run Context').item.json.messageId, claimedAttempts: $('Run Context').item.json.claimedAttempts, status: 'failed', error: ('audio conversion failed: ' + String($json.error?.message ?? $json.error ?? 'the converter returned no audio (see the n8n execution of Convert Audio)')).slice(0, 2000), error_class: 'transient' }) }}")
    }
  },
  output: [{ messageId: SAMPLE_ID, claimedAttempts: 1, status: 'failed', error: 'audio conversion failed: x', error_class: 'transient' }]
});

// The built-in OpenAI node (Audio > Transcribe) on the converted MP3 (binary property 'data'). Verified
// 2026-10-07 on this instance: it returns { text, usage } and reaches OpenAI
// with credential "OpenAI account 2". It appears to use whisper-1 (its usage is
// reported in seconds, whisper-1's format) and has no prompt or model option; on
// a noisy test memo whisper-1 dropped the opening word that gpt-4o-transcribe
// kept, so compare both on real memos before cutover. An API error (quota, 429,
// 5xx) lands in $json.error, which Transcription Failed Row classes as transient
// (retried, bounded); an empty transcript is terminal.
const openAiTranscribe = node({
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 2.3,
  config: {
    name: 'OpenAI Transcribe',
    position: [4380, 200],
    onError: 'continueRegularOutput',
    parameters: { resource: 'audio', operation: 'transcribe', binaryPropertyName: 'data', options: { language: 'en' } },
    credentials: { openAiApi: newCredential('OpenAI account 2') }
  },
  output: [{ text: 'Met Jane Doe, she wants a demo.', usage: { type: 'duration', seconds: 10 } }]
});

const transcribed = ifElse({
  version: 2.3,
  config: {
    name: 'Transcribed?',
    position: [4820, 200],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr("{{ !$json.error && typeof $json.text === 'string' && $json.text.trim() !== '' }}"), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

// Transcript is persisted and the row marked completed BEFORE attribution, so
// a linking failure can never lose a transcript that succeeded. The same
// write takes this memo's first link attempt (link_attempts + 1), which is
// what claim_unlinked_audio_messages does for every later one.
const transcriptRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Transcript Row',
    position: [4820, 0],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ messageId: $('Run Context').item.json.messageId, claimedAttempts: $('Run Context').item.json.claimedAttempts, transcript: $json.text.trim(), status: 'completed', processed_at: $now.toISO(), error: null, error_class: null, link_attempts: ($('Claim Audio Message').item.json.link_attempts ?? 0) + 1, last_link_attempt_at: $now.toISO() }) }}")
    }
  },
  output: [{ messageId: SAMPLE_ID, claimedAttempts: 1, transcript: 'Met Jane Doe, she wants a demo.', status: 'completed', link_attempts: 1 }]
});

// Post-claim writes re-assert this run still holds the processing claim.
const CLAIMED_MESSAGE_WRITE = {
  resource: 'row',
  operation: 'update',
  tableId: 'inbound_messages',
  filterType: 'manual',
  matchType: 'allFilters',
  filters: { conditions: [
    { keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.messageId }}') },
    { keyName: 'status', condition: 'eq', keyValue: 'processing' },
    { keyName: 'processing_attempts', condition: 'eq', keyValue: expr('{{ String($json.claimedAttempts) }}') }
  ] },
  dataToSend: 'autoMapInputData',
  inputsToIgnore: 'messageId,claimedAttempts'
};

const saveTranscript = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: { name: 'Save Transcript', position: [5040, 0], parameters: CLAIMED_MESSAGE_WRITE, credentials: { supabaseApi: newCredential('Supabase account') } },
  output: [{ id: SAMPLE_ID, status: 'completed', transcript: 'Met Jane Doe, she wants a demo.', link_status: 'unlinked', link_attempts: 1, event_id: SAMPLE_EVENT, from_phone: '+15551234567' }]
});

const stillUnlinked = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Still Unlinked?',
    position: [5260, 0],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.link_status }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'unlinked' }],
        combinator: 'and'
      }
    }
  },
  output: [{ id: SAMPLE_ID, link_status: 'unlinked', link_attempts: 1 }]
});

const transcriptionFailedRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Transcription Failed Row',
    position: [4820, 300],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ messageId: $('Run Context').item.json.messageId, claimedAttempts: $('Run Context').item.json.claimedAttempts, status: 'failed', error: String($json.error?.message ?? $json.error ?? 'Transcription returned an empty transcript').slice(0, 2000), error_class: $json.error ? 'transient' : 'terminal' }) }}")
    }
  },
  output: [{ messageId: SAMPLE_ID, claimedAttempts: 1, status: 'failed', error: 'ECONNREFUSED', error_class: 'transient' }]
});

const markTranscriptionFailed = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: { name: 'Mark Transcription Failed', position: [5040, 300], parameters: CLAIMED_MESSAGE_WRITE, credentials: { supabaseApi: newCredential('Supabase account') } },
  output: [{ id: SAMPLE_ID, status: 'failed' }]
});

const unsafePathRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Unsafe Path Row',
    position: [2620, 500],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ messageId: $json.id, claimedAttempts: $json.processing_attempts, status: 'failed', error: ('refusing to process an unexpected storage key or id: ' + String($json.storage_path) + ' / ' + String($json.id)).slice(0, 500), error_class: 'terminal' }) }}")
    }
  },
  output: [{ messageId: SAMPLE_ID, claimedAttempts: 1, status: 'failed', error_class: 'terminal' }]
});

const markUnsafeFailed = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: { name: 'Mark Unsafe Path Failed', position: [2840, 500], parameters: CLAIMED_MESSAGE_WRITE, credentials: { supabaseApi: newCredential('Supabase account') } },
  output: [{ id: SAMPLE_ID, status: 'failed', error: 'refusing to process an unexpected storage key or id: x / y' }]
});

const failUnsafe = node({
  type: 'n8n-nodes-base.stopAndError',
  version: 1,
  config: {
    name: 'Fail Loudly (Unsafe Path)',
    position: [3060, 500],
    parameters: { errorType: 'errorMessage', errorMessage: expr("{{ 'voice memo ' + $json.id + ': ' + $json.error }}") }
  }
});

// ---------------------------------------------------------------- relink

const claimUnlinked = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Claim Unlinked Memos',
    position: [420, 640],
    parameters: {
      method: 'POST',
      url: SUPABASE_URL + '/rest/v1/rpc/claim_unlinked_audio_messages',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: { max_attempts: LINK_MAX_ATTEMPTS, retry_delay_minutes: 20, claim_limit: 3 }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, kind: 'audio', transcript: 'Met Jane Doe, she wants a demo.', link_status: 'unlinked', link_attempts: 2, event_id: SAMPLE_EVENT, from_phone: '+15551234567' }]
});

// claim_unlinked_audio_messages doesn't look at status, so it can claim a memo
// that hasn't been transcribed yet. That spends one of its 50 link attempts
// (bounded by the ~50-minute transcription retry horizon) -- skip it here.
const claimedWithTranscript = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Has Transcript?',
    position: [640, 640],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          { leftValue: expr("{{ String($json.id ?? '') }}"), operator: { type: 'string', operation: 'regex' }, rightValue: UUID_RE },
          { leftValue: expr("{{ typeof $json.transcript === 'string' && $json.transcript.trim() !== '' }}"), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }
        ],
        combinator: 'and'
      }
    }
  },
  output: [{ id: SAMPLE_ID, transcript: 'Met Jane Doe, she wants a demo.', link_attempts: 2 }]
});

// ----------------------------------------------------------- attribution
// Shared by the first attempt (right after transcription) and every retry.

const linkContext = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Link Context',
    position: [5480, 400],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ messageId: $json.id, eventId: $json.event_id ?? null, fromPhone: $json.from_phone ?? null, transcript: $json.transcript, linkAttempts: $json.link_attempts }) }}")
    }
  },
  output: [{ messageId: SAMPLE_ID, eventId: SAMPLE_EVENT, fromPhone: '+15551234567', transcript: 'Met Jane Doe, she wants a demo.', linkAttempts: 1 }]
});

// Candidates: this rep's card/roster contacts at this event (joined through
// source_message_id -> inbound_messages.from_phone). Capped at 200 = the
// attribution schema's results maxItems.
const fetchLinkCandidates = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Link Candidates',
    position: [5700, 400],
    parameters: {
      method: 'GET',
      url: SUPABASE_URL + '/rest/v1/contacts',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [
        { name: 'select', value: 'id,first_name,last_name,email,phone,title,interaction_notes,source_msg:inbound_messages!contacts_source_message_id_fkey!inner(from_phone)' },
        { name: 'event_id', value: expr("{{ 'eq.' + ($json.eventId ?? '') }}") },
        { name: 'source', value: 'in.(card_photo,directory_photo)' },
        { name: 'source_msg.from_phone', value: expr("{{ 'eq.' + ($json.fromPhone ?? '') }}") },
        { name: 'order', value: 'created_at.desc' },
        { name: 'limit', value: '200' }
      ] },
      options: {
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'text' } },
        timeout: 30000
      }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ statusCode: 200, body: '[{"id":"0b8f0b3e-3a33-4a4f-9d3f-4b9b1d1f7c20","first_name":"Jane","last_name":"Doe","interaction_notes":null}]' }]
});

const attributionInput = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Attribution Input',
    position: [5920, 400],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: ATTRIBUTION_INPUT_JS }
  },
  output: [{ messageId: SAMPLE_ID, linkAttempts: 1, transcript: 'Met Jane Doe, she wants a demo.', fetchOk: true, candidateRows: [{ id: SAMPLE_CONTACT, interaction_notes: null }], candidates: [{ contactId: SAMPLE_CONTACT, firstName: 'Jane', lastName: 'Doe', email: '', phone: '', title: '' }] }]
});

// A failed candidate fetch isn't "no candidates": drop the memo for this
// round (its attempt is already spent) rather than recording anything.
const fetchOk = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Candidates Fetched?',
    position: [6140, 400],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.fetchOk === true }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  },
  output: [{ messageId: SAMPLE_ID, linkAttempts: 1, fetchOk: true }]
});

// Also true once extractFallbackContact is set, even with zero candidates --
// there's still a real question worth asking the model at that point (does
// the transcript alone name someone?), matching linkTranscriptToContacts'
// same early-return skip in local-agent/agent.mjs.
const hasCandidates = ifElse({
  version: 2.3,
  config: {
    name: 'Has Candidates?',
    position: [6360, 400],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.candidates.length > 0 || $json.extractFallbackContact === true }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const attributeMemo = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Attribute Memo',
    position: [6580, 300],
    parameters: {
      mode: 'each',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'k1LFHrmVYBqDV4bT' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          transcript: expr('{{ $json.transcript }}'),
          candidates: expr('{{ $json.candidates }}'),
          extractFallbackContact: expr('{{ $json.extractFallbackContact }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'transcript', displayName: 'transcript', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'candidates', displayName: 'candidates', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'array' },
          { id: 'extractFallbackContact', displayName: 'extractFallbackContact', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'boolean' }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: false
      }
    }
  },
  output: [{ success: true, skillName: 'attribute-voice-memo', data: { results: [{ contactId: SAMPLE_CONTACT, excerpt: 'she wants a demo.' }] } }]
});

const attributed = ifElse({
  version: 2.3,
  config: {
    name: 'Attributed?',
    position: [6800, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.success === true }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const planExcerpts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Plan Excerpts',
    position: [7020, 200],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: PLAN_EXCERPTS_JS }
  },
  output: [{ messageId: SAMPLE_ID, linkAttempts: 1, excerpts: [{ messageId: SAMPLE_ID, linkAttempts: 1, contactId: SAMPLE_CONTACT, excerpt: 'she wants a demo.' }] }]
});

const anyExcerpts = ifElse({
  version: 2.3,
  config: {
    name: 'Any Excerpts?',
    position: [7240, 200],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.excerpts.length > 0 }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

// Reached only when Any Excerpts? is false -- attribution ran but placed no
// existing candidate. References the raw Attribute Memo output directly
// (not Plan Excerpts' shape) since extractedContact never survives
// PLAN_EXCERPTS_JS, which only ever looks at .data.results.
const hasExtractedContact = ifElse({
  version: 2.3,
  config: {
    name: 'Has Extracted Contact?',
    position: [7460, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr("{{ !!$('Attribute Memo').item.json.data?.extractedContact }}"), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

// Sibling of Create Contact in pipeline-note-extraction.ts: same
// contacts-from-* Edge Function call shape, keyed on the audio message
// instead of a note submission. contacts-from-voice-memo dedupes on
// (source_message_id, source='voice_memo') itself, so a retry after a crash
// between this succeeding and Record Link Result running just gets the same
// contact id back rather than a duplicate.
const createVoiceMemoContact = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Create Voice Memo Contact',
    position: [7680, 300],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: SUPABASE_URL + '/functions/v1/contacts-from-voice-memo',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify((() => { const c = $('Attribute Memo').item.json.data.extractedContact; const ctx = $('Attribution Input').item.json; return { inboundMessageId: ctx.messageId, firstName: c.firstName ?? '', lastName: c.lastName ?? '', email: c.email ?? '', phone: c.phone ?? '', title: c.title ?? '', districtName: c.districtName ?? '', schoolName: c.schoolName ?? '', interactionNotes: c.interactionNotes ?? '', extractionConfidence: c.extractionConfidence }; })()) }}"),
      options: {
        batching: { batch: { batchSize: 1, batchInterval: 0 } },
        response: { response: { fullResponse: true, neverError: true } },
        timeout: 30000
      }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ statusCode: 201, body: { id: SAMPLE_CONTACT, alreadyProcessed: false, createdAt: '2026-09-28T12:00:01.000Z' } }]
});

const contactCreatedRow = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Contact Created Row',
    position: [7900, 300],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: CONTACT_CREATED_ROW_JS }
  },
  output: [{ messageId: SAMPLE_ID, linkAttempts: 5, matched_contact_ids: [SAMPLE_CONTACT], link_status: 'contact_created' }]
});

const splitExcerpts = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Excerpts',
    position: [7460, 100],
    parameters: { fieldToSplitOut: 'excerpts', include: 'noOtherFields' }
  },
  output: [{ messageId: SAMPLE_ID, linkAttempts: 1, contactId: SAMPLE_CONTACT, excerpt: 'she wants a demo.' }]
});

// append_contact_interaction_notes (migration 20260925190525): one atomic,
// idempotent append per (contact, excerpt). Replaced a read-modify-write PATCH
// guarded on the full notes in the URL, which could 414 on long notes.
const attachExcerpt = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Attach Excerpt',
    position: [7680, 100],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: SUPABASE_URL + '/rest/v1/rpc/append_contact_interaction_notes',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [{ name: 'select', value: 'id' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ p_contact_id: $json.contactId, p_excerpt: $json.excerpt }) }}'),
      options: {
        batching: { batch: { batchSize: 1, batchInterval: 0 } },
        response: { response: { fullResponse: true, neverError: true } },
        timeout: 30000
      }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ statusCode: 200, body: [{ id: SAMPLE_CONTACT }] }]
});

const tallyLinks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Tally Links',
    position: [7900, 100],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: TALLY_LINKS_JS }
  },
  output: [{ messageId: SAMPLE_ID, linkAttempts: 1, matched_contact_ids: [SAMPLE_CONTACT], link_status: 'linked' }]
});

// No candidates at all, or the skill placed nothing: stay unlinked for the
// retry sweep -- or, at the cap, hand to a human (Review's unmatched list).
// Unlike local-agent, a no-candidates run at the cap is also surfaced; before,
// such a memo sat 'unlinked' forever once the claim function stopped picking it.
const unmatchedRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Unmatched Row',
    position: [7460, 400],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ messageId: $json.messageId, linkAttempts: $json.linkAttempts, matched_contact_ids: [], link_status: $json.linkAttempts >= " + LINK_MAX_ATTEMPTS + " ? 'no_candidate_found' : 'unlinked' }) }}")
    }
  },
  output: [{ messageId: SAMPLE_ID, linkAttempts: 1, matched_contact_ids: [], link_status: 'unlinked' }]
});

// Re-asserts link_status = 'unlinked' AND link_attempts = this attempt's
// value, so a human's manual assignment or a newer attempt is never clobbered.
const recordLinkResult = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Record Link Result',
    position: [8120, 300],
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'inbound_messages',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.messageId }}') },
        { keyName: 'link_status', condition: 'eq', keyValue: 'unlinked' },
        { keyName: 'link_attempts', condition: 'eq', keyValue: expr('{{ String($json.linkAttempts) }}') }
      ] },
      dataToSend: 'autoMapInputData',
      inputsToIgnore: 'messageId,linkAttempts'
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, link_status: 'linked' }]
});

const permanentLinkFailure = ifElse({
  version: 2.3,
  config: {
    name: 'Permanent Attribution Failure?',
    position: [7020, 500],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.errorKind }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'permanent' }],
        combinator: 'and'
      }
    }
  }
});

const failAttribution = node({
  type: 'n8n-nodes-base.stopAndError',
  version: 1,
  config: {
    name: 'Fail Loudly (Attribution)',
    position: [7240, 500],
    parameters: { errorType: 'errorMessage', errorMessage: expr("{{ 'attribute-voice-memo failed permanently for memo ' + $('Attribution Input').item.json.messageId + ': ' + $json.message }}") }
  }
});

const note = sticky(
  "## pipeline-voice-transcription (v3)\nVoice memo (inbound_messages, kind='audio') -> download -> Convert Audio (community node n8n-nodes-ffmpeg-audio, AMR to MP3) -> built-in OpenAI node (Audio > Transcribe) -> transcript -> skill-attribute-voice-memo -> excerpts appended to the right contacts' interaction_notes.\n\n**Triggers:** header-authenticated DB Webhook on inbound_messages INSERT *and UPDATE* (twilio-webhook sets storage_path in a second UPDATE after upload); 5-min backstop: reset stale claims (30 min), resurrect transient failures (10 x 5 min), pick up to 5 pending memos, and run the relink sweep (claim_unlinked_audio_messages, 20 x 20 min, 3 per tick). Only a UUID-validated id comes from the webhook.\n\n**Transcription:** optimistic claim to 'processing' (processing_attempts + 1); storage_path and id re-checked before either reaches a storage URL or a row filter (mismatch = terminal + Fail Loudly). A failed conversion marks the memo failed (transient) via Converted?. Transcript saved + 'completed' before attribution. Failures: 'failed' + error_class (transient unless the transcript came back empty); the backstop resurrects transient ones.\n\n**Conversion:** the n8n-nodes-ffmpeg-audio community node installed by the n8n admin (no credential, no external service, no files on the host). Its m4a output is broken, so MP3; it returns binary property 'data'. Verified 2026-10-08 on a stored memo: same transcript as the saved one.\n\n**Attribution:** candidates = this rep's card/roster contacts at the event (max 200). No force-attach fallback onto an EXISTING contact. At link_attempts=3, if nothing matched, the skill is asked whether the transcript alone names someone; if so Create Voice Memo Contact mints a source='voice_memo' contact. Excerpts append atomically and idempotently. NOT YET PORTED from local-agent: unplacedContacts.\n\n**Status:** DRAFT. v2 (Vercel conversion) is live on the same webhook path; to switch, unpublish v2 and publish this.",
  [dbWebhook, webhookMessageId, backstop, resetStale, retryTransient, findPending, backstopMessageId, claimUnlinked, claimedWithTranscript],
  { color: 4 }
);

export default workflow('pipeline-voice-transcription', 'pipeline-voice-transcription')
  .add(dbWebhook).to(webhookMessageId).to(validMessageId)
  .add(backstop).to(resetStale).to(retryTransient).to(findPending).to(backstopMessageId).to(validMessageId)
  .add(backstop).to(claimUnlinked).to(claimedWithTranscript).to(linkContext)
  .add(validMessageId).to(fetchMessage).to(readyToTranscribe).to(claimRow).to(claimMessage)
  .to(safePath
    .onTrue(runContext.to(downloadAudio).to(downloaded
      .onTrue(convertAudio.to(converted
        .onTrue(openAiTranscribe.to(transcribed
          .onTrue(transcriptRow.to(saveTranscript).to(stillUnlinked).to(linkContext))
          .onFalse(transcriptionFailedRow.to(markTranscriptionFailed))))
        .onFalse(conversionFailedRow.to(markTranscriptionFailed))))
      .onFalse(transcriptionFailedRow)))
    .onFalse(unsafePathRow.to(markUnsafeFailed).to(failUnsafe)))
  .add(linkContext).to(fetchLinkCandidates).to(attributionInput).to(fetchOk)
  .to(hasCandidates
    .onTrue(attributeMemo.to(attributed
      .onTrue(planExcerpts.to(anyExcerpts
        .onTrue(splitExcerpts.to(attachExcerpt).to(tallyLinks).to(recordLinkResult))
        .onFalse(hasExtractedContact
          .onTrue(createVoiceMemoContact.to(contactCreatedRow).to(recordLinkResult))
          .onFalse(unmatchedRow.to(recordLinkResult)))))
      .onFalse(permanentLinkFailure.onTrue(failAttribution))))
    .onFalse(unmatchedRow))
  .add(note);
