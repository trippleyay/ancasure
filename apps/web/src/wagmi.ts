import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

const wcProjectId = (import.meta as any).env?.VITE_WALLETCONNECT_PROJECT_ID ?? "";

export const config = createConfig({
  chains: [sepolia],
  connectors: [
    injected(),
    ...(wcProjectId ? [walletConnect({ projectId: wcProjectId, showQrModal: true })] : []),
  ],
  transports: { [sepolia.id]: http() },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
