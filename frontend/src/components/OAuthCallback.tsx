import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

interface OAuthCallbackProps {
  provider: string;
}

const OAuthCallback = ({ provider }: OAuthCallbackProps) => {
  const location = useLocation();
  const hasProcessed = useRef(false);

  useEffect(() => {
    // Prevent duplicate processing
    if (hasProcessed.current) {
      return;
    }

    const handleCallback = async () => {
      // Mark as processed immediately to prevent any race conditions
      hasProcessed.current = true;

      const urlParams = new URLSearchParams(location.search);
      const code = urlParams.get('code');
      const error = urlParams.get('error');

      console.log('OAuth callback processing:', { provider, code: code ? 'present' : 'missing', error });

      if (error) {
        const errorMessage = {
          type: 'OAUTH_ERROR',
          provider,
          error: error
        };
        console.log('XXX Sending OAuth error message:', errorMessage);
        (window.opener as Window)!.postMessage(errorMessage, window.location.origin);
        setTimeout(() => {
          console.log('XXX Closing popup window (error case)');
          try {
            window.close();
            if (!window.closed) {
              console.log('XXX window.close() failed in error case, trying alternative');
              window.location.href = 'about:blank';
              setTimeout(() => window.close(), 100);
            }
          } catch (error) {
            console.error('XXX Error closing popup (error case):', error);
          }
        }, 100);
        return;
      }

      if (code) {
        try {
          console.log('Sending OAuth code to backend...');
          // Send the authorization code to the backend for secure token exchange
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          
          // Include authorization header if user is already logged in
          const authToken = localStorage.getItem('authToken');
          if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
          }
          
          const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/auth/${provider}/callback`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ code }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            console.error('Backend OAuth error:', errorData);
            throw new Error(errorData.error || 'OAuth authentication failed');
          }

          const authData = await response.json();
          console.log('OAuth success, sending message to parent');
          
          // Send the authentication result back to the parent window
          const message = {
            type: 'OAUTH_SUCCESS',
            provider,
            authData
          };
          
          console.log('XXX Sending OAuth success message:', message);
          (window.opener as Window)!.postMessage(message, window.location.origin);
          
          // Add a small delay before closing to ensure message is received
          setTimeout(() => {
            console.log('XXX Closing popup window');
            try {
              window.close();
              // If window.close() doesn't work, try alternative methods
              if (!window.closed) {
                console.log('XXX window.close() failed, trying alternative');
                window.location.href = 'about:blank';
                setTimeout(() => window.close(), 100);
              }
            } catch (error) {
              console.error('XXX Error closing popup:', error);
            }
          }, 100);
        } catch (error: any) {
          console.error('OAuth callback error:', error);
          const errorMessage = {
            type: 'OAUTH_ERROR',
            provider,
            error: error.message
          };
          console.log('XXX Sending OAuth error message (catch):', errorMessage);
          (window.opener as Window)!.postMessage(errorMessage, window.location.origin);
          setTimeout(() => {
            console.log('XXX Closing popup window (catch error)');
            try {
              window.close();
              if (!window.closed) {
                console.log('XXX window.close() failed in catch error, trying alternative');
                window.location.href = 'about:blank';
                setTimeout(() => window.close(), 100);
              }
            } catch (error) {
              console.error('XXX Error closing popup (catch error):', error);
            }
          }, 100);
        }
      }
    };

    handleCallback();
  }, [location.search, provider]); // Use location.search instead of location object



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
