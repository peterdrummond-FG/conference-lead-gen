import { workflow, node, trigger, sticky, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

const SUPABASE_URL = 'https://yrvppufkerbjpvrxniot.supabase.co';
const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const SAMPLE_ID = '6c1d2a53-2f8e-4b43-9d5e-0b7c5f0e9a11';
// A transient failure returns the note to the queue at most this many claims
// in total; after that it's marked failed like any other error. attempts is
// incremented at claim time (crash-safe), so this bounds a stuck 429 loop.
const MAX_NOTE_ATTEMPTS = 3;

const dbWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Note Submitted (DB Webhook)',
    position: [200, 200],
    parameters: {
      httpMethod: 'POST',
      path: 'ckh-note-extraction',
      authentication: 'headerAuth',
      responseMode: 'onReceived',
      options: { noResponseBody: true }
    },
    credentials: { httpHeaderAuth: newCredential('Supabase DB Webhook Secret') }
  },
  output: [{ body: { type: 'INSERT', table: 'note_submissions', record: { id: SAMPLE_ID } } }]
});

const webhookSubmissionId = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Webhook Submission Id',
    position: [420, 200],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [
        { id: 'submissionId', name: 'submissionId', value: expr("{{ String($json.body?.record?.id ?? '') }}"), type: 'string' }
      ] }
    }
  },
  output: [{ submissionId: SAMPLE_ID }]
});

const backstop = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.4,
  config: {
    name: 'Backstop Every 5 Minutes',
    position: [200, 420],
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } }
  },
  output: [{}]
});

const resetStale = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Reset Stale Claims',
    position: [420, 420],
    alwaysOutputData: true,
    parameters: {
      method: 'POST',
      url: SUPABASE_URL + '/rest/v1/rpc/reconcile_stale_note_submissions',
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

const findPending = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Find Pending Submissions',
    position: [640, 420],
    executeOnce: true,
    parameters: {
      method: 'GET',
      url: SUPABASE_URL + '/rest/v1/note_submissions',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [
        { name: 'select', value: 'id' },
        { name: 'status', value: 'eq.pending_extraction' },
        { name: 'order', value: 'created_at' },
        { name: 'limit', value: '5' }
      ] }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID }]
});

const backstopSubmissionId = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Backstop Submission Id',
    position: [860, 420],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [
        { id: 'submissionId', name: 'submissionId', value: expr("{{ String($json.id ?? '') }}"), type: 'string' }
      ] }
    }
  },
  output: [{ submissionId: SAMPLE_ID }]
});

const validSubmissionId = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Valid Submission Id',
    position: [1080, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.submissionId }}'), operator: { type: 'string', operation: 'regex' }, rightValue: UUID_RE }],
        combinator: 'and'
      }
    }
  },
  output: [{ submissionId: SAMPLE_ID }]
});

const fetchSubmission = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Fetch Submission',
    position: [1300, 300],
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'note_submissions',
      returnAll: false,
      limit: 1,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.submissionId }}') },
        { keyName: 'status', condition: 'eq', keyValue: 'pending_extraction' }
      ] }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, status: 'pending_extraction', attempts: 0, body: 'Met Jane Doe, principal at Lincoln Elementary.' }]
});

const claimRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Claim Row',
    position: [1520, 300],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ submissionId: $json.id, status: 'processing', claimed_at: $now.toISO(), attempts: ($json.attempts ?? 0) + 1 }) }}")
    }
  },
  output: [{ submissionId: SAMPLE_ID, status: 'processing', claimed_at: '2026-09-24T12:00:00.000Z', attempts: 1 }]
});

const claimSubmission = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Claim Submission',
    position: [1740, 300],
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'note_submissions',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.submissionId }}') },
        { keyName: 'status', condition: 'eq', keyValue: 'pending_extraction' }
      ] },
      dataToSend: 'autoMapInputData',
      inputsToIgnore: 'submissionId'
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, status: 'processing', attempts: 1, body: 'Met Jane Doe, principal at Lincoln Elementary.' }]
});

const extractContacts = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Extract Contacts',
    position: [1960, 300],
    parameters: {
      mode: 'each',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'QSxeSjcQaEtnw5LI' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: { noteText: expr('{{ $json.body }}') },
        matchingColumns: [],
        schema: [
          { id: 'noteText', displayName: 'noteText', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true
      }
    }
  },
  output: [{ success: true, skillName: 'extract-note-contacts', data: { contacts: [{ firstName: 'Jane', lastName: 'Doe', title: 'Principal', schoolName: 'Lincoln Elementary', extractionConfidence: 'high' }], skipped: [] } }]
});

const extracted = ifElse({
  version: 2.3,
  config: {
    name: 'Extracted?',
    position: [2180, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.success === true }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

// Every downstream row carries its own submissionId + claimedAttempts, so the
// backstop's up-to-5 submissions never have to be told apart by item pairing
// once the contacts fan out.
const resultContext = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Result Context',
    position: [2400, 200],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ submissionId: $('Claim Submission').item.json.id, claimedAttempts: $('Claim Submission').item.json.attempts, skipped: $json.data?.skipped ?? [], contacts: ($json.data?.contacts ?? []).map(c => Object.assign({}, c, { submissionId: $('Claim Submission').item.json.id })) }) }}")
    }
  },
  output: [{ submissionId: SAMPLE_ID, claimedAttempts: 1, skipped: [], contacts: [{ firstName: 'Jane', lastName: 'Doe', extractionConfidence: 'high', submissionId: SAMPLE_ID }] }]
});

const anyContacts = ifElse({
  version: 2.3,
  config: {
    name: 'Any Contacts?',
    position: [2620, 200],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.contacts.length > 0 }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const splitContacts = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Contacts',
    position: [2840, 100],
    parameters: { fieldToSplitOut: 'contacts', include: 'noOtherFields' }
  },
  output: [{ firstName: 'Jane', lastName: 'Doe', extractionConfidence: 'high', submissionId: SAMPLE_ID }]
});

const createContact = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Create Contact',
    position: [3060, 100],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: SUPABASE_URL + '/functions/v1/contacts-from-note',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify({ noteSubmissionId: $json.submissionId, firstName: $json.firstName ?? '', lastName: $json.lastName ?? '', email: $json.email ?? '', phone: $json.phone ?? '', title: $json.title ?? '', districtName: $json.districtName ?? '', schoolName: $json.schoolName ?? '', interactionNotes: $json.interactionNotes ?? '', extractionConfidence: $json.extractionConfidence }) }}"),
      options: {
        batching: { batch: { batchSize: 1, batchInterval: 0 } },
        response: { response: { fullResponse: true, neverError: true } },
        timeout: 30000
      }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ statusCode: 201, body: { id: '0b8f0b3e-3a33-4a4f-9d3f-4b9b1d1f7c20', createdAt: '2026-09-24T12:00:01.000Z' } }]
});

const TALLY_JS = "// One row per submission. Partial success stays 'completed' with the\n// failures recorded -- the contacts that landed are already real in Review.\n// Only a note where nothing at all could be created is 'failed'; a note that\n// legitimately named nobody never reaches this node (Any Contacts? = false).\nconst contacts = $('Split Out Contacts').all();\nconst contexts = $('Result Context').all().map(i => i.json);\nconst bySubmission = new Map();\n$input.all().forEach((r, i) => {\n  const c = (contacts[r.pairedItem?.item ?? i] ?? {}).json ?? {};\n  const id = c.submissionId;\n  if (!bySubmission.has(id)) bySubmission.set(id, { created: 0, failures: [] });\n  const t = bySubmission.get(id);\n  const code = r.json.statusCode;\n  if (typeof code === 'number' && code >= 200 && code < 300) { t.created++; return; }\n  const label = [c.firstName, c.lastName].filter(Boolean).join(' ') || ('entry ' + (i + 1));\n  const body = r.json.body;\n  const detail = (body && typeof body === 'object' ? body.error : body) ?? r.json.error?.message ?? r.json.error ?? '';\n  t.failures.push((label + ': ' + (code ? 'HTTP ' + code + ': ' : '') + String(detail)).trim());\n});\nconst now = new Date().toISOString();\nreturn [...bySubmission.entries()].map(([id, t]) => {\n  const ctx = contexts.find(x => x.submissionId === id) ?? {};\n  return { json: {\n    submissionId: id,\n    claimedAttempts: ctx.claimedAttempts,\n    status: t.failures.length > 0 && t.created === 0 ? 'failed' : 'completed',\n    skipped: ctx.skipped ?? [],\n    error: t.failures.length > 0 ? t.failures.join('; ') : null,\n    processed_at: now\n  } };\n});";

const tallyResults = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Tally Results',
    position: [3280, 100],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: TALLY_JS }
  },
  output: [{ submissionId: SAMPLE_ID, claimedAttempts: 1, status: 'completed', skipped: [], error: null, processed_at: '2026-09-24T12:00:02.000Z' }]
});

const noContactsRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'No Contacts Row',
    position: [3060, 300],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ submissionId: $json.submissionId, claimedAttempts: $json.claimedAttempts, status: 'completed', skipped: $json.skipped, error: null, processed_at: $now.toISO() }) }}")
    }
  },
  output: [{ submissionId: SAMPLE_ID, claimedAttempts: 1, status: 'completed', skipped: [], error: null, processed_at: '2026-09-24T12:00:02.000Z' }]
});

// All three writes after the claim re-assert this run still holds it: status
// 'processing' AND attempts = the value this run's claim set. If a crashed or
// slow run's row was reset by reconcile and re-claimed, the stale write no-ops.
const CLAIMED_WRITE_PARAMS = {
  resource: 'row',
  operation: 'update',
  tableId: 'note_submissions',
  filterType: 'manual',
  matchType: 'allFilters',
  filters: { conditions: [
    { keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.submissionId }}') },
    { keyName: 'status', condition: 'eq', keyValue: 'processing' },
    { keyName: 'attempts', condition: 'eq', keyValue: expr('{{ String($json.claimedAttempts) }}') }
  ] },
  dataToSend: 'autoMapInputData',
  inputsToIgnore: 'submissionId,claimedAttempts'
};

const finalizeSubmission = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: { name: 'Finalize Submission', position: [3500, 200], parameters: CLAIMED_WRITE_PARAMS, credentials: { supabaseApi: newCredential('Supabase account') } },
  output: [{ id: SAMPLE_ID, status: 'completed' }]
});

const retryLater = ifElse({
  version: 2.3,
  config: {
    name: 'Retry Later?',
    position: [2400, 480],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr("{{ $json.errorKind === 'transient' && $('Claim Submission').item.json.attempts < " + MAX_NOTE_ATTEMPTS + " }}"), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const pendingRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Back To Queue Row',
    position: [2620, 400],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ submissionId: $('Claim Submission').item.json.id, claimedAttempts: $('Claim Submission').item.json.attempts, status: 'pending_extraction', claimed_at: null }) }}")
    }
  },
  output: [{ submissionId: SAMPLE_ID, claimedAttempts: 1, status: 'pending_extraction', claimed_at: null }]
});

const returnToQueue = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: { name: 'Return To Queue', position: [2840, 400], parameters: CLAIMED_WRITE_PARAMS, credentials: { supabaseApi: newCredential('Supabase account') } },
  output: [{ id: SAMPLE_ID, status: 'pending_extraction' }]
});

const failedRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Failed Row',
    position: [2620, 580],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ submissionId: $('Claim Submission').item.json.id, claimedAttempts: $('Claim Submission').item.json.attempts, status: 'failed', error: String($json.message ?? 'extract-note-contacts failed').slice(0, 2000), processed_at: $now.toISO() }) }}")
    }
  },
  output: [{ submissionId: SAMPLE_ID, claimedAttempts: 1, status: 'failed', error: 'schema validation failed', processed_at: '2026-09-24T12:00:02.000Z' }]
});

const markFailed = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: { name: 'Mark Failed', position: [2840, 580], parameters: CLAIMED_WRITE_PARAMS, credentials: { supabaseApi: newCredential('Supabase account') } },
  output: [{ id: SAMPLE_ID, status: 'failed', error: 'schema validation failed' }]
});

const failLoudly = node({
  type: 'n8n-nodes-base.stopAndError',
  version: 1,
  config: {
    name: 'Fail Loudly',
    position: [3060, 580],
    parameters: {
      errorType: 'errorMessage',
      errorMessage: expr("{{ 'extract-note-contacts failed for note submission ' + $json.id + ': ' + $json.error }}")
    }
  }
});

const note = sticky(
  "## pipeline-note-extraction\nTurns a pasted or texted note (note_submissions row) into contacts via skill-extract-note-contacts, one contacts-from-note POST per person.\n\n**Triggers:** a header-authenticated Database Webhook on INSERT, and a 5-minute backstop that first resets claims stuck in 'processing' > 30 min (reconcile_stale_note_submissions) then picks up to 5 pending rows. Only a UUID-validated id is taken from either source; the row is re-read.\n\n**Claim:** optimistic -- update to 'processing' WHERE status = 'pending_extraction'. A duplicate webhook/backstop run updates zero rows and stops. attempts is incremented at claim time, so a crash still spends one.\n\n**Outcome:** partial success = 'completed' with failures in error; only all-failed = 'failed'; a note naming nobody is 'completed'. Skill failure: transient and attempts < 3 -> back to the queue; otherwise 'failed' + Fail Loudly (error workflow alerts). Every post-claim write re-asserts status = 'processing' AND attempts = this claim's value.\n\n**Not idempotent past the claim:** contacts-from-note inserts on every call, so a run killed mid-POST and re-claimed after 30 min can duplicate contacts (same as local-agent). Keep the n8n execution timeout well under 30 min.",
  [dbWebhook, webhookSubmissionId, backstop, resetStale, findPending, backstopSubmissionId, validSubmissionId, fetchSubmission, claimRow, claimSubmission, extractContacts],
  { color: 4 }
);

export default workflow('pipeline-note-extraction', 'pipeline-note-extraction')
  .add(dbWebhook).to(webhookSubmissionId).to(validSubmissionId)
  .add(backstop).to(resetStale).to(findPending).to(backstopSubmissionId).to(validSubmissionId)
  .add(validSubmissionId).to(fetchSubmission).to(claimRow).to(claimSubmission).to(extractContacts)
  .to(extracted
    .onTrue(resultContext.to(anyContacts
      .onTrue(splitContacts.to(createContact).to(tallyResults).to(finalizeSubmission))
      .onFalse(noContactsRow.to(finalizeSubmission))))
    .onFalse(retryLater
      .onTrue(pendingRow.to(returnToQueue))
      .onFalse(failedRow.to(markFailed).to(failLoudly))))
  .add(note);
