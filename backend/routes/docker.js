const express = require('express');
const router = express.Router();
const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// List all containers
router.get('/containers', async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        res.json(containers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List all networks (to choose for virtual IPs)
router.get('/networks', async (req, res) => {
    try {
        const networks = await docker.listNetworks();
        res.json(networks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create a network
router.post('/networks', async (req, res) => {
    const { name, driver, subnet, gateway } = req.body;
    try {
        const options = {
            Name: name,
            Driver: driver || 'bridge'
        };
        
        if (subnet || gateway) {
            options.IPAM = {
                Config: [{}]
            };
            if (subnet) options.IPAM.Config[0].Subnet = subnet;
            if (gateway) options.IPAM.Config[0].Gateway = gateway;
        }

        const network = await docker.createNetwork(options);
        res.json({ message: 'Network created', id: network.id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a network
router.delete('/networks/:id', async (req, res) => {
    try {
        const network = docker.getNetwork(req.params.id);
        await network.remove();
        res.json({ message: 'Network deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create a container with a specific virtual IP
router.post('/containers', async (req, res) => {
    const { name, image, network, ipAddress, env, ports } = req.body;
    try {
        const container = await docker.createContainer({
            Image: image,
            name: name,
            Env: env || [],
            HostConfig: {
                PortBindings: ports || {},
                NetworkMode: network
            },
            NetworkingConfig: {
                EndpointsConfig: {
                    [network]: {
                        IPAMConfig: {
                            IPv4Address: ipAddress
                        }
                    }
                }
            }
        });
        await container.start();
        res.json({ message: 'Container created and started', id: container.id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a container
router.delete('/containers/:id', async (req, res) => {
    try {
        const container = docker.getContainer(req.params.id);
        await container.stop();
        await container.remove();
        res.json({ message: 'Container deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List all volumes
router.get('/volumes', async (req, res) => {
    try {
        const volumes = await docker.listVolumes();
        res.json(volumes.Volumes || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create a volume
router.post('/volumes', async (req, res) => {
    const { name, driver, labels } = req.body;
    try {
        const volume = await docker.createVolume({
            Name: name,
            Driver: driver || 'local',
            Labels: labels || {}
        });
        res.json({ message: 'Volume created', name: volume.name });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a volume
router.delete('/volumes/:name', async (req, res) => {
    try {
        const volume = docker.getVolume(req.params.name);
        await volume.remove();
        res.json({ message: 'Volume deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Stream logs
router.get('/containers/:id/logs', async (req, res) => {
    const containerIdentifier = req.params.id;
    const container = docker.getContainer(containerIdentifier);
    
    // Verify container exists before attempting to stream logs
    try {
        await container.inspect();
    } catch (e) {
        return res.status(404).json({ error: 'Container not found' });
    }
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
    res.flushHeaders();

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 15000);

    try {
        const logStream = await container.logs({
            follow: true,
            stdout: true,
            stderr: true,
            tail: 100
        });

        let leftOver = Buffer.alloc(0);

        logStream.on('data', (chunk) => {
            let buffer = Buffer.concat([leftOver, chunk]);
            let offset = 0;

            while (offset + 8 <= buffer.length) {
                const length = buffer.readUInt32BE(offset + 4);
                if (offset + 8 + length <= buffer.length) {
                    const text = buffer.slice(offset + 8, offset + 8 + length).toString();
                    res.write(`data: ${JSON.stringify({ text })}\n\n`);
                    offset += 8 + length;
                } else {
                    break;
                }
            }
            leftOver = buffer.slice(offset);
        });

        logStream.on('end', () => {
            clearInterval(heartbeat);
            res.write(`data: ${JSON.stringify({ text: '\n--- Container stream ended ---\n' })}\n\n`);
            res.end();
        });

        logStream.on('error', (err) => {
            clearInterval(heartbeat);
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        });

        req.on('close', () => {
            clearInterval(heartbeat);
            logStream.destroy();
        });
    } catch (error) {
        clearInterval(heartbeat);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

module.exports = router;
