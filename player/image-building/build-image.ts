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

interface DeviceConfig {
  deviceName: string;
  deviceId: number;
  deviceSecret: string;
  serverUrl: string;
}

interface WifiConfig {
  ssid: string;
  password: string;
}

interface SshConfig {
  publicKey?: string;
  keyFile?: string;
}

function showUsage() {
  console.log("Usage: ./build-image.ts <config-file.json> [options]");
  console.log("");
  console.log("Required:");
  console.log("  config-file.json           Device configuration from server");
  console.log("");
  console.log("Optional:");
  console.log("  --wifi <wifi-config.json>  WiFi configuration file");
  console.log("  --ssh <ssh-config.json>    SSH configuration file");
  console.log("");
  console.log("Config file format:");
  console.log("{");
  console.log('  "deviceName": "living-room",');
  console.log('  "deviceId": 1,');
  console.log('  "deviceSecret": "abc-123",');
  console.log('  "serverUrl": "http://192.168.1.100:3000"');
  console.log("}");
  console.log("");
  console.log("Note: Image includes a script to enable Git-based updates after first boot.");
  console.log("Run 'sudo /etc/nixos/enable-git-updates.sh' on the Pi to activate.");
  process.exit(1);
}

function readJsonFile<T>(filePath: string): T {
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    log.error(`Error reading ${filePath}: ${err}`);
    process.exit(1);
  }
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

async function promptInput(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (hidden) {
      const stdin = process.stdin as any;
      stdin.setRawMode?.(true);
      rl.question(question, (answer) => {
        stdin.setRawMode?.(false);
        console.log();
        rl.close();
        resolve(answer);
      });
      rl.on("line", (line) => {
        // Don't echo characters
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function selectSshKey(): Promise<string> {
  const sshDir = join(process.env.HOME || "~", ".ssh");
  let sshKeys: string[] = [];

  if (existsSync(sshDir)) {
    sshKeys = readdirSync(sshDir)
      .filter((f) => f.endsWith(".pub"))
      .map((f) => join(sshDir, f));
  }

  if (sshKeys.length === 0) {
    console.log("  No SSH keys found in ~/.ssh/");
    console.log("  1) Enter manually");
    return await promptInput("Enter SSH public key: ");
  }

  console.log("Available SSH public keys:");
  sshKeys.forEach((key, i) => {
    console.log(`  ${i + 1}) ${key}`);
  });
  console.log(`  ${sshKeys.length + 1}) Enter manually`);

  const choice = await promptInput(
    `Select SSH key (1-${sshKeys.length + 1}): `
  );
  const index = parseInt(choice) - 1;

  if (index >= 0 && index < sshKeys.length) {
    return readFileSync(sshKeys[index], "utf-8").trim();
  } else {
    return await promptInput("Enter SSH public key: ");
  }
}

async function main() {
  const args = process.argv.slice(2);

  let configFile = "";
  let wifiConfig: string | undefined;
  let sshConfig: string | undefined;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--wifi") {
      wifiConfig = args[++i];
    } else if (args[i] === "--ssh") {
      sshConfig = args[++i];
    } else if (args[i] === "-h" || args[i] === "--help") {
      showUsage();
    } else if (!configFile) {
      configFile = args[i];
    } else {
      log.error(`Unknown argument: ${args[i]}`);
      showUsage();
    }
  }

  if (!configFile) {
    log.error("Error: Config file required");
    showUsage();
  }

  // Resolve paths relative to project root (not player directory)
  const resolvedConfigFile = join(PROJECT_ROOT, configFile);
  const resolvedWifiConfig = wifiConfig
    ? join(PROJECT_ROOT, wifiConfig)
    : undefined;
  const resolvedSshConfig = sshConfig
    ? join(PROJECT_ROOT, sshConfig)
    : undefined;

  if (!existsSync(resolvedConfigFile)) {
    log.error(`Error: Config file not found: ${resolvedConfigFile}`);
    process.exit(1);
  }

  checkDocker();

  console.log(
    `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
  );
  console.log(`${colors.blue}  MusicBox NixOS Image Builder${colors.reset}`);
  console.log(
    `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
  );
  console.log("");

  // Read device config
  const deviceConfig = readJsonFile<DeviceConfig>(resolvedConfigFile);

  if (!deviceConfig.deviceName) {
    log.error("Error: deviceName not found in config file");
    process.exit(1);
  }

  log.success(`Config loaded: ${deviceConfig.deviceName}`);
  console.log("");

  // Handle WiFi configuration
  let wifi: WifiConfig;
  if (resolvedWifiConfig) {
    if (!existsSync(resolvedWifiConfig)) {
      log.error(`Error: WiFi config file not found: ${resolvedWifiConfig}`);
      process.exit(1);
    }
    wifi = readJsonFile<WifiConfig>(resolvedWifiConfig);
    log.success("WiFi config loaded from file");
  } else {
    console.log(`${colors.blue}━━ WiFi Configuration ━━${colors.reset}`);
    const ssid = await promptInput("WiFi SSID: ");
    const password = await promptInput("WiFi Password: ", true);
    wifi = { ssid, password };
  }

  if (!wifi.ssid) {
    log.error("Error: WiFi SSID cannot be empty");
    process.exit(1);
  }

  console.log("");

  // Handle SSH configuration
  let sshKey: string;
  if (resolvedSshConfig) {
    if (!existsSync(resolvedSshConfig)) {
      log.error(`Error: SSH config file not found: ${resolvedSshConfig}`);
      process.exit(1);
    }
    const sshConf = readJsonFile<SshConfig>(resolvedSshConfig);
    if (sshConf.publicKey) {
      sshKey = sshConf.publicKey;
    } else if (sshConf.keyFile && existsSync(sshConf.keyFile)) {
      sshKey = readFileSync(sshConf.keyFile, "utf-8").trim();
    } else {
      log.error("Error: No SSH key found in config file");
      process.exit(1);
    }
    log.success("SSH config loaded from file");
  } else {
    console.log(`${colors.blue}━━ SSH Configuration ━━${colors.reset}`);
    sshKey = await selectSshKey();
  }

  if (!sshKey) {
    log.error("Error: SSH key cannot be empty");
    process.exit(1);
  }

  console.log("");
  log.success("Configuration collected");
  console.log("");

  // Create temporary build directory
  const buildDir = mkdtempSync(join(tmpdir(), "musicbox-build-"));

  try {
    // Generate configuration
    // Initial image uses local files, can enable Git mode later with a script
    const gitRepo = process.env.GIT_REPO || "reesemclean/musicbox";

    const configNix = `# MusicBox Player Configuration for: ${deviceConfig.deviceName}
# Initial mode: LOCAL (using embedded files)
#
# To enable Git-based updates (no reflashing needed):
#   Run: sudo /etc/nixos/enable-git-updates.sh

{ config, pkgs, ... }:

let
  secrets = import ./secrets.nix;
in
{
  imports = [
    # Using local embedded files initially
    # After running enable-git-updates.sh, this will fetch from Git
    ./nixos-module.nix
  ];`;

    // Common configuration (goes in both build and deployed configs)
    const commonConfig = `
  # Boot configuration for Raspberry Pi
  boot.loader.grub.enable = false;
  boot.loader.generic-extlinux-compatible.enable = true;

  # Load I2C kernel modules
  boot.kernelModules = [ "i2c-dev" "i2c-bcm2835" ];

  # Enable flakes
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  # Network configuration
  networking.hostName = "musicbox-${deviceConfig.deviceName}";
  networking.wireless = {
    enable = true;
    networks.\${secrets.wifi.ssid} = {
      psk = secrets.wifi.password;
    };
  };

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

  # SSH access
  services.openssh = {
    enable = true;
    settings.PermitRootLogin = "prohibit-password";
  };

  # Root user SSH key
  users.users.root.openssh.authorizedKeys.keys = [ secrets.sshKey ];

  # Firewall - allow SSH, player HTTP, and mDNS
  networking.firewall.allowedTCPPorts = [ 22 ];
  networking.firewall.allowedUDPPorts = [ 5353 ];  # mDNS

  # MusicBox Player service
  services.musicbox-player = {
    enable = true;
    deviceId = ${deviceConfig.deviceId};
    deviceName = "${deviceConfig.deviceName}";
    deviceSecret = secrets.deviceSecret;
    serverUrl = secrets.server.url;
    httpPort = 8080;
  };

  # System packages
  environment.systemPackages = with pkgs; [
    vim
    git
    htop
    i2c-tools    # For NFC reader communication
    alsa-utils   # For audio control (amixer, aplay)
    pulseaudio   # For pactl volume control (works with PipeWire)
  ];

  system.stateVersion = "24.05";
}
`;

    // Complete configuration
    const finalConfig = configNix + commonConfig;

    // Create enable-git-updates script
    const enableGitScript = `#!/usr/bin/env bash
# MusicBox - Enable Git-Based Updates
# Run this ONCE after initial deployment to enable updates via Git without reflashing

set -e

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo $0"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "  MusicBox - Enable Git-Based Updates"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "This will configure your Pi to fetch updates from:"
echo "  https://github.com/${gitRepo}"
echo ""
echo "After enabling, you can update without reflashing:"
echo "  1. Make changes and push to Git"
echo "  2. SSH to Pi: ssh root@\$(hostname)"
echo "  3. Update: sudo nixos-rebuild switch"
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! \$REPLY =~ ^[Yy]$ ]]; then
  echo "Cancelled"
  exit 0
fi

echo ""
echo "Backing up configuration..."
cd /etc/nixos
cp configuration.nix configuration.nix.backup-\$(date +%Y%m%d-%H%M%S)

echo "Updating configuration to use Git..."

# Create new configuration with fetchGit
cat > configuration.nix.new <<'EOF'
# MusicBox Player Configuration
# Mode: GIT (updates from GitHub)

{ config, pkgs, ... }:

let
  secrets = import ./secrets.nix;

  # Fetch MusicBox code from Git
  musicbox = builtins.fetchGit {
    url = "https://github.com/${gitRepo}";
    ref = "main";
  };
in
{
  imports = [
    "\${musicbox}/player/image-building/nixos-module.nix"
  ];
EOF

# Append the rest of the original configuration (everything after "imports = [")
sed -n '/# Boot configuration for Raspberry Pi/,\$p' configuration.nix >> configuration.nix.new

# Replace
mv configuration.nix.new configuration.nix

echo "Testing configuration..."
if ! nixos-rebuild dry-build 2>&1 | head -20; then
  echo ""
  echo "Configuration test failed! Restoring backup..."
  mv configuration.nix.backup-* configuration.nix
  exit 1
fi

echo ""
echo "Applying configuration..."
if nixos-rebuild switch; then
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  ✓ Git-based updates enabled!"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  echo "Future updates:"
  echo "  1. Push changes to Git"
  echo "  2. Run: sudo nixos-rebuild switch"
  echo ""
else
  echo "Failed to apply configuration"
  echo "Restoring backup..."
  mv configuration.nix.backup-* configuration.nix
  nixos-rebuild switch
  exit 1
fi
`;

    const secretsNix = `# Secrets for: ${deviceConfig.deviceName}

{
  wifi = {
    ssid = "${wifi.ssid}";
    password = "${wifi.password}";
  };

  server = {
    url = "${deviceConfig.serverUrl}";
  };

  deviceSecret = "${deviceConfig.deviceSecret}";

  sshKey = "${sshKey}";
}
`;

    // Write configuration
    writeFileSync(join(buildDir, "configuration.nix"), finalConfig);

    // Write secrets
    writeFileSync(join(buildDir, "secrets.nix"), secretsNix);

    // Write enable-git-updates script
    writeFileSync(join(buildDir, "enable-git-updates.sh"), enableGitScript);

    // Copy required files for initial Docker build
    // These are ALWAYS needed (even in Git mode, for the initial build)
    cpSync(
      join(__dirname, "nixos-module.nix"),
      join(buildDir, "nixos-module.nix")
    );
    cpSync(join(PLAYER_DIR, "package.nix"), join(buildDir, "package.nix"));
    cpSync(join(PLAYER_DIR, "dist"), join(buildDir, "dist"), {
      recursive: true,
    });

    // Build Docker image
    console.log(
      `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
    );
    console.log(`${colors.blue}  Building Docker image...${colors.reset}`);
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

      # Build using configuration.nix (uses local files)
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
              zstd -d "$IMAGE_FILE" -o /output/${deviceConfig.deviceName}.img -f -q
              exit 0
            fi
          fi

          if [ -n "$IMAGE_FILE" ]; then
            echo 'Copying image...'
            cp "$IMAGE_FILE" /output/${deviceConfig.deviceName}.img
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

    const outputImage = join(outputsDir, `${deviceConfig.deviceName}.img`);

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
    log.success("Image built successfully!");
    console.log(
      `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
    );
    console.log("");
    console.log(`${colors.green}📁 Output:${colors.reset} ${outputImage}`);
    console.log("");

    console.log(`${colors.blue}Next steps:${colors.reset}`);
    console.log("  1. Find your SD card:");
    console.log("     diskutil list");
    console.log("");
    console.log("  2. Flash the image:");
    console.log(
      `     sudo dd if=${outputImage} of=/dev/diskX bs=4M status=progress`
    );
    console.log("");
    console.log("  3. Eject SD card:");
    console.log("     diskutil eject /dev/diskX");
    console.log("");
    console.log("  4. Insert into Raspberry Pi and power on!");
    console.log("");
    console.log(
      `${colors.green}🔄 Enable Git-based updates (optional - no reflashing needed!):${colors.reset}`
    );
    console.log(`   1. SSH to Pi: ssh root@musicbox-${deviceConfig.deviceName}.local`);
    console.log(`   2. Run: sudo /etc/nixos/enable-git-updates.sh`);
    console.log(`   3. Future updates: Just push to Git and run nixos-rebuild!`);
    console.log("");
    console.log(`${colors.blue}💡 Tip:${colors.reset}`);
    console.log(
      `   You can flash this same image to multiple Pis.`
    );
    console.log(
      `   Enable Git updates after first boot to get updates without reflashing.`
    );
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
