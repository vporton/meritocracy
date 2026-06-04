import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { API_BASE_URL } from '../services/api';

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

      if (error) {
        const errorMessage = {
          type: 'OAUTH_ERROR',
          provider,
          error: error
        };
        (window.opener as Window)!.postMessage(errorMessage, window.location.origin);
        setTimeout(() => {
          try {
            window.close();
            if (!window.closed) {
              window.location.href = 'about:blank';
              setTimeout(() => window.close(), 100);
            }
          } catch (error) {
            console.error('Error closing popup (error case):', error);
          }
        }, 100);
        return;
      }

      if (code) {
        try {
          // Send the authorization code to the backend for secure token exchange
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          
          // Include authorization header if user is already logged in
          const authToken = localStorage.getItem('authToken');
          if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
          }
          
          const response = await fetch(`${API_BASE_URL}/api/auth/${provider}/callback?code=${code}`, {
            method: 'GET',
            headers,
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'OAuth authentication failed');
          }

          const authData = await response.json();
          
          // Send the authentication result back to the parent window
          const message = {
            type: 'OAUTH_SUCCESS',
            provider,
            authData
          };
          
          (window.opener as Window)!.postMessage(message, window.location.origin);
          
          // Add a small delay before closing to ensure message is received
          setTimeout(() => {
            try {
              window.close();
              // If window.close() doesn't work, try alternative methods
              if (!window.closed) {
                window.location.href = 'about:blank';
                setTimeout(() => window.close(), 100);
              }
            } catch (error) {
              console.error('Error closing popup:', error);
            }
          }, 100);
        } catch (error: any) {
          console.error('OAuth callback error:', error);
          const errorMessage = {
            type: 'OAUTH_ERROR',
            provider,
            error: error.message
          };
          (window.opener as Window)!.postMessage(errorMessage, window.location.origin);
          setTimeout(() => {
            try {
              window.close();
              if (!window.closed) {
                window.location.href = 'about:blank';
                setTimeout(() => window.close(), 100);
              }
            } catch (error) {
              console.error('Error closing popup (catch error):', error);
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
