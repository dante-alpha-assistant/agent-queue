const TASK_TYPES = new Set(["code", "exec", "query", "review"]);
const PRIORITIES = new Set(["high", "normal", "low"]);
const RESULT_STATUSES = new Set(["success", "failed", "timeout"]);
function assert(cond, msg) {
    if (!cond)
        throw new Error(`Validation error: ${msg}`);
}
export function validateTask(data) {
    assert(typeof data === "object" && data !== null, "task must be an object");
    const d = data;
    assert(typeof d.id === "string" && d.id.length > 0, "id required");
    assert(typeof d.type === "string" && TASK_TYPES.has(d.type), "invalid type");
    assert(typeof d.payload === "object" && d.payload !== null, "payload required");
    const p = d.payload;
    assert(typeof p.prompt === "string", "payload.prompt required");
    assert(typeof d.priority === "string" && PRIORITIES.has(d.priority), "invalid priority");
    assert(typeof d.dispatchedBy === "string", "dispatchedBy required");
    assert(typeof d.createdAt === "string", "createdAt required");
    assert(typeof d.maxRetries === "number", "maxRetries required");
    assert(typeof d.retryCount === "number", "retryCount required");
    assert(typeof d.timeoutMs === "number", "timeoutMs required");
    return d;
}
export function validateResult(data) {
    assert(typeof data === "object" && data !== null, "result must be an object");
    const d = data;
    assert(typeof d.taskId === "string", "taskId required");
    assert(typeof d.worker === "string", "worker required");
    assert(typeof d.status === "string" && RESULT_STATUSES.has(d.status), "invalid status");
    assert(typeof d.result === "object" && d.result !== null, "result required");
    assert(typeof d.startedAt === "string", "startedAt required");
    assert(typeof d.completedAt === "string", "completedAt required");
    assert(typeof d.durationMs === "number", "durationMs required");
    return d;
}
export function serializeTask(task) {
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
export function deserializeTask(data) {
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
export function serializeResult(result) {
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
export function deserializeResult(data) {
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
