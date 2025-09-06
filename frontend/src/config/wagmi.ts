import { http, createConfig } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

export const config = createConfig({
  chains: [mainnet, sepolia],
  connectors: [
    injected(),
    ...(projectId ? [walletConnect({ projectId })] : [])
  ],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});
