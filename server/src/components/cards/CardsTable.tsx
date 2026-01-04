import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { Card } from '@/db/schema'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>NFC ID</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Content</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cards.map((card) => (
          <TableRow key={card.nfcId}>
            <TableCell className="font-mono text-xs">{card.nfcId}</TableCell>
            <TableCell className="capitalize">{card.contentType}</TableCell>
            <TableCell>{getContentDisplay(card)}</TableCell>
            <TableCell className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(card)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => onDelete(card)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
