import type {
  CreateSandboxFromImageParams,
  CreateSandboxFromSnapshotParams,
  Daytona,
  DaytonaConfig,
} from "@daytonaio/sdk";

export type DaytonaProviderOptions = {
  client?: Daytona;
  config?: DaytonaConfig;
  createParams?: CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams;
  createOptions?: {
    timeout?: number;
    onSnapshotCreateLogs?: (chunk: string) => void;
  };
};

export type DaytonaExecOptions = never;
