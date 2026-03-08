type WalletNamespace = 'eip155' | 'solana' | 'bip122';

type AppKitOpenOptions = {
  view?: 'Connect';
  namespace?: WalletNamespace;
};

type WalletAccount = {
  namespace: WalletNamespace;
  type?: string;
  address?: string;
};

type AppKitAccountState = {
  address?: string;
  allAccounts: WalletAccount[];
};

type AppKitState = {
  open: boolean;
  loading: boolean;
  connectingWallet?: { name?: string };
  initialized: boolean;
  activeChain?: string;
};

type AppKitEventsState = {
  timestamp?: number;
  data?: unknown;
  pendingEvents?: unknown[];
  walletImpressions?: unknown[];
  reportedErrors?: unknown[];
};

export const useAppKit = () => ({
  open: async (_options?: AppKitOpenOptions) => undefined,
});

export const useAppKitState = (): AppKitState => ({
  open: false,
  loading: false,
  connectingWallet: undefined,
  initialized: false,
  activeChain: undefined,
});

export const useAppKitEvents = (): AppKitEventsState => ({
  timestamp: undefined,
  data: undefined,
  pendingEvents: [],
  walletImpressions: [],
  reportedErrors: [],
});

export const useAppKitAccount = (_options: { namespace: WalletNamespace }): AppKitAccountState => ({
  address: undefined,
  allAccounts: [],
});

export const AlertController = {
  state: {
    open: false,
    message: '',
  },
  subscribeKey: (_key: 'message' | 'open', _callback: () => void) => () => undefined,
};
