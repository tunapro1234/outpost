function finiteToken(value) {
  const number = typeof value === "string" ? Number(value.replaceAll(",", "")) : value;
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : undefined;
}

// Claude CLI'nin stream-json biçimi sürümler arasında iki farklı delta zarfı
// kullandı. Copilot ve mail writer aynı ayrıştırıcıyı kullanarak her ikisini de
// destekler; partial mesaj geldiyse final assistant/result metnini tekrar etmez.
export function jsonDelta(record, state) {
  const streamDelta = record?.event?.delta?.text ??
    (record?.type === "content_block_delta" ? record.delta?.text : undefined);
  if (typeof streamDelta === "string") {
    state.partial = true;
    return streamDelta;
  }
  if (record?.type === "assistant" && !state.partial) {
    const text = record.message?.content
      ?.filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("");
    if (text) return text;
  }
  if (record?.type === "result" && !state.partial && !state.emitted) {
    return typeof record.result === "string" ? record.result : null;
  }
  return null;
}

export function updateClaudeUsage(record, current = null) {
  const source = record?.usage ?? record?.message?.usage;
  const input = finiteToken(source?.input_tokens);
  const output = finiteToken(source?.output_tokens);
  if (input === undefined && output === undefined) return current;
  return {
    tokens_in: Math.max(current?.tokens_in ?? 0, input ?? 0),
    tokens_out: Math.max(current?.tokens_out ?? 0, output ?? 0),
    estimated: false,
  };
}
