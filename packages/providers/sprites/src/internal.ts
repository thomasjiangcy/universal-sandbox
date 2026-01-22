export const normalizeOutput = (value: string | Buffer | undefined): string => {
  if (!value) {
    return "";
  }
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
};

export const normalizeExitCode = (value: number | null | undefined): number | null => value ?? null;
