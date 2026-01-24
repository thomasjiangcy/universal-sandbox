export const appendQueryToken = (url: string, key: string, value: string): string => {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
};
