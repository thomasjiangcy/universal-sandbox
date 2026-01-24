export const createTextStream = () => {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const readable = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });

  const enqueue = (chunk: string) => {
    if (!controller) {
      return;
    }
    controller.enqueue(encoder.encode(chunk));
  };

  const close = () => {
    controller?.close();
  };

  const error = (err: unknown) => {
    controller?.error(err);
  };

  return {
    readable,
    enqueue,
    close,
    error,
  };
};
