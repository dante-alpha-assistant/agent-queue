# @dante/agent-queue

A Redis Streams-based task queue for dispatching and consuming agent work (code, exec, query, review).

## Architecture

```
┌──────────┐       ┌─────────────────────────┐       ┌──────────┐
│ Producer │──────▶│     Redis Streams        │◀──────│ Consumer │
│          │       │                          │       │          │
│ dispatch │       │  agent:tasks   (pending) │       │  claim   │
│ pollRes  │       │  agent:results (done)    │       │  ack     │
│ stats    │       │  agent:dlq     (failed)  │       │  nack→DLQ│
└──────────┘       └─────────────────────────┘       └──────────┘
```

## Quick Start

```bash
npm install @dante/agent-queue

# Set Redis URL (default: redis://redis.infra.svc.cluster.local:6379)
export REDIS_URL=redis://localhost:6379

# Dispatch a task
agent-queue dispatch '{"type":"code","payload":{"prompt":"fix bug"},"priority":"normal","dispatchedBy":"cli","maxRetries":3,"timeoutMs":30000}'

# Check stats
agent-queue stats

# View results
agent-queue results --limit 5
```

## CLI Commands

### `agent-queue stats`
Show queue statistics (pending, processing, completed, failed).

### `agent-queue dispatch <json>`
Dispatch a task. The JSON must include: `type`, `payload` (with `prompt`), `priority`, `dispatchedBy`, `maxRetries`, `timeoutMs`.

```bash
agent-queue dispatch '{"type":"exec","payload":{"prompt":"ls -la","workdir":"/tmp"},"priority":"high","dispatchedBy":"neo","maxRetries":2,"timeoutMs":10000}'
```

### `agent-queue results [--limit N]`
Poll the most recent N results (default 10).

### `agent-queue dlq list`
List all entries in the dead-letter queue.

### `agent-queue dlq retry <taskId>`
Move a task from the DLQ back to the tasks stream for reprocessing.

### `agent-queue dlq purge [--age-hours N]`
Delete DLQ entries older than N hours (default 24).

### `agent-queue drain --confirm`
Trim all three streams to zero. Requires `--confirm` flag.

### `agent-queue monitor`
Live tail all streams. Prints new entries as they arrive. Ctrl+C to stop.

## TypeScript API

### Producer

```typescript
import { QueueClient, TaskProducer } from "@dante/agent-queue";

const client = new QueueClient(process.env.REDIS_URL);
await client.connect();
await client.ensureStreams();

const producer = new TaskProducer(client);
const taskId = await producer.dispatch({
  type: "code",
  payload: { prompt: "implement feature X", repo: "org/repo", branch: "main" },
  priority: "normal",
  dispatchedBy: "neo",
  maxRetries: 3,
  timeoutMs: 60000,
});
console.log("Dispatched:", taskId);

const result = await producer.awaitResult(taskId, 30000);
console.log("Result:", result);

await client.disconnect();
```

### Consumer

```typescript
import { QueueClient, TaskConsumer } from "@dante/agent-queue";

const client = new QueueClient(process.env.REDIS_URL);
await client.connect();
await client.ensureStreams();

const consumer = new TaskConsumer(client, "worker-1");
// Consumer claims tasks, processes them, and acks/nacks
// See src/consumer.ts for the full API

await client.disconnect();
```

## Environment Variables

| Variable    | Description                | Default                                      |
|-------------|----------------------------|----------------------------------------------|
| `REDIS_URL` | Redis connection string    | `redis://redis.infra.svc.cluster.local:6379` |

## License

MIT
