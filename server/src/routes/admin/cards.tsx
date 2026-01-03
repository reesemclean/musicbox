import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { getAllCards } from '@/services/serverFunctions'

export const Route = createFileRoute('/admin/cards')({
  component: CardsPage,
})

function CardsPage() {
  const [cards, setCards] = useState<Array<any>>([])
  const [loading, setLoading] = useState(false)

  const handleLoadCards = async () => {
    setLoading(true)
    try {
      const result = await getAllCards()
      setCards(result)
    } catch (error) {
      console.error('Failed to load cards:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <button
        onClick={handleLoadCards}
        disabled={loading}
        className="px-6 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-600 text-white font-semibold rounded-lg"
      >
        {loading ? 'Loading...' : 'Refresh Cards'}
      </button>
      {cards.length > 0 && (
        <div className="bg-slate-800 rounded-lg p-6 overflow-x-auto">
          <h2 className="text-xl font-bold mb-4">NFC Cards ({cards.length})</h2>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-700">
              <tr>
                <th className="text-left py-2 px-3">NFC ID</th>
                <th className="text-left py-2 px-3">Type</th>
                <th className="text-left py-2 px-3">Path</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => (
                <tr key={card.id} className="border-b border-slate-700">
                  <td className="py-2 px-3 font-mono text-amber-400">
                    {card.nfcId}
                  </td>
                  <td className="py-2 px-3">{card.contentType}</td>
                  <td className="py-2 px-3 text-gray-400">
                    {card.contentPath || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cards.length === 0 && !loading && (
        <div className="text-center py-8 text-gray-400">
          <p>No NFC cards yet. Click "Refresh Cards" to load.</p>
        </div>
      )}
    </div>
  )
}
