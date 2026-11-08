import { useEffect, useState, type ReactNode } from 'react';

type EthereumRequest = {
  method: string;
  params?: unknown[] | Record<string, unknown>;
};

type EthereumProvider = {
  isMetaMask?: boolean;
  request: (request: EthereumRequest) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type Eip6963ProviderDetail = {
  info: { rdns: string; name: string };
  provider: EthereumProvider;
};

declare global {
  interface WindowEventMap {
    'eip6963:announceProvider': CustomEvent<Eip6963ProviderDetail>;
  }

  interface Window {
    ethereum?: EthereumProvider & { providers?: EthereumProvider[] };
  }
}

const announcedProviders: Eip6963ProviderDetail[] = [];
let activeProvider: EthereumProvider | undefined;
let activeAddress: string | undefined;
const stateListeners = new Set<() => void>();

const emitState = () => stateListeners.forEach(listener => listener());

const setAddress = (value: unknown) => {
  const nextAddress = Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
  activeAddress = nextAddress;
  emitState();
};

const rememberProvider = (detail: Eip6963ProviderDetail) => {
  if (!announcedProviders.some(entry => entry.provider === detail.provider)) {
    announcedProviders.push(detail);
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', event => rememberProvider(event.detail));
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

const getInjectedProvider = (): EthereumProvider | undefined => {
  const announcedMetaMask = announcedProviders.find(({ info, provider }) =>
    info.rdns === 'io.metamask' || provider.isMetaMask
  )?.provider;
  if (announcedMetaMask) return announcedMetaMask;

  const injected = window.ethereum;
  if (!injected) return undefined;
  return injected.providers?.find(provider => provider.isMetaMask) ?? injected;
};

const attachProvider = (provider: EthereumProvider) => {
  if (activeProvider === provider) return;
  activeProvider = provider;
  provider.on?.('accountsChanged', setAddress);
  provider.on?.('disconnect', () => setAddress([]));
};

export const connectInjectedEthereumWallet = async () => {
  if (typeof window === 'undefined') throw new Error('Browser wallets are not available here.');

  // Ask again so wallets injected after initial page load can announce themselves.
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const provider = getInjectedProvider();
  if (!provider) throw new Error('MetaMask was not found. Install or enable MetaMask, then reload this page.');

  attachProvider(provider);
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  setAddress(accounts);
  if (!activeAddress) throw new Error('MetaMask did not return an Ethereum account.');
  return activeAddress;
};

export const WagmiProvider = ({ children }: { children: ReactNode }) => children;
export const useConnection = () => {
  const [, refresh] = useState(0);

  useEffect(() => {
    const listener = () => refresh(value => value + 1);
    stateListeners.add(listener);
    return () => { stateListeners.delete(listener); };
  }, []);

  return { address: activeAddress, isConnected: Boolean(activeProvider && activeAddress) };
};
export const useDisconnect = () => ({
  mutateAsync: async () => {
    activeProvider?.removeListener?.('accountsChanged', setAddress);
    activeProvider = undefined;
    activeAddress = undefined;
    emitState();
  },
});
export const useSignMessage = () => ({
  mutateAsync: async ({ message }: { message: string }) => {
    if (!activeProvider || !activeAddress) throw new Error('Connect MetaMask before signing.');
    const signature = await activeProvider.request({
      method: 'personal_sign',
      params: [message, activeAddress],
    });
    if (typeof signature !== 'string') throw new Error('MetaMask did not return a signature.');
    return signature;
  },
});
export const useSendTransaction = () => ({ sendTransactionAsync: async () => { throw new Error('Browser wallet funding has been retired.'); } });
export const useWriteContract = () => ({ writeContractAsync: async () => { throw new Error('Browser wallet funding has been retired.'); } });
