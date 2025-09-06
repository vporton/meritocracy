import { useState, useEffect } from 'react';
import { useConnect, useAccount, useSignMessage } from 'wagmi';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import './ConnectForm.css';

const ConnectForm = () => {
  const { login, isLoading, isAuthenticated, user } = useAuth();
  const { connect, connectors, error: connectError, isLoading: connectLoading } = useConnect();
  const { address, isConnected } = useAccount();
  const { signMessage, signMessageAsync, error: signError, isLoading: isSigningLoading } = useSignMessage();
  const [connectStatus, setConnectStatus] = useState({});
  const navigate = useNavigate();
  
  // Show connected status and allow connecting more accounts
  const renderConnectedStatus = () => {
    if (isAuthenticated) {
      return (
        <div className="connected-status">
          <h3>✅ Connected Accounts</h3>
          <p>You are successfully authenticated. You can connect additional accounts below.</p>
          <div className="connected-user-info">
            <strong>Current user:</strong> {user?.name || 'User'}
          </div>
        </div>
      );
    }
    return null;
  };

  // Ethereum/Web3 Connect
  const handleEthereumConnect = async () => {
    console.log('=== ETHEREUM CONNECT STARTED ===');
    console.log('Initial state - isConnected:', isConnected, 'address:', address);
    
    try {
      // Set connecting status immediately
      console.log('Setting status to connecting');
      setConnectStatus({ ethereum: 'connecting' });
      
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
      setConnectStatus({ ethereum: 'signing' });
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
      setConnectStatus({ ethereum: 'authenticating' });
      
      console.log('Calling backend login API...');
      const authResult = await login({
        ethereumAddress: currentAddress,
        signature,
        message
      }, 'ethereum');
      console.log('Backend login result:', authResult);

      if (authResult.success) {
        console.log('Connect successful! Setting status to success');
        setConnectStatus({ ethereum: 'success' });
        // Reset status after a short delay to allow connecting more accounts
        setTimeout(() => setConnectStatus({}), 2000);
      } else {
        console.log('Connect failed. Setting status to error');
        setConnectStatus({ ethereum: 'error', error: authResult.error });
      }
    } catch (error) {
      console.error('ERROR in handleEthereumConnect:', error);
      console.log('Error type:', typeof error);
      console.log('Error message:', error.message);
      console.log('Error stack:', error.stack);
      
      if (error.message.includes('rejected') || error.message.includes('cancelled')) {
        console.log('Setting status to cancelled');
        setConnectStatus({ ethereum: 'cancelled' });
      } else {
        console.log('Setting status to error');
        setConnectStatus({ ethereum: 'error', error: error.message });
      }
    }
    
    console.log('=== ETHEREUM CONNECT ENDED ===');
  };

  // OAuth Connect Handler
  const handleOAuthConnect = (provider) => {
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
        setConnectStatus({ [provider]: 'cancelled' });
      }
    }, 1000);

    // Handle the OAuth callback message
    const handleMessage = async (event) => {
      if (event.origin !== window.location.origin) return;
      
      if (event.data.type === 'OAUTH_SUCCESS' && event.data.provider === provider) {
        clearInterval(checkClosed);
        popup.close();
        
        try {
          setConnectStatus({ [provider]: 'processing' });
          const result = await login(event.data.userData, provider);
          
          if (result.success) {
            setConnectStatus({ [provider]: 'success' });
            // Reset status after a short delay to allow connecting more accounts
            setTimeout(() => setConnectStatus({}), 2000);
          } else {
            setConnectStatus({ [provider]: 'error', error: result.error });
          }
        } catch (error) {
          setConnectStatus({ [provider]: 'error', error: error.message });
        }
        
        window.removeEventListener('message', handleMessage);
      }
    };

    window.addEventListener('message', handleMessage);
  };

  const getButtonText = (provider) => {
    const status = connectStatus[provider];
    if (provider === 'ethereum') {
      console.log('getButtonText for ethereum - status:', status, 'full connectStatus:', connectStatus);
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

  const getButtonClass = (provider) => {
    const status = connectStatus[provider];
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
      
      {renderConnectedStatus()}
      
      <p>{isAuthenticated ? 'Connect additional accounts:' : 'Choose your preferred connection method:'}</p>
      
      <div className="connect-options">
        {/* Ethereum Connect */}
        <button
          className={getButtonClass('ethereum')}
          onClick={handleEthereumConnect}
          disabled={isLoading || connectStatus.ethereum === 'connecting' || connectStatus.ethereum === 'signing' || connectStatus.ethereum === 'authenticating'}
        >
          <span className="connect-icon">⟠</span>
          {getButtonText('ethereum')}
        </button>

        {/* ORCID Connect */}
        <button
          className={getButtonClass('orcid')}
          onClick={() => handleOAuthConnect('orcid')}
          disabled={isLoading || connectStatus.orcid === 'processing'}
        >
          <span className="connect-icon">🎓</span>
          {getButtonText('orcid')}
        </button>

        {/* GitHub Connect */}
        <button
          className={getButtonClass('github')}
          onClick={() => handleOAuthConnect('github')}
          disabled={isLoading || connectStatus.github === 'processing'}
        >
          <span className="connect-icon">👨‍💻</span>
          {getButtonText('github')}
        </button>

        {/* BitBucket Connect */}
        <button
          className={getButtonClass('bitbucket')}
          onClick={() => handleOAuthConnect('bitbucket')}
          disabled={isLoading || connectStatus.bitbucket === 'processing'}
        >
          <span className="connect-icon">🪣</span>
          {getButtonText('bitbucket')}
        </button>

        {/* GitLab Connect */}
        <button
          className={getButtonClass('gitlab')}
          onClick={() => handleOAuthConnect('gitlab')}
          disabled={isLoading || connectStatus.gitlab === 'processing'}
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
