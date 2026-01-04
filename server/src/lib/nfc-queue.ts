/**
 * Simple in-memory queue for NFC scan events
 * Only keeps the most recent scan and only accepts scans during active sessions
 */

interface NFCScanEvent {
  deviceId: string
  nfcId: string
  timestamp: number
}

interface SessionInfo {
  startedAt: number
  expiresAt: number
  latestScan: NFCScanEvent | null
}

class NFCQueue {
  private activeSessions: Map<string, SessionInfo> = new Map() // sessionId -> session info
  private sessionTimeout = 120000 // 120 seconds
  private cleanupTimer: NodeJS.Timeout | null = null

  startSession(): string {
    const sessionId = crypto.randomUUID()
    const now = Date.now()
    const expiresAt = now + this.sessionTimeout
    this.activeSessions.set(sessionId, {
      startedAt: now,
      expiresAt,
      latestScan: null,
    })
    this.scheduleCleanup()
    console.log(`✅ NFC scan session started: ${sessionId} (expires in 120s)`)
    console.log(`   Active sessions: ${this.activeSessions.size}`)
    return sessionId
  }

  endSession(sessionId: string) {
    this.activeSessions.delete(sessionId)
    console.log(`🛑 NFC scan session ended: ${sessionId}`)
    console.log(`   Active sessions: ${this.activeSessions.size}`)
  }

  private scheduleCleanup() {
    // Clear any existing timer
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer)
    }

    // Find the next expiration time
    let nextExpiration = Infinity
    const now = Date.now()

    for (const session of this.activeSessions.values()) {
      if (session.expiresAt < nextExpiration) {
        nextExpiration = session.expiresAt
      }
    }

    // Schedule cleanup for the next expiration
    if (nextExpiration !== Infinity && nextExpiration > now) {
      this.cleanupTimer = setTimeout(() => {
        this.cleanupExpiredSessions()
      }, nextExpiration - now)
    }
  }

  private cleanupExpiredSessions() {
    const now = Date.now()
    let expiredCount = 0

    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.expiresAt < now) {
        this.activeSessions.delete(sessionId)
        expiredCount++
        console.log(`⏰ NFC scan session expired: ${sessionId}`)
      }
    }

    if (expiredCount > 0) {
      console.log(`   Cleaned up ${expiredCount} expired session(s)`)
      console.log(`   Active sessions: ${this.activeSessions.size}`)
    }

    // Schedule next cleanup if there are still sessions
    if (this.activeSessions.size > 0) {
      this.scheduleCleanup()
    }
  }

  hasActiveSession(): boolean {
    return this.activeSessions.size > 0
  }

  addScan(deviceId: string, nfcId: string): boolean {
    if (!this.hasActiveSession()) {
      console.log(
        `❌ NFC scan rejected (no active sessions): ${nfcId} from ${deviceId}`,
      )
      return false
    }

    const scanEvent: NFCScanEvent = {
      deviceId,
      nfcId,
      timestamp: Date.now(),
    }

    // Add scan to all active sessions
    for (const session of this.activeSessions.values()) {
      session.latestScan = scanEvent
    }

    console.log(`📡 NFC scan queued: ${nfcId} from ${deviceId}`)
    console.log(`   Delivered to ${this.activeSessions.size} active session(s)`)
    return true
  }

  getRecentScans(sessionId: string): Array<NFCScanEvent> {
    const session = this.activeSessions.get(sessionId)
    if (!session) {
      // Session doesn't exist or has expired
      return []
    }

    if (!session.latestScan) {
      return []
    }

    // Only return scans that occurred after this session started
    if (session.latestScan.timestamp < session.startedAt) {
      return []
    }

    const scan = session.latestScan
    // Clear after consuming to prevent reuse
    session.latestScan = null
    return [scan]
  }
}

export const nfcQueue = new NFCQueue()
