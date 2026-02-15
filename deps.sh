#!/bin/bash

################################################################################
# DEB-BASED DEPENDENCY INSTALLER
# Focus: Debian / Ubuntu
# Purpose: Install Docker, NVM, Nginx, and Certbot
################################################################################

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
LOG_DIR="/var/log/infra-setup"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${LOG_DIR}/install_${TIMESTAMP}.log"

################################################################################
# UTILITY FUNCTIONS
################################################################################

log() {
    local message="[$(date +'%Y-%m-%d %H:%M:%S')] $1"
    echo -e "${BLUE}${message}${NC}" | tee -a "$LOG_FILE"
}

log_success() {
    local message="✅ $1"
    echo -e "${GREEN}${message}${NC}" | tee -a "$LOG_FILE"
}

log_error() {
    local message="❌ $1"
    echo -e "${RED}${message}${NC}" | tee -a "$LOG_FILE"
}

log_warning() {
    local message="⚠️  $1"
    echo -e "${YELLOW}${message}${NC}" | tee -a "$LOG_FILE"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root. Please use sudo."
        exit 1
    fi
}

detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
            log_error "Unsupported OS: $ID. This script is optimized for Debian/Ubuntu."
            exit 1
        fi
        OS_ID=$ID
        OS_CODENAME=$VERSION_CODENAME
    else
        log_error "Cannot detect OS type. /etc/os-release missing."
        exit 1
    fi
    log "Detected OS: $OS_ID ($OS_CODENAME)"
}

command_exists() {
    command -v "$1" &> /dev/null
}

################################################################################
# INSTALLATION STEPS
################################################################################

init_environment() {
    mkdir -p "$LOG_DIR"
    log "Initializing environment..."
    apt-get update -y >> "$LOG_FILE" 2>&1
    apt-get install -y \
        curl \
        git \
        gnupg \
        ca-certificates \
        lsb-release \
        software-properties-common \
        build-essential >> "$LOG_FILE" 2>&1
    log_success "Base dependencies installed."
}

install_docker() {
    log "🐳 Setting up Docker..."
    if command_exists docker; then
        log_warning "Docker is already installed."
        return
    fi

    # Add Docker's official GPG key:
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$OS_ID/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg >> "$LOG_FILE" 2>&1
    chmod a+r /etc/apt/keyrings/docker.gpg

    # Add the repository to Apt sources:
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS_ID \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -y >> "$LOG_FILE" 2>&1
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >> "$LOG_FILE" 2>&1
    
    systemctl enable docker >> "$LOG_FILE" 2>&1
    systemctl start docker >> "$LOG_FILE" 2>&1

    # Add current user to docker group if running via sudo
    if [ -n "$SUDO_USER" ]; then
        usermod -aG docker "$SUDO_USER"
        log "User $SUDO_USER added to docker group."
    fi
    log_success "Docker installed successfully."
}

install_nvm() {
    log "📦 Installing NVM (Node Version Manager)..."
    
    # Get latest version from GitHub API
    local LATEST_NVM=$(curl -s https://api.github.com/repos/nvm-sh/nvm/releases/latest | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    
    if [ -z "$LATEST_NVM" ]; then
        LATEST_NVM="v0.40.1" # Fallback
        log_warning "Could not fetch latest NVM version, using fallback: $LATEST_NVM"
    fi

    # Install for the user who called sudo, or root if run directly
    local TARGET_USER=${SUDO_USER:-root}
    local TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)

    log "Target user: $TARGET_USER (Home: $TARGET_HOME)"
    
    sudo -u "$TARGET_USER" bash -c "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/$LATEST_NVM/install.sh | bash" >> "$LOG_FILE" 2>&1
    
    log_success "NVM $LATEST_NVM installed for $TARGET_USER."
}

install_nginx() {
    log "🌐 Installing Nginx..."
    if command_exists nginx; then
        log_warning "Nginx is already installed."
        return
    fi
    
    apt-get install -y nginx >> "$LOG_FILE" 2>&1
    systemctl enable nginx >> "$LOG_FILE" 2>&1
    systemctl start nginx >> "$LOG_FILE" 2>&1
    log_success "Nginx installed and started."
}

install_certbot() {
    log "🔐 Installing Certbot..."
    if command_exists certbot; then
        log_warning "Certbot is already installed."
        return
    fi

    # Using snap is the recommended way for most Debian/Ubuntu systems
    if command_exists snap; then
        log "Using snap for Certbot installation..."
        snap install core >> "$LOG_FILE" 2>&1
        snap refresh core >> "$LOG_FILE" 2>&1
        snap install --classic certbot >> "$LOG_FILE" 2>&1
        ln -sf /snap/bin/certbot /usr/bin/certbot >> "$LOG_FILE" 2>&1
    else
        log_warning "Snap not found, falling back to apt-get for Certbot..."
        apt-get install -y certbot python3-certbot-nginx >> "$LOG_FILE" 2>&1
    fi
    
    log_success "Certbot installed successfully."
}

verify_all() {
    log "🔍 Verifying installations..."
    
    local errors=0
    
    if command_exists docker; then
        log_success "Docker: $(docker --version)"
    else
        log_error "Docker is NOT installed correctly."
        errors=$((errors + 1))
    fi

    if command_exists nginx; then
        log_success "Nginx: $(nginx -v 2>&1 | head -n 1)"
    else
        log_error "Nginx is NOT installed correctly."
        errors=$((errors + 1))
    fi

    if command_exists certbot; then
        log_success "Certbot: $(certbot --version)"
    else
        log_error "Certbot is NOT installed correctly."
        errors=$((errors + 1))
    fi

    if [ $errors -eq 0 ]; then
        echo -e "\n${GREEN}All components installed and verified!${NC}"
    else
        echo -e "\n${RED}Installation completed with $errors error(s). Check $LOG_FILE for details.${NC}"
    fi
}

################################################################################
# MAIN EXECUTION
################################################################################

main() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}   Debian/Ubuntu Infrastructure Setup   ${NC}"
    echo -e "${BLUE}========================================${NC}"
    
    check_root
    detect_os
    init_environment
    
    install_docker
    install_nvm
    install_nginx
    install_certbot
    
    verify_all
    
    echo -e "\n${YELLOW}Next Steps:${NC}"
    echo "1. Log out and back in to use Docker without sudo."
    echo "2. Run 'source ~/.bashrc' (or reopen terminal) to use NVM."
    echo "3. Configure your Nginx sites in /etc/nginx/sites-available/"
    echo "4. Use 'certbot --nginx' to obtain SSL certificates."
    echo -e "\nLog file: $LOG_FILE"
}

main "$@"
