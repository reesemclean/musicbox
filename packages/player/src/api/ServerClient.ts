/**
 * ServerClient - HTTP client for communicating with the MusicBox server
 *
 * Handles:
 * - NFC card scanning via POST /api/nfc/scan
 * - Stream URL construction for audio playback
 * - Error handling for all API responses
 */

import type { NFCScanResponse, NFCScanErrorResponse } from "shared";

export class ServerClient {
  constructor(
    private serverUrl: string,
    private deviceId: string
  ) {}

  /**
   * Scan an NFC card and retrieve its content mapping
   * @param nfcId - The NFC card ID to scan
   * @returns The scan response with content information
   * @throws Error if the network request fails
   */
  async scanCard(nfcId: string): Promise<NFCScanResponse> {
    try {
      const response = await fetch(`${this.serverUrl}/api/nfc/scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceId: this.deviceId,
          nfcId: nfcId,
        }),
      });

      if (!response.ok && response.status !== 422) {
        console.error(`❌ Failed to scan: ${response.status}`);
        const text = await response.text();
        console.error(`   Error: ${text}`);
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      let result: NFCScanResponse | NFCScanErrorResponse;
      try {
        result = (await response.json()) as
          | NFCScanResponse
          | NFCScanErrorResponse;
      } catch {
        console.error(`❌ Invalid response from server`);
        console.error(`   Status: ${response.status}`);
        throw new Error("Invalid JSON response from server");
      }

      if (response.ok && "success" in result) {
        return result;
      } else if (response.status === 422) {
        console.log(`⚠️  Card not registered: ${nfcId}`);
        console.log(`   Register it at: ${this.serverUrl}/cards`);
        throw new Error("Card not registered");
      } else {
        const errorMsg = "error" in result ? result.error : "Unknown error";
        console.error(`❌ Failed to scan: ${response.status} - ${errorMsg}`);
        throw new Error(errorMsg);
      }
    } catch (error) {
      if (error instanceof Error && error.message !== "Card not registered") {
        console.error("❌ Network error:", error);
        console.error(
          `   Make sure the server is running at ${this.serverUrl}`
        );
      }
      throw error;
    }
  }

  /**
   * Construct the streaming URL for a song
   * @param songId - The song's database ID
   * @returns The full URL for streaming the song
   */
  getStreamUrl(songId: number): string {
    return `${this.serverUrl}/api/stream/${songId}`;
  }

  /**
   * Get the server URL
   */
  getServerUrl(): string {
    return this.serverUrl;
  }
}
