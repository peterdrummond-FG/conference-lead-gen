import { workflow, node, trigger, sticky, newCredential, ifElse, merge, expr } from '@n8n/workflow-sdk';

const SUPABASE_URL = 'https://yrvppufkerbjpvrxniot.supabase.co';
const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
// twilio-webhook's own key assertion, narrowed to the photo extensions it
// allowlists -- re-checked because this value crosses DB -> n8n -> Storage URL.
const PHOTO_KEY_RE = '^sms/[0-9a-f-]{36}\\.(jpg|jpeg|png|heic|heif|gif|webp)$';
const SAMPLE_ID = '8e3f4c75-4b0a-4d65-9f70-2d9e7b2acb33';
const SAMPLE_EVENT = '5d5c3508-3199-491e-9b31-0b469c8356c0';
const SAMPLE_HASH = '4ecc6c217f06cdde3efcb0a701ad1d6183e74d1c1ebfb3d872c1d653b962f880';

const PHOTO_CONTEXT_JS = "// Edit Image 'information' replaces the JSON and re-encodes the binary, so\n// take only the size from it and hand the untouched vision copy onward.\nconst claim = $('Claim Photo Message').item.json;\nreturn {\n  json: {\n    messageId: claim.id,\n    claimedAttempts: claim.processing_attempts,\n    storagePath: claim.storage_path,\n    folderCode: $('Fetch Event').item.json.folder_code,\n    hash: $('Hash Photo').item.json.hash,\n    width: $json.size?.width ?? null,\n    height: $json.size?.height ?? null\n  },\n  binary: $('Vision Copy').item.binary\n};";

const CARD_PLAN_JS = "// Per card: the contacts-from-ocr body, plus a crop box for multi-person\n// photos. sourceImageHash is uniquely constrained and every card from one\n// photo shares sourceImagePath, so each card gets a -NN suffix from its\n// reading-order index -- which is also what makes a retry of a partly-failed\n// photo safe (contacts-from-ocr treats an existing hash as a no-op).\n// Padding follows SKILL.md Step 2: 0.15 x the box size on each side, clamped to the image.\nconst ctx = $('Photo Context').item.json;\nconst data = $json.data;\nconst cards = data.cards;\nconst multi = cards.length > 1;\nconst indexes = cards.map(c => c.index);\nconst uniqueIdx = new Set(indexes).size === indexes.length;\nconst prefix = ctx.storagePath.slice(0, ctx.storagePath.lastIndexOf('/'));\nconst source = data.sourceType === 'directory_listing' ? 'directory_photo' : undefined;\nconst W = ctx.width, H = ctx.height;\nconst planned = cards.map((c, i) => {\n  const nn = String(uniqueIdx ? c.index : i + 1).padStart(2, '0');\n  const sourceImageHash = multi ? ctx.hash + '-' + nn : ctx.hash;\n  let crop = null;\n  const b = c.boundingBox;\n  if (multi && b && W && H) {\n    const px = b.x * W, py = b.y * H, pw = b.width * W, ph = b.height * H;\n    const left = Math.max(0, px - 0.15 * pw), right = Math.min(W, px + pw + 0.15 * pw);\n    const top = Math.max(0, py - 0.15 * ph), bottom = Math.min(H, py + ph + 0.15 * ph);\n    const w = Math.round(right - left), h = Math.round(bottom - top);\n    if (w >= 8 && h >= 8) crop = { x: Math.round(left), y: Math.round(top), w, h };\n  }\n  const body = {\n    eventFolderCode: ctx.folderCode,\n    firstName: c.firstName, lastName: c.lastName,\n    email: c.email ?? '', phone: c.phone ?? '', title: c.title ?? '',\n    districtName: c.districtName ?? '', schoolName: c.schoolName ?? '',\n    extractionConfidence: c.extractionConfidence,\n    sourceImageHash, sourceImagePath: ctx.storagePath,\n    inboundMessageId: ctx.messageId\n  };\n  if (source) body.source = source;\n  return { messageId: ctx.messageId, claimedAttempts: ctx.claimedAttempts, label: [c.firstName, c.lastName].filter(Boolean).join(' ') || ('card ' + nn), body, crop, cropKey: crop ? prefix + '/' + ctx.hash + '-crop-' + nn + '.jpg' : null };\n});\nreturn { json: { messageId: ctx.messageId, claimedAttempts: ctx.claimedAttempts, cards: planned }, binary: $('Photo Context').item.binary };";

const TALLY_CARDS_JS = "// One row per photo. Partial success is 'completed' with the failures in\n// error (the cards that landed are real); only every-card-failed is 'failed',\n// classed transient so the backstop retries it -- the contacts-from-ocr hash\n// check makes the already-created ones no-ops on the retry.\nconst sent = $('Merge Cards').all();\nconst byMessage = new Map();\n$input.all().forEach((r, i) => {\n  const c = (sent[r.pairedItem?.item ?? i] ?? {}).json ?? {};\n  if (!byMessage.has(c.messageId)) byMessage.set(c.messageId, { claimedAttempts: c.claimedAttempts, created: 0, failures: [] });\n  const t = byMessage.get(c.messageId);\n  const code = r.json.statusCode;\n  if (typeof code === 'number' && code >= 200 && code < 300) { t.created++; return; }\n  const body = r.json.body;\n  const detail = (body && typeof body === 'object' ? body.error : body) ?? r.json.error?.message ?? r.json.error ?? '';\n  t.failures.push((c.label + ': ' + (code ? 'HTTP ' + code + ': ' : '') + String(detail)).trim());\n});\nconst now = new Date().toISOString();\nreturn [...byMessage.entries()].map(([messageId, t]) => {\n  const allFailed = t.failures.length > 0 && t.created === 0;\n  return { json: {\n    messageId, claimedAttempts: t.claimedAttempts,\n    status: allFailed ? 'failed' : 'completed',\n    error: allFailed ? ('every card failed: ' + t.failures.join('; ')).slice(0, 4000) : (t.failures.length ? t.failures.join('; ').slice(0, 4000) : null),\n    error_class: allFailed ? 'transient' : null,\n    processed_at: now\n  } };\n});";

// ---------------------------------------------------------------- triggers

const dbWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Photo Message Changed (DB Webhook)',
    position: [200, 200],
    parameters: {
      httpMethod: 'POST',
      path: 'ckh-process-cards-sms',
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

// Same two sweeps as pipeline-voice-transcription's backstop: both RPCs cover
// photo and audio rows, and each pipeline must stand on its own during a
// staged cutover. Running them twice in a window is harmless.
const resetStale = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Reset Stale Claims',
    position: [420, 460],
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
    position: [640, 460],
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
    name: 'Find Pending Photos',
    position: [860, 460],
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
        { name: 'kind', value: 'eq.photo' },
        { name: 'status', value: 'eq.pending_ocr' },
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
    position: [1080, 460],
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

// ------------------------------------------------------------ claim + fetch

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
    name: 'Fetch Photo Message',
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
        { keyName: 'kind', condition: 'eq', keyValue: 'photo' },
        { keyName: 'status', condition: 'eq', keyValue: 'pending_ocr' }
      ] }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, kind: 'photo', status: 'pending_ocr', storage_path: 'sms/' + SAMPLE_ID + '.jpg', processing_attempts: 0, event_id: SAMPLE_EVENT }]
});

// twilio-webhook inserts the row, uploads, then sets storage_path in a second
// UPDATE -- a row with no path yet isn't ready, not broken.
const uploadedYet = node({
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
  output: [{ id: SAMPLE_ID, storage_path: 'sms/' + SAMPLE_ID + '.jpg', processing_attempts: 0 }]
});

const claimRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Claim Photo Row',
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
    name: 'Claim Photo Message',
    position: [2180, 300],
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'inbound_messages',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [
        { keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.messageId }}') },
        { keyName: 'status', condition: 'eq', keyValue: 'pending_ocr' }
      ] },
      dataToSend: 'autoMapInputData',
      inputsToIgnore: 'messageId'
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, status: 'processing', storage_path: 'sms/' + SAMPLE_ID + '.jpg', processing_attempts: 1, event_id: SAMPLE_EVENT }]
});

const safePath = ifElse({
  version: 2.3,
  config: {
    name: 'Safe Storage Path?',
    position: [2400, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.storage_path }}'), operator: { type: 'string', operation: 'regex' }, rightValue: PHOTO_KEY_RE }],
        combinator: 'and'
      }
    }
  }
});

const fetchEvent = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Fetch Event',
    position: [2620, 200],
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'events',
      returnAll: false,
      limit: 1,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr("{{ $json.event_id ?? '' }}") }] }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_EVENT, folder_code: 'tsba26' }]
});

const eventFound = ifElse({
  version: 2.3,
  config: {
    name: 'Event Has Folder Code?',
    position: [2840, 200],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr("{{ typeof $json.folder_code === 'string' && $json.folder_code !== '' }}"), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const downloadPhoto = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Download Photo',
    position: [3060, 100],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: expr("{{ '" + SUPABASE_URL + "/storage/v1/object/contact-photos/' + $('Claim Photo Message').item.json.storage_path }}"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      options: {
        response: { response: { responseFormat: 'file', outputPropertyName: 'data' } },
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
    position: [3280, 100],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ !$json.error && !!$binary?.data }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

// A real content hash of the bytes as received, same as local-agent's -- lets
// the same photo texted twice dedup through contacts-from-ocr's hash check.
// (Crypto's hash drops the binary; Restore Photo puts it back.)
const hashPhoto = node({
  type: 'n8n-nodes-base.crypto',
  version: 2,
  config: {
    name: 'Hash Photo',
    position: [3500, 0],
    parameters: { action: 'hash', binaryData: true, binaryPropertyName: 'data', type: 'SHA256', dataPropertyName: 'hash', encoding: 'hex' }
  },
  output: [{ hash: SAMPLE_HASH }]
});

const restorePhoto = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Restore Photo',
    position: [3720, 0],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: "return { json: $json, binary: $('Download Photo').item.binary };" }
  },
  output: [{ hash: SAMPLE_HASH }]
});

// One step converts HEIC (the vision API can't read it; verified the host's
// GraphicsMagick can) and caps the long edge at 2000px so a full-size MMS
// photo stays under the API's image size limit. Crops come from this copy.
const visionCopy = node({
  type: 'n8n-nodes-base.editImage',
  version: 1,
  config: {
    name: 'Vision Copy',
    position: [3940, 0],
    onError: 'continueRegularOutput',
    parameters: { operation: 'resize', dataPropertyName: 'data', width: 2000, height: 2000, resizeOption: 'onlyIfLarger', options: { format: 'jpeg', quality: 90 } }
  },
  output: [{ hash: SAMPLE_HASH }]
});

const readSize = node({
  type: 'n8n-nodes-base.editImage',
  version: 1,
  config: {
    name: 'Read Image Size',
    position: [4160, 0],
    onError: 'continueRegularOutput',
    parameters: { operation: 'information', dataPropertyName: 'data' }
  },
  output: [{ size: { width: 2000, height: 1500 } }]
});

const decoded = ifElse({
  version: 2.3,
  config: {
    name: 'Image Decoded?',
    position: [4380, 0],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr("{{ !$json.error && typeof $json.size?.width === 'number' && $json.size.width > 0 }}"), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const photoContext = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Photo Context',
    position: [4600, -100],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: PHOTO_CONTEXT_JS }
  },
  output: [{ messageId: SAMPLE_ID, claimedAttempts: 1, storagePath: 'sms/' + SAMPLE_ID + '.jpg', folderCode: 'tsba26', hash: SAMPLE_HASH, width: 2000, height: 1500 }]
});

// Passthrough: the whole item, binary photo included, reaches the skill.
const extractCards = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Extract Cards',
    position: [4820, -100],
    parameters: {
      mode: 'each',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'fiHwr67Yn3jH5JRj' }
    }
  },
  output: [{ success: true, skillName: 'process-cards', data: { status: 'ok', sourceType: 'business_card', cards: [{ index: 1, firstName: 'Jane', lastName: 'Doe', extractionConfidence: 'high', boundingBox: null }] } }]
});

const extracted = ifElse({
  version: 2.3,
  config: {
    name: 'Extracted?',
    position: [5040, -100],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.success === true }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const cardFound = ifElse({
  version: 2.3,
  config: {
    name: 'Card Found?',
    position: [5260, -200],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr("{{ $json.data?.status === 'ok' && ($json.data?.cards ?? []).length > 0 }}"), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const cardPlan = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Card Plan',
    position: [5480, -300],
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: CARD_PLAN_JS }
  },
  output: [{ messageId: SAMPLE_ID, claimedAttempts: 1, cards: [{ messageId: SAMPLE_ID, claimedAttempts: 1, label: 'Jane Doe', body: { firstName: 'Jane' }, crop: null, cropKey: null }] }]
});

const splitCards = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Cards',
    position: [5700, -300],
    parameters: { fieldToSplitOut: 'cards', include: 'noOtherFields', options: { includeBinary: true } }
  },
  output: [{ messageId: SAMPLE_ID, claimedAttempts: 1, label: 'Jane Doe', body: { firstName: 'Jane' }, crop: null, cropKey: null }]
});

const needsCrop = ifElse({
  version: 2.3,
  config: {
    name: 'Needs Crop?',
    position: [5920, -300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ !!$json.crop && !!$json.cropKey }}'), operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '' }],
        combinator: 'and'
      }
    }
  }
});

const cropCard = node({
  type: 'n8n-nodes-base.editImage',
  version: 1,
  config: {
    name: 'Crop Card',
    position: [6140, -400],
    onError: 'continueRegularOutput',
    parameters: {
      operation: 'crop',
      dataPropertyName: 'data',
      width: expr('{{ $json.crop.w }}'),
      height: expr('{{ $json.crop.h }}'),
      positionX: expr('{{ $json.crop.x }}'),
      positionY: expr('{{ $json.crop.y }}'),
      options: { format: 'jpeg', quality: 90 }
    }
  },
  output: [{ cropKey: 'sms/x-crop-01.jpg' }]
});

// Crops are uploaded before the contact is created, so croppedImagePath never
// points at an object that isn't there. A failed crop or upload doesn't cost
// the contact: it's created without a crop (the full photo is still attached).
const uploadCrop = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Upload Crop',
    position: [6360, -400],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: expr("{{ '" + SUPABASE_URL + "/storage/v1/object/contact-photos/' + $('Split Out Cards').item.json.cropKey }}"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'x-upsert', value: 'true' }] },
      sendBody: true,
      contentType: 'binaryData',
      inputDataFieldName: 'data',
      options: {
        response: { response: { fullResponse: true, neverError: true } },
        timeout: 60000
      }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ statusCode: 200, body: { Key: 'contact-photos/sms/x-crop-01.jpg' } }]
});

const cropResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Crop Result',
    position: [6580, -400],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ Object.assign({}, $('Split Out Cards').item.json, { cropUploaded: $json.statusCode === 200 }) }}")
    }
  },
  output: [{ messageId: SAMPLE_ID, label: 'Jane Doe', body: { firstName: 'Jane' }, cropKey: 'sms/x-crop-01.jpg', cropUploaded: true }]
});

// One run downstream no matter which branch each card took, so Tally Cards
// sees every card of a photo together.
const mergeCards = merge({
  version: 3.2,
  config: {
    name: 'Merge Cards',
    position: [6800, -300],
    parameters: { mode: 'append' }
  }
});

const createContact = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Create Card Contact',
    position: [7020, -300],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: SUPABASE_URL + '/functions/v1/contacts-from-ocr',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify(Object.assign({}, $json.body, $json.cropUploaded === true ? { croppedImagePath: $json.cropKey } : {})) }}"),
      options: {
        batching: { batch: { batchSize: 1, batchInterval: 0 } },
        response: { response: { fullResponse: true, neverError: true } },
        timeout: 30000
      }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ statusCode: 201, body: { id: '0b8f0b3e-3a33-4a4f-9d3f-4b9b1d1f7c20' } }]
});

const tallyCards = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Tally Cards',
    position: [7240, -300],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: TALLY_CARDS_JS }
  },
  output: [{ messageId: SAMPLE_ID, claimedAttempts: 1, status: 'completed', error: null, error_class: null }]
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

const finalizePhoto = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: { name: 'Finalize Photo', position: [7460, -300], parameters: CLAIMED_MESSAGE_WRITE, credentials: { supabaseApi: newCredential('Supabase account') } },
  output: [{ id: SAMPLE_ID, status: 'completed' }]
});

// ---------------------------------------------------------------- failures
// Every failure before the skill ran: 'failed' + error_class. Unknown causes
// default to transient (the backstop retries up to 10 x 5 min); only a result
// the same bytes will reproduce is terminal.

const noCardRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'No Card Row',
    position: [5480, -100],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ messageId: $('Photo Context').item.json.messageId, claimedAttempts: $('Photo Context').item.json.claimedAttempts, status: 'failed', error: 'no legible business card detected in photo', error_class: 'terminal' }) }}")
    }
  },
  output: [{ messageId: SAMPLE_ID, claimedAttempts: 1, status: 'failed', error_class: 'terminal' }]
});

const skillFailedRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skill Failed Row',
    position: [5260, 100],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ messageId: $('Photo Context').item.json.messageId, claimedAttempts: $('Photo Context').item.json.claimedAttempts, status: 'failed', error: String($json.message ?? 'process-cards failed').slice(0, 2000), error_class: $json.errorKind === 'transient' ? 'transient' : 'terminal' }) }}")
    }
  },
  output: [{ messageId: SAMPLE_ID, claimedAttempts: 1, status: 'failed', error_class: 'terminal' }]
});

const markSkillFailed = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Mark Skill Failed',
    position: [5480, 100],
    parameters: CLAIMED_MESSAGE_WRITE,
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: SAMPLE_ID, status: 'failed', error_class: 'terminal' }]
});

const permanentSkillFailure = ifElse({
  version: 2.3,
  config: {
    name: 'Permanent Skill Failure?',
    position: [5700, 100],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.error_class }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'terminal' }],
        combinator: 'and'
      }
    }
  }
});

const failSkill = node({
  type: 'n8n-nodes-base.stopAndError',
  version: 1,
  config: {
    name: 'Fail Loudly (Skill)',
    position: [5920, 100],
    parameters: { errorType: 'errorMessage', errorMessage: expr("{{ 'process-cards failed permanently for photo ' + $json.id + ': ' + $json.error }}") }
  }
});

const preSkillFailedRow = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Pre-Skill Failed Row',
    position: [4600, 300],
    parameters: {
      mode: 'raw',
      jsonOutput: expr("{{ ({ messageId: $('Claim Photo Message').item.json.id, claimedAttempts: $('Claim Photo Message').item.json.processing_attempts, status: 'failed', error: String($json.error?.message ?? $json.error ?? ($json.size ? 'image could not be decoded' : ('event ' + $('Claim Photo Message').item.json.event_id + ' has no folder_code'))).slice(0, 2000), error_class: 'transient' }) }}")
    }
  },
  output: [{ messageId: SAMPLE_ID, claimedAttempts: 1, status: 'failed', error_class: 'transient' }]
});

const markPreSkillFailed = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: { name: 'Mark Photo Failed', position: [4820, 300], parameters: CLAIMED_MESSAGE_WRITE, credentials: { supabaseApi: newCredential('Supabase account') } },
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
      jsonOutput: expr("{{ ({ messageId: $json.id, claimedAttempts: $json.processing_attempts, status: 'failed', error: ('refusing to download from an unexpected storage key: ' + String($json.storage_path)).slice(0, 500), error_class: 'terminal' }) }}")
    }
  },
  output: [{ messageId: SAMPLE_ID, claimedAttempts: 1, status: 'failed', error_class: 'terminal' }]
});

const markUnsafeFailed = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: { name: 'Mark Unsafe Path Failed', position: [2840, 500], parameters: CLAIMED_MESSAGE_WRITE, credentials: { supabaseApi: newCredential('Supabase account') } },
  output: [{ id: SAMPLE_ID, status: 'failed', error: 'refusing to download from an unexpected storage key: x' }]
});

const failUnsafe = node({
  type: 'n8n-nodes-base.stopAndError',
  version: 1,
  config: {
    name: 'Fail Loudly (Unsafe Path)',
    position: [3060, 500],
    parameters: { errorType: 'errorMessage', errorMessage: expr("{{ 'card photo ' + $json.id + ': ' + $json.error }}") }
  }
});

const note = sticky(
  "## pipeline-process-cards-sms\nCard / roster photo texted to the Twilio number (inbound_messages, kind='photo') -> skill-process-cards (vision) -> one contacts-from-ocr POST per person, with a padded crop for multi-person photos.\n\n**Triggers:** header-authenticated DB Webhook on inbound_messages INSERT and UPDATE (storage_path is set in a second UPDATE after upload); 5-min backstop: reset stale claims (30 min), resurrect transient failures (10 x 5 min), pick up to 5 pending photos. Only a UUID-validated id comes from the webhook.\n\n**Steps:** optimistic claim (processing_attempts + 1) -> storage_path re-checked against twilio-webhook's key + extension allowlist (mismatch = terminal + Fail Loudly) -> event folder_code -> download -> SHA-256 of the bytes -> vision copy (JPEG, long edge <= 2000px; converts HEIC) -> skill -> per card: crop + upload (multi-person only), then contacts-from-ocr (idempotent on sourceImageHash, so retries don't duplicate).\n\n**Outcome:** no card = terminal (Review's manual Retry OCR); permanent skill failure = terminal + Fail Loudly; anything else unexpected = transient. Partial success = 'completed' with failures in error; every card failed = 'failed' (transient). Every post-claim write re-asserts status = 'processing' AND processing_attempts = this claim's value.",
  [dbWebhook, webhookMessageId, backstop, resetStale, retryTransient, findPending, backstopMessageId],
  { color: 4 }
);

export default workflow('pipeline-process-cards-sms', 'pipeline-process-cards-sms')
  .add(dbWebhook).to(webhookMessageId).to(validMessageId)
  .add(backstop).to(resetStale).to(retryTransient).to(findPending).to(backstopMessageId).to(validMessageId)
  .add(validMessageId).to(fetchMessage).to(uploadedYet).to(claimRow).to(claimMessage)
  .to(safePath
    .onTrue(fetchEvent.to(eventFound
      .onTrue(downloadPhoto.to(downloaded
        .onTrue(hashPhoto.to(restorePhoto).to(visionCopy).to(readSize).to(decoded
          .onTrue(photoContext.to(extractCards).to(extracted
            .onTrue(cardFound
              .onTrue(cardPlan.to(splitCards).to(needsCrop
                .onTrue(cropCard.to(uploadCrop).to(cropResult).to(mergeCards.input(0)))
                .onFalse(mergeCards.input(1))))
              .onFalse(noCardRow.to(markPreSkillFailed)))
            .onFalse(skillFailedRow.to(markSkillFailed).to(permanentSkillFailure.onTrue(failSkill)))))
          .onFalse(preSkillFailedRow)))
        .onFalse(preSkillFailedRow)))
      .onFalse(preSkillFailedRow.to(markPreSkillFailed))))
    .onFalse(unsafePathRow.to(markUnsafeFailed).to(failUnsafe)))
  .add(mergeCards).to(createContact).to(tallyCards).to(finalizePhoto)
  .add(note);
