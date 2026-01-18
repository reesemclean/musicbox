#!/bin/bash
# MusicBox Bootstrap Script
# Runs once on first boot to register with the server and configure SSH for Ansible

set -e

BOOTSTRAP_MARKER="/opt/musicbox/.bootstrap-complete"
CONFIG_FILE="/boot/firmware/musicbox/config.txt"
DEVICE_FILE="/boot/firmware/musicbox/device.txt"
LOG_FILE="/var/log/musicbox-bootstrap.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check if already bootstrapped
if [ -f "$BOOTSTRAP_MARKER" ]; then
    log "Bootstrap already complete, exiting"
    exit 0
fi

log "Starting MusicBox bootstrap..."

# Read server URL from config
if [ ! -f "$CONFIG_FILE" ]; then
    log "ERROR: Config file not found at $CONFIG_FILE"
    exit 1
fi

SERVER_URL=$(grep "^SERVER_URL=" "$CONFIG_FILE" | cut -d'=' -f2-)
if [ -z "$SERVER_URL" ]; then
    log "ERROR: SERVER_URL not found in config file"
    exit 1
fi

log "Server URL: $SERVER_URL"

# Get hardware ID from CPU serial
get_hardware_id() {
    # Try /proc/cpuinfo first (Raspberry Pi)
    if [ -f /proc/cpuinfo ]; then
        serial=$(grep -i "^serial" /proc/cpuinfo | awk '{print $3}')
        if [ -n "$serial" ]; then
            echo "$serial"
            return
        fi
    fi

    # Fallback to machine-id
    if [ -f /etc/machine-id ]; then
        cat /etc/machine-id
        return
    fi

    # Last resort: generate random ID
    cat /proc/sys/kernel/random/uuid | tr -d '-'
}

HARDWARE_ID=$(get_hardware_id)
HOSTNAME=$(hostname)

log "Hardware ID: $HARDWARE_ID"
log "Hostname: $HOSTNAME"

# Register with server
log "Registering with server..."

REGISTER_RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "{\"hardwareId\": \"$HARDWARE_ID\", \"hostname\": \"$HOSTNAME\"}" \
    "$SERVER_URL/api/devices/register" || echo "")

if [ -z "$REGISTER_RESPONSE" ]; then
    log "ERROR: Failed to contact server at $SERVER_URL"
    exit 1
fi

# Check for error in response
if echo "$REGISTER_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
    ERROR=$(echo "$REGISTER_RESPONSE" | jq -r '.error')
    log "ERROR: Registration failed: $ERROR"
    exit 1
fi

DEVICE_ID=$(echo "$REGISTER_RESPONSE" | jq -r '.deviceId')
if [ "$DEVICE_ID" = "null" ] || [ -z "$DEVICE_ID" ]; then
    log "ERROR: No device ID in response"
    exit 1
fi

log "Registered with device ID: $DEVICE_ID"

# Poll for approval (5s interval, 10min timeout = 120 attempts)
MAX_ATTEMPTS=120
ATTEMPT=0

log "Waiting for approval..."

# Get IP address for reporting
IP_ADDRESS=$(hostname -I | awk '{print $1}')

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))

    STATUS_RESPONSE=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"ipAddress\": \"$IP_ADDRESS\"}" \
        "$SERVER_URL/api/devices/register/$DEVICE_ID/status" || echo "")

    if [ -z "$STATUS_RESPONSE" ]; then
        log "Warning: Failed to get status, retrying..."
        sleep 5
        continue
    fi

    STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status')

    case "$STATUS" in
        "approved")
            log "Device approved!"

            # Extract approval data
            SECRET=$(echo "$STATUS_RESPONSE" | jq -r '.secret')
            NAME=$(echo "$STATUS_RESPONSE" | jq -r '.name')
            SSH_PUBLIC_KEY=$(echo "$STATUS_RESPONSE" | jq -r '.sshPublicKey')

            if [ "$SECRET" = "null" ] || [ -z "$SECRET" ]; then
                log "ERROR: No secret in approval response"
                exit 1
            fi

            # Save device secret
            log "Saving device secret..."
            echo "$SECRET" > "$DEVICE_FILE"
            chmod 600 "$DEVICE_FILE"

            # Set hostname if provided
            if [ "$NAME" != "null" ] && [ -n "$NAME" ]; then
                log "Setting hostname to: $NAME"
                hostnamectl set-hostname "$NAME"
                # Update /etc/hosts
                sed -i "s/127.0.1.1.*/127.0.1.1\t$NAME/" /etc/hosts
            fi

            # Add SSH public key to authorized_keys for musicbox user
            if [ "$SSH_PUBLIC_KEY" != "null" ] && [ -n "$SSH_PUBLIC_KEY" ]; then
                log "Adding server SSH key to authorized_keys..."

                # Ensure .ssh directory exists for musicbox user
                mkdir -p /home/musicbox/.ssh
                chmod 700 /home/musicbox/.ssh
                chown musicbox:musicbox /home/musicbox/.ssh

                # Add key if not already present
                AUTHORIZED_KEYS="/home/musicbox/.ssh/authorized_keys"
                if [ ! -f "$AUTHORIZED_KEYS" ] || ! grep -q "musicbox-server" "$AUTHORIZED_KEYS"; then
                    echo "$SSH_PUBLIC_KEY" >> "$AUTHORIZED_KEYS"
                    chmod 600 "$AUTHORIZED_KEYS"
                    chown musicbox:musicbox "$AUTHORIZED_KEYS"
                fi

                log "SSH key added successfully"

                # Notify server that SSH key is installed (triggers deployment)
                log "Notifying server that SSH key is ready..."
                SSH_READY_RESPONSE=$(curl -s -X POST \
                    -H "Content-Type: application/json" \
                    -d "{\"secret\": \"$SECRET\"}" \
                    "$SERVER_URL/api/devices/register/$DEVICE_ID/ssh-ready" || echo "")

                if [ -n "$SSH_READY_RESPONSE" ]; then
                    log "Server notified: $SSH_READY_RESPONSE"
                else
                    log "Warning: Failed to notify server, deployment may need manual trigger"
                fi
            fi

            # Create bootstrap complete marker
            mkdir -p /opt/musicbox
            touch "$BOOTSTRAP_MARKER"

            log "Bootstrap complete! Device is ready for Ansible deployment."
            exit 0
            ;;

        "rejected")
            log "ERROR: Device was rejected"
            exit 1
            ;;

        "pending")
            # Still waiting
            if [ $((ATTEMPT % 12)) -eq 0 ]; then
                log "Still waiting for approval... ($ATTEMPT/$MAX_ATTEMPTS)"
            fi
            sleep 5
            ;;

        *)
            log "Warning: Unknown status: $STATUS"
            sleep 5
            ;;
    esac
done

log "ERROR: Timed out waiting for approval (10 minutes)"
exit 1
