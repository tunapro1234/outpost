import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";

const HEADER_CHUNK_BYTES = 16 * 1024;
const MAX_HEADER_BYTES = 256 * 1024;

function decodeBytes(bytes, charset) {
  const normalized = String(charset || "utf-8").trim().toLowerCase();
  try {
    return new TextDecoder(normalized).decode(bytes);
  } catch {
    return Buffer.from(bytes).toString("utf8");
  }
}

function decodeEncodedWord(_match, charset, encoding, value) {
  try {
    if (encoding.toLowerCase() === "b") {
      return decodeBytes(Buffer.from(value, "base64"), charset);
    }
    const bytes = [];
    const source = value.replaceAll("_", " ");
    for (let index = 0; index < source.length; index += 1) {
      if (/^[0-9a-f]{2}$/i.test(source.slice(index + 1, index + 3)) && source[index] === "=") {
        bytes.push(Number.parseInt(source.slice(index + 1, index + 3), 16));
        index += 2;
      } else {
        bytes.push(source.charCodeAt(index));
      }
    }
    return decodeBytes(Uint8Array.from(bytes), charset);
  } catch {
    return value;
  }
}

export function decodeHeaderValue(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, decodeEncodedWord);
}

export function extractMailAddresses(value) {
  const values = Array.isArray(value) ? value.flat(Infinity) : [value];
  const addresses = [];
  const seen = new Set();
  for (const item of values) {
    if (typeof item !== "string") continue;
    for (const match of decodeHeaderValue(item).matchAll(
      /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/gi,
    )) {
      const address = match[0].toLowerCase();
      if (seen.has(address)) continue;
      seen.add(address);
      addresses.push(address);
    }
  }
  return addresses;
}

function headerMap(source) {
  const headers = new Map();
  let current = null;
  for (const line of source.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && current) {
      const values = headers.get(current);
      values[values.length - 1] += ` ${line.trim()}`;
      continue;
    }
    const match = /^([^:\s]+):\s*(.*)$/.exec(line);
    if (!match) {
      current = null;
      continue;
    }
    current = match[1].toLowerCase();
    const values = headers.get(current) ?? [];
    values.push(match[2].trim());
    headers.set(current, values);
  }
  return headers;
}

function messageId(value) {
  if (typeof value !== "string") return null;
  const bracketed = /<([^<>\s]+)>/.exec(value);
  const cleaned = (bracketed?.[1] ?? value.trim()).replace(/\s+/g, "");
  return cleaned || null;
}

function isoDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseMailHeaders(source) {
  const headers = headerMap(String(source ?? ""));
  const all = (name) => headers.get(name) ?? [];
  const first = (name) => all(name)[0] ?? null;
  const from = extractMailAddresses(all("from"));
  const to = extractMailAddresses(all("to"));
  const cc = extractMailAddresses(all("cc"));
  const subject = first("subject") === null ? null : decodeHeaderValue(first("subject")).trim();
  const date = isoDate(first("date"));
  const parsedMessageId = messageId(first("message-id"));
  const recognized = from.length || to.length || cc.length || subject || date || parsedMessageId;
  if (!recognized) throw new Error("tanınan mail başlığı yok");

  const fingerprint = [from.join(","), to.join(","), cc.join(","), subject ?? "", date ?? ""]
    .join("\0");
  return {
    from,
    to,
    cc,
    subject: subject || null,
    date,
    messageId: parsedMessageId,
    id: parsedMessageId ?? createHash("sha256").update(fingerprint).digest("hex"),
  };
}

function headerEnd(buffer) {
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");
  if (crlf < 0) return lf;
  if (lf < 0) return crlf;
  return Math.min(crlf, lf);
}

export async function readMailHeaders(filePath, { maxBytes = MAX_HEADER_BYTES } = {}) {
  const handle = await fs.open(filePath, "r");
  try {
    const chunks = [];
    let total = 0;
    while (total < maxBytes) {
      const chunk = Buffer.alloc(Math.min(HEADER_CHUNK_BYTES, maxBytes - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, total);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
      const combined = Buffer.concat(chunks);
      const end = headerEnd(combined);
      if (end >= 0) return parseMailHeaders(combined.subarray(0, end).toString("utf8"));
    }
    return parseMailHeaders(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await handle.close();
  }
}
