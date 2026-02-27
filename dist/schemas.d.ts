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
export declare function validateTask(data: unknown): Task;
export declare function validateResult(data: unknown): Result;
export declare function serializeTask(task: Task): Record<string, string>;
export declare function deserializeTask(data: Record<string, string>): Task;
export declare function serializeResult(result: Result): Record<string, string>;
export declare function deserializeResult(data: Record<string, string>): Result;
