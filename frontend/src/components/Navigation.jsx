import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function Navigation() {
  const location = useLocation()
  const { user, isAuthenticated, logout, isLoading } = useAuth()
  
  const isActive = (path) => location.pathname === path

  const handleLogout = async () => {
    await logout()
  }

  return (
    <nav className="nav">
      <div className="nav-left">
        <Link 
          to="/" 
          className={`nav-link ${isActive('/') ? 'active' : ''}`}
        >
          Home
        </Link>
      </div>
      
      <div className="nav-right">
        {isLoading ? (
          <span className="nav-loading">Loading...</span>
        ) : isAuthenticated ? (
          <div className="nav-auth">
            <span className="nav-user">
              Welcome, {user?.name || 'User'}
            </span>
            <button onClick={handleLogout} className="nav-logout">
              Logout
            </button>
          </div>
        ) : (
          <Link 
            to="/login" 
            className={`nav-link ${isActive('/login') ? 'active' : ''}`}
          >
            Login
          </Link>
        )}
      </div>
    </nav>
  )
}

export default Navigation
