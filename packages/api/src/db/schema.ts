import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const devices = sqliteTable('devices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mac: text('mac').notNull().unique(),
  name: text('name'),
  secret: text('secret').notNull().unique(),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
  firmwareVersion: text('firmware_version'),
  lastSeen: integer('last_seen', { mode: 'timestamp' }),
  lastIp: text('last_ip'),
  soundMachineSound: text('sound_machine_sound'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
