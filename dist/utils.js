import { randomUUID } from "node:crypto";
export function generateId() {
    return randomUUID();
}
export function isoNow() {
    return new Date().toISOString();
}
