import { randomUUID } from "node:crypto";

export function generateId(): string {
  return randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}
