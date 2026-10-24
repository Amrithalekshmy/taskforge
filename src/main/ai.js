// Event detection + "what next?" suggestions.
// With an Anthropic API key, Claude searches the web for event-specific follow-ups.
// Without one, a built-in checklist is used so the feature still works offline.
const Anthropic = require('@anthropic-ai/sdk');

const EVENT_WORDS = [
  'event', 'hackathon', 'workshop', 'fest', 'festival', 'meetup', 'seminar', 'conference', 'webinar',
  'session', 'competition', 'contest', 'launch', 'talk', 'symposium', 'summit', 'ceremony', 'drive',
  'bootcamp', 'camp', 'orientation', 'expo', 'exhibition', 'tournament', 'gala', 'fundraiser', 'quiz',
  'induction', 'farewell', 'celebration', 'showcase', 'demo day', 'panel', 'networking', 'sponsor',
];

function looksLikeEvent(task) {
  if (task.category === 'event') return true;
  const text = `${task.title} ${task.description || ''} ${(task.tags || []).join(' ')}`.toLowerCase();
  return EVENT_WORDS.some((w) => new RegExp(`\\b${w}`).test(text));
}

const FALLBACK_STEPS = [
  { title: 'Send thank-you notes to sponsors', description: 'Personalised thanks with event photos, attendance numbers and how their brand was featured. Ask about next-year partnership.', dueInDays: 2, priority: 'high', kind: 'sponsor' },
  { title: 'Share sponsor deliverables report', description: 'Logo placements, social reach, footfall and any promised metrics.', dueInDays: 5, priority: 'high', kind: 'sponsor' },
  { title: 'Send feedback form to attendees', description: 'Short (5 question) form while the event is fresh.', dueInDays: 1, priority: 'medium', kind: 'followup' },
  { title: 'Post event recap on social media', description: 'Photo carousel, highlights, tag sponsors, speakers and partners.', dueInDays: 2, priority: 'medium', kind: 'publicity' },
  { title: 'Distribute certificates / prizes', description: 'Participation and winner certificates; confirm prize disbursement.', dueInDays: 4, priority: 'medium', kind: 'followup' },
  { title: 'Thank speakers, judges and volunteers', description: 'Email + LinkedIn shout-out; recognise top volunteers.', dueInDays: 2, priority: 'medium', kind: 'followup' },
  { title: 'Settle accounts & file expense report', description: 'Collect bills, reimburse team members, reconcile budget vs actual.', dueInDays: 7, priority: 'high', kind: 'logistics' },
  { title: 'Return rented equipment / clear venue dues', description: 'Check all borrowed items are returned and deposits recovered.', dueInDays: 1, priority: 'high', kind: 'logistics' },
  { title: 'Hold team retrospective', description: 'What went well, what to improve. Save notes for the next organising team.', dueInDays: 5, priority: 'low', kind: 'report' },
  { title: 'Write event report / blog post', description: 'Archive photos, numbers and learnings; publish on website or newsletter.', dueInDays: 7, priority: 'low', kind: 'report' },
];

function extractJson(text) {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = fenced.length ? fenced.reverse() : [text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const c of candidates) {
    try { return JSON.parse(c); } catch {}
  }
  return null;
}

async function suggestNextSteps({ apiKey, task, event }) {
  if (!apiKey) {
    return {
      source: 'builtin',
      summary: `Standard post-event checklist for "${event.name}". Add an Anthropic API key in Settings to get web-researched, event-specific suggestions.`,
      steps: FALLBACK_STEPS,
      sources: [],
    };
  }

  const client = new Anthropic({ apiKey });
  const prompt = `Our team just completed a task that was part of an event. Help us plan what to do next.

Completed task: ${task.title}
Task details: ${task.description || '(none)'}
Event name: ${event.name}
Event type: ${event.type || 'unspecified'}
Event date: ${event.date || 'unspecified'}
Team notes: ${event.notes || '(none)'}
Today's date: ${new Date().toISOString().slice(0, 10)}

Search the web for current best practices for this kind of event, then suggest 6-10 concrete next steps.
Cover the small things organisers forget: sponsor thank-yous and deliverable reports, payments and
reimbursements, certificates, social media recap, attendee feedback, speaker/volunteer thanks,
equipment returns, and planning ahead for the next edition. Tailor them to this specific event.

Finish your reply with one JSON code block in exactly this shape:
\`\`\`json
{"summary": "one or two sentences", "steps": [{"title": "short imperative", "description": "1-2 sentences", "dueInDays": 2, "priority": "high|medium|low", "kind": "sponsor|publicity|logistics|followup|report|planning"}]}
\`\`\``;

  const messages = [{ role: 'user', content: prompt }];
  const params = {
    model: 'claude-opus-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
  };

  let response;
  const content = [];
  for (let i = 0; i < 4; i++) {
    response = await client.beta.messages.create({ ...params, messages });
    content.push(...response.content);
    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }

  if (response.stop_reason === 'refusal') {
    throw new Error('The AI declined this request. Try rephrasing the event details.');
  }

  const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const sources = [];
  for (const b of content) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) {
        if (r.url && !sources.some((s) => s.url === r.url)) sources.push({ url: r.url, title: r.title });
      }
    }
  }

  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.steps)) {
    return { source: 'builtin', summary: 'AI response could not be parsed – showing the standard checklist instead.', steps: FALLBACK_STEPS, sources };
  }
  return { source: 'ai', summary: parsed.summary || '', steps: parsed.steps.slice(0, 12), sources: sources.slice(0, 8) };
}

function describeAiError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Invalid Anthropic API key (check Settings).';
  if (err instanceof Anthropic.RateLimitError) return 'AI rate limit hit – try again in a minute.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service – check your internet connection.';
  if (err instanceof Anthropic.APIError) return `AI error ${err.status}: ${err.message}`;
  return err.message || String(err);
}

module.exports = { looksLikeEvent, suggestNextSteps, describeAiError, FALLBACK_STEPS };
