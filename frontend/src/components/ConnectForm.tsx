import { useState, useEffect } from 'react';
import { useConnect, useAccount, useSignMessage } from 'wagmi';
import { useAuth } from '../contexts/AuthContext';
import { User } from '../services/api';
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
  const { login, isLoading, isAuthenticated, user, refreshUser, updateAuthData } = useAuth();
  const { connect, connectors } = useConnect();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>({});
  const [pendingEthereumConnection, setPendingEthereumConnection] = useState(false);
  
  // Handle Ethereum connection flow when address becomes available
  useEffect(() => {
    const handleEthereumAuth = async () => {
      if (pendingEthereumConnection && address && isConnected) {
        console.log('useEffect: Address available after connection:', address);
        setPendingEthereumConnection(false);
        
        try {
          // Now sign the message
          console.log('Setting status to signing');
          setConnectStatus(prev => ({ ...prev, ethereum: 'signing' }));
          const message = `Connect to Socialism platform with address: ${address}`;
          console.log('About to sign message:', message);
          
          console.log('Trying signMessageAsync...');
          const signature = await signMessageAsync({ message });
          console.log('Signature result:', signature ? 'received' : 'null/undefined');
          console.log('Actual signature value:', signature);

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
            // Reset status after a short delay to allow connecting more accounts
            setTimeout(() => setConnectStatus(prev => {
              const { ethereum, ...rest } = prev;
              return rest;
            }), 2000);
          } else {
            console.log('Connect failed. Setting status to error');
            setConnectStatus(prev => ({ ...prev, ethereum: 'error', error: authResult.error }));
          }
        } catch (error: any) {
          console.error('ERROR in useEffect handleEthereumAuth:', error);
          
          if (error.message.includes('rejected') || error.message.includes('cancelled')) {
            console.log('Setting status to cancelled');
            setConnectStatus(prev => ({ ...prev, ethereum: 'cancelled' }));
          } else {
            console.log('Setting status to error');
            setConnectStatus(prev => ({ ...prev, ethereum: 'error', error: error.message }));
          }
        }
      }
    };
    
    handleEthereumAuth();
  }, [pendingEthereumConnection, address, isConnected, signMessageAsync, login]);
  
  // Show connected status and allow connecting more accounts
  const renderConnectedStatus = () => {
    if (isAuthenticated && user) {
      const connectedProviders = [];
      const providerDisplayNames: Record<string, string> = {
        ethereum: 'Ethereum',
        orcid: 'ORCID',
        github: 'GitHub',
        bitbucket: 'BitBucket',
        gitlab: 'GitLab'
      };
      
      // Check which providers are connected
      if (user.ethereumAddress) connectedProviders.push({ name: 'Ethereum', value: user.ethereumAddress });
      if (user.orcidId) connectedProviders.push({ name: 'ORCID', value: user.orcidId });
      if (user.githubHandle) connectedProviders.push({ name: 'GitHub', value: user.githubHandle });
      if (user.bitbucketHandle) connectedProviders.push({ name: 'BitBucket', value: user.bitbucketHandle });
      if (user.gitlabHandle) connectedProviders.push({ name: 'GitLab', value: user.gitlabHandle });
      
      return (
        <div className="connected-status">
          <h3>✅ Connected Accounts</h3>
          {user.onboarded ? (
            <div className="onboarded-notice">
              <p><strong>🎉 Onboarding Complete!</strong></p>
              <p>You have successfully completed the onboarding process. You cannot connect additional accounts at this time.</p>
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

  // Ethereum/Web3 Connect
  const handleEthereumConnect = async () => {
    // Check if already connected and user wants to disconnect
    if (isProviderConnected('ethereum')) {
      return handleDisconnect('ethereum');
    }
    console.log('=== ETHEREUM CONNECT STARTED ===');
    console.log('Initial state - isConnected:', isConnected, 'address:', address);
    
    try {
      // Set connecting status immediately
      console.log('Setting status to connecting');
      setConnectStatus(prev => ({ ...prev, ethereum: 'connecting' }));
      
      // If not connected, connect first
      if (!isConnected) {
        console.log('Not connected, attempting to connect...');
        const connector = connectors.find(c => c.name === 'MetaMask') || connectors[0];
        console.log('Found connector:', connector?.name);
        
        // Set flag to trigger useEffect when address becomes available
        setPendingEthereumConnection(true);
        
        await connect({ connector });
        console.log('Connect initiated');
        
        // The useEffect will handle the rest when address is available
      } else {
        console.log('Already connected, proceeding with existing address:', address);
        // If already connected, trigger the auth flow directly
        setPendingEthereumConnection(true);
      }
    } catch (error: any) {
      console.error('ERROR in handleEthereumConnect:', error);
      console.log('Error type:', typeof error);
      console.log('Error message:', error.message);
      console.log('Error stack:', error.stack);
      
      setPendingEthereumConnection(false);
      
      if (error.message.includes('rejected') || error.message.includes('cancelled')) {
        console.log('Setting status to cancelled');
        setConnectStatus(prev => ({ ...prev, ethereum: 'cancelled' }));
      } else {
        console.log('Setting status to error');
        setConnectStatus(prev => ({ ...prev, ethereum: 'error', error: error.message }));
      }
    }
    
    console.log('=== ETHEREUM CONNECT ENDED ===');
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

    const redirectUris: OAuthRedirectUris = {
      github: import.meta.env.VITE_GITHUB_REDIRECT_URI,
      orcid: import.meta.env.VITE_ORCID_REDIRECT_URI,
      bitbucket: import.meta.env.VITE_BITBUCKET_REDIRECT_URI,
      gitlab: import.meta.env.VITE_GITLAB_REDIRECT_URI,
    };

    const authUrls: OAuthAuthUrls = {
      github: `https://github.com/login/oauth/authorize?client_id=${clientIds.github}&redirect_uri=${encodeURIComponent(redirectUris.github)}&scope=`,
      orcid: `https://${import.meta.env.VITE_ORCID_DOMAIN}/oauth/authorize?client_id=${clientIds.orcid}&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(redirectUris.orcid)}`,
      bitbucket: `https://bitbucket.org/site/oauth2/authorize?client_id=${clientIds.bitbucket}&response_type=code&redirect_uri=${encodeURIComponent(redirectUris.bitbucket)}`,
      gitlab: `https://gitlab.com/oauth/authorize?client_id=${clientIds.gitlab}&redirect_uri=${encodeURIComponent(redirectUris.gitlab)}&response_type=code&scope=read_user`,
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
      if (event.origin !== window.location.origin) return;
      
      console.log(`OAuth message received for ${provider}:`, event.data);
      
      if (event.data.type === 'OAUTH_SUCCESS' && event.data.provider === provider) {
        hasReceivedResponse = true;
        clearInterval(checkClosed);
        popup.close();
        
        try {
          setConnectStatus(prev => ({ ...prev, [provider]: 'success' }));
          
          // The backend already handled authentication, just update the frontend state
          const { user, session } = event.data.authData!;
          
          // Update AuthContext with the new user and session
          await updateAuthData(user, session.token);
          
          // Reset status after a short delay to allow connecting more accounts
          setTimeout(() => setConnectStatus(prev => {
            const { [provider]: _, ...rest } = prev;
            return rest;
          }), 2000);
        } catch (error: any) {
          setConnectStatus(prev => ({ ...prev, [provider]: 'error', error: error.message }));
        }
        
        window.removeEventListener('message', handleMessage as any);
      } else if (event.data.type === 'OAUTH_ERROR' && event.data.provider === provider) {
        hasReceivedResponse = true;
        clearInterval(checkClosed);
        popup.close();
        setConnectStatus(prev => ({ ...prev, [provider]: 'error', error: event.data.error }));
        window.removeEventListener('message', handleMessage as any);
      }
    };

    window.addEventListener('message', handleMessage as any);
  };

  // Helper function to check if a provider is connected
  const isProviderConnected = (provider: string): boolean => {
    if (!user) return false;
    
    const providerFields: Record<string, keyof User> = {
      ethereum: 'ethereumAddress',
      orcid: 'orcidId', 
      github: 'githubHandle',
      bitbucket: 'bitbucketHandle',
      gitlab: 'gitlabHandle'
    };
    
    const field = providerFields[provider];
    return field && user[field] != null;
  };

  const getButtonText = (provider: string): string => {
    const status = connectStatus[provider];
    const isConnected = isProviderConnected(provider);
    
    // Map provider names to display names
    const providerDisplayNames: Record<string, string> = {
      ethereum: 'Ethereum',
      orcid: 'ORCID',
      github: 'GitHub',
      bitbucket: 'BitBucket',
      gitlab: 'GitLab'
    };
    
    const displayName = providerDisplayNames[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
    
    if (provider === 'ethereum') {
      console.log('getButtonText for ethereum - status:', status, 'isConnected:', isConnected, 'full connectStatus:', connectStatus);
    }
    
    // If user is onboarded and not connected to this provider, show disabled state
    if (user?.onboarded && !isConnected) {
      return `Onboarding Complete`;
    }
    
    // If connected and no temporary status, show disconnect option
    if (isConnected && !status) {
      return `Disconnect ${displayName}`;
    }
    
    switch (status) {
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
    
    if (status === 'connecting' || status === 'signing' || status === 'authenticating' || status === 'processing' || status === 'disconnecting') {
      className += ' loading';
    }
    if (status === 'success') className += ' success';
    if (status === 'error') className += ' error';
    if (isConnected && !status) className += ' connected';
    if (user?.onboarded && !isConnected) className += ' disabled';
    
    return className;
  };

  return (
    <div className="connect-form">
      <h2>Connect to Socialism Platform</h2>
      
      {renderConnectedStatus()}
      
      <p>You need to connect all accounts with your products (like GutHub for your free software, ORCID for your scientific articles, etc.) to receive maximum salary at our site (and, yes, it is completely free, you even don't need to pay for blockchain gas).</p>

      <p>The Ethereum address will also be used for payments to you.</p>
      
      <div className="connect-options">
        {/* Ethereum Connect */}
        <button
          className={getButtonClass('ethereum')}
          onClick={handleEthereumConnect}
          disabled={isLoading || connectStatus.ethereum === 'connecting' || connectStatus.ethereum === 'signing' || connectStatus.ethereum === 'authenticating' || connectStatus.ethereum === 'disconnecting' || (user?.onboarded && !isProviderConnected('ethereum'))}
        >
          <span className="connect-icon">⟠</span>
          {getButtonText('ethereum')}
        </button>

        {/* ORCID Connect */}
        <button
          className={getButtonClass('orcid')}
          onClick={() => handleOAuthConnect('orcid')}
          disabled={isLoading || connectStatus.orcid === 'processing' || connectStatus.orcid === 'disconnecting' || (user?.onboarded && !isProviderConnected('orcid'))}
        >
          <span className="connect-icon">🎓</span>
          {getButtonText('orcid')}
        </button>

        {/* GitHub Connect */}
        <button
          className={getButtonClass('github')}
          onClick={() => handleOAuthConnect('github')}
          disabled={isLoading || connectStatus.github === 'processing' || connectStatus.github === 'disconnecting' || (user?.onboarded && !isProviderConnected('github'))}
        >
          <span className="connect-icon">👨‍💻</span>
          {getButtonText('github')}
        </button>

        {/* BitBucket Connect */}
        <button
          className={getButtonClass('bitbucket')}
          onClick={() => handleOAuthConnect('bitbucket')}
          disabled={isLoading || connectStatus.bitbucket === 'processing' || connectStatus.bitbucket === 'disconnecting' || (user?.onboarded && !isProviderConnected('bitbucket'))}
        >
          <span className="connect-icon">🪣</span>
          {getButtonText('bitbucket')}
        </button>

        {/* GitLab Connect */}
        <button
          className={getButtonClass('gitlab')}
          onClick={() => handleOAuthConnect('gitlab')}
          disabled={isLoading || connectStatus.gitlab === 'processing' || connectStatus.gitlab === 'disconnecting' || (user?.onboarded && !isProviderConnected('gitlab'))}
        >
          <span className="connect-icon">🦊</span>
          {getButtonText('gitlab')}
        </button>
      </div>

      {/* Error Display */}
      {Object.entries(connectStatus).map(([provider, status]) => 
        status === 'error' && (
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
