export type TextReadable = {
  readText: () => Promise<string>;
};

export const readTextOrEmpty = async (stream?: TextReadable | null): Promise<string> => {
  if (!stream) {
    return "";
  }
  return stream.readText();
};
