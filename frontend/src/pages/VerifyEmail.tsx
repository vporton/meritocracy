import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Helmet } from 'react-helmet-async';
import './VerifyEmail.css';

const VerifyEmail = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { verifyEmail, resendVerification, user, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'resending'>('verifying');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const token = searchParams.get('token');

  const verificationStarted = useRef(false);
  const pendingEmail = user?.emails?.find(email => !email.verified)?.email;

  useEffect(() => {
    if (!token || verificationStarted.current) {
      if (!token) {
        setStatus('error');
        setError('No verification token provided');
      }
      return;
    }

    verificationStarted.current = true;

    const handleVerification = async () => {
      try {
        setStatus('verifying');
        const result = await verifyEmail(token);

        if (result.success) {
          setStatus('success');
          setMessage('Your email has been verified successfully!');
          // Redirect to home page after 3 seconds
          setTimeout(() => {
            navigate('/');
          }, 3000);
        } else {
          setStatus('error');
          setError(result.error || 'Verification failed');
        }
      } catch (err) {
        setStatus('error');
        setError('An unexpected error occurred during verification');
      }
    };

    handleVerification();
  }, [token, verifyEmail, navigate]);

  const handleResendVerification = async () => {
    try {
      setStatus('resending');
      const result = await resendVerification(pendingEmail);

      if (result.success) {
        setMessage('Verification email sent successfully! Please check your inbox.');
        setStatus('success');
      } else {
        setError(result.error || 'Failed to resend verification email');
        setStatus('error');
      }
    } catch (err) {
      setError('An unexpected error occurred while resending verification email');
      setStatus('error');
    }
  };

  const handleGoHome = () => {
    navigate('/');
  };

  return (
    <div className="verify-email">
      <Helmet>
        <title>Email Verification · Meritocracy Platform</title>
        <meta
          name="description"
          content="Track the status of your Meritocracy email verification and resend the verification link if necessary."
        />
      </Helmet>
      <div className="verify-email-container">
        <h1>Email Verification</h1>

        {status === 'verifying' && (
          <div className="status-message verifying">
            <div className="spinner"></div>
            <p>Verifying your email address...</p>
          </div>
        )}

        {status === 'success' && (
          <div className="status-message success">
            <div className="success-icon">✓</div>
            <p>{message}</p>
            <p className="redirect-message">You will be redirected to the home page in a few seconds...</p>
            <button onClick={handleGoHome} className="home-button">
              Go to Home Page
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="status-message error">
            <div className="error-icon">✗</div>
            <p className="error-text">{error}</p>

            {isAuthenticated && user && pendingEmail && (
              <div className="resend-section">
                <p>Didn't receive the verification email?</p>
                <button
                  onClick={handleResendVerification}
                  disabled={false}
                  className="resend-button"
                >
                  Resend Verification Email
                </button>
              </div>
            )}

            <button onClick={handleGoHome} className="home-button">
              Go to Home Page
            </button>
          </div>
        )}

        {status === 'resending' && (
          <div className="status-message resending">
            <div className="spinner"></div>
            <p>Sending verification email...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
