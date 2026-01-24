import type Docker from "dockerode";

import type { LocalDockerPortExposure } from "../types.js";

export const buildPortExposureConfig = (
  exposure: Required<LocalDockerPortExposure>,
): {
  ExposedPorts?: Record<string, Record<string, never>>;
  HostConfig?: Docker.ContainerCreateOptions["HostConfig"];
} => {
  if (exposure.mode === "host") {
    return { HostConfig: { NetworkMode: "host" } };
  }

  const ports = resolveExposedPorts(exposure);
  if (ports.length === 0) {
    return {};
  }

  const exposedPorts: Record<string, Record<string, never>> = {};
  const portBindings: Record<string, Array<{ HostIp: string; HostPort: string }>> = {};

  for (const port of ports) {
    const key = `${port}/tcp`;
    exposedPorts[key] = {};
    portBindings[key] = [
      {
        HostIp: exposure.hostIp,
        HostPort: exposure.publishMode === "random" ? "" : String(port),
      },
    ];
  }

  return {
    ExposedPorts: exposedPorts,
    HostConfig: { PortBindings: portBindings },
  };
};

export const resolvePortExposure = (
  input?: LocalDockerPortExposure,
): Required<LocalDockerPortExposure> => ({
  mode: input?.mode ?? "published",
  ports: input?.ports ?? [],
  portRange: input?.portRange ?? { start: 0, end: 0 },
  publishMode: input?.publishMode ?? "same-port",
  hostIp: input?.hostIp ?? "127.0.0.1",
});

const resolveExposedPorts = (exposure: Required<LocalDockerPortExposure>): number[] => {
  const ports = new Set<number>();
  for (const port of exposure.ports) {
    assertValidPort(port);
    ports.add(port);
  }

  if (exposure.portRange.start !== 0 || exposure.portRange.end !== 0) {
    if (exposure.portRange.start > exposure.portRange.end) {
      throw new Error("LocalDockerProvider portRange start must be <= end.");
    }
    for (let port = exposure.portRange.start; port <= exposure.portRange.end; port += 1) {
      assertValidPort(port);
      ports.add(port);
    }
  }

  return [...ports].sort((a, b) => a - b);
};

const assertValidPort = (port: number): void => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port ${port}; expected 1-65535.`);
  }
};

export const normalizeHostIp = (hostIp: string | undefined, fallback: string): string => {
  if (!hostIp || hostIp === "0.0.0.0" || hostIp === "::") {
    return fallback;
  }
  return hostIp;
};

export const getPortBinding = (
  inspect: Docker.ContainerInspectInfo,
  port: number,
): { HostIp: string; HostPort: string } | undefined => {
  const key = `${port}/tcp`;
  const bindings = inspect.NetworkSettings?.Ports?.[key];
  if (!bindings || bindings.length === 0) {
    return undefined;
  }
  return bindings[0];
};
