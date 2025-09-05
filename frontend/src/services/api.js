import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Users API
export const usersApi = {
  getAll: () => api.get('/api/users'),
  getById: (id) => api.get(`/api/users/${id}`),
  create: (userData) => api.post('/api/users', userData),
  update: (id, userData) => api.put(`/api/users/${id}`, userData),
  delete: (id) => api.delete(`/api/users/${id}`),
}

// Posts API
export const postsApi = {
  getAll: (published) => {
    const params = published !== undefined ? { published } : {}
    return api.get('/api/posts', { params })
  },
  getById: (id) => api.get(`/api/posts/${id}`),
  create: (postData) => api.post('/api/posts', postData),
  update: (id, postData) => api.put(`/api/posts/${id}`, postData),
  delete: (id) => api.delete(`/api/posts/${id}`),
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
