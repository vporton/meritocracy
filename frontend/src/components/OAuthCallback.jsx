import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const OAuthCallback = ({ provider }) => {
  const location = useLocation();

  useEffect(() => {
    const handleCallback = async () => {
      const urlParams = new URLSearchParams(location.search);
      const code = urlParams.get('code');
      const error = urlParams.get('error');

      if (error) {
        window.opener?.postMessage({
          type: 'OAUTH_ERROR',
          provider,
          error: error
        }, window.location.origin);
        window.close();
        return;
      }

      if (code) {
        try {
          // Exchange the code for user data
          const userData = await exchangeCodeForUserData(provider, code);
          
          // Send the user data back to the parent window
          window.opener?.postMessage({
            type: 'OAUTH_SUCCESS',
            provider,
            userData
          }, window.location.origin);
          
          window.close();
        } catch (error) {
          console.error('OAuth callback error:', error);
          window.opener?.postMessage({
            type: 'OAUTH_ERROR',
            provider,
            error: error.message
          }, window.location.origin);
          window.close();
        }
      }
    };

    handleCallback();
  }, [location, provider]);

  const exchangeCodeForUserData = async (provider, code) => {
    const clientIds = {
      github: import.meta.env.VITE_GITHUB_CLIENT_ID,
      orcid: import.meta.env.VITE_ORCID_CLIENT_ID,
      bitbucket: import.meta.env.VITE_BITBUCKET_CLIENT_ID,
      gitlab: import.meta.env.VITE_GITLAB_CLIENT_ID,
    };

    switch (provider) {
      case 'github':
        return await handleGitHubCallback(code, clientIds.github);
      case 'orcid':
        return await handleORCIDCallback(code, clientIds.orcid);
      case 'bitbucket':
        return await handleBitBucketCallback(code, clientIds.bitbucket);
      case 'gitlab':
        return await handleGitLabCallback(code, clientIds.gitlab);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  };

  const handleGitHubCallback = async (code, clientId) => {
    // Note: In a production app, this token exchange should happen on the backend
    // for security reasons. This is a simplified implementation.
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: '', // This should be handled on the backend
        code: code,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await response.json();
    
    // Get user data from GitHub API
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${tokenData.access_token}`,
      },
    });

    if (!userResponse.ok) {
      throw new Error('Failed to fetch user data');
    }

    const userData = await userResponse.json();
    
    return {
      githubHandle: userData.login,
      name: userData.name,
      email: userData.email,
      accessToken: tokenData.access_token,
    };
  };

  const handleORCIDCallback = async (code, clientId) => {
    // Similar to GitHub but for ORCID
    const response = await fetch('https://orcid.org/oauth/token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: '', // This should be handled on the backend
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: import.meta.env.VITE_ORCID_REDIRECT_URI,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await response.json();
    
    return {
      orcidId: tokenData.orcid,
      name: tokenData.name,
      accessToken: tokenData.access_token,
    };
  };

  const handleBitBucketCallback = async (code, clientId) => {
    // Similar implementation for BitBucket
    const response = await fetch('https://bitbucket.org/site/oauth2/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: clientId,
        client_secret: '', // This should be handled on the backend
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await response.json();
    
    // Get user data from BitBucket API
    const userResponse = await fetch('https://api.bitbucket.org/2.0/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });

    if (!userResponse.ok) {
      throw new Error('Failed to fetch user data');
    }

    const userData = await userResponse.json();
    
    return {
      bitbucketHandle: userData.username,
      name: userData.display_name,
      email: userData.email,
      accessToken: tokenData.access_token,
    };
  };

  const handleGitLabCallback = async (code, clientId) => {
    // Similar implementation for GitLab
    const response = await fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: '', // This should be handled on the backend
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: import.meta.env.VITE_GITLAB_REDIRECT_URI,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await response.json();
    
    // Get user data from GitLab API
    const userResponse = await fetch('https://gitlab.com/api/v4/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });

    if (!userResponse.ok) {
      throw new Error('Failed to fetch user data');
    }

    const userData = await userResponse.json();
    
    return {
      gitlabHandle: userData.username,
      name: userData.name,
      email: userData.email,
      accessToken: tokenData.access_token,
    };
  };

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      fontSize: '18px'
    }}>
      Processing {provider} authentication...
    </div>
  );
};

export default OAuthCallback;
