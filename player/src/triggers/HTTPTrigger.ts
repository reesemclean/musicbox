/**
 * HTTPTrigger - HTTP API for remote control of the player
 *
 * Provides REST endpoints:
 * - POST /scan - Trigger a card scan with {nfcId: string}
 * - POST /play - Resume playback
 * - POST /pause - Pause playback
 * - POST /next - Skip to next song
 * - POST /previous - Go to previous song
 * - POST /stop - Stop playback
 * - GET /status - Get current playback state
 *
 * All responses use JSON format with CORS enabled
 */

import * as http from "http";
import type { Trigger } from "./TriggerInterface.ts";
import type { PlayerCore } from "../core/PlayerCore.ts";

export class HTTPTrigger implements Trigger {
  readonly name = "http";
  private server?: http.Server;
  private playerCore?: PlayerCore;
  private port: number;
  private connections = new Set<any>();

  constructor(port: number = 8080) {
    this.port = port;
  }

  async start(playerCore: PlayerCore): Promise<void> {
    this.playerCore = playerCore;

    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);

      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Content-Type", "application/json");

      // Handle OPTIONS preflight
      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      try {
        if (req.method === "POST" && url.pathname === "/scan") {
          const body = await this.readBody(req);
          const { nfcId } = JSON.parse(body);

          if (!nfcId) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Missing nfcId parameter" }));
            return;
          }

          await this.playerCore?.handleCardScan(nfcId);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } else if (req.method === "POST" && url.pathname === "/play") {
          console.log(`🌐 HTTP: /play`);
          this.playerCore?.play();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } else if (req.method === "POST" && url.pathname === "/pause") {
          console.log(`🌐 HTTP: /pause`);
          this.playerCore?.pause();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } else if (req.method === "POST" && url.pathname === "/next") {
          this.playerCore?.next();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } else if (req.method === "POST" && url.pathname === "/previous") {
          this.playerCore?.previous();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } else if (req.method === "POST" && url.pathname === "/stop") {
          console.log(`🌐 HTTP: /stop`);
          this.playerCore?.stop();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } else if (req.method === "POST" && url.pathname === "/volume") {
          const body = await this.readBody(req);
          const { level } = JSON.parse(body);

          if (level === undefined || typeof level !== "number") {
            res.writeHead(400);
            res.end(
              JSON.stringify({
                error: "Missing or invalid level parameter (0-100)",
              })
            );
            return;
          }

          this.playerCore?.setVolume(level);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, volume: level }));
        } else if (req.method === "POST" && url.pathname === "/volume/up") {
          this.playerCore?.volumeUp();
          const volume = this.playerCore?.getVolume();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, volume }));
        } else if (req.method === "POST" && url.pathname === "/volume/down") {
          this.playerCore?.volumeDown();
          const volume = this.playerCore?.getVolume();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, volume }));
        } else if (req.method === "GET" && url.pathname === "/status") {
          const status = this.playerCore?.getStatus();
          const volume = this.playerCore?.getVolume();
          res.writeHead(200);
          res.end(JSON.stringify({ ...status, volume }));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "Not found" }));
        }
      } catch (error) {
        console.error("HTTP trigger error:", error);
        res.writeHead(500);
        res.end(
          JSON.stringify({
            error:
              error instanceof Error ? error.message : "Internal server error",
          })
        );
      }
    });

    // Track connections for forceful shutdown
    this.server.on("connection", (conn) => {
      this.connections.add(conn);
      conn.on("close", () => {
        this.connections.delete(conn);
      });
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(this.port, () => {
        // Allow process to exit even with server listening
        this.server!.unref();

        console.log(`🌐 HTTP trigger listening on port ${this.port}`);
        console.log(`   Endpoints:`);
        console.log(`   - POST http://localhost:${this.port}/scan`);
        console.log(`   - POST http://localhost:${this.port}/play`);
        console.log(`   - POST http://localhost:${this.port}/pause`);
        console.log(`   - POST http://localhost:${this.port}/next`);
        console.log(`   - POST http://localhost:${this.port}/previous`);
        console.log(`   - POST http://localhost:${this.port}/stop`);
        console.log(`   - POST http://localhost:${this.port}/volume`);
        console.log(`   - POST http://localhost:${this.port}/volume/up`);
        console.log(`   - POST http://localhost:${this.port}/volume/down`);
        console.log(`   - GET  http://localhost:${this.port}/status`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    // Forcefully destroy all active connections
    for (const conn of this.connections) {
      conn.destroy();
    }
    this.connections.clear();

    return new Promise((resolve) => {
      this.server!.close(() => {
        console.log("\n🌐 HTTP trigger stopped");
        this.server = undefined;
        resolve();
      });
    });
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => resolve(body));
    });
  }
}
