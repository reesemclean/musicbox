import { Link } from '@tanstack/react-router'

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/library', label: 'Library' },
  { to: '/playlists', label: 'Playlists' },
  { to: '/cards', label: 'Cards' },
  { to: '/devices', label: 'Devices' },
]

export default function Header() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link to="/" className="text-xl font-bold text-gray-900">
          MusicBox
        </Link>
        <div className="flex gap-6">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="text-gray-600 hover:text-gray-900 [&.active]:font-semibold [&.active]:text-gray-900"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  )
}
