import { randomUUID } from "node:crypto";

export function uuid(): string {
  return randomUUID();
}

export function timestamp(): string {
  return new Date().toISOString();
}
