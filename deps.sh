#!/bin/bash

################################################################################
# MAIN INITIALIZATION SCRIPT - Standalone Setup & Version Scraper
# Purpose: Install Docker, Node Version Manager, Nginx, and dependencies
# Features: Auto-detects latest versions and distro, root-required
################################################################################

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
LOG_DIR="/var/log/docker-init"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${LOG_DIR}/init_${TIMESTAMP}.log"

################################################################################
# UTILITY FUNCTIONS
################################################################################

# Initialize logging
init_logging() {
    mkdir -p "$LOG_DIR"
    touch "$LOG_FILE"
    echo "Initialization started at $(date)" | tee -a "$LOG_FILE"
}

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}❌ $1${NC}" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}" | tee -a "$LOG_FILE"
}

# Check root privileges
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root. Please use sudo."
        exit 1
    fi
    log_success "Running as root"
}

# Detect OS/Distribution
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_TYPE=$ID
        OS_VERSION=$VERSION_ID
        OS_CODENAME=$VERSION_CODENAME
    else
        log_error "Cannot detect OS type"
        exit 1
    fi
    log "Detected OS: $OS_TYPE (${OS_VERSION:-unknown})"
}

# Check if command exists
command_exists() {
    command -v "$1" &> /dev/null
}

################################################################################
# VERSION SCRAPING FUNCTIONS
################################################################################

# Get latest Docker version
scrape_docker_version() {
    log "🔍 Scraping latest Docker version..."
    local docker_version
    
    # Try to get latest from Docker API
    docker_version=$(curl -s https://api.github.com/repos/moby/moby/releases/latest | grep '"tag_name"' | head -1 | sed 's/.*"v//' | sed 's/".*//')
    
    if [ -z "$docker_version" ]; then
        docker_version="latest"
        log_warning "Could not determine latest Docker version, using: $docker_version"
    else
        log_success "Latest Docker version found: v$docker_version"
    fi
    
    echo "$docker_version"
}

# Get latest NVM version
scrape_nvm_version() {
    log "🔍 Scraping latest NVM version..."
    local nvm_version
    
    nvm_version=$(curl -s https://api.github.com/repos/nvm-sh/nvm/releases/latest | grep '"tag_name"' | head -1 | sed 's/.*"v//' | sed 's/".*//')
    
    if [ -z "$nvm_version" ]; then
        nvm_version="v0.40.3"  # Fallback version
        log_warning "Could not determine latest NVM version, using fallback: $nvm_version"
    else
        log_success "Latest NVM version found: $nvm_version"
    fi
    
    echo "$nvm_version"
}

# Get latest Nginx version
scrape_nginx_version() {
    log "🔍 Checking available Nginx versions from package manager..."
    
    if command_exists apt; then
        local nginx_version=$(apt-cache policy nginx 2>/dev/null | grep Candidate | awk '{print $2}' | head -1)
        if [ -n "$nginx_version" ]; then
            log_success "Nginx version available: $nginx_version"
            echo "$nginx_version"
            return 0
        fi
    fi
    
    local nginx_version=$(curl -s https://api.github.com/repos/nginx/nginx/releases/latest 2>/dev/null | grep '"tag_name"' | head -1 | sed 's/.*"release-//' | sed 's/".*//')
    
    if [ -z "$nginx_version" ]; then
        log_warning "Could not determine latest Nginx version, will use package manager default"
        echo "latest"
    else
        log_success "Latest Nginx version found: $nginx_version"
        echo "$nginx_version"
    fi
}

# Get latest Certbot version
scrape_certbot_version() {
    log "🔍 Checking available Certbot versions from package manager..."
    
    if command_exists apt; then
        local certbot_version=$(apt-cache policy certbot 2>/dev/null | grep Candidate | awk '{print $2}' | head -1)
        if [ -n "$certbot_version" ]; then
            log_success "Certbot version available: $certbot_version"
            echo "$certbot_version"
            return 0
        fi
    fi
    
    local certbot_version=$(curl -s https://api.github.com/repos/certbot/certbot/releases/latest 2>/dev/null | grep '"tag_name"' | head -1 | sed 's/.*"v//' | sed 's/".*//')
    
    if [ -z "$certbot_version" ]; then
        log_warning "Could not determine latest Certbot version, will use package manager default"
        echo "latest"
    else
        log_success "Latest Certbot version found: $certbot_version"
        echo "$certbot_version"
    fi
}

################################################################################
# INSTALLATION FUNCTIONS
################################################################################

# Install dependencies
install_dependencies() {
    log "📦 Installing base dependencies..."
    
    if command_exists apt; then
        log "Using apt (Debian/Ubuntu)"
        apt-get update -y >> "$LOG_FILE" 2>&1
        apt-get install -y curl make build-essential ca-certificates gnupg wget git >> "$LOG_FILE" 2>&1
    elif command_exists dnf; then
        log "Using dnf (Fedora)"
        dnf install -y curl make gcc gcc-c++ ca-certificates gnupg wget git >> "$LOG_FILE" 2>&1
    elif command_exists yum; then
        log "Using yum (CentOS/RHEL)"
        yum install -y curl make gcc gcc-c++ ca-certificates gnupg wget git >> "$LOG_FILE" 2>&1
    else
        log_error "No supported package manager found (apt/yum/dnf)"
        return 1
    fi
    
    log_success "Base dependencies installed"
}

# Install Docker
install_docker() {
    log "🐳 Installing Docker Engine..."
    
    if command_exists docker; then
        log_warning "Docker already installed: $(docker --version)"
        return 0
    fi
    
    if command_exists apt; then
        install_docker_debian
    elif command_exists yum || command_exists dnf; then
        install_docker_rhel
    else
        log_error "Unsupported package manager"
        return 1
    fi
}

# Install Docker on Debian/Ubuntu
install_docker_debian() {
    log "Setting up Docker repository for Debian/Ubuntu..."
    
    install -m 0755 -d /etc/apt/keyrings >> "$LOG_FILE" 2>&1
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg >> "$LOG_FILE" 2>&1
    chmod a+r /etc/apt/keyrings/docker.gpg
    
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    apt-get update -y >> "$LOG_FILE" 2>&1
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >> "$LOG_FILE" 2>&1
    
    systemctl enable docker >> "$LOG_FILE" 2>&1
    systemctl start docker >> "$LOG_FILE" 2>&1
    
    if [ -n "$SUDO_USER" ]; then
        usermod -aG docker "$SUDO_USER"
        log "Added $SUDO_USER to docker group"
    fi
    
    log_success "Docker installed: $(docker --version)"
}

# Install Docker on RHEL/CentOS/Fedora
install_docker_rhel() {
    local PKG_MANAGER="yum"
    
    if command_exists dnf; then
        PKG_MANAGER="dnf"
    fi
    
    log "Setting up Docker repository for RHEL/CentOS/Fedora..."
    
    $PKG_MANAGER install -y yum-utils >> "$LOG_FILE" 2>&1
    yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo >> "$LOG_FILE" 2>&1
    
    $PKG_MANAGER install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >> "$LOG_FILE" 2>&1
    
    systemctl enable docker >> "$LOG_FILE" 2>&1
    systemctl start docker >> "$LOG_FILE" 2>&1
    
    if [ -n "$SUDO_USER" ]; then
        usermod -aG docker "$SUDO_USER"
        log "Added $SUDO_USER to docker group"
    fi
    
    log_success "Docker installed: $(docker --version)"
}

# Install NVM (Node Version Manager)
install_nvm() {
    log "📦 Installing Node Version Manager (NVM)..."
    
    if [ -d "$HOME/.nvm" ]; then
        log_warning "NVM already installed at $HOME/.nvm"
        return 0
    fi
    
    local NVM_VERSION=$(scrape_nvm_version)
    
    log "Installing NVM v$NVM_VERSION..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh | bash >> "$LOG_FILE" 2>&1
    
    # Source NVM immediately for current session
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    
    log_success "NVM installed: $(. $HOME/.nvm/nvm.sh && nvm --version)"
}

# Install Nginx
install_nginx() {
    log "🌐 Installing Nginx web server..."
    
    if command_exists nginx; then
        log_warning "Nginx already installed: $(nginx -v 2>&1)"
        return 0
    fi
    
    local nginx_version=$(scrape_nginx_version)
    
    if command_exists apt; then
        apt-get install -y nginx >> "$LOG_FILE" 2>&1
    elif command_exists dnf; then
        dnf install -y nginx >> "$LOG_FILE" 2>&1
    elif command_exists yum; then
        yum install -y nginx >> "$LOG_FILE" 2>&1
    else
        log_error "No package manager found for Nginx installation"
        return 1
    fi
    
    # Enable and start Nginx
    systemctl enable nginx >> "$LOG_FILE" 2>&1
    systemctl start nginx >> "$LOG_FILE" 2>&1
    
    # Backup original config
    if [ -f /etc/nginx/nginx.conf ]; then
        cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup.${TIMESTAMP}
    fi
    
    # Test configuration
    nginx -t >> "$LOG_FILE" 2>&1
    
    log_success "Nginx installed: $(nginx -v 2>&1)"
}

# Install Certbot (Let's Encrypt SSL/TLS certificate automation)
install_certbot() {
    log "🔐 Installing Certbot for SSL/TLS certificates..."
    
    if command_exists certbot; then
        log_warning "Certbot already installed: $(certbot --version 2>&1)"
        return 0
    fi
    
    local certbot_version=$(scrape_certbot_version)
    
    if command_exists apt; then
        apt-get install -y certbot python3-certbot-nginx >> "$LOG_FILE" 2>&1
    elif command_exists dnf; then
        dnf install -y certbot python3-certbot-nginx >> "$LOG_FILE" 2>&1
    elif command_exists yum; then
        yum install -y certbot python3-certbot-nginx >> "$LOG_FILE" 2>&1
    else
        log_error "No package manager found for Certbot installation"
        return 1
    fi
    
    # Create renewal hooks directory
    mkdir -p /etc/letsencrypt/renewal-hooks/post >> "$LOG_FILE" 2>&1
    mkdir -p /etc/letsencrypt/renewal-hooks/pre >> "$LOG_FILE" 2>&1
    
    # Enable automatic renewal timer (if using systemd)
    if command_exists systemctl; then
        systemctl enable certbot.timer >> "$LOG_FILE" 2>&1
        systemctl start certbot.timer >> "$LOG_FILE" 2>&1
    fi
    
    log_success "Certbot installed: $(certbot --version 2>&1)"
}

################################################################################
# VERIFICATION FUNCTIONS
################################################################################

# Verify Docker installation
verify_docker() {
    log "🔍 Verifying Docker installation..."
    
    if ! command_exists docker; then
        log_error "Docker command not found"
        return 1
    fi
    
    # Try to run hello-world container
    if docker run --rm hello-world > /dev/null 2>&1; then
        log_success "Docker verified successfully"
        docker --version | tee -a "$LOG_FILE"
        return 0
    else
        log_warning "Docker installed but container test failed (may need user login)"
        docker --version | tee -a "$LOG_FILE"
        return 0
    fi
}

# Verify NVM installation
verify_nvm() {
    log "🔍 Verifying NVM installation..."
    
    if [ ! -d "$HOME/.nvm" ]; then
        log_error "NVM directory not found"
        return 1
    fi
    
    . "$HOME/.nvm/nvm.sh"
    
    if nvm --version > /dev/null 2>&1; then
        log_success "NVM verified successfully"
        nvm --version | tee -a "$LOG_FILE"
        return 0
    else
        log_error "NVM not functioning properly"
        return 1
    fi
}

# Verify Nginx installation
verify_nginx() {
    log "🔍 Verifying Nginx installation..."
    
    if ! command_exists nginx; then
        log_error "Nginx command not found"
        return 1
    fi
    
    if nginx -t 2>&1 | grep -q "successful"; then
        log_success "Nginx verified successfully"
        nginx -v 2>&1 | tee -a "$LOG_FILE"
        return 0
    else
        log_warning "Nginx installed but configuration test failed"
        return 1
    fi
}

# Verify Certbot installation
verify_certbot() {
    log "🔍 Verifying Certbot installation..."
    
    if ! command_exists certbot; then
        log_error "Certbot command not found"
        return 1
    fi
    
    if certbot --version > /dev/null 2>&1; then
        log_success "Certbot verified successfully"
        certbot --version 2>&1 | tee -a "$LOG_FILE"
        return 0
    else
        log_error "Certbot not functioning properly"
        return 1
    fi
}

################################################################################
# MAIN EXECUTION
################################################################################

main() {
    clear
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║  Docker & Development Environment Initialization Script   ║${NC}"
    echo -e "${BLUE}║  Standalone Setup with Automatic Version Detection        ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    init_logging
    
    log "Starting comprehensive system initialization..."
    log "Log file: $LOG_FILE"
    echo ""
    
    # Check prerequisites
    log "🔧 Checking prerequisites..."
    check_root
    detect_os
    echo ""
    
    # Display version detection
    log "🌐 Scraping latest component versions..."
    local DOCKER_VER=$(scrape_docker_version)
    local NVM_VER=$(scrape_nvm_version)
    local NGINX_VER=$(scrape_nginx_version)
    echo ""
    
    # Installation steps
    log "📥 Installing components..."
    echo ""
    
    if ! install_dependencies; then
        log_error "Failed to install dependencies"
        exit 1
    fi
    echo ""
    
    if ! install_docker; then
        log_error "Failed to install Docker"
        exit 1
    fi
    echo ""
    
    if ! install_nvm; then
        log_warning "NVM installation encountered an issue, continuing..."
    fi
    echo ""
    
    if ! install_nginx; then
        log_error "Failed to install Nginx"
        exit 1
    fi
    echo ""
    
    if ! install_certbot; then
        log_warning "Certbot installation encountered an issue, continuing..."
    fi
    echo ""
    
    # Verification steps
    log "✅ Verifying installations..."
    echo ""
    
    verify_docker
    verify_nvm
    verify_nginx
    verify_certbot
    
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✅ System Initialization Completed Successfully!         ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}⚠️  IMPORTANT NOTES:${NC}"
    echo "  • Log file: $LOG_FILE"
    echo "  • Docker group changes require logout/login to apply"
    echo "  • NVM requires shell reload: exec \$SHELL"
    echo "  • Nginx is running and enabled at startup"
    echo "  • Certbot is installed with automatic renewal via systemd timer"
    echo "  • To create a certificate: sudo certbot certonly --nginx -d yourdomain.com"
    echo ""
    
    log "Initialization completed at $(date)"
}

# Execute main
main "$@"
exit 0
