import type { App, Image, SandboxCreateParams, SandboxExecParams, Secret } from "modal";

export type ModalServiceUrlOptions = {
  authMode?: "header" | "query";
};

export type ModalProviderOptions = {
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
} & ModalServiceUrlOptions;

export type ModalExecOptions = SandboxExecParams;
