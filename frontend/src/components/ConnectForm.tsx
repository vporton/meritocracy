import { useState, useEffect, FormEvent, ChangeEvent } from 'react';
import { useConnect, useAccount, useSignMessage, useConnectorClient } from 'wagmi';
import { useAuth } from '../contexts/AuthContext';
import { User, authApi, usersApi } from '../services/api';
import { validateNonEvmAddresses, NonEvmAddressErrors } from '../utils/addressValidation';
import './ConnectForm.css';

interface ConnectStatus {
  [provider: string]: string | undefined;
  error?: string;
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

const ConnectForm = () => {
  const { login, registerEmail, isLoading, isAuthenticated, user, refreshUser, updateAuthData } = useAuth();
  const { connect, connectors } = useConnect();
  const { address, isConnected, connector } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { data: connectorClient } = useConnectorClient();
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>({});
  const [emailForm, setEmailForm] = useState({ email: '', name: '' });
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [nonEvmForm, setNonEvmForm] = useState({
    solanaAddress: '',
    bitcoinAddress: '',
    polkadotAddress: '',
    cosmosAddress: '',
  });
  const [nonEvmErrors, setNonEvmErrors] = useState<NonEvmAddressErrors>({});
  
  // Handle Ethereum connection flow when address becomes available
  // Note: This useEffect is disabled in favor of manual authentication flow in wallet selection
  useEffect(() => {
    console.log('useEffect triggered with:', { 
      address: !!address, 
      isConnected, 
      connector: !!connector, 
      connectorClient: !!connectorClient, 
      isProviderConnected: isProviderConnected('ethereum'),
      currentStatus: connectStatus.ethereum
    });
    
    // Disabled automatic authentication - now handled manually in wallet selection
    console.log('Automatic authentication disabled - use wallet selection modal instead');
  }, [address, isConnected, signMessageAsync, login, connectors, connector, connectorClient, connectStatus.ethereum]);
  
  useEffect(() => {
    if (user) {
      setNonEvmForm({
        solanaAddress: user.solanaAddress ?? '',
        bitcoinAddress: user.bitcoinAddress ?? '',
        polkadotAddress: user.polkadotAddress ?? '',
        cosmosAddress: user.cosmosAddress ?? '',
      });
    } else {
      setNonEvmForm({
        solanaAddress: '',
        bitcoinAddress: '',
        polkadotAddress: '',
        cosmosAddress: '',
      });
    }
    setNonEvmErrors({});
  }, [user]);
  
  // Show connected status and allow connecting more accounts
  const renderConnectedStatus = () => {
    if (isAuthenticated && user) {
      const connectedProviders = [];
      
      // Check which providers are connected
      if (user.ethereumAddress) connectedProviders.push({ name: 'Ethereum', value: user.ethereumAddress });
      if (user.solanaAddress) connectedProviders.push({ name: 'Solana', value: user.solanaAddress });
      if (user.bitcoinAddress) connectedProviders.push({ name: 'Bitcoin', value: user.bitcoinAddress });
      if (user.polkadotAddress) connectedProviders.push({ name: 'Polkadot', value: user.polkadotAddress });
      if (user.cosmosAddress) connectedProviders.push({ name: 'Cosmos', value: user.cosmosAddress });
      if (user.orcidId) connectedProviders.push({ name: 'ORCID', value: user.orcidId });
      if (user.githubHandle) connectedProviders.push({ name: 'GitHub', value: user.githubHandle });
      if (user.bitbucketHandle) connectedProviders.push({ name: 'BitBucket', value: user.bitbucketHandle });
      if (user.gitlabHandle) connectedProviders.push({ name: 'GitLab', value: user.gitlabHandle });
      if (user.email) {
        const emailStatus = user.emailVerified ? '✓' : '⚠️';
        connectedProviders.push({ name: 'Email', value: `${user.email} ${emailStatus}` });
      }
      if (user.kycStatus) {
        const kycStatusIcon = user.kycStatus === 'APPROVED' ? '✓' : 
                              user.kycStatus === 'REJECTED' ? '❌' : 
                              user.kycStatus === 'PENDING' ? '⏳' : '❓';
        connectedProviders.push({ name: 'KYC', value: `${user.kycStatus} ${kycStatusIcon}` });
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
                  <li key={index}>
                    <strong>{provider.name}:</strong> {provider.value}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  // Helper function to disconnect a provider
  const handleDisconnect = async (provider: string) => {
    try {
      setConnectStatus(prev => ({ ...prev, [provider]: 'disconnecting' }));
      
      // Call backend to disconnect/unlink the provider
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/auth/disconnect/${provider}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        await response.json();
        // Update the user context with the updated user data
        await refreshUser();
        setConnectStatus(prev => {
          const { [provider]: _, ...rest } = prev;
          return rest;
        }); // Clear the provider's status
      } else {
        throw new Error('Failed to disconnect provider');
      }
    } catch (error: any) {
      console.error('Disconnect error:', error);
      setConnectStatus(prev => ({ ...prev, [provider]: 'error', error: error.message }));
    }
  };

  // Ethereum/Web3 Connect - show wallet selection
  const handleEthereumConnect = async () => {
    console.log('Ethereum connect button clicked!');
    console.log('Current state:', { isConnected, isProviderConnected: isProviderConnected('ethereum'), connectors: connectors.length });
    
    // Check if already connected to our platform and user wants to disconnect
    if (isProviderConnected('ethereum')) {
      console.log('Already connected to platform, disconnecting...');
      return handleDisconnect('ethereum');
    }
    
    // Always show wallet selection modal first, regardless of current connection state
    console.log('Showing wallet selection modal...');
    setConnectStatus(prev => ({ ...prev, ethereum: 'selecting' }));
  };

  // Handle wallet selection
  const handleWalletSelect = async (selectedConnector: any) => {
    try {
      setConnectStatus(prev => ({ ...prev, ethereum: 'connecting' }));
      console.log('Connecting to wallet:', selectedConnector.name);
      console.log('Connector details:', selectedConnector);
      console.log('Current connection state:', { isConnected, connector: connector?.name });
      
      // If already connected to this connector, proceed with authentication
      if (isConnected && selectedConnector.name === connector?.name) {
        console.log('Already connected to this wallet, proceeding with authentication...');
        setConnectStatus(prev => ({ ...prev, ethereum: 'signing' }));
        
        // Proceed with authentication directly
        const message = `Connect to Socialism platform with address: ${address}`;
        console.log('Attempting to sign message...');
        
        const signature = await signMessageAsync({ message });
        console.log('Signature result:', signature ? 'received' : 'null/undefined');
        
        if (!signature) {
          throw new Error('Signature was cancelled');
        }
        
        // Now authenticate with backend
        console.log('Setting status to authenticating');
        setConnectStatus(prev => ({ ...prev, ethereum: 'authenticating' }));
        
        console.log('Calling backend login API...');
        const authResult = await login({
          ethereumAddress: address,
          signature,
          message
        }, 'ethereum');
        console.log('Backend login result:', authResult);
        
        if (authResult.success) {
          console.log('Connect successful! Setting status to success');
          setConnectStatus(prev => ({ ...prev, ethereum: 'success' }));
          // Reset status after a short delay
          setTimeout(() => setConnectStatus(prev => {
            const { ethereum, ...rest } = prev;
            return rest;
          }), 2000);
        } else {
          console.log('Connect failed. Setting status to error');
          setConnectStatus(prev => ({ ...prev, ethereum: 'error', error: authResult.error }));
        }
      } else {
        // Connect to the selected wallet
        console.log('Attempting to connect to wallet...');
        await connect({ connector: selectedConnector });
        console.log('Wallet connection initiated successfully');
        
        // Wait for the connection to be established with timeout
        let connectionAttempts = 0;
        const maxAttempts = 10;
        
        while (connectionAttempts < maxAttempts && (!isConnected || !address)) {
          console.log(`Waiting for connection... attempt ${connectionAttempts + 1}/${maxAttempts}`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          connectionAttempts++;
        }
        
        // Check if connection was successful
        if (isConnected && address) {
          console.log('Connection successful, proceeding with authentication...');
          setConnectStatus(prev => ({ ...prev, ethereum: 'signing' }));
          
          // Proceed with authentication
          const message = `Connect to Socialism platform with address: ${address}`;
          console.log('Attempting to sign message...');
          
          const signature = await signMessageAsync({ message });
          console.log('Signature result:', signature ? 'received' : 'null/undefined');
          
          if (!signature) {
            throw new Error('Signature was cancelled');
          }
          
          // Now authenticate with backend
          console.log('Setting status to authenticating');
          setConnectStatus(prev => ({ ...prev, ethereum: 'authenticating' }));
          
          console.log('Calling backend login API...');
          const authResult = await login({
            ethereumAddress: address,
            signature,
            message
          }, 'ethereum');
          console.log('Backend login result:', authResult);
          
          if (authResult.success) {
            console.log('Connect successful! Setting status to success');
            setConnectStatus(prev => ({ ...prev, ethereum: 'success' }));
            // Reset status after a short delay
            setTimeout(() => setConnectStatus(prev => {
              const { ethereum, ...rest } = prev;
              return rest;
            }), 2000);
          } else {
            console.log('Connect failed. Setting status to error');
            setConnectStatus(prev => ({ ...prev, ethereum: 'error', error: authResult.error }));
          }
        } else {
          console.log('Connection not established, trying direct authentication anyway...');
          // Even if the connection state isn't updated, try to proceed with authentication
          // This handles cases where the hooks don't update immediately
          try {
            setConnectStatus(prev => ({ ...prev, ethereum: 'signing' }));
            
            // Try to get the address from the connector directly
            const currentAddress = address || await selectedConnector.getAccount?.();
            if (currentAddress) {
              console.log('Found address from connector, proceeding with authentication...');
              const message = `Connect to Socialism platform with address: ${currentAddress}`;
              
              const signature = await signMessageAsync({ message });
              if (!signature) {
                throw new Error('Signature was cancelled');
              }
              
              setConnectStatus(prev => ({ ...prev, ethereum: 'authenticating' }));
              const authResult = await login({
                ethereumAddress: currentAddress,
                signature,
                message
              }, 'ethereum');
              
              if (authResult.success) {
                setConnectStatus(prev => ({ ...prev, ethereum: 'success' }));
                setTimeout(() => setConnectStatus(prev => {
                  const { ethereum, ...rest } = prev;
                  return rest;
                }), 2000);
              } else {
                setConnectStatus(prev => ({ ...prev, ethereum: 'error', error: authResult.error }));
              }
            } else {
              throw new Error('No address available');
            }
          } catch (authError: any) {
            console.error('Fallback authentication failed:', authError);
            setConnectStatus(prev => ({ ...prev, ethereum: 'error', error: 'Failed to connect to wallet' }));
          }
        }
      }
    } catch (error: any) {
      console.error('Wallet connection error:', error);
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
      github: import.meta.env.VITE_GITHUB_CLIENT_ID,
      orcid: import.meta.env.VITE_ORCID_CLIENT_ID,
      bitbucket: import.meta.env.VITE_BITBUCKET_CLIENT_ID,
      gitlab: import.meta.env.VITE_GITLAB_CLIENT_ID,
    };

    // Get current user's token to include in OAuth state parameter for user linking
    const currentToken = localStorage.getItem('authToken');
    const stateParam = currentToken ? encodeURIComponent(currentToken) : '';
    
    console.log(`${provider} OAuth: currentToken ${currentToken ? 'present' : 'missing'}, stateParam: ${stateParam ? 'included' : 'not included'}`);

    const redirectUris: OAuthRedirectUris = {
      github: `${import.meta.env.VITE_API_URL}/api/auth/github/callback`,
      orcid: `${import.meta.env.VITE_API_URL}/api/auth/orcid/callback`,
      bitbucket: `${import.meta.env.VITE_API_URL}/api/auth/bitbucket/callback`,
      gitlab: `${import.meta.env.VITE_API_URL}/api/auth/gitlab/callback`,
    };

    const authUrls: OAuthAuthUrls = {
      github: `https://github.com/login/oauth/authorize?client_id=${clientIds.github}&redirect_uri=${encodeURIComponent(redirectUris.github)}&scope=&state=${stateParam}`,
      orcid: `https://${import.meta.env.VITE_ORCID_DOMAIN}/oauth/authorize?client_id=${clientIds.orcid}&response_type=code&scope=/authenticate&redirect_uri=${encodeURIComponent(redirectUris.orcid)}&state=${stateParam}`,
      bitbucket: `https://bitbucket.org/site/oauth2/authorize?client_id=${clientIds.bitbucket}&response_type=code&redirect_uri=${encodeURIComponent(redirectUris.bitbucket)}&state=${stateParam}`,
      gitlab: `https://gitlab.com/oauth/authorize?client_id=${clientIds.gitlab}&redirect_uri=${encodeURIComponent(redirectUris.gitlab)}&response_type=code&scope=openid profile read_user&state=${stateParam}`,
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

  // KYC connection handler
  const handleKycConnect = async () => {
    // Check if already connected and user wants to disconnect
    if (isProviderConnected('kyc')) {
      return handleDisconnect('kyc');
    }

    try {
      setConnectStatus(prev => ({ ...prev, kyc: 'connecting' }));
      
      const response = await authApi.initiateKyc();
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
        window.open(data.url, '_blank');
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
      
      // Reset status after a delay
      setTimeout(() => {
        setConnectStatus(prev => {
          const { kyc, ...rest } = prev;
          return rest;
        });
      }, 5000);
    }
  };

  // Email connection handler
  const handleEmailConnect = async () => {
    // Check if already connected and user wants to disconnect
    if (isProviderConnected('email')) {
      return handleDisconnect('email');
    }

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

  const handleNonEvmChange = (field: keyof typeof nonEvmForm) => (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setNonEvmForm(prev => ({ ...prev, [field]: value }));
    setNonEvmErrors(prev => {
      if (!prev[field]) {
        return prev;
      }
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const handleNonEvmSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!user) {
      setConnectStatus(prev => ({ ...prev, nonEvmAddresses: 'error', error: 'You must be logged in to save addresses' }));
      return;
    }

    try {
      const validationErrors = validateNonEvmAddresses(nonEvmForm);
      if (Object.keys(validationErrors).length > 0) {
        const firstError = Object.values(validationErrors)[0];
        setNonEvmErrors(validationErrors);
        setConnectStatus(prev => ({ ...prev, nonEvmAddresses: 'error', error: firstError || 'Please check the address formats.' }));
        return;
      }

      setNonEvmErrors({});
      setConnectStatus(prev => ({ ...prev, nonEvmAddresses: 'processing', error: undefined }));

      await usersApi.update(user.id, {
        solanaAddress: nonEvmForm.solanaAddress.trim() || null,
        bitcoinAddress: nonEvmForm.bitcoinAddress.trim() || null,
        polkadotAddress: nonEvmForm.polkadotAddress.trim() || null,
        cosmosAddress: nonEvmForm.cosmosAddress.trim() || null,
      });

      await refreshUser();

      setConnectStatus(prev => {
        const { error, ...rest } = prev;
        return { ...rest, nonEvmAddresses: 'success' };
      });

      setTimeout(() => {
        setConnectStatus(prev => {
          const { nonEvmAddresses, ...rest } = prev;
          return rest;
        });
      }, 2000);
    } catch (error: any) {
      console.error('Non-EVM address update failed:', error);
      const errorMessage = error?.response?.data?.error || error?.message || 'Failed to save addresses';
      const detailErrors = error?.response?.data?.details;
      if (detailErrors && typeof detailErrors === 'object') {
        const recognizedKeys = ['solanaAddress', 'bitcoinAddress', 'polkadotAddress', 'cosmosAddress'] as const;
        const mappedErrors: NonEvmAddressErrors = {};
        for (const key of recognizedKeys) {
          const value = (detailErrors as Record<string, unknown>)[key];
          if (typeof value === 'string') {
            mappedErrors[key] = value;
          }
        }
        setNonEvmErrors(mappedErrors);
      }
      setConnectStatus(prev => ({ ...prev, nonEvmAddresses: 'error', error: errorMessage }));
    }
  };

  // Helper function to check if a provider is connected
  const isProviderConnected = (provider: string): boolean => {
    if (!user) return false;
    
    const providerFields: Record<string, keyof User> = {
      ethereum: 'ethereumAddress',
      orcid: 'orcidId', 
      github: 'githubHandle',
      bitbucket: 'bitbucketHandle',
      gitlab: 'gitlabHandle',
      email: 'email',
      kyc: 'kycStatus'
    };
    
    const field = providerFields[provider];
    if (provider === 'kyc') {
      // KYC is connected if status is APPROVED
      return user.kycStatus === 'APPROVED';
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
      kyc: 'KYC'
    };
    
    const displayName = providerDisplayNames[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
    
    // Special handling for email: check verification status
    if (provider === 'email' && isConnected && !status) {
      if (user?.email && !user?.emailVerified) {
        return 'Waiting for email';
      }
      return `Disconnect ${displayName}`;
    }
    
    // Special handling for KYC: show status
    if (provider === 'kyc' && !status) {
      if (user?.kycStatus === 'APPROVED') {
        return 'KYC passed';
      } else if (user?.kycStatus === 'PENDING') {
        return 'KYC Pending...';
      } else if (user?.kycStatus === 'REJECTED') {
        return 'KYC Rejected - Try Again';
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
        return 'Try Again';
      case 'cancelled':
        return 'Try Again';
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
    if (provider === 'email' && isConnected && !status) {
      if (user?.email && !user?.emailVerified) {
        className += ' waiting-for-verification';
      } else {
        className += ' connected';
      }
    } else if (provider === 'kyc' && !status) {
      // Special handling for KYC status
      if (user?.kycStatus === 'APPROVED') {
        className += ' connected';
      } else if (user?.kycStatus === 'PENDING') {
        className += ' waiting-for-verification';
      } else if (user?.kycStatus === 'REJECTED') {
        className += ' error';
      }
    } else if (isConnected && !status) {
      className += ' connected';
    }
    
    return className;
  };

  return (
    <div className="connect-form">
      <h2>Connect to Socialism Platform</h2>
      
      {renderConnectedStatus()}
      
      <p>You need to connect all accounts with your products (like GitHub for your free software, ORCID for your scientific articles, etc.) to receive maximum salary at our site (and, yes, it is completely free, you even don't need to pay for blockchain gas). KYC is mandatory.</p>

      <p>The Ethereum address will also be used for payments to you.</p>

      <p style={{ color: 'red' }}>GitLab and BitBucket are not supported yet.</p>
      
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
          <span className="connect-icon">👨‍💻</span>
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

        {/* KYC Verification */}
        <button
          className={getButtonClass('kyc')}
          onClick={handleKycConnect}
          disabled={isLoading || connectStatus.kyc === 'connecting' || connectStatus.kyc === 'disconnecting' || user?.kycStatus === 'APPROVED'}
        >
          <span className="connect-icon">🆔</span>
          {getButtonText('kyc')}
        </button>
      </div>

      <div className="non-evm-addresses">
        <h3>Non-EVM Addresses</h3>
        <form onSubmit={handleNonEvmSubmit}>
          <div className="form-group">
            <label htmlFor="solanaAddress">Solana Address</label>
            <input
              type="text"
              id="solanaAddress"
              value={nonEvmForm.solanaAddress}
              onChange={handleNonEvmChange('solanaAddress')}
              placeholder="Enter your Solana address"
              disabled={!isAuthenticated || connectStatus.nonEvmAddresses === 'processing'}
            />
            {nonEvmErrors.solanaAddress && (
              <p className="error-message">{nonEvmErrors.solanaAddress}</p>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="bitcoinAddress">Bitcoin Address</label>
            <input
              type="text"
              id="bitcoinAddress"
              value={nonEvmForm.bitcoinAddress}
              onChange={handleNonEvmChange('bitcoinAddress')}
              placeholder="Enter your Bitcoin address"
              disabled={!isAuthenticated || connectStatus.nonEvmAddresses === 'processing'}
            />
            {nonEvmErrors.bitcoinAddress && (
              <p className="error-message">{nonEvmErrors.bitcoinAddress}</p>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="polkadotAddress">Polkadot Address</label>
            <input
              type="text"
              id="polkadotAddress"
              value={nonEvmForm.polkadotAddress}
              onChange={handleNonEvmChange('polkadotAddress')}
              placeholder="Enter your Polkadot address"
              disabled={!isAuthenticated || connectStatus.nonEvmAddresses === 'processing'}
            />
            {nonEvmErrors.polkadotAddress && (
              <p className="error-message">{nonEvmErrors.polkadotAddress}</p>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="cosmosAddress">Cosmos (ATOM) Address</label>
            <input
              type="text"
              id="cosmosAddress"
              value={nonEvmForm.cosmosAddress}
              onChange={handleNonEvmChange('cosmosAddress')}
              placeholder="Enter your Cosmos Hub address"
              disabled={!isAuthenticated || connectStatus.nonEvmAddresses === 'processing'}
            />
            {nonEvmErrors.cosmosAddress && (
              <p className="error-message">{nonEvmErrors.cosmosAddress}</p>
            )}
          </div>
          <div className="form-actions">
            <button
              type="submit"
              className="submit-button"
              disabled={!isAuthenticated || connectStatus.nonEvmAddresses === 'processing'}
            >
              {connectStatus.nonEvmAddresses === 'processing' ? 'Saving...' : 'Save Addresses'}
            </button>
          </div>
          {connectStatus.nonEvmAddresses === 'success' && (
            <p className="success-message">Addresses saved successfully.</p>
          )}
          {connectStatus.nonEvmAddresses === 'error' && connectStatus.error && (
            <p className="error-message">{connectStatus.error}</p>
          )}
          {!isAuthenticated && (
            <p className="info-message">Log in or connect an account before saving addresses.</p>
          )}
        </form>
      </div>

      {/* Email Form */}
      {showEmailForm && (
        <div className="email-form">
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
          <p className="email-info">
            <strong>Note:</strong> You will receive a verification email. Please check your inbox and click the verification link to complete the connection.
          </p>
        </div>
      )}

      {/* Error Display */}
      {Object.entries(connectStatus).map(([provider, status]) => 
        status === 'error' && provider !== 'nonEvmAddresses' && (
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
      
      {/* Wallet Selection Modal */}
      {connectStatus.ethereum === 'selecting' && (
        <div className="wallet-selection-modal">
          <div className="modal-overlay" onClick={() => setConnectStatus(prev => ({ ...prev, ethereum: undefined }))} />
          <div className="modal-content">
            <h3>Select a Wallet</h3>
            <div className="wallet-options">
              {console.log('Rendering wallet selection modal with connectors:', connectors)}
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  className="wallet-option"
                  onClick={() => handleWalletSelect(connector)}
                >
                  <span className="wallet-icon">
                    {connector.name === 'MetaMask' && '🦊'}
                    {connector.name === 'WalletConnect' && '🔗'}
                    {connector.name === 'Coinbase Wallet' && '🔵'}
                    {connector.name === 'Safe' && '🛡️'}
                    {connector.name === 'Rainbow' && '🌈'}
                    {!['MetaMask', 'WalletConnect', 'Coinbase Wallet', 'Safe', 'Rainbow'].includes(connector.name) && '💳'}
                  </span>
                  <span className="wallet-name">{connector.name}</span>
                </button>
              ))}
            </div>
            <button
              className="modal-close"
              onClick={() => setConnectStatus(prev => ({ ...prev, ethereum: undefined }))}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConnectForm;
