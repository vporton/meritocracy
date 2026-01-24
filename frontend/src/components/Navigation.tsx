import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

function Navigation() {
  const location = useLocation()
  const { user, isAuthenticated, logout, isLoading } = useAuth()
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen)
  const closeMenu = () => setIsMenuOpen(false)

  const isActive = (path: string) => location.pathname === path

  const handleLogout = async () => {
    await logout()
  }

  return (
    <nav className="nav">
      <div className="nav-header">
        <button className="nav-toggle" onClick={toggleMenu} aria-label="Toggle navigation">
          ☰
        </button>
      </div>

      <div className={`nav-items ${isMenuOpen ? 'show' : ''}`}>
        <div className="nav-left">
          <Link
            to="/"
            className={`nav-link ${isActive('/') ? 'active' : ''}`}
            onClick={closeMenu}
          >
            Home
          </Link>
          <Link
            to="/logs"
            className={`nav-link ${isActive('/logs') ? 'active' : ''}`}
            onClick={closeMenu}
          >
            Logs
          </Link>
          <Link
            to="/ban-voting"
            className={`nav-link ${isActive('/ban-voting') ? 'active' : ''}`}
            onClick={closeMenu}
          >
            Ban Voting
          </Link>
          <Link
            to="https://science-dao.org/meritocracy/"
            className='nav-link'
            onClick={closeMenu}
          >
            Site
          </Link>
          <Link
            to="https://science-dao.org/donation/"
            className='nav-link'
            onClick={closeMenu}
          >
            Donate
          </Link>
          <Link
            to="https://science-dao.org/meritocracy-help/"
            className='nav-link'
            onClick={closeMenu}
          >
            Help
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
                onClick={closeMenu}
              >
                Connect
              </Link>
              {isAuthenticated && (
                <button
                  onClick={() => { handleLogout(); closeMenu(); }}
                  className="nav-logout"
                >
                  Logout
                </button>
              )}
            </div>
          )}
          <Link
            to="https://github.com/vporton/meritocracy"
            onClick={closeMenu}
          >
            <img src="/github-mark.svg" alt="GitHub" width="20" height="20" />
          </Link>
        </div>
      </div>
    </nav>
  )
}

export default Navigation
