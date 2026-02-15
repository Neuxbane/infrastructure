const express = require('express');
const router = express.Router();
const { exec } = require('child_process');

// Request a new certificate
router.post('/request', (req, res) => {
    const { domain, email } = req.body;

    // Using --nginx plugin for automatic configuration
    const command = `certbot --nginx -d ${domain} --non-interactive --agree-tos -m ${email} && systemctl reload nginx`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: 'Certbot execution failed', details: stderr });
        }
        res.json({ message: 'SSL certificate obtained and Nginx reloaded successfully', output: stdout });
    });
});

// List certificates
router.get('/certificates', (req, res) => {
    exec('certbot certificates', (error, stdout, stderr) => {
        if (error && !stdout) {
            return res.status(500).json({ error: 'Failed to list certificates' });
        }

        const certs = [];
        const blocks = stdout.split('- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -');

        blocks.forEach(block => {
            if (block.includes('Certificate Name:')) {
                const nameMatch = block.match(/Certificate Name: (.+)/);
                const domainsMatch = block.match(/Domains: (.+)/);
                const expiryMatch = block.match(/Expiry Date: (.+) \(VALID: (.+)\)/);

                if (nameMatch) {
                    certs.push({
                        name: nameMatch[1].trim(),
                        domains: domainsMatch ? domainsMatch[1].trim() : '',
                        expiry: expiryMatch ? expiryMatch[1].trim() : '',
                        validDays: expiryMatch ? expiryMatch[2].trim() : ''
                    });
                }
            }
        });

        res.json(certs);
    });
});

// Renew all certificates
router.post('/renew', (req, res) => {
    exec('certbot renew', (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: 'Renewal failed' });
        }
        res.json({ message: 'Renewal process triggered', output: stdout });
    });
});

// Renew specific certificate
router.post('/renew/:name', (req, res) => {
    const name = req.params.name;
    exec(`certbot renew --cert-name ${name}`, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: `Renewal failed for ${name}` });
        }
        res.json({ message: `Renewal successful for ${name}`, output: stdout });
    });
});

module.exports = router;
