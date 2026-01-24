import type {
  CreateSandboxFromImageParams,
  CreateSandboxFromSnapshotParams,
  Daytona,
  DaytonaConfig,
} from "@daytonaio/sdk";

export type DaytonaServiceUrlOptions = {
  preferSignedUrl?: boolean;
};

export type DaytonaProviderOptions = {
  client?: Daytona;
  config?: DaytonaConfig;
  createParams?: CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams;
  createOptions?: {
    timeout?: number;
    onSnapshotCreateLogs?: (chunk: string) => void;
  };
} & DaytonaServiceUrlOptions;

export type DaytonaExecOptions = never;
