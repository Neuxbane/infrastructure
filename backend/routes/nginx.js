const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const http = require('http');
const https = require('https');

const NGINX_CONF_DIR = process.env.NGINX_CONF_DIR || '/etc/nginx/sites-available';
const NGINX_ENABLED_DIR = process.env.NGINX_ENABLED_DIR || '/etc/nginx/sites-enabled';
const NGINX_META_DIR = process.env.NGINX_META_DIR || '/etc/nginx/infraflow-meta';

// Ensure required Nginx structures and snippets exist
const ensureNginxSnippet = () => {
    const SNIPPET_DIR = '/etc/nginx/snippets';
    const SNIPPET_PATH = path.join(SNIPPET_DIR, 'custom_error_pages.conf');
    const ERROR_PAGES_DIR = '/root/core/backend/code';

    const snippetContent = `
error_page 404 /404.html;
error_page 502 503 504 /502.html;

location = /404.html {
    root ${ERROR_PAGES_DIR};
    internal;
}

location = /502.html {
    root ${ERROR_PAGES_DIR};
    internal;
}
`;

    try {
        if (!fs.existsSync(SNIPPET_DIR)) {
            fs.mkdirSync(SNIPPET_DIR, { recursive: true });
        }

        // Always ensure the snippet is up to date with the correct path
        fs.writeFileSync(SNIPPET_PATH, snippetContent.trim());
        console.log('Ensured Nginx snippet exists at:', SNIPPET_PATH);
    } catch (err) {
        console.error('Failed to create Nginx snippet:', err);
    }
};

// Ensure meta dir exists
if (!fs.existsSync(NGINX_META_DIR)) {
    fs.mkdirSync(NGINX_META_DIR, { recursive: true });
}

// Initial snippet check
ensureNginxSnippet();

// Test backend connection
router.post('/test-connection', (req, res) => {
    const { targetIp, targetPort, useHttps } = req.body;
    const protocol = useHttps ? https : http;
    
    let responded = false;
    const sendResponse = (data, statusCode = 200) => {
        if (!responded) {
            responded = true;
            res.status(statusCode).json(data);
        }
    };

    const request = protocol.get({ 
        host: targetIp, 
        port: targetPort, 
        path: '/', 
        timeout: 5000, // Increase to 5s for slower containers
        rejectUnauthorized: false 
    }, (response) => {
        sendResponse({ 
            success: true, 
            status: response.statusCode, 
            message: `Connection successful! Backend responded with HTTP ${response.statusCode}`,
            headers: response.headers
        });
        response.resume();
    });
    
    request.on('error', (error) => {
        sendResponse({ 
            success: false, 
            message: `Connection failed: ${error.message}`,
            suggestion: error.code === 'ECONNREFUSED' ? 'Nothing is listening on this port. Try checking if the container is running.' : null
        }, 200); // We return 200 so the frontend can display the error message nicely
    });
    
    request.on('timeout', () => {
        request.destroy();
        sendResponse({ success: false, message: 'Connection timeout after 5 seconds' }, 200);
    });
});

// List configurations
router.get('/configs', (req, res) => {
    try {
        if (!fs.existsSync(NGINX_CONF_DIR)) return res.json([]);
        const files = fs.readdirSync(NGINX_CONF_DIR).filter(f => f.endsWith('.conf'));
        res.json(files);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get specific configuration details
router.get('/configs/:domain', (req, res) => {
    const domain = req.params.domain;
    const filePath = path.join(NGINX_CONF_DIR, `${domain}.conf`);
    const metaPath = path.join(NGINX_META_DIR, `${domain}.json`);

    try {
        if (!fs.existsSync(filePath)) {
            // Create a default configuration if it doesn't exist
            const defaultConfig = `
server {
    listen 80;
    server_name ${domain};
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
`;
            fs.writeFileSync(filePath, defaultConfig);
            console.log(`Created default config for ${domain}`);
        }
        
        let data = {};
        if (fs.existsSync(metaPath)) {
            data = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            // Ensure compatibility with old metadata format
            if (!data.locations && data.targetIp) {
                data.locations = [{
                    path: '/',
                    targetIp: data.targetIp,
                    targetPort: data.targetPort || '80',
                    websocket: data.rawContent?.includes('proxy_set_header Upgrade') || false
                }];
            }
        } else {
            // Fallback for existing configs without metadata
            const content = fs.readFileSync(filePath, 'utf8');
            const targetIpMatch = content.match(/proxy_pass http:\/\/(.+):(\d+);/);
            const hasSsl = content.includes('listen 443') || content.includes('ssl_certificate');
            
            data = {
                domain: domain,
                advancedMode: false,
                locations: targetIpMatch ? [{
                    path: '/',
                    targetIp: targetIpMatch[1],
                    targetPort: targetIpMatch[2],
                    websocket: content.includes('proxy_set_header Upgrade')
                }] : [],
                useSsl: hasSsl,
                rawContent: content
            };
        }
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create/Update configuration
router.post('/configs', (req, res) => {
    const { domain, locations, useSsl, email, advancedMode, rawContent, clientMaxBodySize, originalDomain } = req.body;
    
    // Ensure snippet exists before doing anything that might trigger nginx -t
    ensureNginxSnippet();

    // Handle rename: if originalDomain is provided and differs from domain, remove old config
    if (originalDomain && originalDomain !== domain) {
        try {
            const oldFilePath = path.join(NGINX_CONF_DIR, `${originalDomain}.conf`);
            const oldEnabledPath = path.join(NGINX_ENABLED_DIR, `${originalDomain}.conf`);
            const oldMetaPath = path.join(NGINX_META_DIR, `${originalDomain}.json`);
            
            if (fs.existsSync(oldEnabledPath)) fs.unlinkSync(oldEnabledPath);
            if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
            if (fs.existsSync(oldMetaPath)) fs.unlinkSync(oldMetaPath);
            console.log(`Renamed: Removed old config for ${originalDomain}`);
        } catch (err) {
            console.error('Failed to cleanup old domain during rename:', err);
        }
    }

    const filename = `${domain}.conf`;
    const filePath = path.join(NGINX_CONF_DIR, filename);
    const enabledPath = path.join(NGINX_ENABLED_DIR, filename);
    const metaPath = path.join(NGINX_META_DIR, `${domain}.json`);

    let config = '';
    if (advancedMode && rawContent) {
        config = rawContent;
    } else {
        let locationsConfig = '';
        (locations || []).forEach(loc => {
            // Build custom headers
            let customHeaders = '';
            if (loc.customHeaders && Array.isArray(loc.customHeaders)) {
                loc.customHeaders.forEach(h => {
                    if (h.name && h.value) {
                        customHeaders += `\n        add_header ${h.name} "${h.value}";`;
                    }
                });
            }

            // Build CORS if enabled
            let corsConfig = '';
            if (loc.enableCors) {
                corsConfig = `
        add_header 'Access-Control-Allow-Origin' '${loc.corsOrigin || '*'}';
        add_header 'Access-Control-Allow-Methods' '${loc.corsMethods || 'GET, POST, OPTIONS'}';
        add_header 'Access-Control-Allow-Headers' '${loc.corsHeaders || 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range'}';
        if ($request_method = 'OPTIONS') {
            add_header 'Access-Control-Max-Age' 1728000;
            add_header 'Content-Type' 'text/plain; charset=utf-8';
            add_header 'Content-Length' 0;
            return 204;
        }`;
            }

            // Build rate limiting
            let rateLimitConfig = '';
            if (loc.enableRateLimit) {
                rateLimitConfig = `\n        limit_req zone=${loc.rateLimitZone || 'general'} burst=${loc.rateLimitBurst || '10'} nodelay;`;
            }

            // Build caching
            let cacheConfig = '';
            if (loc.enableCache) {
                cacheConfig = `
        proxy_cache_valid 200 ${loc.cacheTime || '10m'};
        proxy_cache_bypass $http_pragma $http_authorization;
        add_header X-Cache-Status $upstream_cache_status;`;
            }

            // Build IP access control
            let accessControl = '';
            if (loc.allowedIps && loc.allowedIps.length > 0) {
                loc.allowedIps.forEach(ip => {
                    accessControl += `\n        allow ${ip};`;
                });
                accessControl += `\n        deny all;`;
            }

            locationsConfig += `
    location ${loc.path} {
        proxy_pass http://${loc.targetIp}:${loc.targetPort};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        ${loc.websocket ? `
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";` : ''}
        
        # Proxy timeouts
        proxy_connect_timeout ${loc.proxyTimeout || '60'}s;
        proxy_send_timeout ${loc.proxyTimeout || '60'}s;
        proxy_read_timeout ${loc.proxyTimeout || '60'}s;
        
        # Buffer settings
        proxy_buffering ${loc.enableBuffering !== false ? 'on' : 'off'};
        proxy_buffer_size ${loc.bufferSize || '4k'};
        proxy_buffers ${loc.bufferCount || '8'} ${loc.bufferSize || '4k'};
        ${customHeaders}${corsConfig}${rateLimitConfig}${cacheConfig}${accessControl}
        ${loc.customDirectives || ''}
    }
`;
        });

        // Add rate limit zones if needed
        let rateLimitZones = '';
        const uniqueZones = [...new Set((locations || []).filter(l => l.enableRateLimit).map(l => l.rateLimitZone || 'general'))];
        if (uniqueZones.length > 0) {
            rateLimitZones = `\n    # Rate limiting zones\n`;
            uniqueZones.forEach(zone => {
                rateLimitZones += `    limit_req_zone $binary_remote_addr zone=${zone}:10m rate=${domain.includes('api') ? '100' : '10'}r/s;\n`;
            });
        }

        // Check if SSL certificates exist
        const certPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
        const keyPath = `/etc/letsencrypt/live/${domain}/privkey.pem`;
        const sslExists = fs.existsSync(certPath) && fs.existsSync(keyPath);

        config = `
server {
    listen 80;
    ${sslExists ? 'listen 443 ssl http2;' : '# listen 443 ssl http2; # Will be enabled after SSL certificate generation'}
    server_name ${domain};
    include /etc/nginx/snippets/custom_error_pages.conf;
    client_max_body_size ${clientMaxBodySize || '10M'};

    ${sslExists ? `# SSL Configuration
    ssl_certificate ${certPath};
    ssl_certificate_key ${keyPath};` : '# SSL Config (Certbot will manage these after certificate generation)'}
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';

    ${sslExists ? `if ($scheme = http) {
        return 301 https://$host$request_uri;
    }` : '# HTTP to HTTPS redirect will be enabled after SSL setup'}


${locationsConfig}
}
`;
    }

    try {
        fs.writeFileSync(filePath, config);
        fs.writeFileSync(metaPath, JSON.stringify(req.body, null, 2));

        if (!fs.existsSync(enabledPath)) {
            try {
                fs.symlinkSync(filePath, enabledPath);
            } catch (symlinkError) {
                // If symlink already exists or other error, ignore if it exists
                if (!fs.existsSync(enabledPath)) throw symlinkError;
            }
        }

        // Test and reload
        exec('nginx -t', (testError, stdout, stderr) => {
            if (testError) {
                console.error('Nginx test error:', stderr);
                return res.status(500).json({ error: 'Nginx config test failed', details: stderr });
            }

            exec('systemctl reload nginx', (reloadError) => {
                if (useSsl && email) {
                    const certbotCmd = `certbot --nginx -d ${domain} -m ${email} --non-interactive --agree-tos --redirect`;
                    exec(certbotCmd, (certError, stdout, stderr) => {
                        if (certError) {
                            return res.status(500).json({ error: 'SSL request failed', details: stderr });
                        }
                        
                        // If successfully obtained cert, regenerate the config file with SSL enabled
                        // (This overwrites Certbot's modifications with our clean template using sslExists=true)
                        try {
                            // Check if certs exist now
                            const newCertPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
                            const newKeyPath = `/etc/letsencrypt/live/${domain}/privkey.pem`;
                            
                            if (fs.existsSync(newCertPath) && fs.existsSync(newKeyPath)) {
                                console.log('Certificate obtained, regenerating Nginx config...');
                                
                                // RE-GENERATE CONFIG (reuse variables from scope)
                                // Note: We duplicate the generation logic here or call a helper function. 
                                // Since logic is inline, we will re-write content with sslExists=true directives hardcoded/interpolated
                                
                                // 1. Rebuild locations block (same as above)
                                // We can just use the 'config' variable but replace commented SSL lines?
                                // Better to just replace the specific markers we added.
                                
                                let newConfig = config;
                                // Enable SSL Listen
                                newConfig = newConfig.replace('# listen 443 ssl http2; # Will be enabled after SSL certificate generation', 'listen 443 ssl http2;');
                                
                                // Enable SSL Config Block
                                newConfig = newConfig.replace('# SSL Config (Certbot will manage these after certificate generation)', `# SSL Configuration
    ssl_certificate ${newCertPath};
    ssl_certificate_key ${newKeyPath};`);
    
                                // Enable Redirect
                                newConfig = newConfig.replace('# HTTP to HTTPS redirect will be enabled after SSL setup', `if ($scheme = http) {
        return 301 https://$host$request_uri;
    }`);

                                fs.writeFileSync(filePath, newConfig);
                                
                                // Reload again to apply our clean SSL config
                                exec('systemctl reload nginx', () => {
                                    res.json({ message: 'Nginx configuration updated and SSL enabled' });
                                });
                            } else {
                                // Fallback if regular file check fails
                                res.json({ message: 'SSL enabled via Certbot' });
                            }
                        } catch (regenError) {
                            console.error('Error regenerating config after SSL:', regenError);
                            if (!res.headersSent) {
                                res.json({ message: 'SSL enabled but config regeneration failed', details: regenError.message });
                            }
                        }
                    });
                } else {
                    if (!res.headersSent) {
                        res.json({ message: 'Nginx configuration updated' });
                    }
                }
            });
        });
    } catch (error) {
        console.error('Route error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// Delete configuration
router.delete('/configs/:domain', (req, res) => {
    const domain = req.params.domain;
    const filePath = path.join(NGINX_CONF_DIR, `${domain}.conf`);
    const enabledPath = path.join(NGINX_ENABLED_DIR, `${domain}.conf`);
    const metaPath = path.join(NGINX_META_DIR, `${domain}.json`);

    try {
        if (fs.existsSync(enabledPath)) fs.unlinkSync(enabledPath);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);

        exec('systemctl reload nginx', (error, stdout, stderr) => {
            if (!res.headersSent) {
                res.json({ message: 'Nginx configuration deleted' });
            }
        });
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

module.exports = router;
