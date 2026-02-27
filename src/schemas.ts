export interface Task {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  priority: "low" | "normal" | "high";
  createdAt: string;
  retryCount: number;
  meta?: Record<string, unknown>;
}

export interface Result {
  taskId: string;
  status: "success" | "failure";
  output?: unknown;
  error?: string;
  completedAt: string;
}

export function serializeTask(task: Task): Record<string, string> {
  return {
    id: task.id,
    type: task.type,
    payload: JSON.stringify(task.payload),
    priority: task.priority,
    createdAt: task.createdAt,
    retryCount: String(task.retryCount),
    ...(task.meta ? { meta: JSON.stringify(task.meta) } : {}),
  };
}

export function deserializeTask(fields: Record<string, string>): Task {
  return {
    id: fields.id!,
    type: fields.type!,
    payload: JSON.parse(fields.payload!),
    priority: fields.priority as Task["priority"],
    createdAt: fields.createdAt!,
    retryCount: Number(fields.retryCount),
    ...(fields.meta ? { meta: JSON.parse(fields.meta) } : {}),
  };
}

export function serializeResult(result: Result): Record<string, string> {
  return {
    taskId: result.taskId,
    status: result.status,
    ...(result.output !== undefined ? { output: JSON.stringify(result.output) } : {}),
    ...(result.error ? { error: result.error } : {}),
    completedAt: result.completedAt,
  };
}

export function deserializeResult(fields: Record<string, string>): Result {
  return {
    taskId: fields.taskId!,
    status: fields.status as Result["status"],
    ...(fields.output ? { output: JSON.parse(fields.output) } : {}),
    ...(fields.error ? { error: fields.error } : {}),
    completedAt: fields.completedAt!,
  };
}

export function validateTask(task: unknown): task is Task {
  if (!task || typeof task !== "object") return false;
  const t = task as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.type === "string" &&
    typeof t.payload === "object" &&
    ["low", "normal", "high"].includes(t.priority as string) &&
    typeof t.createdAt === "string" &&
    typeof t.retryCount === "number"
  );
}
