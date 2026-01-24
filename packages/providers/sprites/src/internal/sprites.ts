import { ServiceUrlError } from "@usbx/core";

import type { SpritesSandbox } from "../sandbox.js";

export const getSpriteUrlAndAuth = (value: unknown): { url: string; auth?: string } => {
  if (!isRecord(value)) {
    throw new ServiceUrlError("service_not_ready", "Sprite details are unavailable.");
  }

  const urlValue = value.url;
  if (typeof urlValue !== "string" || urlValue.length === 0) {
    throw new ServiceUrlError("service_not_ready", "Sprite URL is unavailable.");
  }

  const urlSettings = value.url_settings;
  if (!isRecord(urlSettings)) {
    return { url: urlValue };
  }

  const authValue = urlSettings.auth;
  if (typeof authValue !== "string") {
    return { url: urlValue };
  }

  return { url: urlValue, auth: authValue };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const waitForPortListening = async (
  sandbox: SpritesSandbox,
  port: number,
  timeoutSeconds: number | undefined,
): Promise<void> => {
  const retries = timeoutSeconds ? Math.max(0, Math.ceil(timeoutSeconds)) : 0;
  const script = buildPortCheckScript(port, retries);
  const result = await sandbox.exec("sh", ["-c", script]);

  if (result.exitCode === 0) {
    return;
  }
  if (result.exitCode === 2) {
    throw new ServiceUrlError(
      "unsupported",
      "SpritesProvider.getServiceUrl requires ss or lsof to be available in the sprite.",
    );
  }

  throw new ServiceUrlError("port_unavailable", `Port ${port} is not listening inside the sprite.`);
};

const buildPortCheckScript = (port: number, retries: number): string => `
check_port() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${port}" | awk 'NR>1 {found=1} END {exit found?0:1}'
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nPiTCP:${port} -sTCP:LISTEN -t >/dev/null 2>&1
    return $?
  fi
  return 2
}

i=0
while [ $i -le ${retries} ]; do
  check_port
  rc=$?
  if [ $rc -eq 0 ]; then
    exit 0
  fi
  if [ $rc -eq 2 ]; then
    exit 2
  fi
  i=$((i+1))
  if [ $i -le ${retries} ]; then
    sleep 1
  fi
done
exit 1
`;
