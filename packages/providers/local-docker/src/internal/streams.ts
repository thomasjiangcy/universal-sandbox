export const nodeReadableToWeb = (stream: NodeJS.ReadableStream): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk) => {
        if (typeof chunk === "string") {
          controller.enqueue(new TextEncoder().encode(chunk));
          return;
        }
        controller.enqueue(Buffer.isBuffer(chunk) ? chunk : new Uint8Array(chunk));
      });
      stream.on("end", () => controller.close());
      stream.on("error", (error: Error) => controller.error(error));
    },
    cancel() {
      if ("destroy" in stream && typeof stream.destroy === "function") {
        stream.destroy();
      }
    },
  });

export const nodeWritableToWeb = (stream: NodeJS.WritableStream): WritableStream<Uint8Array> =>
  new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        stream.write(chunk, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        stream.once("error", (error: Error) => reject(error));
        stream.end(() => resolve());
      });
    },
    abort(reason) {
      if ("destroy" in stream && typeof stream.destroy === "function") {
        stream.destroy(reason instanceof Error ? reason : undefined);
      }
    },
  });

export const writeToNodeStream = async (
  stream: NodeJS.WritableStream,
  input: string | Uint8Array,
): Promise<void> => {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;

  await new Promise<void>((resolve, reject) => {
    stream.once("error", reject);
    stream.end(buffer, resolve);
  });
};
