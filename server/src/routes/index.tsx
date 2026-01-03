import { createFileRoute } from '@tanstack/react-router'
import { Music, Radio, Zap } from 'lucide-react'

export const Route = createFileRoute('/')({ component: App })

function App() {
  const features = [
    {
      icon: <Music className="w-12 h-12 text-amber-400" />,
      title: 'NFC Card Control',
      description:
        'Tap a card to instantly play your music. No screens, no menus—just physical cards and music.',
    },
    {
      icon: <Radio className="w-12 h-12 text-amber-400" />,
      title: 'Multi-Room Playback',
      description:
        'Same card plays the same song on every Raspberry Pi in your home. Synchronized across all rooms.',
    },
    {
      icon: <Zap className="w-12 h-12 text-amber-400" />,
      title: 'Instant Playback',
      description:
        'Music starts within 1 second of tap. No streaming latency, no buffering—pure instant gratification.',
    },
  ]

  return (
    <div className="min-h-screen bg-slate-900">
      <section className="relative py-20 px-6 text-center">
        <div className="relative max-w-5xl mx-auto">
          <h1 className="text-6xl md:text-7xl font-black text-white mb-4">
            🎵 MusicBox
          </h1>
          <p className="text-2xl md:text-3xl text-amber-400 mb-4 font-light">
            NFC-Powered Music for Every Room
          </p>
          <p className="text-lg text-gray-300 max-w-3xl mx-auto mb-8">
            Tap a card. Music plays instantly. No screens, no menus—just
            physical cards and synchronized playback across your home.
          </p>
          <div className="flex flex-col items-center gap-4">
            <a
              href="/admin"
              className="px-8 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg transition-colors shadow-lg shadow-amber-500/50"
            >
              Go to Admin
            </a>
          </div>
        </div>
      </section>

      <section className="py-16 px-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <div
              key={index}
              className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6 hover:border-amber-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-amber-500/10"
            >
              <div className="mb-4">{feature.icon}</div>
              <h3 className="text-xl font-semibold text-white mb-3">
                {feature.title}
              </h3>
              <p className="text-gray-400 leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
