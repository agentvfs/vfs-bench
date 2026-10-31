/**
 * Upstream's Pydantic models (`claw_eval/models/`) as the graders read
 * them: their fields, defaults and `model_dump`. The port's
 * `claw_eval.models.*` imports resolve here.
 */
import { PyDict, ValueError, fromJSON, isinstance, dict as pyDict, now } from './py.ts'

/** The run's clock as upstream's `_now()` stamps it (`trace._now`). */
export function _now(): string {
  return now.iso
}
/** A model's input, a dict or an object, as an object of its fields. */
function shallow(input: any): Record<string, any> {
  if (input instanceof PyDict) return Object.fromEntries([...input.entries()].map(([k, v]) => [String(k), v]))
  return input ?? {}
}
function fields(target: any, values: Record<string, any>, defaults: Record<string, () => any>) {
  for (const [k, make] of Object.entries(defaults)) target[k] = Object.hasOwn(values, k) ? values[k] : make()
}
function required(values: Record<string, any>, ...names: string[]) {
  for (const n of names) if (!Object.hasOwn(values, n)) throw new ValueError(`Field required: ${n}`)
}

export class TextBlock {
  type = 'text'
  text: string
  constructor(input: any) {
    const values = shallow(input)
    required(values, 'text')
    if (typeof values.text !== 'string') throw new ValueError('text: Input should be a valid string')
    this.text = values.text
  }
}
export class ToolUseBlock {
  type = 'tool_use'
  id: string
  name: string
  input: PyDict
  constructor(input: any) {
    const values = shallow(input)
    required(values, 'id', 'name')
    this.id = values.id
    this.name = values.name
    this.input = values.input === undefined ? new PyDict() : values.input instanceof PyDict ? values.input : fromJSON(values.input)
  }
}
export class ToolResultBlock {
  type = 'tool_result'
  tool_use_id: string
  content: TextBlock[]
  is_error: boolean
  constructor(input: any) {
    const values = shallow(input)
    required(values, 'tool_use_id')
    this.tool_use_id = values.tool_use_id
    this.content = (values.content ?? []).map((b: any) => (b instanceof TextBlock ? b : new TextBlock(b)))
    this.is_error = values.is_error ?? false
  }
}
class MediaBlock {
  type = ''
  data: string
  mime_type: string
  source_path: string | null
  constructor(input: any) {
    const values = shallow(input)
    this.data = values.data
    this.mime_type = values.mime_type
    this.source_path = values.source_path ?? null
  }
}
export class ImageBlock extends MediaBlock {
  override type = 'image'
}
export class AudioBlock extends MediaBlock {
  override type = 'audio'
}
export class VideoBlock extends MediaBlock {
  override type = 'video'
}
const BLOCKS: Record<string, new (v: any) => any> = {
  text: TextBlock,
  tool_use: ToolUseBlock,
  tool_result: ToolResultBlock,
  image: ImageBlock,
  audio: AudioBlock,
  video: VideoBlock,
}
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock | AudioBlock | VideoBlock

export class Message {
  role: string
  content: ContentBlock[]
  reasoning_content: string | null
  constructor(input: any) {
    const values = shallow(input)
    required(values, 'role')
    if (!['user', 'assistant', 'system'].includes(values.role)) throw new ValueError('role: Input should be user, assistant or system')
    this.role = values.role
    const content = typeof values.content === 'string' ? [{ type: 'text', text: values.content }] : (values.content ?? [])
    this.content = content.map((input: any) => {
      const b = input instanceof PyDict ? shallow(input) : input
      const make = BLOCKS[b.type]
      if (!make) throw new ValueError(`content: unknown block type ${b.type}`)
      return input instanceof make ? input : new make(b)
    })
    this.reasoning_content = values.reasoning_content ?? null
  }
  /** Concatenate all TextBlock content. */
  get text(): string {
    return this.content
      .filter((b) => 'text' in b && b.type === 'text')
      .map((b) => (b as TextBlock).text)
      .join('\n')
  }
}
export class TokenUsage {
  input_tokens = 0
  output_tokens = 0
}
export class DimensionScores {
  completion = 0.0
  robustness = 0.0
  communication = 0.0
  safety = 1.0
  efficiency_turns = 0
  efficiency_tokens = 0
  efficiency_wall_time_s = 0.0
  constructor(...args: any[]) {
    const values = args[0]?.values ?? {}
    Object.assign(this, values)
  }
  model_dump(): PyDict {
    return pyDict(
      [
        'completion',
        'robustness',
        'communication',
        'safety',
        'efficiency_turns',
        'efficiency_tokens',
        'efficiency_wall_time_s',
      ].map((k) => [k, (this as any)[k]])
    )
  }
}
export class TraceMessage {
  type = 'message'
  trace_id!: string
  message!: Message
  usage!: TokenUsage
  timestamp!: string
  constructor(input: any) {
    const values = shallow(input)
    required(values, 'trace_id', 'message')
    fields(this, values, { trace_id: () => '', usage: () => new TokenUsage(), timestamp: _now })
    this.message = values.message instanceof Message ? values.message : new Message(values.message)
  }
}
export class ToolDispatch {
  type = 'tool_dispatch'
  trace_id!: string
  tool_use_id!: string
  tool_name!: string
  endpoint_url!: string
  request_body!: PyDict
  response_status!: number
  response_body: any
  latency_ms!: number
  timestamp!: string
  constructor(input: any) {
    const values = shallow(input)
    required(values, 'trace_id', 'tool_use_id', 'tool_name', 'endpoint_url')
    fields(this, values, {
      trace_id: () => '',
      tool_use_id: () => '',
      tool_name: () => '',
      endpoint_url: () => '',
      request_body: () => new PyDict(),
      response_status: () => 200,
      response_body: () => null,
      latency_ms: () => 0.0,
      timestamp: _now,
    })
    if (!isinstance(this.request_body, pyDict)) this.request_body = fromJSON(this.request_body)
    if (!(this.request_body instanceof PyDict)) throw new ValueError('request_body: Input should be a valid dictionary')
    if (!Number.isInteger(this.response_status)) throw new ValueError('response_status: Input should be a valid integer')
    if (!(this.response_body instanceof PyDict)) this.response_body = fromJSON(this.response_body)
  }
}
export class MediaLoad {
  type = 'media_load'
  modality = ''
  status = 'loaded'
}

/** The fields of upstream's `TaskDefinition` the graders and the trace
 * assembly read; `build.py` takes them from each task's `task.yaml`. */
export interface TaskData {
  task_id: string
  task_name: string
  prompt: { text: string; language: string }
  judge_rubric: string
  services: { name: string; reset_endpoint: string | null }[]
  tools: { name: string }[]
  tool_endpoints: { tool_name: string; url: string }[]
}
export class TaskDefinition {
  task_id: string
  task_name: string
  prompt: { text: string; language: string }
  judge_rubric: string
  services: { name: string; reset_endpoint: string | null }[]
  tools: { name: string }[]
  tool_endpoints: { tool_name: string; url: string }[]
  task_file: string
  constructor(data: TaskData) {
    this.task_id = data.task_id
    this.task_name = data.task_name
    this.prompt = data.prompt
    this.judge_rubric = data.judge_rubric
    this.services = data.services
    this.tools = data.tools
    this.tool_endpoints = data.tool_endpoints
    this.task_file = `tasks/${data.task_id}/task.yaml`
  }
}
