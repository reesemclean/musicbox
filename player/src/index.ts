import type { Device, CardMapping } from "shared";

console.log("🎵 MusicBox Player - Starting...");

// Placeholder for player initialization
const deviceName = process.env.DEVICE_NAME || "dev-player";
const proxmoxUrl = process.env.PROXMOX_URL || "http://localhost:3000";

console.log(`Device: ${deviceName}`);
console.log(`Proxmox URL: ${proxmoxUrl}`);
console.log("Waiting for implementation...");
