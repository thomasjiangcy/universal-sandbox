import type Docker from "dockerode";

export type LocalDockerPortExposureMode = "published" | "host";

export type LocalDockerPortPublishMode = "same-port" | "random";

export type LocalDockerPortExposure = {
  mode?: LocalDockerPortExposureMode;
  ports?: number[];
  portRange?: { start: number; end: number };
  publishMode?: LocalDockerPortPublishMode;
  hostIp?: string;
};

export type LocalDockerProviderOptions = {
  docker?: Docker;
  socketPath?: string;
  host?: string;
  port?: number;
  protocol?: "http" | "https";
  defaultImage?: string;
  defaultCommand?: string[];
  portExposure?: LocalDockerPortExposure;
};

export type LocalDockerExecOptions = {
  user?: string;
  privileged?: boolean;
  tty?: boolean;
};
