const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const STREAMS_CONF_DIR = '/etc/nginx/streams-available';
const STREAMS_ENABLED_DIR = '/etc/nginx/streams-enabled';

// List configurations
router.get('/', (req, res) => {
    try {
        if (!fs.existsSync(STREAMS_CONF_DIR)) return res.json([]);
        const files = fs.readdirSync(STREAMS_CONF_DIR);
        res.json(files);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get specific stream details
router.get('/:name', (req, res) => {
    const filePath = path.join(STREAMS_CONF_DIR, `${req.params.name}.conf`);
    try {
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Config not found' });
        const content = fs.readFileSync(filePath, 'utf8');

        const listenMatch = content.match(/listen (\d+)( udp)?;/);
        const proxyMatch = content.match(/proxy_pass (.+):(\d+);/);

        res.json({
            name: req.params.name,
            listenPort: listenMatch ? listenMatch[1] : '',
            protocol: listenMatch && listenMatch[2] ? 'udp' : 'tcp',
            targetIp: proxyMatch ? proxyMatch[1] : '',
            targetPort: proxyMatch ? proxyMatch[2] : ''
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create/Update configuration
router.post('/', (req, res) => {
    const { name, listenPort, targetIp, targetPort, protocol } = req.body;
    const filename = `${name}.conf`;
    const filePath = path.join(STREAMS_CONF_DIR, filename);
    const enabledPath = path.join(STREAMS_ENABLED_DIR, filename);

    const config = `
server {
    listen ${listenPort}${protocol === 'udp' ? ' udp' : ''};
    proxy_pass ${targetIp}:${targetPort};
}
`;

    try {
        fs.writeFileSync(filePath, config);
        if (!fs.existsSync(enabledPath)) {
            fs.symlinkSync(filePath, enabledPath);
        }

        exec('nginx -t && systemctl reload nginx', (error, stdout, stderr) => {
            if (error) {
                return res.status(500).json({ error: 'Nginx config test failed', details: stderr });
            }
            res.json({ message: 'Stream configuration updated and reloaded' });
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete configuration
router.delete('/:name', (req, res) => {
    const name = req.params.name;
    const filePath = path.join(STREAMS_CONF_DIR, `${name}.conf`);
    const enabledPath = path.join(STREAMS_ENABLED_DIR, `${name}.conf`);

    try {
        if (fs.existsSync(enabledPath)) fs.unlinkSync(enabledPath);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        exec('systemctl reload nginx', (error, stdout, stderr) => {
            res.json({ message: 'Stream configuration deleted' });
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
