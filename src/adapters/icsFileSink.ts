import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { redactSensitive } from "../domain/redact.js";
import type { CalendarSink } from "./types.js";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function icsStamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export function buildIcs(input: {
  uid: string;
  stamp: string;
  title: string;
  start: string;
  durationMinutes?: number;
  description?: string;
}): string {
  const minutes = input.durationMinutes ?? 30;
  const end = new Date(new Date(input.start).getTime() + minutes * 60_000).toISOString();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Wayfinder//EN",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${icsStamp(input.stamp)}`,
    `DTSTART:${icsStamp(input.start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${escapeText(input.title)}`
  ];
  if (input.description !== undefined) lines.push(`DESCRIPTION:${escapeText(input.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR", "");
  return lines.join("\r\n");
}

export function createIcsFileSink(deps: { dir: string; now?: () => string }): CalendarSink {
  return {
    async publish(input) {
      await mkdir(deps.dir, { recursive: true });
      const uid = `wf-${randomUUID()}@wayfinder`;
      const stamp = deps.now ? deps.now() : new Date().toISOString();
      const ics = buildIcs({
        uid,
        stamp,
        title: redactSensitive(input.title),
        start: input.start,
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        ...(input.description !== undefined ? { description: redactSensitive(input.description) } : {})
      });
      const file = join(deps.dir, `${uid}.ics`);
      await writeFile(file, ics, "utf8");
      return { ref: file };
    }
  };
}
