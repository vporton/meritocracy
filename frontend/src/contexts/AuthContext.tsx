import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';
import { User, AuthData } from '../services/api';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (authData: AuthData, provider: string) => Promise<{ success: boolean; error?: string; user?: User }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<User | undefined>;
  updateAuthData: (userData: User, sessionToken: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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

  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

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

  const login = async (authData: AuthData, provider: string) => {
    try {
      setIsLoading(true);
      const response = await axios.post(`${API_BASE_URL}/api/auth/login/${provider}`, authData);
      
      const { user: userData, session } = response.data;
      setUser(userData);
      setToken(session.token);
      localStorage.setItem('authToken', session.token);
      
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
  };

  const logout = async () => {
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
    }
  };

  const refreshUser = async (): Promise<User | undefined> => {
    if (token) {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/auth/me`);
        setUser(response.data.user);
        return response.data.user;
      } catch (error) {
        console.error('Failed to refresh user data:', error);
        throw error;
      }
    }
  };

  const updateAuthData = (userData: User, sessionToken: string) => {
    setUser(userData);
    setToken(sessionToken);
    localStorage.setItem('authToken', sessionToken);
  };

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    refreshUser,
    updateAuthData,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
