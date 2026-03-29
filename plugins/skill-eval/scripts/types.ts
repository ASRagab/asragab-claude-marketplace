export interface RawContentBlockText {
  type: "text";
  text: string;
}

export interface RawContentBlockToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface RawContentBlockThinking {
  type: "thinking";
  thinking: string;
  signature: string;
}

export interface RawContentBlockToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  caller?: { type: string };
}

export type RawContentBlock =
  | RawContentBlockText
  | RawContentBlockToolResult
  | RawContentBlockThinking
  | RawContentBlockToolUse;

export interface RawQueueOperation {
  type: "queue-operation";
  operation: string;
  timestamp: string;
  sessionId: string;
  content: string;
}

export interface RawUserMessage {
  type: "user";
  parentUuid: string;
  isSidechain: boolean;
  promptId?: string;
  message: {
    role: "user";
    content: string | RawContentBlock[];
  };
  uuid: string;
  timestamp: string;
  permissionMode: string;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch?: string;
}

export interface RawAssistantMessage {
  type: "assistant";
  parentUuid: string;
  isSidechain: boolean;
  message: {
    model: string;
    id: string;
    role: "assistant";
    content: RawContentBlock[];
    stop_reason: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  requestId: string;
  uuid: string;
  timestamp: string;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch?: string;
}

export interface RawProgressMessage {
  type: "progress";
  parentUuid: string;
  data: {
    type: string;
    hookEvent: string;
    hookName: string;
    command?: string;
  };
  parentToolUseID?: string;
  timestamp?: string;
  sessionId?: string;
}

export interface RawLastPrompt {
  type: "last-prompt";
  lastPrompt: string;
  sessionId: string;
  timestamp?: string;
}

export interface RawSystemMessage {
  type: "system";
  message?: { role: "system"; content: string | RawContentBlock[] };
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
}

export interface RawFileHistorySnapshot {
  type: "file-history-snapshot";
  timestamp?: string;
  sessionId?: string;
  files?: unknown;
}

export type RawMessage =
  | RawQueueOperation
  | RawUserMessage
  | RawAssistantMessage
  | RawProgressMessage
  | RawLastPrompt
  | RawSystemMessage
  | RawFileHistorySnapshot;

export interface SessionMeta {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: string;
  kind: string;
  entrypoint: string;
}

export interface SubagentMeta {
  agentType: string;
}

export interface HistoryEntry {
  display: string;
  timestamp: string;
  project: string;
  sessionId: string;
}

export interface BaseEvent {
  session_id: string;
  timestamp: string;
  sequence: number;
  message_uuid: string;
  parent_message_uuid: string | null;
  cwd: string;
  git_branch: string | null;
  is_subagent: boolean;
  parent_session_id: string | null;
  subagent_id: string | null;
  subagent_type: string | null;
  model: string | null;
  version: string | null;
}

export type ExtractedEvent =
  | BaseEvent & { type: "user_message"; text: string }
  | BaseEvent & { type: "assistant_text"; text: string }
  | BaseEvent & { type: "tool_use"; tool_use_id: string; tool_name: string; tool_input: unknown }
  | BaseEvent & { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean }
  | BaseEvent & { type: "thinking"; text: string }
  | BaseEvent & { type: "progress"; hook_event: string; hook_name: string }
  | BaseEvent & { type: "system"; subtype: string; content: string };

export interface CLIOptions {
  session: string | null;
  project: string | null;
  since: number | null;
  includeSubagents: boolean;
  output: string | null;
  format: "jsonl" | "summary";
}

export interface ClassificationLabel {
  category: "noise" | "friction" | "success" | "neutral";
  subcategory: string;
  confidence: number;
  evidence?: string;
}

export type ClassifiedEvent = ExtractedEvent & {
  classification: ClassificationLabel;
};
