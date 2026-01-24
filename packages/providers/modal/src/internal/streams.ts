export const writeToWebStream = async (
  stream: WritableStream<Uint8Array>,
  input: string | Uint8Array,
): Promise<void> => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const writer = stream.getWriter();
  await writer.write(bytes);
  await writer.close();
  writer.releaseLock();
};
