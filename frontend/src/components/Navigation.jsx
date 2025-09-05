import { Link, useLocation } from 'react-router-dom'

function Navigation() {
  const location = useLocation()
  
  const isActive = (path) => location.pathname === path

  return (
    <nav className="nav">
      <Link 
        to="/" 
        className={isActive('/') ? 'active' : ''}
      >
        Home
      </Link>
    </nav>
  )
}

export default Navigation
