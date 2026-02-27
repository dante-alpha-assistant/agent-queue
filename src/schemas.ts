export interface Task {
  id: string;
  type: "code" | "exec" | "query" | "review";
  payload: {
    repo?: string;
    issue?: number;
    prompt: string;
    workdir?: string;
    branch?: string;
  };
  priority: "high" | "normal" | "low";
  dispatchedBy: string;
  createdAt: string;
  maxRetries: number;
  retryCount: number;
  timeoutMs: number;
}

export interface Result {
  taskId: string;
  worker: string;
  status: "success" | "failed" | "timeout";
  result: {
    output?: string;
    error?: string;
    commitSha?: string;
    branch?: string;
  };
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

const TASK_TYPES = new Set(["code", "exec", "query", "review"]);
const PRIORITIES = new Set(["high", "normal", "low"]);
const RESULT_STATUSES = new Set(["success", "failed", "timeout"]);

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(`Validation error: ${msg}`);
}

export function validateTask(data: unknown): Task {
  assert(typeof data === "object" && data !== null, "task must be an object");
  const d = data as Record<string, unknown>;
  assert(typeof d.id === "string" && d.id.length > 0, "id required");
  assert(typeof d.type === "string" && TASK_TYPES.has(d.type), "invalid type");
  assert(typeof d.payload === "object" && d.payload !== null, "payload required");
  const p = d.payload as Record<string, unknown>;
  assert(typeof p.prompt === "string", "payload.prompt required");
  assert(typeof d.priority === "string" && PRIORITIES.has(d.priority), "invalid priority");
  assert(typeof d.dispatchedBy === "string", "dispatchedBy required");
  assert(typeof d.createdAt === "string", "createdAt required");
  assert(typeof d.maxRetries === "number", "maxRetries required");
  assert(typeof d.retryCount === "number", "retryCount required");
  assert(typeof d.timeoutMs === "number", "timeoutMs required");
  return d as unknown as Task;
}

export function validateResult(data: unknown): Result {
  assert(typeof data === "object" && data !== null, "result must be an object");
  const d = data as Record<string, unknown>;
  assert(typeof d.taskId === "string", "taskId required");
  assert(typeof d.worker === "string", "worker required");
  assert(typeof d.status === "string" && RESULT_STATUSES.has(d.status), "invalid status");
  assert(typeof d.result === "object" && d.result !== null, "result required");
  assert(typeof d.startedAt === "string", "startedAt required");
  assert(typeof d.completedAt === "string", "completedAt required");
  assert(typeof d.durationMs === "number", "durationMs required");
  return d as unknown as Result;
}

export function serializeTask(task: Task): Record<string, string> {
  return {
    id: task.id,
    type: task.type,
    payload: JSON.stringify(task.payload),
    priority: task.priority,
    dispatchedBy: task.dispatchedBy,
    createdAt: task.createdAt,
    maxRetries: String(task.maxRetries),
    retryCount: String(task.retryCount),
    timeoutMs: String(task.timeoutMs),
  };
}

export function deserializeTask(data: Record<string, string>): Task {
  return validateTask({
    id: data.id,
    type: data.type,
    payload: JSON.parse(data.payload),
    priority: data.priority,
    dispatchedBy: data.dispatchedBy,
    createdAt: data.createdAt,
    maxRetries: Number(data.maxRetries),
    retryCount: Number(data.retryCount),
    timeoutMs: Number(data.timeoutMs),
  });
}

export function serializeResult(result: Result): Record<string, string> {
  return {
    taskId: result.taskId,
    worker: result.worker,
    status: result.status,
    result: JSON.stringify(result.result),
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: String(result.durationMs),
  };
}

export function deserializeResult(data: Record<string, string>): Result {
  return validateResult({
    taskId: data.taskId,
    worker: data.worker,
    status: data.status,
    result: JSON.parse(data.result),
    startedAt: data.startedAt,
    completedAt: data.completedAt,
    durationMs: Number(data.durationMs),
  });
}
