import type {
  App,
  Image,
  ModalClient,
  SandboxCreateParams,
  SandboxExecParams,
  Secret,
} from "modal";

export type ModalProviderOptions = {
  client?: ModalClient;
  app?: App;
  appName?: string;
  appLookupOptions?: {
    environment?: string;
    createIfMissing?: boolean;
  };
  image?: Image;
  imageRef?: string;
  imageRegistrySecret?: Secret;
  sandboxOptions?: SandboxCreateParams;
};

export type ModalExecOptions = SandboxExecParams;
