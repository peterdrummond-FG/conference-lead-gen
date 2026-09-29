import { workflow, node, trigger, sticky, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

const dbWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Contact Changed (DB Webhook)',
    position: [200, 200],
    parameters: {
      httpMethod: 'POST',
      path: 'ckh-contact-intent',
      authentication: 'headerAuth',
      responseMode: 'onReceived',
      options: { noResponseBody: true }
    },
    credentials: { httpHeaderAuth: newCredential('Supabase DB Webhook Secret') }
  },
  output: [{ body: { type: 'UPDATE', table: 'contacts', record: { id: '2f2a77eb-8039-4359-880f-f4d9ef1d6f65' } } }]
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
  output: [{ contactId: '2f2a77eb-8039-4359-880f-f4d9ef1d6f65' }]
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
        conditions: [{ leftValue: expr('{{ $json.contactId }}'), operator: { type: 'string', operation: 'regex' }, rightValue: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' }],
        combinator: 'and'
      }
    }
  },
  output: [{ contactId: '2f2a77eb-8039-4359-880f-f4d9ef1d6f65' }]
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

const findUnclassified = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Find Unclassified Contacts',
    position: [420, 420],
    parameters: {
      method: 'POST',
      url: 'https://yrvppufkerbjpvrxniot.supabase.co/rest/v1/rpc/claim_contacts_needing_intent',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: { p_limit: 5 }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: '2f2a77eb-8039-4359-880f-f4d9ef1d6f65', interaction_notes: 'wants a demo', contact_intent_classified_notes: null }]
});

const backstopContactId = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Backstop Contact Id',
    position: [640, 420],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [
        { id: 'contactId', name: 'contactId', value: expr("{{ String($json.id ?? '') }}"), type: 'string' }
      ] }
    }
  },
  output: [{ contactId: '2f2a77eb-8039-4359-880f-f4d9ef1d6f65' }]
});

const fetchContact = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Fetch Contact',
    position: [880, 300],
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'contacts',
      returnAll: false,
      limit: 1,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.contactId }}') }] }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: '2f2a77eb-8039-4359-880f-f4d9ef1d6f65', interaction_notes: 'wants a demo', contact_intent_is_manual: false, contact_intent_classified_notes: null }]
});

const needsClassification = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Needs Classification',
    position: [1100, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{
          leftValue: expr("{{ $json.contact_intent_is_manual === false && ($json.interaction_notes ?? '') !== '' && $json.interaction_notes !== $json.contact_intent_classified_notes }}"),
          operator: { type: 'boolean', operation: 'true', singleValue: true },
          rightValue: ''
        }],
        combinator: 'and'
      }
    }
  },
  output: [{ id: '2f2a77eb-8039-4359-880f-f4d9ef1d6f65', interaction_notes: 'wants a demo', contact_intent_is_manual: false, contact_intent_classified_notes: null }]
});

const classifyIntent = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Classify Intent',
    position: [1320, 300],
    parameters: {
      mode: 'each',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Z3mAeLedo9RDxvqg' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: { contactId: expr('{{ $json.id }}'), interactionNotes: expr('{{ $json.interaction_notes }}') },
        matchingColumns: [],
        schema: [
          { id: 'contactId', displayName: 'contactId', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'interactionNotes', displayName: 'interactionNotes', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true
      }
    }
  },
  output: [{ success: true, skillName: 'classify-contact-intent', data: { contactIntent: 'hot' } }]
});

const classified = ifElse({
  version: 2.3,
  config: {
    name: 'Classified?',
    position: [1540, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.success === true }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

// set_contact_intent_if_current (migration 20260925190525) writes only if
// contact_intent_is_manual = false AND interaction_notes still equals the text
// classified. The notes travel in the body -- the first version put them in the
// URL as an eq. filter, which would 414 once a contact's notes grew long.
const writeIntent = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Write Intent (if still current)',
    position: [1760, 200],
    parameters: {
      method: 'POST',
      url: 'https://yrvppufkerbjpvrxniot.supabase.co/rest/v1/rpc/set_contact_intent_if_current',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [{ name: 'select', value: 'id,contact_intent' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify({ p_contact_id: $('Fetch Contact').item.json.id, p_contact_intent: $json.data?.contactIntent ?? null, p_classified_notes: $('Fetch Contact').item.json.interaction_notes }) }}"),
      options: { timeout: 30000 }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: '2f2a77eb-8039-4359-880f-f4d9ef1d6f65', contact_intent: 'hot' }]
});

const permanentFailure = ifElse({
  version: 2.3,
  config: {
    name: 'Permanent Failure?',
    position: [1760, 420],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.errorKind }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'permanent' }],
        combinator: 'and'
      }
    }
  }
});

const failLoudly = node({
  type: 'n8n-nodes-base.stopAndError',
  version: 1,
  config: {
    name: 'Fail Loudly',
    position: [1980, 380],
    parameters: {
      errorType: 'errorMessage',
      errorMessage: expr("{{ 'classify-contact-intent failed permanently for contact ' + $('Fetch Contact').item.json.id + ': ' + $json.message }}")
    }
  }
});

const note = sticky(
  "## pipeline-contact-intent\nClassifies a contact's interaction_notes as hot/warm/cold/null whenever the notes change and no reviewer has set intent by hand.\n\n**Triggers:** a Supabase Database Webhook (header-authenticated) and a 5-minute backstop that calls the read-only claim_contacts_needing_intent RPC (PostgREST can't compare two columns). Only the contact id is taken from the webhook -- the row is re-read and re-checked here, never trusted from the payload.\n\n**Concurrency:** there is no lock. The write re-asserts contact_intent_is_manual = false AND interaction_notes = the exact text classified, so a reviewer's manual pick or a newer note landing mid-flight turns the write into a no-op, and a duplicate run writes the same value. Same pattern as before; the claim function is a plain SELECT.\n\n**Failures:** permanent -> Fail Loudly (execution errors, so the error workflow alerts); transient -> ends quietly, the backstop retries. Nothing is written on failure.",
  [dbWebhook, webhookContactId, validContactId, backstop, findUnclassified, backstopContactId, fetchContact, needsClassification, classifyIntent, writeIntent, failLoudly],
  { color: 4 }
);

export default workflow('pipeline-contact-intent', 'pipeline-contact-intent')
  .add(dbWebhook).to(webhookContactId).to(validContactId).to(fetchContact)
  .add(backstop).to(findUnclassified).to(backstopContactId).to(fetchContact)
  .add(fetchContact).to(needsClassification).to(classifyIntent)
  .to(classified.onTrue(writeIntent).onFalse(permanentFailure.onTrue(failLoudly)))
  .add(note);
