#!/usr/bin/env node
import { execSync, spawn } from "child_process";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  cpSync,
  existsSync,
  readdirSync,
  mkdirSync,
} from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import readline from "readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLAYER_DIR = join(__dirname, "..");
const PROJECT_ROOT = join(__dirname, "../..");

// Colors
const colors = {
  red: "\x1b[0;31m",
  green: "\x1b[0;32m",
  blue: "\x1b[0;34m",
  yellow: "\x1b[1;33m",
  reset: "\x1b[0m",
};

const log = {
  info: (msg: string) => console.log(`${colors.blue}${msg}${colors.reset}`),
  success: (msg: string) =>
    console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg: string) => console.log(`${colors.red}${msg}${colors.reset}`),
  warning: (msg: string) =>
    console.log(`${colors.yellow}${msg}${colors.reset}`),
};

function showUsage() {
  console.log("Usage: ./build-generic-image.ts [options]");
  console.log("");
  console.log("Builds a generic MusicBox SD card image that works on any Pi.");
  console.log("");
  console.log("Options:");
  console.log("  --ssh-key FILE          Path to SSH public key (default: auto-detect from ~/.ssh/)");
  console.log("  --wifi-ssid SSID        WiFi network name to embed in image");
  console.log("  --wifi-password PASS    WiFi password to embed in image");
  console.log("");
  console.log("The generic image includes:");
  console.log("  - NixOS for Raspberry Pi Zero 2 W");
  console.log("  - SSH access with your key");
  console.log("  - WiFi pre-configured (if provided)");
  console.log("  - MusicBox player (disabled by default)");
  console.log("  - Setup wizard for first-boot configuration");
  console.log("  - I2S audio (MAX98357A) pre-configured");
  console.log("");
  console.log("After flashing:");
  console.log("  1. Flash image to SD card");
  console.log("  2. Boot Pi (connects to WiFi automatically if configured)");
  console.log("  3. SSH in: ssh root@musicbox.local");
  console.log("  4. Run setup wizard: /root/setup-musicbox.sh");
  console.log("");
  process.exit(1);
}

function checkDocker() {
  try {
    execSync("docker info", { stdio: "pipe" });
  } catch {
    log.error("Error: Docker is not running!");
    console.log("");
    console.log("Please start Docker Desktop and try again.");
    process.exit(1);
  }
}

async function selectSshKey(providedPath?: string): Promise<string> {
  if (providedPath) {
    if (!existsSync(providedPath)) {
      log.error(`SSH key not found: ${providedPath}`);
      process.exit(1);
    }
    return readFileSync(providedPath, "utf-8").trim();
  }

  const sshDir = join(process.env.HOME || "~", ".ssh");
  let sshKeys: string[] = [];

  if (existsSync(sshDir)) {
    sshKeys = readdirSync(sshDir)
      .filter((f) => f.endsWith(".pub"))
      .map((f) => join(sshDir, f));
  }

  if (sshKeys.length === 0) {
    log.error("No SSH keys found in ~/.ssh/");
    console.log("");
    console.log("Generate one with:");
    console.log("  ssh-keygen -t ed25519 -C 'your@email.com'");
    process.exit(1);
  }

  if (sshKeys.length === 1) {
    const keyPath = sshKeys[0];
    log.success(`Using SSH key: ${keyPath}`);
    return readFileSync(keyPath, "utf-8").trim();
  }

  console.log("Available SSH public keys:");
  sshKeys.forEach((key, i) => {
    console.log(`  ${i + 1}) ${key}`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`Select SSH key (1-${sshKeys.length}): `, (answer) => {
      rl.close();
      const index = parseInt(answer) - 1;
      if (index >= 0 && index < sshKeys.length) {
        const keyPath = sshKeys[index];
        log.success(`Using SSH key: ${keyPath}`);
        resolve(readFileSync(keyPath, "utf-8").trim());
      } else {
        log.error("Invalid selection");
        process.exit(1);
      }
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("-h") || args.includes("--help")) {
    showUsage();
  }

  // Parse arguments
  let sshKeyFile: string | undefined;
  let wifiSsid: string | undefined;
  let wifiPassword: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--ssh-key" && i + 1 < args.length) {
      sshKeyFile = args[++i];
    } else if (arg === "--wifi-ssid" && i + 1 < args.length) {
      wifiSsid = args[++i];
    } else if (arg === "--wifi-password" && i + 1 < args.length) {
      wifiPassword = args[++i];
    } else if (!arg.startsWith("--")) {
      // Legacy: first positional arg is SSH key file
      sshKeyFile = arg;
    }
  }

  // Validate WiFi arguments
  if ((wifiSsid && !wifiPassword) || (!wifiSsid && wifiPassword)) {
    log.error("Both --wifi-ssid and --wifi-password must be provided together");
    process.exit(1);
  }

  checkDocker();

  console.log(
    `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
  );
  console.log(`${colors.blue}  MusicBox Generic NixOS Image Builder${colors.reset}`);
  console.log(
    `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
  );
  console.log("");

  // Get SSH key
  const sshKey = await selectSshKey(sshKeyFile);
  console.log("");

  // Show WiFi configuration status
  if (wifiSsid) {
    log.success(`WiFi will be pre-configured: ${wifiSsid}`);
    console.log("");
  } else {
    log.info("WiFi not configured - setup wizard will prompt for it");
    console.log("");
  }

  // Create temporary build directory
  const buildDir = mkdtempSync(join(tmpdir(), "musicbox-generic-build-"));

  try {
    const gitRepo = process.env.GIT_REPO || "reesemclean/musicbox";

    // Generate secrets.nix if WiFi is provided
    if (wifiSsid && wifiPassword) {
      const secretsNix = `# MusicBox Secrets
# WiFi credentials embedded at build time

{
  wifi = {
    ssid = "${wifiSsid.replace(/"/g, '\\"')}";
    password = "${wifiPassword.replace(/"/g, '\\"')}";
  };
}
`;
      writeFileSync(join(buildDir, "secrets.nix"), secretsNix);
    }

    // Generate generic configuration
    const hasWifi = wifiSsid && wifiPassword;
    const configNix = `# MusicBox Generic Image Configuration
# This image works on any Raspberry Pi Zero 2 W
# Run /root/setup-musicbox.sh after first boot to configure

{ config, pkgs, ... }:

${hasWifi ? "let\n  secrets = import ./secrets.nix;\nin\n{" : "{"}
  imports = [ ./nixos-module.nix ];

  # Boot configuration for Raspberry Pi
  boot.loader.grub.enable = false;
  boot.loader.generic-extlinux-compatible.enable = true;

  # Load I2C kernel modules
  boot.kernelModules = [ "i2c-dev" "i2c-bcm2835" ];

  # Enable flakes
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  # Generic hostname (setup wizard will change this)
  networking.hostName = "musicbox";

  ${hasWifi ? `# WiFi pre-configured at build time
  networking.wireless = {
    enable = true;
    networks.\${secrets.wifi.ssid}.psk = secrets.wifi.password;
  };` : "# No WiFi configured - setup wizard handles this"}

  # Enable mDNS for .local hostname resolution
  services.avahi = {
    enable = true;
    nssmdns4 = true;
    publish = {
      enable = true;
      addresses = true;
      domain = true;
      hinfo = true;
      userServices = true;
      workstation = true;
    };
  };

  # SSH access (for initial setup)
  services.openssh = {
    enable = true;
    settings.PermitRootLogin = "prohibit-password";
  };

  # Root user SSH key (for initial access)
  users.users.root.openssh.authorizedKeys.keys = [ "${sshKey}" ];

  # Firewall - allow SSH and mDNS
  networking.firewall.allowedTCPPorts = [ 22 ];
  networking.firewall.allowedUDPPorts = [ 5353 ];  # mDNS

  # MusicBox Player service - DISABLED by default
  # Setup wizard will enable it after configuration
  services.musicbox-player.enable = false;

  # System packages
  environment.systemPackages = with pkgs; [
    vim
    git
    htop
    i2c-tools    # For NFC reader
    alsa-utils   # For audio control
    pulseaudio   # For pactl volume control
  ];

  system.stateVersion = "24.05";
}
`;

    writeFileSync(join(buildDir, "configuration.nix"), configNix);

    // Copy required files
    cpSync(
      join(__dirname, "nixos-module.nix"),
      join(buildDir, "nixos-module.nix")
    );
    cpSync(join(PLAYER_DIR, "package.nix"), join(buildDir, "package.nix"));
    cpSync(join(PLAYER_DIR, "dist"), join(buildDir, "dist"), {
      recursive: true,
    });

    // Copy setup wizard script
    cpSync(
      join(__dirname, "setup-wizard.sh"),
      join(buildDir, "setup-wizard.sh")
    );

    // Build Docker image
    console.log(
      `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
    );
    console.log(`${colors.blue}  Building Docker builder image...${colors.reset}`);
    console.log(
      `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
    );
    console.log("");

    log.info("Building Docker image...");
    execSync(
      `docker build -t musicbox-builder -f "${join(__dirname, "Dockerfile.builder")}" "${__dirname}" -q`,
      {
        stdio: "pipe",
      }
    );

    console.log("");
    console.log(
      `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
    );
    console.log(`${colors.blue}  Building NixOS image...${colors.reset}`);
    console.log(
      `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
    );
    console.log("");
    log.warning("⏱️  This will take 20-40 minutes on first build");
    log.warning("   Subsequent builds are much faster (Nix caches everything)");
    console.log("");

    // Ensure outputs directory exists
    const outputsDir = join(PROJECT_ROOT, "outputs");
    if (!existsSync(outputsDir)) {
      mkdirSync(outputsDir, { recursive: true });
    }

    // Run build in Docker
    const dockerScript = `
      set -e

      # Build using configuration.nix
      echo 'Building NixOS image...'
      nixos-generate -f sd-aarch64 -c configuration.nix --system aarch64-linux 2>&1 | grep -E "(warning|error|evaluation warning)" || true

      echo ''
      echo 'Extracting image from Nix store...'

      STORE_DIRS=$(find /nix/store -maxdepth 1 -type d -name '*nixos-image-sd-card*.img.zst' 2>/dev/null)

      for DIR in $STORE_DIRS; do
        if [ -d "$DIR/sd-image" ]; then
          IMAGE_FILE=$(find "$DIR/sd-image" -name '*.img' 2>/dev/null | head -n 1)

          if [ -z "$IMAGE_FILE" ]; then
            IMAGE_FILE=$(find "$DIR/sd-image" -name '*.img.zst' 2>/dev/null | head -n 1)
            if [ -n "$IMAGE_FILE" ]; then
              echo 'Decompressing image...'
              zstd -d "$IMAGE_FILE" -o /output/musicbox-generic.img -f -q
              exit 0
            fi
          fi

          if [ -n "$IMAGE_FILE" ]; then
            echo 'Copying image...'
            cp "$IMAGE_FILE" /output/musicbox-generic.img
            exit 0
          fi
        fi
      done

      echo 'Error: Could not find image file' >&2
      exit 1
    `;

    const docker = spawn(
      "docker",
      [
        "run",
        "--rm",
        "--platform",
        "linux/aarch64",
        "-v",
        `${buildDir}:/build`,
        "-v",
        `${outputsDir}:/output`,
        "-w",
        "/build",
        "musicbox-builder",
        "bash",
        "-c",
        dockerScript,
      ],
      { stdio: "inherit" }
    );

    await new Promise<void>((resolve, reject) => {
      docker.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Docker build failed with code ${code}`));
        }
      });
    });

    const outputImage = join(outputsDir, "musicbox-generic.img");

    if (!existsSync(outputImage)) {
      console.log("");
      console.log(
        `${colors.red}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
      );
      log.error("Error: Image file not created");
      console.log(
        `${colors.red}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
      );
      process.exit(1);
    }

    console.log("");
    console.log(
      `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
    );
    log.success("Generic image built successfully!");
    console.log(
      `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
    );
    console.log("");
    console.log(`${colors.green}📁 Output:${colors.reset} ${outputImage}`);
    console.log("");

    console.log(`${colors.blue}Next steps:${colors.reset}`);
    console.log("");
    console.log("1. Flash to SD card:");
    console.log("   diskutil list  # Find your SD card");
    console.log(`   sudo dd if=${outputImage} of=/dev/rdiskX bs=4m status=progress`);
    console.log("   diskutil eject /dev/diskX");
    console.log("");
    console.log("2. Boot Raspberry Pi:");
    console.log("   - Insert SD card into Pi Zero 2 W");
    console.log("   - Power on");
    console.log("   - Wait 2-3 minutes for first boot");
    console.log("");
    console.log("3. SSH into Pi:");
    console.log("   ssh root@musicbox.local");
    console.log("");
    console.log("4. Run setup wizard:");
    console.log("   /root/setup-musicbox.sh");
    console.log("");
    console.log(`${colors.green}💡 Tips:${colors.reset}`);
    console.log("   - Same image works for ALL devices");
    console.log("   - Can reflash and re-setup anytime");
    if (wifiSsid) {
      console.log(`   - WiFi pre-configured: ${wifiSsid}`);
      console.log("   - Setup wizard will only ask for device info");
    } else {
      console.log("   - Setup wizard configures WiFi, device, and Git updates");
    }
    console.log("");
  } finally {
    // Cleanup
    rmSync(buildDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  log.error(`Error: ${err.message}`);
  process.exit(1);
});
