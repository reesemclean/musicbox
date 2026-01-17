import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { Card } from '@/db/schema'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface CardsTableProps {
  cards: Array<Card>
  getContentDisplay: (card: Card) => React.ReactNode
  onEdit: (card: Card) => void
  onDelete: (card: Card) => void
}

export function CardsTable({
  cards,
  getContentDisplay,
  onEdit,
  onDelete,
}: CardsTableProps) {
  return (
    <table className="w-full">
      <thead className="sticky top-0 z-10 bg-card border-b">
        <tr>
          <th className="text-left py-3 px-4 font-semibold">NFC ID</th>
          <th className="text-left py-3 px-4 font-semibold">Type</th>
          <th className="text-left py-3 px-4 font-semibold">Content</th>
          <th className="text-right py-3 px-4 font-semibold w-16">Actions</th>
        </tr>
      </thead>
      <tbody>
        {cards.map((card) => (
          <tr
            key={card.id}
            className="border-b last:border-0 hover:bg-accent/50 transition-colors group"
          >
            <td className="py-3 px-4 font-mono text-sm text-amber-500">
              {card.nfcId}
            </td>
            <td className="py-3 px-4">
              <span className="capitalize">{card.contentType}</span>
            </td>
            <td className="py-3 px-4">{getContentDisplay(card)}</td>
            <td className="py-3 px-4 text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Open menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(card)}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onDelete(card)}
                    className="text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
