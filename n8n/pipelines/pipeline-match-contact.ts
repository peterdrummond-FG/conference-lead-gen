import { workflow, node, trigger, sticky, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

const SUPABASE_URL = 'https://yrvppufkerbjpvrxniot.supabase.co';
const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const SAMPLE_ID = '9f4a5d86-5c1b-4e76-8a81-3eaf8c3bdc44';
const MAX_MATCH_ATTEMPTS = 3;
const RETRY_DELAY_MINUTES = 10;

const FINALIZE_PARAMS_JS = "// Blank to null: JSON Schema cannot transform, so empty or whitespace-only\n// strings pass validation as strings (n8n/schemas/README.md). Persist them as\n// null, same as the old blankToNull.\nconst ctx = $('Research Input').item.json;\nconst research = $('Research Contact').item.json.data ?? {};\nconst m = $json.data ?? {};\nconst b = v => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : (v ?? null));\nreturn { json: {\n  p_contact_id: ctx.contactId,\n  p_match_status: m.matchStatus,\n  p_match_confidence: b(m.matchConfidence),\n  p_matched_zoho_contact_id: b(m.matchedZohoContactId),\n  p_matched_zoho_contact_name: b(m.matchedZohoContactName),\n  p_matched_zoho_contact_email: b(m.matchedZohoContactEmail),\n  p_matched_zoho_contact_phone: b(m.matchedZohoContactPhone),\n  p_matched_zoho_contact_title: b(m.matchedZohoContactTitle),\n  p_matched_zoho_account_id: b(m.matchedZohoAccountId),\n  p_matched_zoho_account_name: b(m.matchedZohoAccountName),\n  p_matched_zoho_account_level: b(m.matchedZohoAccountLevel),\n  p_has_active_opportunity: m.hasActiveOpportunity ?? null,\n  p_active_opportunity_name: b(m.activeOpportunityName),\n  p_candidate_matches: m.candidateMatches ?? null,\n  p_notes: b(m.notes),\n  p_glance_summary: b(m.glanceSummary),\n  p_research_confidence: b(research.researchConfidence),\n  p_person_verified: research.personVerified ?? null,\n  p_extraction_ok: ctx.extractionConfidence === null || ctx.extractionConfidence === undefined || ctx.extractionConfidence === 'high'\n} };";

const BUILD_LOCAL_QUERY_JS = "// Candidate Accounts for match-contact's no-Zoho fallback. Same normalisation\n// as SKILL.md's \"Normalize names\" step (apostrophes/quotes/semicolons/percent/\n// parentheses stripped, whole-word abbreviation swaps, generic tokens dropped),\n// done here so the query is deterministic and never built from model output.\nconst data = $json.data ?? {};\nconst GENERIC = ['school', 'schools', 'district', 'county', 'public', 'independent', 'consolidated', 'municipal', 'co', 'of', 'the', 'and'];\nconst ABBR = { co: 'county', cnty: 'county', dist: 'district', sch: 'school', ind: 'independent', indep: 'independent', cons: 'consolidated', consol: 'consolidated', pub: 'public', twp: 'township', mun: 'municipal' };\nconst tokens = name => {\n  if (typeof name !== 'string') return [];\n  const s = name.toLowerCase()\n    .replace(/\\([^)]*\\)\\s*$/, ' ')\n    .replace(/&/g, ' and ')\n    .replace(/['\u2019\"\\\\;%()]/g, '')\n    .replace(/[.,]/g, '')\n    .replace(/[^a-z0-9]+/g, ' ');\n  return s.split(' ').filter(Boolean)\n    .map(t => (Object.prototype.hasOwnProperty.call(ABBR, t) ? ABBR[t] : t))\n    .filter(t => t.length >= 3 && !GENERIC.includes(t));\n};\nconst uniq = a => [...new Set(a)];\nconst districtTokens = uniq([data.districtName, ...(Array.isArray(data.alternateDistrictNames) ? data.alternateDistrictNames : [])].flatMap(tokens));\nconst schoolTokens = uniq([data.schoolName, data.institutionLevelCampusName].flatMap(tokens));\nreturn { json: {\n  contact: data,\n  rpc: {\n    p_states: data.eventState ? [String(data.eventState)] : [],\n    p_district_tokens: districtTokens,\n    p_school_tokens: schoolTokens,\n    p_limit: 40\n  }\n} };";

const ATTACH_LOCAL_ACCOUNTS_JS = "// A failed or malformed lookup must reach the skill as available:false, not as\n// empty lists: empty lists read as \"no Account exists\" and would classify a\n// real district new_account.\nconst b = $('Build Local Account Query').item.json;\nconst r = $json;\nconst ok = r && Array.isArray(r.districts) && Array.isArray(r.schools);\nreturn { json: {\n  contact: b.contact,\n  localAccounts: ok\n    ? { available: true, districts: r.districts, districts_total: r.districts_total ?? r.districts.length, schools: r.schools, schools_total: r.schools_total ?? r.schools.length }\n    : { available: false }\n} };";

// ---------------------------------------------------------------- triggers

const dbWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Contact Created (DB Webhook)',
    position: [200, 200],
    parameters: {
      httpMethod: 'POST',
      path: 'ckh-match-contact',
      authentication: 'headerAuth',
      responseMode: 'onReceived',
      options: { noResponseBody: true }
    },
    credentials: { httpHeaderAuth: newCredential('Supabase DB Webhook Secret') }
  },
  output: [{ body: { type: 'INSERT', table: 'contacts', record: { id: SAMPLE_ID } } }]
});

const webhookContactId = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Webhook Contact Id',
    position: [420, 200],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [
        { id: 'contactId', name: 'contactId', value: expr("{{ String($json.body?.record?.id ?? '') }}"), type: 'string' }
      ] }
    }
  },
  output: [{ contactId: SAMPLE_ID }]
});

const validContactId = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Valid Contact Id',
    position: [640, 200],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.contactId }}'), operator: { type: 'string', operation: 'regex' }, rightValue: UUID_RE }],
        combinator: 'and'
      }
    }
  },
  output: [{ contactId: SAMPLE_ID }]
});

const fetchContact = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Fetch Contact',
    position: [860, 200],
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'contacts',
      returnAll: false,
      limit: 1,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.contactId }}') },
        { keyName: 'match_status', condition: 'eq', keyValue: 'pending' }
      ] }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, match_status: 'pending', match_attempts: 0, last_match_attempt_at: null }]
});

// Same eligibility claim_pending_contacts applies, checked here; the claim
// below is what makes it atomic (it only matches the attempts value read).
const eligible = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Eligible?',
    position: [1080, 200],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr("{{ ($json.match_attempts ?? 0) < " + MAX_MATCH_ATTEMPTS + " && (!$json.last_match_attempt_at || DateTime.fromISO($json.last_match_attempt_at) < $now.minus({ minutes: " + RETRY_DELAY_MINUTES + " })) }}"), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  },
  output: [{ id: SAMPLE_ID, match_attempts: 0 }]
});

const claimRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Claim Row',
    position: [1300, 200],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ contactId: $json.id, readAttempts: $json.match_attempts ?? 0, match_attempts: ($json.match_attempts ?? 0) + 1, last_match_attempt_at: $now.toISO() }) }}")
    }
  },
  output: [{ contactId: SAMPLE_ID, readAttempts: 0, match_attempts: 1 }]
});

// match_attempts is spent at claim time (crash-safe, same as
// claim_pending_contacts); a transient failure refunds it below.
const claimContact = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Claim Contact',
    position: [1520, 200],
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'contacts',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.contactId }}') },
        { keyName: 'match_status', condition: 'eq', keyValue: 'pending' },
        { keyName: 'match_attempts', condition: 'eq', keyValue: expr('{{ String($json.readAttempts) }}') }
      ] },
      dataToSend: 'autoMapInputData',
      inputsToIgnore: 'contactId,readAttempts'
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, match_status: 'pending', match_attempts: 1 }]
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

const claimPending = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Claim Pending Contacts',
    position: [420, 460],
    parameters: {
      method: 'POST',
      url: SUPABASE_URL + '/rest/v1/rpc/claim_pending_contacts',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: { max_attempts: MAX_MATCH_ATTEMPTS, retry_delay_minutes: RETRY_DELAY_MINUTES, claim_limit: 3 }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, match_status: 'pending', match_attempts: 2 }]
});

// ------------------------------------------------------------ research + match

const claimedContact = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Claimed Contact',
    position: [1740, 330],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr("{{ String($json.id ?? '') }}"), operator: { type: 'string', operation: 'regex' }, rightValue: UUID_RE }],
        combinator: 'and'
      }
    }
  },
  output: [{ id: SAMPLE_ID, match_attempts: 1 }]
});

const loadContact = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Load Contact',
    position: [1960, 330],
    parameters: {
      method: 'GET',
      url: SUPABASE_URL + '/rest/v1/contacts',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [
        { name: 'id', value: expr("{{ 'eq.' + $json.id }}") },
        { name: 'select', value: '*,event:events(state),school_district:school_districts(name),school:schools(name)' }
      ] },
      options: { timeout: 30000 }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, first_name: 'Dana', last_name: 'Whitfield', match_attempts: 1, source: 'card_photo', extraction_confidence: 'high', event: { state: 'TN' }, school_district: null, school_district_name_raw: 'Maple Ridge SD', school: null, school_name_raw: null }]
});

// Unlike local-agent, an unresolved district/school falls back to the name as
// captured (school_district_name_raw) instead of reaching research as null.
const researchInput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Research Input',
    position: [2180, 330],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ contactId: $json.id, claimedAttempts: $('Claimed Contact').item.json.match_attempts, extractionConfidence: $json.extraction_confidence ?? null, contact: { contactId: $json.id, firstName: $json.first_name, lastName: $json.last_name, email: $json.email ?? null, phone: $json.phone ?? null, title: $json.title ?? null, districtName: $json.school_district?.name ?? $json.school_district_name_raw ?? null, schoolName: $json.school?.name ?? $json.school_name_raw ?? null, eventState: $json.event?.state ?? null, source: $json.source, extractionConfidence: $json.extraction_confidence ?? null } }) }}")
    }
  },
  output: [{ contactId: SAMPLE_ID, claimedAttempts: 1, extractionConfidence: 'high', contact: { contactId: SAMPLE_ID, firstName: 'Dana', lastName: 'Whitfield' } }]
});

const researchContact = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Research Contact',
    position: [2400, 330],
    parameters: {
      mode: 'each',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'llARky9YWlgXdU5z' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: { contact: expr('{{ $json.contact }}') },
        matchingColumns: [],
        schema: [
          { id: 'contact', displayName: 'contact', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'object' }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: false
      }
    }
  },
  output: [{ success: true, skillName: 'research-contact', data: { contactId: SAMPLE_ID, firstName: 'Dana', lastName: 'Whitfield', researchConfidence: 'medium', personVerified: true } }]
});

const researched = ifElse({
  version: 2.3,
  config: {
    name: 'Researched?',
    position: [2620, 330],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.success === true }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});


// No-Zoho fallback plumbing. skill-match-contact uses the Zoho MCP connector
// when ZOHO_MCP_URL is usable and otherwise classifies against the local copy
// of Zoho Accounts these three nodes fetch. Fetched here, by the pipeline,
// because the skill session reads attacker-supplied card text and must hold
// only the model credential (CLAUDE.md rule 2). Always fetched -- it is one
// cheap RPC -- so the skill never has to ask the pipeline for it.
const buildLocalQuery = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Local Account Query',
    position: [2840, 230],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: BUILD_LOCAL_QUERY_JS }
  },
  output: [{ contact: { firstName: 'Dana', eventState: 'Tennessee' }, rpc: { p_states: ['Tennessee'], p_district_tokens: ['maple', 'ridge'], p_school_tokens: [], p_limit: 40 } }]
});

const fetchLocalAccounts = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Local Accounts',
    position: [3060, 230],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: SUPABASE_URL + '/rest/v1/rpc/match_candidate_accounts',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify($json.rpc) }}'),
      options: { timeout: 30000 }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ districts: [], districts_total: 0, schools: [], schools_total: 0 }]
});

const attachLocalAccounts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Attach Local Accounts',
    position: [3280, 230],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: ATTACH_LOCAL_ACCOUNTS_JS }
  },
  output: [{ contact: { firstName: 'Dana' }, localAccounts: { available: true, districts: [], districts_total: 0, schools: [], schools_total: 0 } }]
});

// research-contact's full output (input fields merged back in, input wins) is
// match-contact's input, unchanged.
const matchContact = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Match Contact',
    position: [3500, 230],
    parameters: {
      mode: 'each',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'qTr3bwVAAYBdHHyq' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: { contact: expr('{{ $json.contact }}'), localAccounts: expr('{{ $json.localAccounts }}') },
        matchingColumns: [],
        schema: [
          { id: 'contact', displayName: 'contact', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'object' },
          { id: 'localAccounts', displayName: 'localAccounts', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'object' }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: false
      }
    }
  },
  output: [{ success: true, skillName: 'match-contact', data: { matchStatus: 'new_account', matchConfidence: null, notes: 'No account found.' } }]
});

const matched = ifElse({
  version: 2.3,
  config: {
    name: 'Matched?',
    position: [3720, 230],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.success === true }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const finalizeParams = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Finalize Params',
    position: [3940, 130],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: FINALIZE_PARAMS_JS }
  },
  output: [{ p_contact_id: SAMPLE_ID, p_match_status: 'new_account' }]
});

// The RPC writes the match atomically and only while the row is still pending. It never
// approves the lead (no auto-confirm, 2026-10-06); a person always does.
const finalizeMatch = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Finalize Contact Match',
    position: [4160, 130],
    parameters: {
      method: 'POST',
      url: SUPABASE_URL + '/rest/v1/rpc/finalize_contact_match',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify($json) }}'),
      options: { timeout: 30000 }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, match_status: 'new_account' }]
});

// ---------------------------------------------------------------- failures
// Decision 4a: a transient failure (429/529/timeout/credit) refunds the
// attempt claimed above; a permanent one (contract violation, model refusal)
// keeps it spent and errors loudly. last_match_attempt_at is left as set, so
// the 10-minute cooldown still spaces the retry.

const failureRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skill Failure',
    position: [3940, 430],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ contactId: $('Research Input').item.json.contactId, claimedAttempts: $('Research Input').item.json.claimedAttempts, skillName: $json.skillName ?? 'unknown skill', errorKind: $json.errorKind ?? 'permanent', message: String($json.message ?? '').slice(0, 2000) }) }}")
    }
  },
  output: [{ contactId: SAMPLE_ID, claimedAttempts: 1, skillName: 'research-contact', errorKind: 'transient', message: '429 rate_limit_error' }]
});

const transient = ifElse({
  version: 2.3,
  config: {
    name: 'Transient?',
    position: [4160, 430],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.errorKind }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'transient' }],
        combinator: 'and'
      }
    }
  }
});

const refundRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Refund Row',
    position: [4380, 330],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ contactId: $json.contactId, claimedAttempts: $json.claimedAttempts, match_attempts: Math.max(0, $json.claimedAttempts - 1) }) }}")
    }
  },
  output: [{ contactId: SAMPLE_ID, claimedAttempts: 1, match_attempts: 0 }]
});

// PostgREST can't express match_attempts - 1, so this is an optimistic
// conditional write: it only lands if the row still holds this run's claim.
const refundAttempt = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Refund Attempt',
    position: [4600, 330],
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'contacts',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.contactId }}') },
        { keyName: 'match_status', condition: 'eq', keyValue: 'pending' },
        { keyName: 'match_attempts', condition: 'eq', keyValue: expr('{{ String($json.claimedAttempts) }}') }
      ] },
      dataToSend: 'autoMapInputData',
      inputsToIgnore: 'contactId,claimedAttempts'
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, match_attempts: 0 }]
});

const failLoudly = node({
  type: 'n8n-nodes-base.stopAndError',
  version: 1,
  config: {
    name: 'Fail Loudly',
    position: [4380, 530],
    parameters: { errorType: 'errorMessage', errorMessage: expr("{{ $json.skillName + ' failed permanently for contact ' + $json.contactId + ' (attempt ' + $json.claimedAttempts + ' of " + MAX_MATCH_ATTEMPTS + "): ' + $json.message }}") }
  }
});

const note = sticky(
  "## pipeline-match-contact\nNew contact -> skill-research-contact -> skill-match-contact (read-only Zoho MCP) -> finalize_contact_match RPC, which applies the result and the auto-approve rule atomically, server-side.\n\n**Triggers:** header-authenticated DB Webhook on contacts INSERT (only the UUID-validated id is used; the row is re-read and must still be pending, under 3 attempts and out of its 10-minute cooldown), and a 5-minute backstop calling claim_pending_contacts(3, 10, 3) for retries and anything the webhook missed.\n\n**Claim:** match_attempts is spent at claim time (crash-safe). Webhook path: optimistic update WHERE match_status = 'pending' AND match_attempts = the value read, so a duplicate webhook or the backstop can't double-claim.\n\n**Failures (decision 4a):** transient -> refund the attempt (conditional on the row still holding this claim), backstop retries after the cooldown; permanent -> attempt stays spent, Fail Loudly. Nothing is written on failure.\n\n**No-Zoho fallback:** before each match the pipeline fetches candidate Accounts from the local copy (match_candidate_accounts RPC) and passes them to skill-match-contact, which uses them only when the ZOHO_MCP_URL row in n8n_config is missing or masked (Contacts and Deals unchecked, confidence capped at medium). With a usable URL the Zoho MCP connector is used exactly as before.",
  [dbWebhook, webhookContactId, validContactId, fetchContact, eligible, claimRow, claimContact, backstop, claimPending],
  { color: 4 }
);

export default workflow('pipeline-match-contact', 'pipeline-match-contact')
  .add(dbWebhook).to(webhookContactId).to(validContactId).to(fetchContact).to(eligible).to(claimRow).to(claimContact).to(claimedContact)
  .add(backstop).to(claimPending).to(claimedContact)
  .add(claimedContact).to(loadContact).to(researchInput).to(researchContact)
  .to(researched
    .onTrue(buildLocalQuery.to(fetchLocalAccounts.to(attachLocalAccounts.to(matchContact.to(matched
      .onTrue(finalizeParams.to(finalizeMatch))
      .onFalse(failureRow))))))
    .onFalse(failureRow))
  .add(failureRow).to(transient
    .onTrue(refundRow.to(refundAttempt))
    .onFalse(failLoudly))
  .add(note);
