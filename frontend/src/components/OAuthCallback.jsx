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
          // Send the authorization code to the backend for secure token exchange
          const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/auth/oauth/${provider}/callback`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ code }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'OAuth authentication failed');
          }

          const authData = await response.json();
          
          // Send the authentication result back to the parent window
          window.opener?.postMessage({
            type: 'OAUTH_SUCCESS',
            provider,
            authData
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
