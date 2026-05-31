import { useState, useEffect, FormEvent, ChangeEvent, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAppKit, useAppKitAccount, useAppKitEvents, useAppKitState } from '@reown/appkit/react';
import { AlertController } from '@reown/appkit-controllers';
import { useConnection, useDisconnect, useSignMessage } from 'wagmi';
import { isAddress } from 'ethers';
import { useAuth } from '../contexts/AuthContext';
import api, { User, authApi, usersApi, API_BASE_URL } from '../services/api';
import { NonEvmAddressInput, validateNonEvmAddresses } from '../utils/addressValidation';
import './ConnectForm.css';
import Canonical from './Canonical';
import { Helmet } from 'react-helmet-async';
import { hasReownWalletModal } from '../config/wagmi';
import { getFrontendOrigin } from '../config/origins';

interface ConnectStatus {
  [provider: string]: string | undefined;
  error?: string;
}

interface DisplayProvider {
  name: string;
  value: string;
  displayValue: string;
  isBlockchain: boolean;
}

interface OAuthClientIds {
  github: string;
  orcid: string;
  bitbucket: string;
  gitlab: string;
}

interface OAuthRedirectUris {
  github: string;
  orcid: string;
  bitbucket: string;
  gitlab: string;
}

interface OAuthAuthUrls {
  github: string;
  orcid: string;
  bitbucket: string;
  gitlab: string;
}

interface MessageEvent {
  origin: string;
  data: {
    type: string;
    provider: string;
    authData?: {
      user: User;
      session: {
        token: string;
        expiresAt: string;
      };
    };
    error?: string;
  };
}

interface SolanaPublicKey {
  toBase58(): string;
}

interface SolanaWalletProvider {
  publicKey?: SolanaPublicKey;
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  isMetaMask?: boolean;
  providers?: SolanaWalletProvider[];
  connect?: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: SolanaPublicKey } | void>;
  request?: (args: { method: string; params?: unknown }) => Promise<{ publicKey?: SolanaPublicKey } | string | void>;
}

interface SolanaWindow extends Window {
  backpack?: SolanaWalletProvider | { solana?: SolanaWalletProvider };
  phantom?: { solana?: SolanaWalletProvider };
  solana?: SolanaWalletProvider;
  solflare?: SolanaWalletProvider | { solana?: SolanaWalletProvider };
}

interface SolanaWalletOption {
  id: string;
  label: string;
  provider: SolanaWalletProvider;
}

type AddressFormValues = {
  ethereumAddress: string;
} & Record<keyof NonEvmAddressInput, string>;

type AddressFormErrors = Partial<Record<keyof AddressFormValues, string>>;

const ADDRESS_FORM_FIELDS: (keyof AddressFormValues)[] = [
  'ethereumAddress',
  'solanaAddress',
  'bitcoinAddress',
  'bitcoinCashAddress',
  'polkadotAddress',
  'cosmosAddress',
  'stellarAddress',
  'icpAddress',
];

const getEmptyAddressForm = (): AddressFormValues => ({
  ethereumAddress: '',
  solanaAddress: '',
  bitcoinAddress: '',
  bitcoinCashAddress: '',
  polkadotAddress: '',
  cosmosAddress: '',
  stellarAddress: '',
  icpAddress: '',
});

const getEmptyWalletAutofillState = (initial?: Partial<Record<'solanaAddress' | 'bitcoinAddress', string>>) => ({
  solanaAddress: initial?.solanaAddress ?? '',
  bitcoinAddress: initial?.bitcoinAddress ?? '',
});

const getEmptyWalletAutofillSuppressionState = (
  initial?: Partial<Record<'solanaAddress' | 'bitcoinAddress', boolean>>
) => ({
  solanaAddress: initial?.solanaAddress ?? false,
  bitcoinAddress: initial?.bitcoinAddress ?? false,
});

const BLOCKCHAIN_PROVIDER_NAMES = new Set([
  'Ethereum',
  'Solana',
  'Bitcoin',
  'Bitcoin Cash',
  'Polkadot',
  'Cosmos',
  'Stellar',
  'ICP',
]);

const SHORT_ADDRESS_HEAD = 6;
const SHORT_ADDRESS_TAIL = 4;

const shortenAddress = (address: string) => {
  const normalized = address.trim();
  if (normalized.length <= SHORT_ADDRESS_HEAD + SHORT_ADDRESS_TAIL + 1) {
    return normalized;
  }
  return `${normalized.slice(0, SHORT_ADDRESS_HEAD)}…${normalized.slice(-SHORT_ADDRESS_TAIL)}`;
};

const copyTextToClipboard = async (text: string) => {
  const value = text.trim();
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value);
  }

  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Clipboard is not available'));
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const successful = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!successful) {
    return Promise.reject(new Error('Fallback copy command failed'));
  }

  return Promise.resolve();
};

const serializeDebugData = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
};

/* TODO@P3 White-screen bug in production: disabling Solana/Bitcoin wallet autofill helpers until we can fix the crash.
const normalizeSolanaProvider = (value: unknown): SolanaWalletProvider | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const provider = value as SolanaWalletProvider | { solana?: SolanaWalletProvider };
  return provider.solana ?? (provider as SolanaWalletProvider);
};

const canConnectSolanaProvider = (provider?: SolanaWalletProvider): provider is SolanaWalletProvider => {
  return Boolean(provider && (typeof provider.connect === 'function' || typeof provider.request === 'function'));
};

const getSolanaWalletLabel = (id: string, provider?: SolanaWalletProvider): string => {
  if (provider?.isMetaMask) {
    return 'MetaMask';
  }

  if (provider?.isPhantom) {
    return 'Phantom';
  }

  if (provider?.isSolflare) {
    return 'Solflare';
  }

  if (provider?.isBackpack) {
    return 'Backpack';
  }

  return id;
};

const getInjectedSolanaWallets = (): SolanaWalletOption[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  const solanaWindow = window as SolanaWindow;
  const rootProvider = normalizeSolanaProvider(solanaWindow.solana);
  const candidateEntries: Array<{ id: string; provider?: SolanaWalletProvider }> = [
    { id: 'MetaMask', provider: rootProvider?.isMetaMask ? rootProvider : undefined },
    { id: 'Phantom', provider: normalizeSolanaProvider(solanaWindow.phantom) },
    { id: 'Solflare', provider: normalizeSolanaProvider(solanaWindow.solflare) },
    { id: 'Backpack', provider: normalizeSolanaProvider(solanaWindow.backpack) },
    { id: 'Injected Solana', provider: rootProvider },
  ];

  for (const [index, provider] of (rootProvider?.providers ?? []).entries()) {
    candidateEntries.push({
      id: `Injected Solana ${index + 1}`,
      provider,
    });
  }

  const seenProviders = new Set<SolanaWalletProvider>();

  return candidateEntries.flatMap(candidate => {
    if (!canConnectSolanaProvider(candidate.provider) || seenProviders.has(candidate.provider)) {
      return [];
    }

    seenProviders.add(candidate.provider);

    return [{
      id: candidate.id,
      label: getSolanaWalletLabel(candidate.id, candidate.provider),
      provider: candidate.provider,
    }];
  });
};

const selectInjectedSolanaWallet = (wallets: SolanaWalletOption[]): SolanaWalletOption | null => {
  if (wallets.length === 0) {
    return null;
  }

  if (wallets.length === 1 || typeof window === 'undefined') {
    return wallets[0];
  }

  const choices = wallets.map((wallet, index) => `${index + 1}. ${wallet.label}`).join('\n');
  const selection = window.prompt(`Choose a Solana wallet:\n${choices}`, '1');
  if (selection === null) {
    return null;
  }

  const selectedIndex = Number.parseInt(selection, 10) - 1;
  return wallets[selectedIndex] ?? null;
};

const connectInjectedSolanaWallet = async (): Promise<string | null> => {
  const wallets = getInjectedSolanaWallets();
  const selectedWallet = selectInjectedSolanaWallet(wallets);
  if (!selectedWallet) {
    return null;
  }

  const { provider } = selectedWallet;
  const result = provider.connect
    ? await provider.connect()
    : await provider.request?.({ method: 'connect' });
  const resultPublicKey = typeof result === 'string' ? result : result?.publicKey;
  const publicKey = resultPublicKey ?? provider.publicKey;

  if (!publicKey) {
    return null;
  }

  return typeof publicKey === 'string' ? publicKey : publicKey.toBase58();
};
*/

const ConnectForm = () => {
  const { login, registerEmail, resendVerification, isLoading, isAuthenticated, user, refreshUser, updateAuthData } = useAuth();
  const navigate = useNavigate();
  const { open: openAppKit } = useAppKit();
  const { open: isAppKitOpen, loading: isAppKitLoading, connectingWallet, initialized: isAppKitInitialized, activeChain } = useAppKitState();
  const appKitEvents = useAppKitEvents();
  const solanaAccount = useAppKitAccount({ namespace: 'solana' });
  const bitcoinAccount = useAppKitAccount({ namespace: 'bip122' });
  const { address, isConnected } = useConnection();
  const { mutateAsync: disconnectWalletAsync } = useDisconnect();
  const { mutateAsync: signWalletMessageAsync } = useSignMessage();
  const [searchParams] = useSearchParams();
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>({});
  const [emailForm, setEmailForm] = useState({ email: '', name: '' });
  const [showEmailForm, setShowEmailForm] = useState(false);
  const kycTokenParam = searchParams.get('kycToken') || '';
  const [addressForm, setAddressForm] = useState<AddressFormValues>(getEmptyAddressForm());
  const addressFormRef = useRef<AddressFormValues>(getEmptyAddressForm());
  const [addressErrors, setAddressErrors] = useState<AddressFormErrors>({});
  const walletAutofillRef = useRef(getEmptyWalletAutofillState());
  const walletAutofillSuppressedRef = useRef(getEmptyWalletAutofillSuppressionState());
  const persistAddressFormRef = useRef<((overrides?: Partial<AddressFormValues>) => Promise<boolean>) | null>(null);
  const [copiedProvider, setCopiedProvider] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingWalletAuth, setPendingWalletAuth] = useState(false);
  const [appKitAlertMessage, setAppKitAlertMessage] = useState('');
  const [votingPleaUpdating, setVotingPleaUpdating] = useState(false);
  const [votingPleaError, setVotingPleaError] = useState<string | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const userEmails = user?.emails?.length
    ? user.emails
    : user?.email
      ? [{ email: user.email, verified: !!user.emailVerified, createdAt: user.createdAt, updatedAt: user.updatedAt }]
      : [];
  const verifiedEmails = userEmails.filter(email => email.verified);
  const pendingEmails = userEmails.filter(email => !email.verified);

  // Handle Ethereum connection flow when address becomes available
  useEffect(() => {
    const handleAuthentication = async () => {
      // Only proceed if we're waiting for wallet auth and have a connected address
      if (!pendingWalletAuth || !isConnected || !address) {
        return;
      }

      console.log('Wallet connected, proceeding with authentication...', { address, isConnected });

      try {
        // Clear the pending flag immediately to prevent re-entry
        setPendingWalletAuth(false);
        setConnectStatus(prev => ({ ...prev, ethereum: 'signing' }));

        // Request signature
        const message = `Connect to Meritocracy platform with address: ${address}`;
        console.log('Requesting signature for message:', message);

        const signature = await signWalletMessageAsync({ message });
        console.log('Signature received:', signature ? 'yes' : 'no');

        if (!signature) {
          throw new Error('Signature was cancelled');
        }

        // Authenticate with backend
        setConnectStatus(prev => ({ ...prev, ethereum: 'authenticating' }));
        console.log('Authenticating with backend...');

        const authResult = await login({
          ethereumAddress: address,
          signature,
          message
        }, 'ethereum');

        console.log('Authentication result:', authResult);

        if (authResult.success) {
          setConnectStatus(prev => ({ ...prev, ethereum: 'success' }));
          setTimeout(() => setConnectStatus(prev => {
            const { ethereum, ...rest } = prev;
            return rest;
          }), 2000);
        } else {
          setConnectStatus(prev => ({ ...prev, ethereum: 'error', error: authResult.error }));
        }
      } catch (error: any) {
        console.error('Authentication error:', error);
        if (error.message.includes('rejected') || error.message.includes('cancelled')) {
          setConnectStatus(prev => ({ ...prev, ethereum: 'cancelled' }));
        } else {
          setConnectStatus(prev => ({ ...prev, ethereum: 'error', error: error.message }));
        }
      }
    };

    handleAuthentication();
  }, [pendingWalletAuth, isConnected, address, signWalletMessageAsync, login]);

  useEffect(() => {
    if (connectStatus.ethereum === 'selecting' && isConnected && address) {
      setPendingWalletAuth(true);
    }
  }, [connectStatus.ethereum, isConnected, address]);

  useEffect(() => {
    const syncAlertState = () => {
      setAppKitAlertMessage(AlertController.state.open ? AlertController.state.message : '');
    };

    syncAlertState();
    const unsubscribeMessage = AlertController.subscribeKey('message', syncAlertState);
    const unsubscribeOpen = AlertController.subscribeKey('open', syncAlertState);

    return () => {
      unsubscribeMessage();
      unsubscribeOpen();
    };
  }, []);

  useEffect(() => {
    if (!hasReownWalletModal) {
      return;
    }

    console.log('AppKit state update', {
      ethereumStatus: connectStatus.ethereum,
      isAppKitInitialized,
      isAppKitOpen,
      isAppKitLoading,
      connectingWallet: connectingWallet?.name,
      activeChain,
      isConnected,
      address,
      alert: appKitAlertMessage || undefined,
    });
  }, [
    connectStatus.ethereum,
    isAppKitInitialized,
    isAppKitOpen,
    isAppKitLoading,
    connectingWallet,
    activeChain,
    isConnected,
    address,
    appKitAlertMessage,
  ]);

  useEffect(() => {
    if (!hasReownWalletModal || !appKitEvents.timestamp) {
      return;
    }

    console.log('AppKit event update', {
      timestamp: appKitEvents.timestamp,
      data: appKitEvents.data,
      pendingEvents: appKitEvents.pendingEvents,
      walletImpressions: appKitEvents.walletImpressions,
      reportedErrors: appKitEvents.reportedErrors,
    });
  }, [appKitEvents, appKitEvents.timestamp]);

  useEffect(() => {
    const nextAddressForm = user ? {
      ethereumAddress: user.ethereumAddress ?? '',
      solanaAddress: user.solanaAddress ?? '',
      bitcoinAddress: user.bitcoinAddress ?? '',
      bitcoinCashAddress: user.bitcoinCashAddress ?? '',
      polkadotAddress: user.polkadotAddress ?? '',
      cosmosAddress: user.cosmosAddress ?? '',
      stellarAddress: user.stellarAddress ?? '',
      icpAddress: user.icpAddress ?? '',
    } : getEmptyAddressForm();

    addressFormRef.current = nextAddressForm;

    if (user) {
      setAddressForm(nextAddressForm);
    } else {
      setAddressForm(nextAddressForm);
    }
    setAddressErrors({});
    setConnectStatus(prev => {
      const { addresses, ...rest } = prev;
      return rest;
    });
    walletAutofillRef.current = getEmptyWalletAutofillState({
      solanaAddress: user?.solanaAddress?.trim(),
      bitcoinAddress: user?.bitcoinAddress?.trim(),
    });
    walletAutofillSuppressedRef.current = getEmptyWalletAutofillSuppressionState();
  }, [user]);

  const syncWalletAddressField = (field: 'solanaAddress' | 'bitcoinAddress', nextValue?: string): string | undefined => {
    const trimmedValue = nextValue?.trim();
    const previousWalletValue = walletAutofillRef.current[field];

    if (!trimmedValue) {
      walletAutofillRef.current[field] = '';
      return undefined;
    }

    if (walletAutofillSuppressedRef.current[field] && trimmedValue === previousWalletValue) {
      return undefined;
    }

    const currentValue = addressFormRef.current[field].trim();

    walletAutofillRef.current[field] = trimmedValue;

    if (currentValue && currentValue !== previousWalletValue) {
      return undefined;
    }

    if (currentValue === trimmedValue) {
      return undefined;
    }

    const nextForm = {
      ...addressFormRef.current,
      [field]: trimmedValue,
    };

    addressFormRef.current = nextForm;
    setAddressForm(nextForm);

    setAddressErrors(prev => {
      if (!prev[field]) {
        return prev;
      }

      const { [field]: _removed, ...rest } = prev;
      return rest;
    });

    return trimmedValue;
  };

  const bitcoinWalletAddress = bitcoinAccount.allAccounts.find(account => account.namespace === 'bip122' && account.type === 'payment')?.address
    ?? (typeof bitcoinAccount.address === 'string' ? bitcoinAccount.address : undefined);

  const resolveSolanaAccountAddress = () => {
    const injected = typeof solanaAccount.address === 'string' && solanaAccount.address.trim()
      ? solanaAccount.address.trim()
      : undefined;
    if (injected) {
      return injected;
    }

    const fallback = solanaAccount.allAccounts.find(account => account.namespace === 'solana' && account.address);
    return fallback?.address?.trim() || undefined;
  };

  useEffect(() => {
    const effectiveAddress = resolveSolanaAccountAddress();
    const updatedValue = syncWalletAddressField('solanaAddress', effectiveAddress);
    if (user && updatedValue) {
      void persistAddressFormRef.current?.({ solanaAddress: updatedValue });
    }
  }, [solanaAccount.address, solanaAccount.allAccounts, user]);

  useEffect(() => {
    const updatedValue = syncWalletAddressField('bitcoinAddress', bitcoinWalletAddress);
    if (user && updatedValue) {
      void persistAddressFormRef.current?.({ bitcoinAddress: updatedValue });
    }
  }, [bitcoinWalletAddress, user]);

  // Scroll to email form when it's shown
  useEffect(() => {
    if (showEmailForm) {
      const element = document.getElementById('email-form-section');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [showEmailForm]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyAddress = async (value: string, providerName: string) => {
    try {
      await copyTextToClipboard(value);
      setCopiedProvider(providerName);

      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }

      copyTimeoutRef.current = setTimeout(() => {
        setCopiedProvider(prev => (prev === providerName ? null : prev));
      }, 2000);
    } catch (error) {
      console.error('Failed to copy address to clipboard:', error);
    }
  };

  // Show connected status and allow connecting more accounts
  const renderConnectedStatus = () => {
    if (!isAuthenticated || !user) {
      return null;
    }

    const connectedProviders: DisplayProvider[] = [];

    const addProvider = (
      name: string,
      rawValue: string,
      options: { isBlockchain?: boolean; displayValue?: string } = {}
    ) => {
      const trimmedValue = rawValue.trim();
      if (!trimmedValue) {
        return;
      }

      const isBlockchainProvider = options.isBlockchain ?? BLOCKCHAIN_PROVIDER_NAMES.has(name);
      connectedProviders.push({
        name,
        value: trimmedValue,
        displayValue: options.displayValue ?? (isBlockchainProvider ? shortenAddress(trimmedValue) : trimmedValue),
        isBlockchain: isBlockchainProvider,
      });
    };

    if (user.ethereumAddress) addProvider('Ethereum', user.ethereumAddress);
    if (user.solanaAddress) addProvider('Solana', user.solanaAddress);
    if (user.bitcoinAddress) addProvider('Bitcoin', user.bitcoinAddress);
    if (user.bitcoinCashAddress) addProvider('Bitcoin Cash', user.bitcoinCashAddress);
    if (user.polkadotAddress) addProvider('Polkadot', user.polkadotAddress);
    if (user.cosmosAddress) addProvider('Cosmos', user.cosmosAddress);
    if (user.stellarAddress) addProvider('Stellar', user.stellarAddress);
    if (user.icpAddress) addProvider('ICP', user.icpAddress);
    if (user.orcidId) addProvider('ORCID', user.orcidId);
    if (user.githubHandle) addProvider('GitHub', user.githubHandle);
    if (user.bitbucketHandle) addProvider('BitBucket', user.bitbucketHandle);
    if (user.gitlabHandle) addProvider('GitLab', user.gitlabHandle);
    if (userEmails.length > 0) {
      const emailDisplay = userEmails
        .map(email => `${email.email} ${email.verified ? '✓' : '⚠️'}`)
        .join(', ');
      addProvider('Emails', emailDisplay, { isBlockchain: false, displayValue: emailDisplay });
    }
    if (user.kycStatus === 'APPROVED' || user.kycStatus === 'PENDING') {
      addProvider('Receiver KYC', 'APPROVED ✓', { isBlockchain: false });
    }
    if (user.kycVotingStatus === 'APPROVED' || user.kycVotingStatus === 'PENDING') {
      addProvider('Voting KYC', 'APPROVED ✓', { isBlockchain: false });
    }

    return (
      <div className="connected-status">
        <h3>✅ Connected Accounts</h3>
        {user.onboarded ? (
          <div className="onboarded-notice">
            <p><strong>🎉 Onboarding Complete!</strong></p>
            <p>You have successfully completed the onboarding process. You can still connect additional accounts below.</p>
          </div>
        ) : (
          <p>You are successfully authenticated. You can connect additional accounts below.</p>
        )}
        <div className="connected-user-info">
          <strong>Current user:</strong> {user?.id}: {user?.name || 'User'}
        </div>
        {connectedProviders.length > 0 && (
          <div className="connected-providers">
            <h4>Connected Services:</h4>
            <ul>
              {connectedProviders.map((provider, index) => (
                <li key={`${provider.name}-${index}`} className="connected-provider-item">
                  <div className="provider-value">
                    <strong>{provider.name}:</strong>
                    <span
                      title={provider.isBlockchain ? provider.value : undefined}
                      aria-label={provider.isBlockchain ? provider.value : undefined}
                    >
                      {provider.displayValue}
                    </span>
                  </div>
                  {provider.isBlockchain && (
                    <button
                      type="button"
                      className="copy-address-button"
                      onClick={() => handleCopyAddress(provider.value, provider.name)}
                      title={`Copy ${provider.name} address`}
                    >
                      {copiedProvider === provider.name ? 'Copied!' : 'Copy'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const renderVotingPleaPreference = () => {
    if (!isAuthenticated || !user) {
      return null;
    }

    const isSubscribed = !user.votingPleaUnsubscribed;

    return (
      <div className="voting-plea-preference">
        <h3>🗳️ Voting Pleas</h3>
        <p className="preference-description">
          {isSubscribed
            ? 'We will email you once when a ban or unban vote is opened so you can weigh in.'
            : 'You have opted out of voting plea emails. You can re-subscribe at any time.'}
        </p>
        <p className="voting-plea-warning">
          If you don’t vote, scammers can take all your money.
        </p>
        <button
          type="button"
          onClick={handleVotingPleaToggle}
          disabled={votingPleaUpdating}
          className="voting-plea-button"
        >
          {votingPleaUpdating
            ? 'Updating...'
            : isSubscribed ? 'Unsubscribe from voting pleas' : 'Resubscribe to voting pleas'}
        </button>
        {votingPleaError && (
          <p className="error-message voting-plea-error">{votingPleaError}</p>
        )}
      </div>
    );
  };

  // Helper function to disconnect a provider
  const handleDisconnect = async (provider: string, payload?: Record<string, unknown>) => {
    try {
      setConnectStatus(prev => ({ ...prev, [provider]: 'disconnecting' }));

      const response = await authApi.disconnectProvider(provider, payload);
      if (provider === 'ethereum' && isConnected) {
        await disconnectWalletAsync();
      }
      if (response.data.user) {
        await refreshUser();
        setConnectStatus(prev => {
          const { [provider]: _, ...rest } = prev;
          return rest;
        }); // Clear the provider's status
      }
    } catch (error: any) {
      console.error('Disconnect error:', error);
      setConnectStatus(prev => ({ ...prev, [provider]: 'error', error: error.response?.data?.error || error.message }));
    }
  };

  const handleVotingPleaToggle = async () => {
    if (!user) return;
    setVotingPleaError(null);
    setVotingPleaUpdating(true);
    try {
      await usersApi.update(user.id, {
        votingPleaUnsubscribed: !user.votingPleaUnsubscribed
      });
      await refreshUser();
    } catch (error: any) {
      console.error('Voting plea preference update failed:', error);
      setVotingPleaError(error.response?.data?.error || error.message || 'Failed to update voting preferences');
    } finally {
      setVotingPleaUpdating(false);
    }
  };

  // Ethereum/Web3 Connect - show wallet selection
  const handleEthereumConnect = async () => {
    console.log('Ethereum connect button clicked!');
    console.log('Current state:', { isConnected, isProviderConnected: isProviderConnected('ethereum') });

    // Check if already connected to our platform and user wants to disconnect
    if (isProviderConnected('ethereum')) {
      console.log('Already connected to platform, disconnecting...');
      return handleDisconnect('ethereum');
    }

    try {
      if (isConnected && address) {
        console.log('Wallet already connected, proceeding with authentication...');
        setPendingWalletAuth(true);
        return;
      }

      if (!hasReownWalletModal) {
        setConnectStatus(prev => ({
          ...prev,
          ethereum: 'error',
          error: 'Wallet connection is not configured. Set VITE_WALLETCONNECT_PROJECT_ID to enable Reown.'
        }));
        return;
      }

      setAppKitAlertMessage('');
      setConnectStatus(prev => ({ ...prev, ethereum: 'selecting' }));
      console.log('Opening Reown wallet chooser...');
      await openAppKit({ view: 'Connect', namespace: 'eip155' });
    } catch (error: any) {
      console.error('Wallet selection error:', error);
      if (error.message.includes('rejected') || error.message.includes('cancelled')) {
        setConnectStatus(prev => ({ ...prev, ethereum: 'cancelled' }));
      } else {
        setConnectStatus(prev => ({ ...prev, ethereum: 'error', error: error.message }));
      }
    }
  };

  // OAuth Connect Handler
  const handleOAuthConnect = (provider: string) => {
    // Check if already connected and user wants to disconnect
    if (isProviderConnected(provider)) {
      return handleDisconnect(provider);
    }
    const clientIds: OAuthClientIds = {
      github: (import.meta.env.VITE_GITHUB_CLIENT_ID || '').trim(),
      orcid: (import.meta.env.VITE_ORCID_CLIENT_ID || '').trim(),
      bitbucket: (import.meta.env.VITE_BITBUCKET_CLIENT_ID || '').trim(),
      gitlab: (import.meta.env.VITE_GITLAB_CLIENT_ID || '').trim(),
    };

    // Get current user's token to include in OAuth state parameter for user linking
    const currentToken = localStorage.getItem('authToken');
    const stateParam = currentToken ? encodeURIComponent(currentToken) : '';

    console.log(`${provider} OAuth: currentToken ${currentToken ? 'present' : 'missing'}, stateParam: ${stateParam ? 'included' : 'not included'}`);

    const redirectUris: OAuthRedirectUris = {
      github: `${API_BASE_URL}/api/auth/github/callback`,
      orcid: `${API_BASE_URL}/api/auth/orcid/callback`,
      bitbucket: `${API_BASE_URL}/api/auth/bitbucket/callback`,
      gitlab: `${API_BASE_URL}/api/auth/gitlab/callback`,
    };

    const authUrls: OAuthAuthUrls = {
      github: `https://github.com/login/oauth/authorize?client_id=${clientIds.github}&redirect_uri=${encodeURIComponent(redirectUris.github)}&scope=&state=${stateParam}`,
      orcid: `https://${import.meta.env.VITE_ORCID_DOMAIN}/oauth/authorize?client_id=${clientIds.orcid}&response_type=code&scope=/authenticate&redirect_uri=${encodeURIComponent(redirectUris.orcid)}&state=${stateParam}`,
      bitbucket: `https://bitbucket.org/site/oauth2/authorize?client_id=${clientIds.bitbucket}&response_type=code&redirect_uri=${encodeURIComponent(redirectUris.bitbucket)}&state=${stateParam}`,
      gitlab: `https://gitlab.com/oauth/authorize?client_id=${clientIds.gitlab}&redirect_uri=${encodeURIComponent(redirectUris.gitlab)}&response_type=code&scope=${encodeURIComponent('read_user openid')}&state=${stateParam}`,
    };

    if (!clientIds[provider as keyof OAuthClientIds]) {
      alert(`${provider.toUpperCase()} client ID not configured`);
      return;
    }

    // Open OAuth flow in popup window
    const popup = window.open(
      authUrls[provider as keyof OAuthAuthUrls],
      `${provider}_oauth`,
      'width=600,height=600,scrollbars=yes,resizable=yes'
    );

    if (!popup) {
      alert('Popup was blocked. Please allow popups for this site.');
      return;
    }

    // Track if we've received a proper response (to avoid race condition)
    let hasReceivedResponse = false;

    // Listen for the OAuth callback
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        console.log(`${provider} popup closed. hasReceivedResponse:`, hasReceivedResponse);
        clearInterval(checkClosed);
        // Only mark as cancelled if we didn't receive a proper response
        if (!hasReceivedResponse) {
          console.log(`${provider} marked as cancelled - no response received`);
          setConnectStatus(prev => ({ ...prev, [provider]: 'cancelled' }));
        }
      }
    }, 1000);

    // Handle the OAuth callback message
    const handleMessage = async (event: MessageEvent) => {
      console.log(`XXX Message received for ${provider}:`, {
        origin: event.origin,
        expectedOrigin: window.location.origin,
        data: event.data,
        hasType: event.data?.type
      });

      if (event.origin !== window.location.origin) {
        console.log(`XXX Message origin mismatch for ${provider}, ignoring`);
        return;
      }

      // Only process OAuth-related messages, ignore other messages (like MetaMask)
      if (!event.data || typeof event.data !== 'object' || !event.data.type) {
        console.log(`XXX Message has no type for ${provider}, ignoring`);
        return;
      }

      // Only log actual OAuth messages
      if (event.data.type === 'OAUTH_SUCCESS' || event.data.type === 'OAUTH_ERROR') {
        console.log(`XXX OAuth message received for ${provider}:`, event.data);
      }

      if (event.data.type === 'OAUTH_SUCCESS' && event.data.provider === provider) {
        hasReceivedResponse = true;
        clearInterval(checkClosed);
        // Don't close popup here - let the popup close itself

        try {
          console.log(`OAuth success for ${provider}:`, event.data);
          setConnectStatus(prev => ({ ...prev, [provider]: 'success' }));

          // The backend already handled authentication, just update the frontend state
          const { user, session } = event.data.authData!;

          console.log(`Updating auth data for ${provider}:`, {
            user: {
              id: user.id,
              githubHandle: user.githubHandle,
              orcidId: user.orcidId,
              ethereumAddress: user.ethereumAddress,
              bitbucketHandle: user.bitbucketHandle,
              gitlabHandle: user.gitlabHandle
            },
            sessionToken: session.token ? 'present' : 'missing'
          });

          // Update AuthContext with the new user and session
          updateAuthData(user, session.token);

          console.log(`Auth data updated for ${provider}, clearing status in 2 seconds`);

          // Reset status after a short delay to allow connecting more accounts
          // Use a longer delay to ensure React state has updated
          setTimeout(() => {
            console.log(`Clearing status for ${provider}`);
            setConnectStatus(prev => {
              const { [provider]: _, ...rest } = prev;
              return rest;
            });
          }, 2000);
        } catch (error: any) {
          console.error(`Error in OAuth success handler for ${provider}:`, error);
          setConnectStatus(prev => ({ ...prev, [provider]: 'error', error: error.message }));
        }

        window.removeEventListener('message', handleMessage as any);
      } else if (event.data.type === 'OAUTH_ERROR' && event.data.provider === provider) {
        hasReceivedResponse = true;
        clearInterval(checkClosed);
        // Don't close popup here - let the popup close itself
        setConnectStatus(prev => ({ ...prev, [provider]: 'error', error: event.data.error }));
        window.removeEventListener('message', handleMessage as any);
      }
    };

    window.addEventListener('message', handleMessage as any);
  };

  // Auto-initiate Receiver KYC if token is present
  useEffect(() => {
    const autoHandleReceiverKyc = async () => {
      // If no token or already "started" handled by status checks mostly,
      // but strictly we only want to run if we have a token.
      if (!kycTokenParam) return;

      // Prevent re-entry if already connecting/success/error
      // Note: 'error' state might prevent retrying if page not refreshed, which is probably fine.
      if (connectStatus.kyc) return;

      try {
        setConnectStatus(prev => ({ ...prev, kyc: 'connecting' }));
        console.log('Auto-initiating Receiver KYC with token:', kycTokenParam);

        // initiateKyc with token implies Receiver KYC
        const response = await authApi.initiateKyc(kycTokenParam);
        const data = response.data;

        // Check if KYC was skipped
        if (data.skipped) {
          console.log('KYC was skipped - automatically verified');

          // If we got a session back (for unauthenticated users), update auth context
          if (data.session && data.user) {
            console.log('KYC created new session for unauthenticated user');
            updateAuthData(data.user, data.session.token);
          } else {
            // Refresh user data to get updated KYC status
            await refreshUser();
          }

          setConnectStatus(prev => ({ ...prev, kyc: 'success' }));

          // Reset status after a delay
          setTimeout(() => {
            setConnectStatus(prev => {
              const { kyc, ...rest } = prev;
              return rest;
            });
          }, 3000);
        } else if (data.url) {
          // If we got a session back (for unauthenticated users), update auth context
          if (data.session && data.user) {
            console.log('KYC created new session for unauthenticated user');
            updateAuthData(data.user, data.session.token);
          }

          // Open KYC URL in new tab 
          // Redirect to KYC URL in the same tab to avoid popup blockers and provide seamless flow
          window.location.href = data.url;
          setConnectStatus(prev => ({ ...prev, kyc: 'success' }));

          // Reset status after a delay
          setTimeout(() => {
            setConnectStatus(prev => {
              const { kyc, ...rest } = prev;
              return rest;
            });
          }, 3000);
        } else {
          throw new Error('No KYC URL received');
        }
      } catch (error: any) {
        console.error('KYC connection error:', error);
        setConnectStatus(prev => ({ ...prev, kyc: 'error', error: error.message }));
      }
    };

    autoHandleReceiverKyc();
  }, [kycTokenParam, connectStatus.kyc, updateAuthData, refreshUser]);


  // Voting KYC connection handler
  const handleVotingKycConnect = async () => {
    // Check if already connected and user wants to disconnect
    if (isProviderConnected('votingKyc')) {
      return handleDisconnect('votingKyc'); // Check if backend supports this for votingKyc
    }

    try {
      setConnectStatus(prev => ({ ...prev, votingKyc: 'connecting' }));

      // initiateKyc without token implies Voting KYC for authenticated user
      const response = await authApi.initiateKyc();
      const data = response.data;

      // Check if KYC was skipped
      if (data.skipped) {
        console.log('Voting KYC was skipped - automatically verified');
        await refreshUser();
        setConnectStatus(prev => ({ ...prev, votingKyc: 'success' }));
        setTimeout(() => {
          setConnectStatus(prev => {
            const { votingKyc, ...rest } = prev;
            return rest;
          });
        }, 3000);
      } else if (data.url) {
        window.open(data.url, '_blank');
        setConnectStatus(prev => ({ ...prev, votingKyc: 'success' }));
        setTimeout(() => {
          setConnectStatus(prev => {
            const { votingKyc, ...rest } = prev;
            return rest;
          });
        }, 3000);
      } else {
        throw new Error('No KYC URL received');
      }
    } catch (error: any) {
      console.error('Voting KYC connection error:', error);
      setConnectStatus(prev => ({ ...prev, votingKyc: 'error', error: error.message }));
      setTimeout(() => {
        setConnectStatus(prev => {
          const { votingKyc, ...rest } = prev;
          return rest;
        });
      }, 5000);
    }
  };

  // Email connection handler
  const handleEmailConnect = async () => {
    if (!showEmailForm) {
      setShowEmailForm(true);
      return;
    }

    if (!emailForm.email.trim()) {
      setConnectStatus(prev => ({ ...prev, email: 'error', error: 'Email is required' }));
      return;
    }

    try {
      setConnectStatus(prev => ({ ...prev, email: 'connecting' }));

      const result = await registerEmail(emailForm.email.trim(), emailForm.name.trim() || undefined);

      if (result.success) {
        // Log the success message to console for debugging
        if (result.message) {
          console.log('Email registration success:', result.message);
        }

        if (result.requiresVerification) {
          // Show "verification sent" status instead of success
          setConnectStatus(prev => ({ ...prev, email: 'verification-sent' }));
          setEmailForm({ email: '', name: '' });
          setShowEmailForm(false);

          // Reset status after a longer delay to give user time to read the message
          setTimeout(() => {
            setConnectStatus(prev => {
              const { email, ...rest } = prev;
              return rest;
            });
          }, 5000);
        } else {
          // Only show success if email is already verified (no verification required)
          setConnectStatus(prev => ({ ...prev, email: 'success' }));
          setEmailForm({ email: '', name: '' });
          setShowEmailForm(false);

          setTimeout(() => setConnectStatus(prev => {
            const { email, ...rest } = prev;
            return rest;
          }), 2000);
        }
      } else {
        setConnectStatus(prev => ({ ...prev, email: 'error', error: result.error }));
      }
    } catch (error: any) {
      console.error('Email connection error:', error);
      setConnectStatus(prev => ({ ...prev, email: 'error', error: error.message }));
    }
  };

  const handleEmailRemove = async (email: string) => {
    await handleDisconnect('email', { email });
  };

  const handleEmailResend = async (email: string) => {
    try {
      setConnectStatus(prev => ({ ...prev, email: 'connecting' }));
      const result = await resendVerification(email);
      if (!result.success) {
        throw new Error(result.error || 'Failed to resend verification email');
      }
      setConnectStatus(prev => ({ ...prev, email: 'verification-sent' }));
      setTimeout(() => {
        setConnectStatus(prev => {
          const { email, ...rest } = prev;
          return rest;
        });
      }, 5000);
    } catch (error: any) {
      setConnectStatus(prev => ({ ...prev, email: 'error', error: error.message }));
    }
  };

  const handleAddressChange = (field: keyof AddressFormValues) => (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    if (field === 'solanaAddress' || field === 'bitcoinAddress') {
      walletAutofillSuppressedRef.current[field] = value.trim() !== walletAutofillRef.current[field];
    }
    const nextForm = {
      ...addressFormRef.current,
      [field]: value,
    };
    addressFormRef.current = nextForm;
    setAddressForm(nextForm);
    setAddressErrors(prev => {
      if (!prev[field]) {
        return prev;
      }
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const persistAddressForm = async (overrides: Partial<AddressFormValues> = {}) => {
    if (!user) {
      setConnectStatus(prev => ({ ...prev, addresses: 'error', error: 'You must be logged in to save addresses' }));
      return false;
    }

    const mergedForm: AddressFormValues = { ...addressFormRef.current, ...overrides };
    const trimmedForm: AddressFormValues = ADDRESS_FORM_FIELDS.reduce<AddressFormValues>((acc, key) => {
      acc[key] = (mergedForm[key] ?? '').trim();
      return acc;
    }, {} as AddressFormValues);

    const validationErrors: AddressFormErrors = {
      ...validateNonEvmAddresses({
        solanaAddress: trimmedForm.solanaAddress,
        bitcoinAddress: trimmedForm.bitcoinAddress,
        bitcoinCashAddress: trimmedForm.bitcoinCashAddress,
        polkadotAddress: trimmedForm.polkadotAddress,
        cosmosAddress: trimmedForm.cosmosAddress,
        stellarAddress: trimmedForm.stellarAddress,
        icpAddress: trimmedForm.icpAddress,
      })
    };

    if (trimmedForm.ethereumAddress && !isAddress(trimmedForm.ethereumAddress)) {
      validationErrors.ethereumAddress = 'Invalid Ethereum address format.';
    }

    if (Object.keys(validationErrors).length > 0) {
      const firstError = Object.values(validationErrors).find(value => value) || 'Please check the address formats.';
      setAddressErrors(validationErrors);
      setConnectStatus(prev => ({ ...prev, addresses: 'error', error: firstError }));
      return false;
    }

    setAddressErrors({});
    setConnectStatus(prev => ({ ...prev, addresses: 'processing', error: undefined }));

    try {
      await usersApi.update(user.id, {
        ethereumAddress: trimmedForm.ethereumAddress || null,
        solanaAddress: trimmedForm.solanaAddress || null,
        bitcoinAddress: trimmedForm.bitcoinAddress || null,
        bitcoinCashAddress: trimmedForm.bitcoinCashAddress || null,
        polkadotAddress: trimmedForm.polkadotAddress || null,
        cosmosAddress: trimmedForm.cosmosAddress || null,
        stellarAddress: trimmedForm.stellarAddress || null,
        icpAddress: trimmedForm.icpAddress || null,
      });

      await refreshUser();
      addressFormRef.current = trimmedForm;
      setAddressForm(trimmedForm);

      walletAutofillRef.current = {
        solanaAddress: trimmedForm.solanaAddress,
        bitcoinAddress: trimmedForm.bitcoinAddress,
      };
      walletAutofillSuppressedRef.current = getEmptyWalletAutofillSuppressionState();

      setConnectStatus(prev => {
        const { error, ...rest } = prev;
        return { ...rest, addresses: 'success' };
      });

      setTimeout(() => {
        setConnectStatus(prev => {
          const { addresses, ...rest } = prev;
          return rest;
        });
      }, 2000);

      return true;
    } catch (error: any) {
      console.error('Address update failed:', error);
      const errorMessage = error?.response?.data?.error || error?.message || 'Failed to save addresses';
      const detailErrors = error?.response?.data?.details;
      if (detailErrors && typeof detailErrors === 'object') {
        const mappedErrors: AddressFormErrors = {};
        for (const key of ADDRESS_FORM_FIELDS) {
          const value = (detailErrors as Record<string, unknown>)[key];
          if (typeof value === 'string') {
            mappedErrors[key] = value;
          }
        }
        if (Object.keys(mappedErrors).length > 0) {
          setAddressErrors(mappedErrors);
        }
      }
      setConnectStatus(prev => ({ ...prev, addresses: 'error', error: errorMessage }));
      return false;
    }
  };

  persistAddressFormRef.current = persistAddressForm;

  const handleAddressesSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    await persistAddressForm();
  };

  /* TODO@P3 White-screen bug in production: disable Solana/Bitcoin wallet connect helper until we can fix the crash.
  const handleWalletAddressConnect = async (
    field: 'solanaAddress' | 'bitcoinAddress',
    namespace: 'solana' | 'bip122'
  ) => {
    walletAutofillSuppressedRef.current[field] = false;

    if (namespace === 'solana') {
      try {
        setConnectStatus(prev => ({ ...prev, addresses: undefined, error: undefined }));
        const injectedSolanaAddress = await connectInjectedSolanaWallet();
        if (injectedSolanaAddress) {
          const updatedValue = syncWalletAddressField(field, injectedSolanaAddress);
          if (user && updatedValue) {
            void persistAddressForm({ [field]: updatedValue });
          }
          return;
        }
      } catch (error: any) {
        setConnectStatus(prev => ({
          ...prev,
          addresses: 'error',
          error: error?.message || 'Failed to connect Solana wallet'
        }));
        return;
      }
    }

    if (!hasReownWalletModal) {
      setConnectStatus(prev => ({
        ...prev,
        addresses: 'error',
        error: 'Wallet connection is not configured. Set VITE_WALLETCONNECT_PROJECT_ID to enable wallet autofill.'
      }));
      return;
    }

    try {
      setConnectStatus(prev => ({ ...prev, addresses: undefined, error: undefined }));
      await openAppKit({ view: 'Connect', namespace });
    } catch (error: any) {
      setConnectStatus(prev => ({
        ...prev,
        addresses: 'error',
        error: error?.message || 'Failed to open wallet selector'
      }));
    }
  };
  */

  // Helper function to check if a provider is connected
  const isProviderConnected = (provider: string): boolean => {
    if (!user) return false;

    const providerFields: Record<string, keyof User> = {
      ethereum: 'ethereumAddress',
      orcid: 'orcidId',
      github: 'githubHandle',
      bitbucket: 'bitbucketHandle',
      gitlab: 'gitlabHandle',
      votingKyc: 'kycVotingStatus'
    };

    if (provider === 'email') {
      return userEmails.length > 0;
    }

    const field = providerFields[provider];
    if (provider === 'votingKyc') {
      return user.kycVotingStatus === 'APPROVED';
    }

    const isConnected = field && user[field] != null && user[field] !== '';

    return isConnected;
  };

  const getButtonText = (provider: string): string => {
    const status = connectStatus[provider];
    const isConnected = isProviderConnected(provider);

    console.log(`Button text for ${provider}:`, { status, isConnected });

    // Map provider names to display names
    const providerDisplayNames: Record<string, string> = {
      ethereum: 'Ethereum',
      orcid: 'ORCID',
      github: 'GitHub',
      bitbucket: 'BitBucket',
      gitlab: 'GitLab',
      email: 'Email',
      votingKyc: 'KYC Level 1 (Voter)'
    };

    const displayName = providerDisplayNames[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);

    // Special handling for email: check verification status
    if (provider === 'email' && !status) {
      return userEmails.length > 0 ? 'Add Email' : 'Connect with Email';
    }

    // Special handling for KYC: show status -> REMOVED
    /*
    if (provider === 'kyc' && !status) {
      if (user?.kycStatus === 'APPROVED') {
        return 'KYC passed';
      } else if (user?.kycStatus === 'PENDING') {
        return 'KYC Pending...';
      } else if (user?.kycStatus === 'REJECTED') {
        return 'Connect Receiver KYC'; 
      }
    }
    */

    if (provider === 'votingKyc' && !status) {
      if (user?.kycVotingStatus === 'APPROVED') {
        return 'KYC Level 1 (Voter) Passed';
      } else if (user?.kycVotingStatus === 'PENDING') {
        return 'KYC Level 1 (Voter) Pending...';
      } else if (user?.kycVotingStatus === 'REJECTED') {
        return 'Connect with KYC Level 1 (Voter)';
      }
    }

    // If connected and no temporary status, show disconnect option
    if (isConnected && !status) {
      return `Disconnect ${displayName}`;
    }

    switch (status) {
      case 'selecting':
        return 'Select Wallet...';
      case 'connecting':
        return 'Connecting...';
      case 'signing':
        return 'Sign Message...';
      case 'authenticating':
        return 'Authenticating...';
      case 'processing':
        return 'Processing...';
      case 'disconnecting':
        return 'Disconnecting...';
      case 'success':
        return 'Success!';
      case 'verification-sent':
        return 'Check Email!';
      case 'error':
        return `Try ${displayName} Again`;
      case 'cancelled':
        return `Try ${displayName} Again`;
      default:
        return `Connect with ${displayName}`;
    }
  };

  const getButtonClass = (provider: string): string => {
    const status = connectStatus[provider];
    const isConnected = isProviderConnected(provider);
    let className = `connect-button ${provider}-button`;

    if (status === 'selecting' || status === 'connecting' || status === 'signing' || status === 'authenticating' || status === 'processing' || status === 'disconnecting') {
      className += ' loading';
    }
    if (status === 'success') className += ' success';
    if (status === 'verification-sent') className += ' verification-sent';
    if (status === 'error') className += ' error';

    // Special handling for email verification status
    if (provider === 'email' && !status) {
      if (pendingEmails.length > 0) {
        className += ' waiting-for-verification';
      } else if (userEmails.length > 0) {
        className += ' connected';
      }
    } else if (provider === 'votingKyc' && !status) {
      if (user?.kycVotingStatus === 'APPROVED') {
        className += ' connected';
      } else if (user?.kycVotingStatus === 'PENDING') {
        className += ' waiting-for-verification';
      } else if (user?.kycVotingStatus === 'REJECTED') {
        className += ' error';
      }
    } else if (isConnected && !status) {
      className += ' connected';
    }

    return className;
  };

  const hasConnectedAccounts = (): boolean => {
    if (!user) return false;

    const hasSocial = !!(user.orcidId || user.githubHandle || user.bitbucketHandle || user.gitlabHandle);
    const hasEmail = verifiedEmails.length > 0;
    const hasEth = !!user.ethereumAddress;

    if (import.meta.env.DEV) {
      return hasEmail && hasEth;
    }

    return hasSocial && hasEmail && hasEth;
  };

  const handleStartEvaluation = async () => {
    if (!user || !isAuthenticated || onboardingLoading || user.onboarded || !hasConnectedAccounts()) {
      return;
    }

    setOnboardingLoading(true);
    try {
      const response = await api.post('/api/evaluation/start', {
        userId: user.id,
        userData: {
          orcidId: user.orcidId,
          githubHandle: user.githubHandle,
          bitbucketHandle: user.bitbucketHandle,
          gitlabHandle: user.gitlabHandle,
          ethereumAddress: user.ethereumAddress,
          email: verifiedEmails[0]?.email,
          emailVerified: verifiedEmails.length > 0,
          emails: verifiedEmails,
        }
      });

      if (response.data.success) {
        await refreshUser();
        navigate('/logs');
      } else {
        alert('Failed to start evaluation. Please try again.');
      }
    } catch (error) {
      console.error('Start evaluation error:', error);
      alert('Failed to start evaluation. Please try again.');
    } finally {
      setOnboardingLoading(false);
    }
  };

  return (
    <div className="connect-form">
      <Helmet>
        <title>Meritocracy App - Connect Your Account and Receive Money</title>
        <meta name="description" content="Meritocracy App - You just connect your accounts (GitHub, ORCID, etc.) and start receiving money." />
      </Helmet>
      <Canonical baseUrl={`${getFrontendOrigin()}/connect`} />
      <h2>Connect to Meritocracy Platform</h2>

      {renderConnectedStatus()}
      {renderVotingPleaPreference()}

      {isAuthenticated && user && !user.onboarded && (
        <div className="evaluation-start-card">
          <p>{hasConnectedAccounts() ? 'All required accounts are connected.' : 'Add the required accounts and an Ethereum address to start evaluation.'}</p>
          <button
            className="connect-button start-evaluation-button"
            onClick={handleStartEvaluation}
            disabled={!hasConnectedAccounts() || onboardingLoading}
          >
            <span className="connect-icon">🚀</span>
            {onboardingLoading ? 'Starting Evaluation...' : 'Start Evaluation'}
          </button>
        </div>
      )}

      <p>You need to connect all accounts with your products (like GitHub for your free software, ORCID for your scientific articles, etc.) <strong>before</strong> the evaluation to receive maximum salary at our site (and, yes, it is completely free, you even don't need to pay for blockchain gas). You also must provide your Ethereum address, either by connecting a wallet or entering it manually.</p>

      <p style={{ color: 'red' }}>Your data won't be deleted (even on request),
        because it may be necessary to sue against you, if you misbehave (hack, DoS, etc. us).</p>

      <p style={{ color: 'red' }}>After connecting your accounts, you need to pass evaluation (the evaluate button will appear at this page){" "}
        to decide, whether the system will pay you and how much.</p>

      {user?.kycStatus !== 'APPROVED' && !kycTokenParam && (
        <p className="kyc-notice">KYC verification will be requested via email once funds are allocated to you.</p>
      )}

      <p style={{ color: 'red' }}>BitBucket is not supported yet.</p>

      <div className="connect-options">
        {/* Ethereum Connect */}
        <button
          className={getButtonClass('ethereum')}
          onClick={() => {
            // If there's an error, clear it and try again
            if (connectStatus.ethereum === 'error') {
              setConnectStatus(prev => {
                const { ethereum, ...rest } = prev;
                return rest;
              });
            }
            handleEthereumConnect();
          }}
          disabled={isLoading || connectStatus.ethereum === 'connecting' || connectStatus.ethereum === 'signing' || connectStatus.ethereum === 'authenticating' || connectStatus.ethereum === 'disconnecting'}
          style={{
            backgroundColor: (isLoading || connectStatus.ethereum === 'connecting' || connectStatus.ethereum === 'signing' || connectStatus.ethereum === 'authenticating' || connectStatus.ethereum === 'disconnecting') ? 'gray' : 'blue',
            cursor: (isLoading || connectStatus.ethereum === 'connecting' || connectStatus.ethereum === 'signing' || connectStatus.ethereum === 'authenticating' || connectStatus.ethereum === 'disconnecting') ? 'not-allowed' : 'pointer'
          }}
        >
          <span className="connect-icon">⟠</span>
          {getButtonText('ethereum')}
        </button>

        {/* Voting KYC Connect - Displayed always */}
        <button
          className={getButtonClass('votingKyc')}
          onClick={handleVotingKycConnect}
          disabled={isLoading || connectStatus.votingKyc === 'connecting' || connectStatus.votingKyc === 'success'}
        >
          <span className="connect-icon">🗳️</span>
          {getButtonText('votingKyc')}
          {connectStatus.votingKyc === 'error' && <span className="error-message">{connectStatus.error}</span>}
        </button>

        {/* ORCID Connect */}
        <button
          className={getButtonClass('orcid')}
          onClick={() => handleOAuthConnect('orcid')}
          disabled={isLoading || connectStatus.orcid === 'processing' || connectStatus.orcid === 'disconnecting'}
        >
          <span className="connect-icon">🎓</span>
          {getButtonText('orcid')}
        </button>

        {/* GitHub Connect */}
        <button
          className={getButtonClass('github')}
          onClick={() => handleOAuthConnect('github')}
          disabled={isLoading || connectStatus.github === 'processing' || connectStatus.github === 'disconnecting'}
        >
          <img src="/github-mark.svg" alt="GitHub" className="connect-icon github-logo" />
          {getButtonText('github')}
        </button>

        {/* BitBucket Connect */}
        <button
          className={getButtonClass('bitbucket')}
          onClick={() => handleOAuthConnect('bitbucket')}
          disabled={isLoading || connectStatus.bitbucket === 'processing' || connectStatus.bitbucket === 'disconnecting'}
        >
          <span className="connect-icon">🪣</span>
          {getButtonText('bitbucket')}
        </button>

        {/* GitLab Connect */}
        <button
          className={getButtonClass('gitlab')}
          onClick={() => handleOAuthConnect('gitlab')}
          disabled={isLoading || connectStatus.gitlab === 'processing' || connectStatus.gitlab === 'disconnecting'}
        >
          <span className="connect-icon">🦊</span>
          {getButtonText('gitlab')}
        </button>

        {/* Email Connect */}
        <button
          className={getButtonClass('email')}
          onClick={handleEmailConnect}
          disabled={isLoading || connectStatus.email === 'connecting' || connectStatus.email === 'disconnecting'}
        >
          <span className="connect-icon">📧</span>
          {getButtonText('email')}
        </button>


      </div>

      {userEmails.length > 0 && (
        <div className="email-form">
          <h3>Connected Emails</h3>
          <div className="connected-providers">
            <ul>
              {userEmails.map(email => (
                <li key={email.email}>
                  <strong>{email.email}</strong> {email.verified ? '✓ verified' : '⚠️ pending'}
                  {!email.verified && (
                    <button type="button" className="cancel-button" onClick={() => handleEmailResend(email.email)}>
                      Resend verification
                    </button>
                  )}
                  <button type="button" className="cancel-button" onClick={() => handleEmailRemove(email.email)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="addresses-form">
        <h3>Blockchain Addresses</h3>
        <p className="addresses-form-note">
          Enter your preferred blockchain addresses here. You can still connect a wallet later if you prefer. Wallet autofill currently supports Ethereum login plus Solana and Bitcoin wallet sessions.
        </p>
        <form onSubmit={handleAddressesSubmit}>
          <div className="form-group">
            <label htmlFor="ethereumAddress">Ethereum Address</label>
            <input
              type="text"
              id="ethereumAddress"
              value={addressForm.ethereumAddress}
              onChange={handleAddressChange('ethereumAddress')}
              placeholder="0x..."
              disabled={!isAuthenticated || connectStatus.addresses === 'processing'}
            />
            {addressErrors.ethereumAddress && (
              <p className="error-message">{addressErrors.ethereumAddress}</p>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="solanaAddress">Solana Address</label>
            {/* TODO@P3 White-screen bug in production: disabling the Solana wallet autofill button until we fix the crash. */}
            {/*
            <button
              type="button"
              className="cancel-button"
              onClick={() => handleWalletAddressConnect('solanaAddress', 'solana')}
              disabled={connectStatus.addresses === 'processing'}
            >
              Connect Solana wallet
            </button>
            */}
            <input
              type="text"
              id="solanaAddress"
              value={addressForm.solanaAddress}
              onChange={handleAddressChange('solanaAddress')}
              placeholder="Enter your Solana address"
              disabled={!isAuthenticated || connectStatus.addresses === 'processing'}
            />
            {addressErrors.solanaAddress && (
              <p className="error-message">{addressErrors.solanaAddress}</p>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="bitcoinAddress">Bitcoin Address</label>
            {/* TODO@P3 White-screen bug in production: disabling the Bitcoin wallet autofill button until we fix the crash. */}
            {/*
            <button
              type="button"
              className="cancel-button"
              onClick={() => handleWalletAddressConnect('bitcoinAddress', 'bip122')}
              disabled={connectStatus.addresses === 'processing'}
            >
              Connect Bitcoin wallet
            </button>
            */}
            <input
              type="text"
              id="bitcoinAddress"
              value={addressForm.bitcoinAddress}
              onChange={handleAddressChange('bitcoinAddress')}
              placeholder="Enter your Bitcoin address"
              disabled={!isAuthenticated || connectStatus.addresses === 'processing'}
            />
            {addressErrors.bitcoinAddress && (
              <p className="error-message">{addressErrors.bitcoinAddress}</p>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="bitcoinCashAddress">Bitcoin Cash Address</label>
            <input
              type="text"
              id="bitcoinCashAddress"
              value={addressForm.bitcoinCashAddress}
              onChange={handleAddressChange('bitcoinCashAddress')}
              placeholder="Enter your Bitcoin Cash address"
              disabled={!isAuthenticated || connectStatus.addresses === 'processing'}
            />
            {addressErrors.bitcoinCashAddress && (
              <p className="error-message">{addressErrors.bitcoinCashAddress}</p>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="polkadotAddress">Polkadot Address</label>
            <input
              type="text"
              id="polkadotAddress"
              value={addressForm.polkadotAddress}
              onChange={handleAddressChange('polkadotAddress')}
              placeholder="Enter your Polkadot address"
              disabled={!isAuthenticated || connectStatus.addresses === 'processing'}
            />
            {addressErrors.polkadotAddress && (
              <p className="error-message">{addressErrors.polkadotAddress}</p>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="cosmosAddress">Cosmos (ATOM) Address</label>
            <input
              type="text"
              id="cosmosAddress"
              value={addressForm.cosmosAddress}
              onChange={handleAddressChange('cosmosAddress')}
              placeholder="Enter your Cosmos Hub address"
              disabled={!isAuthenticated || connectStatus.addresses === 'processing'}
            />
            {addressErrors.cosmosAddress && (
              <p className="error-message">{addressErrors.cosmosAddress}</p>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="stellarAddress">Stellar Address</label>
            <input
              type="text"
              id="stellarAddress"
              value={addressForm.stellarAddress}
              onChange={handleAddressChange('stellarAddress')}
              placeholder="Enter your Stellar public key (starts with G)"
              disabled={!isAuthenticated || connectStatus.addresses === 'processing'}
            />
            {addressErrors.stellarAddress && (
              <p className="error-message">{addressErrors.stellarAddress}</p>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="icpAddress">ICP Address</label>
            <input
              type="text"
              id="icpAddress"
              value={addressForm.icpAddress}
              onChange={handleAddressChange('icpAddress')}
              placeholder="Enter your ICP account ID or principal"
              disabled={!isAuthenticated || connectStatus.addresses === 'processing'}
            />
            {addressErrors.icpAddress && (
              <p className="error-message">{addressErrors.icpAddress}</p>
            )}
          </div>
          <div className="form-actions">
            <button
              type="submit"
              className="submit-button"
              disabled={!isAuthenticated || connectStatus.addresses === 'processing'}
            >
              {connectStatus.addresses === 'processing' ? 'Saving...' : 'Save Addresses'}
            </button>
          </div>
          {connectStatus.addresses === 'success' && (
            <p className="success-message">Addresses saved successfully.</p>
          )}
          {connectStatus.addresses === 'error' && connectStatus.error && (
            <p className="error-message">{connectStatus.error}</p>
          )}
      {!isAuthenticated && (
        <p className="info-message">Log in or connect an account before saving addresses.</p>
      )}
    </form>
  </div>

      {/* Email Form - Moved here to be more visible */}
      {showEmailForm && (
        <div className="email-form" id="email-form-section">
          <h3>Connect with Email</h3>
          <div className="form-group">
            <label htmlFor="email">Email Address *</label>
            <input
              type="email"
              id="email"
              value={emailForm.email}
              onChange={(e) => setEmailForm(prev => ({ ...prev, email: e.target.value }))}
              placeholder="Enter your email address"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="name">Name (Optional)</label>
            <input
              type="text"
              id="name"
              value={emailForm.name}
              onChange={(e) => setEmailForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Enter your name"
            />
          </div>
          <div className="form-actions">
            <button
              type="button"
              onClick={handleEmailConnect}
              disabled={isLoading || connectStatus.email === 'connecting'}
              className="submit-button"
            >
              {connectStatus.email === 'connecting' ? 'Connecting...' : 'Connect Email'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowEmailForm(false);
                setEmailForm({ email: '', name: '' });
                setConnectStatus(prev => {
                  const { email, ...rest } = prev;
                  return rest;
                });
              }}
              className="cancel-button"
            >
              Cancel
            </button>
          </div>
          <p>
            <strong>Note:</strong> Email will be used to send you important communications. You can unsubscribe at any time.
          </p>
          <p className="email-info">
            <strong>Note:</strong> You will receive a verification email. Please check your inbox and click the verification link to complete the connection.
          </p>
        </div>
      )}


      {/* Error Display */}
      {Object.entries(connectStatus).map(([provider, status]) =>
        status === 'error' && provider !== 'addresses' && (
          <div key={provider} className="error-message">
            {provider.toUpperCase()} connection failed: {connectStatus.error}
          </div>
        )
      )}

      <div className="connect-info">
        <p>
          <strong>Note:</strong> If you have accounts on multiple platforms, they will be automatically merged into one account.
        </p>
      </div>

    </div>
  );
};

export default ConnectForm;
