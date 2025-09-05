import { useState, useEffect } from 'react';
import { useConnect, useAccount, useSignMessage } from 'wagmi';
import { useAuth } from '../contexts/AuthContext';
import './LoginForm.css';

const LoginForm = () => {
  const { login, isLoading } = useAuth();
  const { connect, connectors, error: connectError, isLoading: connectLoading } = useConnect();
  const { address, isConnected } = useAccount();
  const { signMessage } = useSignMessage();
  const [loginStatus, setLoginStatus] = useState({});

  // Monitor wagmi connection state changes
  useEffect(() => {
    if (connectError) {
      console.error('MetaMask connection error:', connectError);
      setLoginStatus({ ethereum: 'error', error: connectError.message });
    } else if (!connectLoading && isConnected && loginStatus.ethereum === 'connecting') {
      // Connection successful, now proceed with signing
      handleEthereumSignAndLogin();
    }
  }, [connectError, connectLoading, isConnected, loginStatus.ethereum]);

  // Separate function for signing and login after successful connection
  const handleEthereumSignAndLogin = async () => {
    try {
      setLoginStatus({ ethereum: 'processing' });
      
      // Sign a message to prove ownership
      const message = `Login to Socialism platform with address: ${address}`;
      const signature = await signMessage({ message });

      const result = await login({
        ethereumAddress: address,
        signature,
        message
      }, 'ethereum');

      if (result.success) {
        setLoginStatus({ ethereum: 'success' });
      } else {
        setLoginStatus({ ethereum: 'error', error: result.error });
      }
    } catch (error) {
      console.error('Ethereum sign/login error:', error);
      setLoginStatus({ ethereum: 'error', error: error.message });
    }
  };

  // Ethereum/Web3 Login
  const handleEthereumLogin = async () => {
    try {
      if (!isConnected) {
        // Connect wallet first - the useEffect will handle the rest
        setLoginStatus({ ethereum: 'connecting' });
        const connector = connectors.find(c => c.name === 'MetaMask') || connectors[0];
        await connect({ connector });
      } else {
        // Already connected, proceed directly to sign and login
        await handleEthereumSignAndLogin();
      }
    } catch (error) {
      console.error('Ethereum login error:', error);
      setLoginStatus({ ethereum: 'error', error: error.message });
    }
  };

  // OAuth Login Handler
  const handleOAuthLogin = (provider) => {
    const clientIds = {
      github: import.meta.env.VITE_GITHUB_CLIENT_ID,
      orcid: import.meta.env.VITE_ORCID_CLIENT_ID,
      bitbucket: import.meta.env.VITE_BITBUCKET_CLIENT_ID,
      gitlab: import.meta.env.VITE_GITLAB_CLIENT_ID,
    };

    const redirectUris = {
      github: import.meta.env.VITE_GITHUB_REDIRECT_URI,
      orcid: import.meta.env.VITE_ORCID_REDIRECT_URI,
      bitbucket: import.meta.env.VITE_BITBUCKET_REDIRECT_URI,
      gitlab: import.meta.env.VITE_GITLAB_REDIRECT_URI,
    };

    const authUrls = {
      github: `https://github.com/login/oauth/authorize?client_id=${clientIds.github}&redirect_uri=${encodeURIComponent(redirectUris.github)}&scope=user:email`,
      orcid: `https://orcid.org/oauth/authorize?client_id=${clientIds.orcid}&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(redirectUris.orcid)}`,
      bitbucket: `https://bitbucket.org/site/oauth2/authorize?client_id=${clientIds.bitbucket}&response_type=code&redirect_uri=${encodeURIComponent(redirectUris.bitbucket)}`,
      gitlab: `https://gitlab.com/oauth/authorize?client_id=${clientIds.gitlab}&redirect_uri=${encodeURIComponent(redirectUris.gitlab)}&response_type=code&scope=read_user`,
    };

    if (!clientIds[provider]) {
      alert(`${provider.toUpperCase()} client ID not configured`);
      return;
    }

    // Open OAuth flow in popup window
    const popup = window.open(
      authUrls[provider],
      `${provider}_oauth`,
      'width=600,height=600,scrollbars=yes,resizable=yes'
    );

    // Listen for the OAuth callback
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        setLoginStatus({ [provider]: 'cancelled' });
      }
    }, 1000);

    // Handle the OAuth callback message
    const handleMessage = async (event) => {
      if (event.origin !== window.location.origin) return;
      
      if (event.data.type === 'OAUTH_SUCCESS' && event.data.provider === provider) {
        clearInterval(checkClosed);
        popup.close();
        
        try {
          setLoginStatus({ [provider]: 'processing' });
          const result = await login(event.data.userData, provider);
          
          if (result.success) {
            setLoginStatus({ [provider]: 'success' });
          } else {
            setLoginStatus({ [provider]: 'error', error: result.error });
          }
        } catch (error) {
          setLoginStatus({ [provider]: 'error', error: error.message });
        }
        
        window.removeEventListener('message', handleMessage);
      }
    };

    window.addEventListener('message', handleMessage);
  };

  const getButtonText = (provider) => {
    const status = loginStatus[provider];
    switch (status) {
      case 'connecting':
        return 'Connecting...';
      case 'processing':
        return 'Processing...';
      case 'success':
        return 'Success!';
      case 'error':
        return 'Try Again';
      case 'cancelled':
        return 'Try Again';
      default:
        return `Login with ${provider.charAt(0).toUpperCase() + provider.slice(1)}`;
    }
  };

  const getButtonClass = (provider) => {
    const status = loginStatus[provider];
    let className = `login-button ${provider}-button`;
    if (status === 'connecting' || status === 'processing') className += ' loading';
    if (status === 'success') className += ' success';
    if (status === 'error') className += ' error';
    return className;
  };

  return (
    <div className="login-form">
      <h2>Login to Socialism Platform</h2>
      <p>Choose your preferred login method:</p>
      
      <div className="login-options">
        {/* Ethereum Login */}
        <button
          className={getButtonClass('ethereum')}
          onClick={handleEthereumLogin}
          disabled={isLoading || loginStatus.ethereum === 'connecting' || loginStatus.ethereum === 'processing'}
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
            {provider.toUpperCase()} login failed: {loginStatus.error}
          </div>
        )
      )}

      <div className="login-info">
        <p>
          <strong>Note:</strong> If you have accounts on multiple platforms, they will be automatically merged into one account.
        </p>
      </div>
    </div>
  );
};

export default LoginForm;
