import { useState, useEffect } from 'react';
import { useConnect, useAccount, useSignMessage } from 'wagmi';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { User } from '../services/api';
import './LoginForm.css';

interface LoginStatus {
  [provider: string]: string;
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

const LoginForm = () => {
  const { login, isLoading, isAuthenticated } = useAuth();
  const { connect, connectors, error: connectError, isLoading: connectLoading } = useConnect();
  const { address, isConnected } = useAccount();
  const { signMessage, signMessageAsync, error: signError, isLoading: isSigningLoading } = useSignMessage();
  const [loginStatus, setLoginStatus] = useState<LoginStatus>({});
  const navigate = useNavigate();
  
  // If user is already authenticated, don't show login buttons
  if (isAuthenticated) {
    return (
      <div className="connect-form">
        <h2>You are already connected!</h2>
        <p>You are successfully authenticated.</p>
      </div>
    );
  }

  // Ethereum/Web3 Login
  const handleEthereumLogin = async () => {
    console.log('=== ETHEREUM LOGIN STARTED ===');
    console.log('Initial state - isConnected:', isConnected, 'address:', address);
    
    try {
      // Set connecting status immediately
      console.log('Setting status to connecting');
      setLoginStatus({ ethereum: 'connecting' });
      
      let currentAddress = address;
      let currentIsConnected = isConnected;
      
      // If not connected, connect first
      if (!currentIsConnected) {
        console.log('Not connected, attempting to connect...');
        const connector = connectors.find(c => c.name === 'MetaMask') || connectors[0];
        console.log('Found connector:', connector?.name);
        
        const result = await connect({ connector });
        console.log('Connect result:', result);
        
        // After connection, get the updated address
        currentAddress = result.accounts[0];
        currentIsConnected = true;
        console.log('Connected! New address:', currentAddress);
      } else {
        console.log('Already connected, proceeding with existing address:', currentAddress);
      }
      
      // Now sign the message
      console.log('Setting status to signing');
      setLoginStatus({ ethereum: 'signing' });
      const message = `Connect to Socialism platform with address: ${currentAddress}`;
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
      setLoginStatus({ ethereum: 'authenticating' });
      
      console.log('Calling backend login API...');
      const authResult = await login({
        ethereumAddress: currentAddress,
        signature,
        message
      }, 'ethereum');
      console.log('Backend login result:', authResult);

      if (authResult.success) {
        console.log('Login successful! Setting status to success');
        setLoginStatus({ ethereum: 'success' });
        // Redirect to home page after successful login
        setTimeout(() => navigate('/'), 1000);
      } else {
        console.log('Login failed. Setting status to error');
        setLoginStatus({ ethereum: 'error', error: authResult.error });
      }
    } catch (error: any) {
      console.error('ERROR in handleEthereumLogin:', error);
      console.log('Error type:', typeof error);
      console.log('Error message:', error.message);
      console.log('Error stack:', error.stack);
      
      if (error.message.includes('rejected') || error.message.includes('cancelled')) {
        console.log('Setting status to cancelled');
        setLoginStatus({ ethereum: 'cancelled' });
      } else {
        console.log('Setting status to error');
        setLoginStatus({ ethereum: 'error', error: error.message });
      }
    }
    
    console.log('=== ETHEREUM LOGIN ENDED ===');
  };

  // OAuth Login Handler
  const handleOAuthLogin = (provider: string) => {
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
      github: `https://github.com/login/oauth/authorize?client_id=${clientIds.github}&redirect_uri=${encodeURIComponent(redirectUris.github)}&scope=user:email`,
      orcid: `https://orcid.org/oauth/authorize?client_id=${clientIds.orcid}&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(redirectUris.orcid)}`,
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
          setLoginStatus({ [provider]: 'cancelled' });
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
          setLoginStatus({ [provider]: 'success' });
          
          // The backend already handled authentication, just update the frontend state
          const { user, session } = event.data.authData!;
          
          // Update localStorage with the new token
          localStorage.setItem('authToken', session.token);
          
          // Redirect to home page after successful login
          setTimeout(() => navigate('/'), 1000);
        } catch (error: any) {
          setLoginStatus({ [provider]: 'error', error: error.message });
        }
        
        window.removeEventListener('message', handleMessage as any);
      } else if (event.data.type === 'OAUTH_ERROR' && event.data.provider === provider) {
        hasReceivedResponse = true;
        clearInterval(checkClosed);
        popup.close();
        setLoginStatus({ [provider]: 'error', error: event.data.error });
        window.removeEventListener('message', handleMessage as any);
      }
    };

    window.addEventListener('message', handleMessage as any);
  };

  const getButtonText = (provider: string): string => {
    const status = loginStatus[provider];
    if (provider === 'ethereum') {
      console.log('getButtonText for ethereum - status:', status, 'full loginStatus:', loginStatus);
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
      case 'success':
        return 'Success!';
      case 'error':
        return 'Try Again';
      case 'cancelled':
        return 'Try Again';
      default:
        return `Connect with ${provider.charAt(0).toUpperCase() + provider.slice(1)}`;
    }
  };

  const getButtonClass = (provider: string): string => {
    const status = loginStatus[provider];
    let className = `connect-button ${provider}-button`;
    if (status === 'connecting' || status === 'signing' || status === 'authenticating' || status === 'processing') {
      className += ' loading';
    }
    if (status === 'success') className += ' success';
    if (status === 'error') className += ' error';
    return className;
  };

  return (
            <div className="connect-form">
      <h2>Connect to Socialism Platform</h2>
      <p>Choose your preferred connection method:</p>
      
      <div className="connect-options">
        {/* Ethereum Login */}
        <button
          className={getButtonClass('ethereum')}
          onClick={handleEthereumLogin}
          disabled={isLoading || loginStatus.ethereum === 'connecting' || loginStatus.ethereum === 'signing' || loginStatus.ethereum === 'authenticating'}
        >
          <span className="login-icon">⟠</span>
          {getButtonText('ethereum')}
        </button>

        {/* ORCID Login */}
        <button
          className={getButtonClass('orcid')}
          onClick={() => handleOAuthLogin('orcid')}
          disabled={isLoading || loginStatus.orcid === 'processing'}
        >
          <span className="login-icon">🎓</span>
          {getButtonText('orcid')}
        </button>

        {/* GitHub Login */}
        <button
          className={getButtonClass('github')}
          onClick={() => handleOAuthLogin('github')}
          disabled={isLoading || loginStatus.github === 'processing'}
        >
          <span className="login-icon">👨‍💻</span>
          {getButtonText('github')}
        </button>

        {/* BitBucket Login */}
        <button
          className={getButtonClass('bitbucket')}
          onClick={() => handleOAuthLogin('bitbucket')}
          disabled={isLoading || loginStatus.bitbucket === 'processing'}
        >
          <span className="login-icon">🪣</span>
          {getButtonText('bitbucket')}
        </button>

        {/* GitLab Login */}
        <button
          className={getButtonClass('gitlab')}
          onClick={() => handleOAuthLogin('gitlab')}
          disabled={isLoading || loginStatus.gitlab === 'processing'}
        >
          <span className="login-icon">🦊</span>
          {getButtonText('gitlab')}
        </button>
      </div>

      {/* Error Display */}
      {Object.entries(loginStatus).map(([provider, status]) => 
        status === 'error' && (
          <div key={provider} className="error-message">
            {provider.toUpperCase()} connection failed: {loginStatus.error}
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

export default LoginForm;
