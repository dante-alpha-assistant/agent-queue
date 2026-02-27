#!/usr/bin/env node
import { Command } from "commander";
import { QueueClient } from "./client.js";
import { TaskProducer } from "./producer.js";
import { STREAMS, CONSUMER_GROUP } from "./streams.js";
import { deserializeTask, deserializeResult, serializeTask } from "./schemas.js";

const program = new Command();
program.name("agent-queue").description("CLI for the agent task queue").version("0.1.0");

function createClient(): QueueClient {
  return new QueueClient(process.env.REDIS_URL);
}

async function withClient<T>(fn: (client: QueueClient) => Promise<T>): Promise<T> {
  const client = createClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

function fieldsToMap(fields: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    map[fields[i]] = fields[i + 1];
  }
  return map;
}

// --- stats ---
program.command("stats").description("Show queue statistics").action(async () => {
  await withClient(async (client) => {
    const producer = new TaskProducer(client);
    const s = await producer.stats();
    console.log("\n  Queue Statistics");
    console.log("  ────────────────────");
    console.log(`  Pending:    ${s.pending}`);
    console.log(`  Processing: ${s.processing}`);
    console.log(`  Completed:  ${s.completed}`);
    console.log(`  Failed:     ${s.failed}`);
    console.log();
  });
});

// --- dispatch ---
program
  .command("dispatch <json>")
  .description("Dispatch a task (pass JSON)")
  .action(async (json: string) => {
    const data = JSON.parse(json);
    await withClient(async (client) => {
      const producer = new TaskProducer(client);
      const id = await producer.dispatch(data);
      console.log(`Dispatched task: ${id}`);
    });
  });

// --- results ---
program
  .command("results")
  .description("Poll recent results")
  .option("-l, --limit <n>", "max results", "10")
  .action(async (opts) => {
    await withClient(async (client) => {
      const producer = new TaskProducer(client);
      const results = await producer.pollResults(Number(opts.limit));
      if (!results.length) {
        console.log("No results.");
        return;
      }
      console.log("\n  Task ID                                Status    Duration  Worker");
      console.log("  " + "─".repeat(78));
      for (const r of results) {
        console.log(
          `  ${r.taskId}  ${r.status.padEnd(9)} ${String(r.durationMs).padStart(7)}ms  ${r.worker}`
        );
      }
      console.log();
    });
  });

// --- dlq ---
const dlq = program.command("dlq").description("Dead-letter queue operations");

dlq.command("list").description("List DLQ entries").action(async () => {
  await withClient(async (client) => {
    const entries = await client.getRedis().xrange(STREAMS.DLQ, "-", "+");
    if (!entries.length) {
      console.log("DLQ is empty.");
      return;
    }
    console.log("\n  Stream ID                  Task ID                              Type");
    console.log("  " + "─".repeat(78));
    for (const [streamId, fields] of entries) {
      const map = fieldsToMap(fields);
      console.log(`  ${streamId.padEnd(26)} ${(map.id ?? "?").padEnd(38)} ${map.type ?? "?"}`);
    }
    console.log();
  });
});

dlq
  .command("retry <taskId>")
  .description("Retry a DLQ task")
  .action(async (taskId: string) => {
    await withClient(async (client) => {
      const redis = client.getRedis();
      const entries = await redis.xrange(STREAMS.DLQ, "-", "+");
      for (const [streamId, fields] of entries) {
        const map = fieldsToMap(fields);
        if (map.id === taskId) {
          const task = deserializeTask(map);
          task.retryCount = 0;
          const serialized = serializeTask(task);
          const args: string[] = [];
          for (const [k, v] of Object.entries(serialized)) args.push(k, v);
          await redis.xadd(STREAMS.TASKS, "*", ...args);
          await redis.xdel(STREAMS.DLQ, streamId);
          console.log(`Retried task ${taskId}`);
          return;
        }
      }
      console.error(`Task ${taskId} not found in DLQ`);
      process.exitCode = 1;
    });
  });

dlq
  .command("purge")
  .description("Purge old DLQ entries")
  .option("--age-hours <n>", "delete entries older than N hours", "24")
  .action(async (opts) => {
    await withClient(async (client) => {
      const redis = client.getRedis();
      const cutoff = Date.now() - Number(opts.ageHours) * 3600_000;
      const entries = await redis.xrange(STREAMS.DLQ, "-", "+");
      let deleted = 0;
      for (const [streamId] of entries) {
        const ts = Number(streamId.split("-")[0]);
        if (ts < cutoff) {
          await redis.xdel(STREAMS.DLQ, streamId);
          deleted++;
        }
      }
      console.log(`Purged ${deleted} entries from DLQ`);
    });
  });

// --- drain ---
program
  .command("drain")
  .description("Drain all streams")
  .requiredOption("--confirm", "confirm drain")
  .action(async () => {
    await withClient(async (client) => {
      const redis = client.getRedis();
      for (const stream of [STREAMS.TASKS, STREAMS.RESULTS, STREAMS.DLQ]) {
        await redis.xtrim(stream, "MAXLEN", 0);
      }
      console.log("All streams drained.");
    });
  });

// --- monitor ---
program
  .command("monitor")
  .description("Live tail all streams")
  .action(async () => {
    const client = createClient();
    await client.connect();
    const redis = client.getRedis();
    const ids: Record<string, string> = {
      [STREAMS.TASKS]: "$",
      [STREAMS.RESULTS]: "$",
      [STREAMS.DLQ]: "$",
    };
    console.log("Monitoring streams (Ctrl+C to stop)...\n");

    const shutdown = async () => {
      await client.disconnect();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    while (true) {
      const streams = Object.keys(ids);
      const lastIds = streams.map((s) => ids[s]);
      const resp = await (redis as any).xread("BLOCK", 1000, "COUNT", 50, "STREAMS", ...streams, ...lastIds);
      if (!resp) continue;
      for (const [stream, entries] of resp) {
        for (const [id, fields] of entries) {
          ids[stream] = id;
          const map = fieldsToMap(fields);
          const label = stream === STREAMS.TASKS ? "TASK" : stream === STREAMS.RESULTS ? "RESULT" : "DLQ";
          const summary = map.id ?? map.taskId ?? "?";
          const ts = new Date(Number(id.split("-")[0])).toISOString();
          console.log(`[${ts}] ${label.padEnd(6)} ${summary}  ${map.type ?? map.status ?? ""}`);
        }
      }
    }
  });

program.parseAsync();
