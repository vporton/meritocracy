import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import axios from 'axios';
import { API_BASE_URL, User, AuthData, authApi } from '../services/api';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (authData: AuthData, provider: string) => Promise<{ success: boolean; error?: string; user?: User }>;
  registerEmail: (email: string, name?: string) => Promise<{ success: boolean; error?: string; user?: User; requiresVerification?: boolean; message?: string }>;
  verifyEmail: (token: string) => Promise<{ success: boolean; error?: string; user?: User }>;
  resendVerification: (email?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<User | undefined>;
  updateAuthData: (userData: User, sessionToken: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const AUTH_SYNC_STORAGE_KEY = 'meritocracy-auth-sync';

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState<string | null>(localStorage.getItem('authToken'));

  const notifyAuthSync = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.setItem(AUTH_SYNC_STORAGE_KEY, Date.now().toString());
  }, []);

  // Set up axios interceptor for auth token
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  // Check if user is authenticated on app start
  useEffect(() => {
    const checkAuth = async () => {
      if (token) {
        try {
          const response = await axios.get(`${API_BASE_URL}/api/auth/me`);
          setUser(response.data.user);
        } catch (error) {
          console.error('Authentication check failed:', error);
          logout();
        }
      }
      setIsLoading(false);
    };

    checkAuth();
  }, [token, API_BASE_URL]);

  const login = useCallback(async (authData: AuthData, provider: string) => {
    try {
      setIsLoading(true);

      // Create headers object
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Include authorization header if user is already logged in (for connecting additional accounts)
      const authToken = localStorage.getItem('authToken');
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await axios.post(`${API_BASE_URL}/api/auth/login/${provider}`, authData, {
        headers
      });

      const { user: userData, session } = response.data;
      setUser(userData);
      setToken(session.token);
      localStorage.setItem('authToken', session.token);
      notifyAuthSync();

      return { success: true, user: userData };
    } catch (error: any) {
      console.error('Login failed:', error);
      return {
        success: false,
        error: error.response?.data?.error || 'Login failed'
      };
    } finally {
      setIsLoading(false);
    }
  }, [API_BASE_URL, notifyAuthSync]);

  const logout = useCallback(async () => {
    try {
      if (token) {
        await axios.post(`${API_BASE_URL}/api/auth/logout`);
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      setToken(null);
      localStorage.removeItem('authToken');
      delete axios.defaults.headers.common['Authorization'];
      notifyAuthSync();
    }
  }, [token, API_BASE_URL, notifyAuthSync]);

  const refreshUser = useCallback(async (overrideToken?: string): Promise<User | undefined> => {
    const authToken = overrideToken ?? token ?? localStorage.getItem('authToken');

    if (authToken) {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
        setUser(response.data.user);
        return response.data.user;
      } catch (error) {
        console.error('Failed to refresh user data:', error);
        throw error;
      }
    }
  }, [token, API_BASE_URL]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'authToken') {
        setToken(event.newValue);

        if (!event.newValue) {
          setUser(null);
          return;
        }

        void refreshUser(event.newValue);
        return;
      }

      if (event.key === AUTH_SYNC_STORAGE_KEY && token) {
        void refreshUser();
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [refreshUser, token]);

  const registerEmail = useCallback(async (email: string, name?: string) => {
    try {
      setIsLoading(true);

      const response = await authApi.registerEmail(email, name);
      const { message, user: userData, session, requiresVerification } = response.data;

      console.log('Email registration response:', { message, requiresVerification });

      if (session) {
        setUser(userData);
        setToken(session.token);
        localStorage.setItem('authToken', session.token);
        notifyAuthSync();
      } else if (localStorage.getItem('authToken')) {
        // An already-authenticated user may be attaching an additional email.
        setUser(userData);
        notifyAuthSync();
      }

      return {
        success: true,
        user: userData,
        requiresVerification,
        message
      };
    } catch (error: any) {
      console.error('Email registration failed:', error);
      return {
        success: false,
        error: error.response?.data?.error || 'Email registration failed'
      };
    } finally {
      setIsLoading(false);
    }
  }, [notifyAuthSync]);

  const verifyEmail = useCallback(async (token: string) => {
    try {
      setIsLoading(true);

      const response = await authApi.verifyEmail(token);
      const { user: userData, session } = response.data;

      setUser(userData);
      setToken(session.token);
      localStorage.setItem('authToken', session.token);
      notifyAuthSync();

      return {
        success: true,
        user: userData
      };
    } catch (error: any) {
      console.error('Email verification failed:', error);
      return {
        success: false,
        error: error.response?.data?.error || 'Email verification failed'
      };
    } finally {
      setIsLoading(false);
    }
  }, [notifyAuthSync]);

  const resendVerification = useCallback(async (email?: string) => {
    try {
      setIsLoading(true);

      await authApi.resendVerification(email);

      return {
        success: true
      };
    } catch (error: any) {
      console.error('Resend verification failed:', error);
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to resend verification email'
      };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateAuthData = useCallback((userData: User, sessionToken: string) => {
    setUser(userData);
    setToken(sessionToken);
    localStorage.setItem('authToken', sessionToken);
    notifyAuthSync();
  }, [notifyAuthSync]);

  const value = useMemo(() => ({
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    registerEmail,
    verifyEmail,
    resendVerification,
    logout,
    refreshUser,
    updateAuthData,
  }), [user, isLoading, login, registerEmail, verifyEmail, resendVerification, logout, refreshUser, updateAuthData]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
