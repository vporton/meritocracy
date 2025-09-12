import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function Navigation() {
  const location = useLocation()
  const { user, isAuthenticated, logout, isLoading } = useAuth()
  
  const isActive = (path: string) => location.pathname === path

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
        <Link 
          to="/logs" 
          className={`nav-link ${isActive('/logs') ? 'active' : ''}`}
        >
          OpenAI Logs
        </Link>
      </div>
      
      <div className="nav-right">
        {isLoading ? (
          <span className="nav-loading">Loading...</span>
        ) : (
          <div className="nav-auth">
            {isAuthenticated && (
              <span className="nav-user">
                Welcome, {user?.name || 'User'}
              </span>
            )}
            <Link 
              to="/connect" 
              className={`nav-link ${isActive('/connect') ? 'active' : ''}`}
            >
              Connect
            </Link>
            {isAuthenticated && (
              <button onClick={handleLogout} className="nav-logout">
                Logout
              </button>
            )}
          </div>
        )}
      </div>
    </nav>
  )
}

export default Navigation
