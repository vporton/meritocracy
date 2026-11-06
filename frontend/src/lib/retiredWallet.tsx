import type { ReactNode } from 'react';

export const WagmiProvider = ({ children }: { children: ReactNode }) => children;
export const useConnection = () => ({ address: undefined as string | undefined, isConnected: false });
export const useDisconnect = () => ({ mutateAsync: async () => undefined });
export const useSignMessage = () => ({ mutateAsync: async () => { throw new Error('Browser wallet signing has been retired.'); } });
export const useSendTransaction = () => ({ sendTransactionAsync: async () => { throw new Error('Browser wallet funding has been retired.'); } });
export const useWriteContract = () => ({ writeContractAsync: async () => { throw new Error('Browser wallet funding has been retired.'); } });
