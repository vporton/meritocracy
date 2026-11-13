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
    <nav className="nav" aria-label="Main">
      <div className="nav-header">
        <Link to="/" className="nav-brand" aria-label="SciWard home" onClick={closeMenu}>
          <img
            src="/ward.png"
            className="nav-logo"
            width="44"
            height="44"
            alt=""
          />
          <span className="nav-brand-name">SciWard</span>
        </Link>
        <button className="nav-toggle" onClick={toggleMenu} aria-label="Toggle navigation">
          ☰
        </button>
      </div>

      <div className={`nav-items ${isMenuOpen ? 'show' : ''}`}>
        <div className="nav-left">
          <Link
            to="/"
            className={`nav-link ${isActive('/') ? 'active' : ''}`}
            aria-current={`${isActive('/') ? 'page' : 'false'}`}
            onClick={closeMenu}
          >
            Home
          </Link>
          <Link
            to="/logs"
            className={`nav-link ${isActive('/logs') ? 'active' : ''}`}
            aria-current={`${isActive('/logs') ? 'page' : 'false'}`}
            onClick={closeMenu}
          >
            Audit Logs
          </Link>
          <Link
            to="/treasury"
            className={`nav-link ${isActive('/treasury') ? 'active' : ''}`}
            aria-current={`${isActive('/treasury') ? 'page' : 'false'}`}
            onClick={closeMenu}
          >
            Treasury
          </Link>
          <Link
            to="/ban-voting"
            className={`nav-link ${isActive('/ban-voting') ? 'active' : ''}`}
            aria-current={`${isActive('/ban-voting') ? 'page' : 'false'}`}
            onClick={closeMenu}
          >
            Ban Voting
          </Link>
          <Link
            to="https://science-dao.org/meritocracy/"
            className='nav-link'
            onClick={closeMenu}
          >
            Science DAO
          </Link>
          <Link
            to="https://science-dao.org/donation/"
            className='nav-link'
            onClick={closeMenu}
          >
            Donate / Support
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
                aria-current={`${isActive('/connect') ? 'page' : 'false'}`}
                onClick={closeMenu}
              >
                Connect Accounts
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
        </div>
      </div>
    </nav>
  )
}

export default Navigation
