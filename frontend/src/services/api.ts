import axios, { AxiosResponse } from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add request interceptor to include auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

interface User {
  id: number;
  email?: string;
  emailVerified?: boolean;
  emails?: Array<{
    email: string;
    verified: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  name?: string;
  ethereumAddress?: string;
  solanaAddress?: string | null;
  bitcoinAddress?: string | null;
  bitcoinCashAddress?: string | null;
  polkadotAddress?: string | null;
  cosmosAddress?: string | null;
  stellarAddress?: string | null;
  icpAddress?: string | null;
  orcidId?: string;
  githubHandle?: string;
  bitbucketHandle?: string;
  gitlabHandle?: string;
  onboarded: boolean;
  shareInGDP?: number;
  // KYC fields
  kycStatus?: string;
  kycVerifiedAt?: string;
  kycRejectedAt?: string;
  kycRejectionReason?: string;
  createdAt: string;
  updatedAt: string;
  votingPleaUnsubscribed?: boolean;
  // KYC Voting fields
  kycVotingStatus?: string;
  kycVotingVerifiedAt?: string;
  kycVotingRejectedAt?: string;
  kycVotingRejectionReason?: string;
}

interface Post {
  id: number;
  title: string;
  content?: string;
  published: boolean;
  authorId: number;
  author: Pick<User, 'id' | 'name' | 'email'>;
  createdAt: string;
  updatedAt: string;
}

interface CreateUserData {
  email: string;
  name?: string;
}

interface CreatePostData {
  title: string;
  content?: string;
  published?: boolean;
  authorId: number;
}

interface UpdateUserData {
  email?: string;
  name?: string;
  ethereumAddress?: string | null;
  solanaAddress?: string | null;
  bitcoinAddress?: string | null;
  bitcoinCashAddress?: string | null;
  polkadotAddress?: string | null;
  cosmosAddress?: string | null;
  stellarAddress?: string | null;
  icpAddress?: string | null;
  votingPleaUnsubscribed?: boolean;
}

interface UpdatePostData {
  title?: string;
  content?: string;
  published?: boolean;
}

interface SalaryStats {
  worldGdp: number;
  userCount: number;
  totalRecommendedSalary: number;
  averageRecommendedSalary: number;
  medianRecommendedSalary: number;
}

interface TokenPriceQuote {
  symbol: string;
  coinId: string;
  usd: number;
  lastUpdatedAt: string | null;
  source: 'coingecko';
}

interface AuthData {
  ethereumAddress?: string;
  signature?: string;
  message?: string;
  name?: string;
  orcidId?: string;
  accessToken?: string;
  email?: string;
  githubHandle?: string;
  bitbucketHandle?: string;
  gitlabHandle?: string;
  token?: string; // For email verification
}

interface DBLogEntry {
  id: string;
  type: 'openai' | 'task' | 'user' | 'session';
  timestamp: string;
  userId?: number;
  user?: {
    id: number;
    name?: string | null;
    ethereumAddress?: string | null;
    solanaAddress?: string | null;
    bitcoinAddress?: string | null;
    bitcoinCashAddress?: string | null;
    polkadotAddress?: string | null;
    cosmosAddress?: string | null;
    stellarAddress?: string | null;
    icpAddress?: string | null;
    orcidId?: string | null;
    githubHandle?: string | null;
    bitbucketHandle?: string | null;
    gitlabHandle?: string | null;
  };
  taskId?: number;
  action: string;
  details: any;
  // New structure for OpenAI logs
  request?: {
    data: any;
    timestamp: string;
    status: string;
  };
  response?: {
    data: any;
    timestamp?: string;
    status: string;
    error?: string;
  };
  status?: string;
  error?: string;
}

interface LogsFilter {
  userId?: number;
  taskId?: number;
  type?: 'openai' | 'task' | 'user' | 'session';
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

interface LogStats {
  totalLogs: number;
  logsByType: Record<string, number>;
  logsByUser: Record<number, number>;
  recentActivity: number;
}

interface LogTypes {
  [key: string]: {
    name: string;
    description: string;
    fields: string[];
  };
}

interface LeaderboardEntry {
  rank: number;
  userId: number;
  name: string;
  shareInGDP: number;
}

// Users API
export const usersApi = {
  getAll: (): Promise<AxiosResponse<User[]>> => api.get('/api/users'),
  getById: (id: number): Promise<AxiosResponse<User>> => api.get(`/api/users/${id}`),
  create: (userData: CreateUserData): Promise<AxiosResponse<User>> => api.post('/api/users', userData),
  update: (id: number, userData: UpdateUserData): Promise<AxiosResponse<User>> => api.put(`/api/users/${id}`, userData),
  delete: (id: number): Promise<AxiosResponse<void>> => api.delete(`/api/users/${id}`),
  getMyGdpShare: (): Promise<AxiosResponse<{ success: boolean; data?: { userId: number; name?: string; email?: string; shareInGDP: number | null; formatted?: string }; message?: string }>> =>
    api.get('/api/users/me/gdp-share'),
  getLeaderboard: (limit?: number): Promise<AxiosResponse<{ success: boolean; data: { leaderboard: LeaderboardEntry[]; total: number; limit: number } }>> =>
    api.get('/api/users/leaderboard', { params: limit ? { limit } : {} }),
  getSalaryStats: (): Promise<AxiosResponse<{ success: boolean; data: SalaryStats }>> =>
    api.get('/api/users/salary-stats'),
}

// Posts API
export const postsApi = {
  getAll: (published?: boolean): Promise<AxiosResponse<Post[]>> => {
    const params = published !== undefined ? { published } : {}
    return api.get('/api/posts', { params })
  },
  getById: (id: number): Promise<AxiosResponse<Post>> => api.get(`/api/posts/${id}`),
  create: (postData: CreatePostData): Promise<AxiosResponse<Post>> => api.post('/api/posts', postData),
  update: (id: number, postData: UpdatePostData): Promise<AxiosResponse<Post>> => api.put(`/api/posts/${id}`, postData),
  delete: (id: number): Promise<AxiosResponse<void>> => api.delete(`/api/posts/${id}`),
}

// Authentication API
export const authApi = {
  login: (provider: string, userData: AuthData): Promise<AxiosResponse<{ user: User; session: { token: string; expiresAt: string } }>> =>
    api.post(`/api/auth/login/${provider}`, userData),
  registerEmail: (email: string, name?: string): Promise<AxiosResponse<{ message: string; user: User; session?: { token: string; expiresAt: string }; requiresVerification?: boolean }>> =>
    api.post('/api/auth/register/email', { email, name }),
  verifyEmail: (token: string): Promise<AxiosResponse<{ message: string; user: User }>> =>
    api.post('/api/auth/verify/email', { token }),
  resendVerification: (email?: string): Promise<AxiosResponse<{ message: string }>> =>
    api.post('/api/auth/resend-verification', email ? { email } : {}),
  disconnectProvider: (provider: string, payload?: Record<string, unknown>): Promise<AxiosResponse<{ message: string; user: User }>> =>
    api.post(`/api/auth/disconnect/${provider}`, payload || {}),
  logout: (): Promise<AxiosResponse<{ message: string }>> => api.post('/api/auth/logout'),
  getCurrentUser: (): Promise<AxiosResponse<{ user: User }>> => api.get('/api/auth/me'),
  cleanupSessions: (): Promise<AxiosResponse<{ message: string; deletedCount: number }>> => api.delete('/api/auth/sessions/cleanup'),
  // KYC API
  initiateKyc: (kycToken?: string): Promise<AxiosResponse<{ url: string | null; sessionId: string | null; session?: { token: string; expiresAt: string }; user?: User; skipped?: boolean; message?: string }>> =>
    api.post('/api/auth/kyc/initiate', { kycToken }),
  getKycStatus: (): Promise<AxiosResponse<{ kycStatus?: string; kycVerifiedAt?: string; kycRejectedAt?: string; kycRejectionReason?: string }>> =>
    api.get('/api/auth/kyc/status'),
}

// Logs API
export const logsApi = {
  getAll: (filter?: LogsFilter): Promise<AxiosResponse<{ success: boolean; logs: DBLogEntry[]; count: number; filter: LogsFilter }>> =>
    api.get('/api/logs', { params: filter }),
  getMy: (filter?: Omit<LogsFilter, 'userId'>): Promise<AxiosResponse<{ success: boolean; logs: DBLogEntry[]; count: number; userId: number; filter: LogsFilter }>> =>
    api.get('/api/logs/my', { params: filter }),
  getUser: (userId: number, filter?: Omit<LogsFilter, 'userId'>): Promise<AxiosResponse<{ success: boolean; logs: DBLogEntry[]; count: number; userId: number; filter: LogsFilter }>> =>
    api.get(`/api/logs/user/${userId}`, { params: filter }),
  getStats: (): Promise<AxiosResponse<{ success: boolean; stats: LogStats }>> =>
    api.get('/api/logs/stats'),
  getTypes: (): Promise<AxiosResponse<{ success: boolean; logTypes: LogTypes }>> =>
    api.get('/api/logs/types'),
}

// Admin API
export const adminApi = {
  getStatus: (password: string): Promise<AxiosResponse<{ gasDistributionEnabled: boolean; cronStatus: any }>> =>
    api.get('/api/admin/status', { headers: { 'x-admin-password': password } }),
  toggleDistribution: (password: string, enabled: boolean): Promise<AxiosResponse<{ message: string; enabled: boolean }>> =>
    api.post('/api/admin/toggle-distribution', { enabled }, { headers: { 'x-admin-password': password } }),
  triggerDistribution: (password: string): Promise<AxiosResponse<{ message: string; result: any }>> =>
    api.post('/api/admin/trigger-distribution', {}, { headers: { 'x-admin-password': password } }),
  triggerReWorthAssessment: (password: string): Promise<AxiosResponse<{ message: string; result: any }>> =>
    api.post('/api/admin/trigger-re-worth-assessment', {}, { headers: { 'x-admin-password': password } }),
}

// World GDP API
export const worldGdpApi = {
  get: (): Promise<AxiosResponse<{ success: boolean; data: { worldGdp: number; formatted: string; currency: string; lastUpdated: string } }>> =>
    api.get('/api/global/gdp'),
}

export const tokenPricesApi = {
  get: (symbols: string[]): Promise<AxiosResponse<{ success: boolean; data: { quotes: Record<string, TokenPriceQuote>; source: string; requestedSymbols: string[]; supportedSymbols: string[] } }>> =>
    api.get('/api/global/token-prices', { params: { symbols: symbols.join(',') } }),
}

// Add response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message)
    return Promise.reject(error)
  }
)

export default api
export type { User, Post, CreateUserData, CreatePostData, UpdateUserData, UpdatePostData, AuthData, DBLogEntry, LogsFilter, LogStats, LogTypes, LeaderboardEntry, SalaryStats, TokenPriceQuote }
