export interface Task {
  taskId: string;
  type: string;
  payload: Record<string, unknown>;
  priority: number;
  maxRetries: number;
  retryCount: number;
  timeoutMs: number;
  createdAt: string;
}

export interface Result {
  taskId: string;
  result: "success" | "failure";
  output?: unknown;
  error?: string;
  workerName: string;
  startedAt: string;
  completedAt: string;
}

export function serialize(obj: Task | Result): Record<string, string> {
  return { data: JSON.stringify(obj) };
}

export function deserialize<T>(fields: Record<string, string>): T {
  return JSON.parse(fields.data) as T;
}

export function validateTask(t: unknown): t is Task {
  if (typeof t !== "object" || t === null) return false;
  const o = t as Record<string, unknown>;
  return (
    typeof o.taskId === "string" &&
    typeof o.type === "string" &&
    typeof o.maxRetries === "number" &&
    typeof o.timeoutMs === "number"
  );
}
