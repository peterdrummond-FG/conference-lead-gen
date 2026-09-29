import { workflow, node, trigger, sticky, newCredential, placeholder, expr } from '@n8n/workflow-sdk';

const errorTrigger = trigger({
  type: 'n8n-nodes-base.errorTrigger',
  version: 1,
  config: { name: 'Pipeline Failed', position: [200, 300] },
  output: [{ execution: { id: '1234', url: 'https://workflow.flippengroup.com/workflow/abc/executions/1234', error: { message: 'match-contact failed permanently for contact x (attempt 1 of 3): schema' }, lastNodeExecuted: 'Fail Loudly', mode: 'webhook' }, workflow: { id: 'abc', name: 'pipeline-match-contact' } }]
});

// Plain text on purpose: error messages can quote model output or OCR text,
// so nothing here is ever rendered as HTML. Each field is bounded.
const alertBody = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Alert Text',
    position: [420, 300],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [
        { id: 'subject', name: 'subject', value: expr("{{ ('[CKH n8n] ' + String($json.workflow?.name ?? 'unknown workflow') + ' failed').slice(0, 150) }}"), type: 'string' },
        { id: 'text', name: 'text', value: expr("{{ ['Workflow: ' + String($json.workflow?.name ?? '?') + ' (' + String($json.workflow?.id ?? '?') + ')', 'Failed at: ' + String($json.execution?.lastNodeExecuted ?? '?'), 'Mode: ' + String($json.execution?.mode ?? '?'), 'Execution: ' + String($json.execution?.url ?? $json.execution?.id ?? '?'), '', 'Error:', String($json.execution?.error?.message ?? $json.trigger?.error?.message ?? 'no message').slice(0, 2000)].join('\\n') }}"), type: 'string' }
      ] }
    }
  },
  output: [{ subject: '[CKH n8n] pipeline-match-contact failed', text: 'Workflow: ...' }]
});

const sendEmail = node({
  type: 'n8n-nodes-base.emailSend',
  version: 2.1,
  config: {
    name: 'Email Alert',
    position: [640, 300],
    parameters: {
      resource: 'email',
      operation: 'send',
      fromEmail: placeholder('Sender address the SMTP account may send as, e.g. CKH Alerts <alerts@flippengroup.com>'),
      toEmail: placeholder('Who gets pipeline failure alerts'),
      subject: expr('{{ $json.subject }}'),
      emailFormat: 'text',
      text: expr('{{ $json.text }}'),
      options: { appendAttribution: false }
    },
    credentials: { smtp: newCredential('Alert SMTP') }
  },
  output: [{ accepted: ['ops@example.org'] }]
});

const note = sticky(
  "## error-alert-email\nError workflow for every CKH pipeline and skill workflow (set as each one's errorWorkflow). Fires on production failures only -- manual/test runs never trigger it.\n\nWhat reaches it: a Fail Loudly node (permanent skill failure, unsafe storage path), or any node error that wasn't handled (e.g. a Supabase write failing, a missing ZOHO_MCP_URL). Transient failures are handled in-pipeline and do not alert.\n\n**Needs:** an SMTP credential (Alert SMTP) and the sender/recipient addresses (placeholders).",
  [errorTrigger, alertBody, sendEmail],
  { color: 4 }
);

export default workflow('error-alert-email', 'error-alert-email')
  .add(errorTrigger).to(alertBody).to(sendEmail)
  .add(note);
