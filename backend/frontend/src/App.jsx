import React, { useState, useEffect, useRef } from 'react';
import { LayoutDashboard, Box, Zap, Lock, Settings, Plus, RefreshCw, Trash2, Globe, Activity, Edit2, Share2, Terminal, X, HardDrive } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// use relative API path so client and server share the same origin/scheme
const API_BASE = '/api';

function App() {
  const [activeTab, setActiveTab] = useState('docker');

  return (
    <div className="dashboard">
      <div className="sidebar">
        <div className="sidebar-logo">
          <Zap size={32} />
          <span>InfraFlow</span>
        </div>
        <nav>
          <div
            className={`nav-link ${activeTab === 'docker' ? 'active' : ''}`}
            onClick={() => setActiveTab('docker')}
          >
            <Box /> Docker
          </div>
          <div
            className={`nav-link ${activeTab === 'nginx' ? 'active' : ''}`}
            onClick={() => setActiveTab('nginx')}
          >
            <Globe /> Nginx Proxy
          </div>
          <div
            className={`nav-link ${activeTab === 'networks' ? 'active' : ''}`}
            onClick={() => setActiveTab('networks')}
          >
            <Share2 /> Docker Networks
          </div>
          <div
            className={`nav-link ${activeTab === 'volumes' ? 'active' : ''}`}
            onClick={() => setActiveTab('volumes')}
          >
            <HardDrive /> Docker Volumes
          </div>
          <div
            className={`nav-link ${activeTab === 'streams' ? 'active' : ''}`}
            onClick={() => setActiveTab('streams')}
          >
            <Activity /> Streams (TCP/UDP)
          </div>
        </nav>
      </div>

      <main className="main-content">
        <AnimatePresence mode="wait">
          {activeTab === 'docker' && <DockerPage key="docker" />}
          {activeTab === 'nginx' && <NginxPage key="nginx" />}
          {activeTab === 'networks' && <NetworksPage key="networks" />}
          {activeTab === 'volumes' && <VolumesPage key="volumes" />}
          {activeTab === 'streams' && <StreamsPage key="streams" />}
        </AnimatePresence>
      </main>
    </div>
  );
}

const LogModal = ({ container, onClose }) => {
  const [logs, setLogs] = useState('');
  const [status, setStatus] = useState('connecting');
  const scrollRef = useRef();

  useEffect(() => {
    let es;
    const containerName = container.Names[0].replace('/', '');
    const connect = () => {
      es = new EventSource(`${API_BASE}/docker/containers/${containerName}/logs`);
      
      es.onopen = () => setStatus('connected');
      
      es.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.text) {
          setLogs(prev => prev + data.text);
        }
        if (data.error) {
          setLogs(prev => prev + `\n[System Error]: ${data.error}\n`);
        }
      };

      es.onerror = () => {
        setStatus('reconnecting');
        es.close();
        setTimeout(connect, 3000); // Manual retry if server ends the response
      };
    };

    connect();

    return () => {
      if (es) es.close();
    };
  }, [container.Id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="modal-overlay">
      <div className="modal-content large">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <h2>Logs: {container.Names[0].replace('/', '')}</h2>
            <span className={`badge ${status === 'connected' ? 'badge-success' : 'badge-warning'}`}>
              {status === 'connected' ? 'Live' : 'Reconnecting...'}
            </span>
          </div>
          <X size={24} onClick={onClose} style={{ cursor: 'pointer' }} />
        </div>
        <div className="terminal-window" ref={scrollRef}>
          {logs || (status === 'connecting' ? 'Connecting to logs...' : 'Waiting for stream...')}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

const DockerPage = () => {
  const [containers, setContainers] = useState([]);
  const [networks, setNetworks] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [logContainer, setLogContainer] = useState(null);
  const [formData, setFormData] = useState({ name: '', image: '', network: '', ipAddress: '' });

  const fetchData = () => {
    fetch(`${API_BASE}/docker/containers`).then(r => r.json()).then(setContainers);
    fetch(`${API_BASE}/docker/networks`).then(r => r.json()).then(setNetworks);
  };

  useEffect(fetchData, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await fetch(`${API_BASE}/docker/containers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    setShowModal(false);
    setFormData({ name: '', image: '', network: '', ipAddress: '' });
    fetchData();
  };

  const handleEdit = (container) => {
    setFormData({
      id: container.Id,
      name: container.Names[0].replace('/', ''),
      image: container.Image,
      network: Object.keys(container.NetworkSettings.Networks)[0],
      ipAddress: Object.values(container.NetworkSettings.Networks)[0]?.IPAddress || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure?')) return;
    await fetch(`${API_BASE}/docker/containers/${id}`, { method: 'DELETE' });
    fetchData();
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>Docker</h1>
        <button className="btn" onClick={() => setShowModal(true)}><Plus size={20} /> New Container</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Image</th>
              <th>IP Address</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {containers.map(c => (
              <tr key={c.Id}>
                <td>{c.Names[0].replace('/', '')}</td>
                <td>{c.Image}</td>
                <td>{Object.values(c.NetworkSettings?.Networks || {})[0]?.IPAddress || 'Dynamic'}</td>
                <td><span className={`badge ${c.State === 'running' ? 'badge-success' : 'badge-warning'}`}>{c.State}</span></td>
                <td style={{ display: 'flex', gap: '1rem' }}>
                  <Terminal size={18} onClick={() => setLogContainer(c)} style={{ color: '#10b981', cursor: 'pointer' }} />
                  <Edit2 size={18} onClick={() => handleEdit(c)} style={{ color: 'var(--primary)', cursor: 'pointer' }} />
                  <Trash2 size={18} onClick={() => handleDelete(c.Id)} style={{ color: '#ef4444', cursor: 'pointer' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>{formData.id ? 'Edit Container' : 'New Container'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Container Name</label>
                <input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. web-app" />
              </div>
              <div className="form-group">
                <label>Image</label>
                <input required value={formData.image} onChange={e => setFormData({ ...formData, image: e.target.value })} placeholder="e.g. nginx:latest" />
              </div>
              <div className="form-group">
                <label>Network</label>
                <select value={formData.network} onChange={e => setFormData({ ...formData, network: e.target.value })}>
                  <option value="">Select Network</option>
                  {(networks || []).map(n => <option key={n.Id} value={n.Name}>{n.Name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Virtual IP Address</label>
                <input value={formData.ipAddress} onChange={e => setFormData({ ...formData, ipAddress: e.target.value })} placeholder="e.g. 172.18.0.10" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowModal(false); setFormData({ name: '', image: '', network: '', ipAddress: '' }); }}>Cancel</button>
                <button type="submit" className="btn">{formData.id ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {logContainer && (
        <LogModal container={logContainer} onClose={() => setLogContainer(null)} />
      )}
    </motion.div>
  );
};

const NginxPage = () => {
  const [configs, setConfigs] = useState([]);
  const [containers, setContainers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState({});
  const [formData, setFormData] = useState({ 
    domain: '', 
    locations: [{ 
      path: '/', 
      targetIp: '', 
      targetPort: '80', 
      websocket: false,
      enableCors: false,
      corsOrigin: '*',
      corsMethods: 'GET, POST, OPTIONS',
      corsHeaders: 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range',
      enableRateLimit: false,
      rateLimitZone: 'general',
      rateLimitBurst: '10',
      enableCache: false,
      cacheTime: '10m',
      customHeaders: [],
      allowedIps: [],
      proxyTimeout: '60',
      enableBuffering: true,
      bufferSize: '4k',
      bufferCount: '8',
      customDirectives: ''
    }], 
    useSsl: true, 
    email: localStorage.getItem('infraflow_renewal_email') || '', 
    clientMaxBodySize: '10M'
  });

  const fetchData = () => {
    fetch(`${API_BASE}/nginx/configs`)
      .then(r => r.json())
      .then(data => Array.isArray(data) ? setConfigs(data) : setConfigs([]))
      .catch(() => setConfigs([]));
      
    fetch(`${API_BASE}/docker/containers`)
      .then(r => r.json())
      .then(data => Array.isArray(data) ? setContainers(data) : setContainers([]))
      .catch(() => setContainers([]));
  };

  useEffect(fetchData, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    // Save email to localStorage for future use
    if (formData.email) {
      localStorage.setItem('infraflow_renewal_email', formData.email);
    }
    await fetch(`${API_BASE}/nginx/configs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    setLoading(false);
    setShowModal(false);
    setFormData({ 
      domain: '', 
      locations: [{ 
        path: '/', 
        targetIp: '', 
        targetPort: '80', 
        websocket: false,
        enableCors: false,
        corsOrigin: '*',
        corsMethods: 'GET, POST, OPTIONS',
        corsHeaders: 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range',
        enableRateLimit: false,
        rateLimitZone: 'general',
        rateLimitBurst: '10',
        enableCache: false,
        cacheTime: '10m',
        customHeaders: [],
        allowedIps: [],
        proxyTimeout: '60',
        enableBuffering: true,
        bufferSize: '4k',
        bufferCount: '8',
        customDirectives: ''
      }], 
      useSsl: true, 
      email: localStorage.getItem('infraflow_renewal_email') || '', 
      clientMaxBodySize: '10M' 
    });
    fetchData();
  };

  const addLocation = () => {
    setFormData({
      ...formData,
      locations: [...(formData.locations || []), { 
        path: '', 
        targetIp: '', 
        targetPort: '80', 
        websocket: false,
        enableCors: false,
        corsOrigin: '*',
        corsMethods: 'GET, POST, OPTIONS',
        corsHeaders: 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range',
        enableRateLimit: false,
        rateLimitZone: 'general',
        rateLimitBurst: '10',
        enableCache: false,
        cacheTime: '10m',
        customHeaders: [],
        allowedIps: [],
        proxyTimeout: '60',
        enableBuffering: true,
        bufferSize: '4k',
        bufferCount: '8',
        customDirectives: ''
      }]
    });
  };

  const removeLocation = (index) => {
    const newLocations = [...(formData.locations || [])];
    newLocations.splice(index, 1);
    setFormData({ ...formData, locations: newLocations });
  };

  const updateLocation = (index, field, value) => {
    const newLocations = [...(formData.locations || [])];
    if (!newLocations[index]) return;
    newLocations[index][field] = value;
    setFormData({ ...formData, locations: newLocations });
  };

  const testConnection = async (locationIndex) => {
    const loc = formData.locations[locationIndex];
    const newLocations = [...formData.locations];
    newLocations[locationIndex].testResult = null;
    setFormData({ ...formData, locations: newLocations });
    
    try {
      const response = await fetch(`${API_BASE}/nginx/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          targetIp: loc.targetIp, 
          targetPort: loc.targetPort,
          useHttps: false
        })
      });
      const result = await response.json();
      newLocations[locationIndex].testResult = result;
      setFormData({ ...formData, locations: newLocations });
    } catch (error) {
      newLocations[locationIndex].testResult = { 
        success: false, 
        message: `Test failed: ${error.message}` 
      };
      setFormData({ ...formData, locations: newLocations });
    }
  };

  const toggleSection = (locationIndex, section) => {
    const key = `${locationIndex}-${section}`;
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const addCustomHeader = (locationIndex) => {
    const newLocations = [...(formData.locations || [])];
    if (!newLocations[locationIndex].customHeaders) {
      newLocations[locationIndex].customHeaders = [];
    }
    newLocations[locationIndex].customHeaders.push({ name: '', value: '' });
    setFormData({ ...formData, locations: newLocations });
  };

  const removeCustomHeader = (locationIndex, headerIndex) => {
    const newLocations = [...(formData.locations || [])];
    newLocations[locationIndex].customHeaders.splice(headerIndex, 1);
    setFormData({ ...formData, locations: newLocations });
  };

  const updateCustomHeader = (locationIndex, headerIndex, field, value) => {
    const newLocations = [...(formData.locations || [])];
    newLocations[locationIndex].customHeaders[headerIndex][field] = value;
    setFormData({ ...formData, locations: newLocations });
  };

  const addAllowedIp = (locationIndex) => {
    const newLocations = [...(formData.locations || [])];
    if (!newLocations[locationIndex].allowedIps) {
      newLocations[locationIndex].allowedIps = [];
    }
    newLocations[locationIndex].allowedIps.push('');
    setFormData({ ...formData, locations: newLocations });
  };

  const removeAllowedIp = (locationIndex, ipIndex) => {
    const newLocations = [...(formData.locations || [])];
    newLocations[locationIndex].allowedIps.splice(ipIndex, 1);
    setFormData({ ...formData, locations: newLocations });
  };

  const updateAllowedIp = (locationIndex, ipIndex, value) => {
    const newLocations = [...(formData.locations || [])];
    newLocations[locationIndex].allowedIps[ipIndex] = value;
    setFormData({ ...formData, locations: newLocations });
  };

  const handleEdit = async (domain) => {
    const data = await fetch(`${API_BASE}/nginx/configs/${domain}`).then(r => r.json());
    
    // Store original domain to handle renames
    data.originalDomain = domain;

    // Ensure locations array exists with proper defaults
    if (!data.locations && data.targetIp) {
      data.locations = [{
        path: '/',
        targetIp: data.targetIp,
        targetPort: data.targetPort || '80',
        websocket: data.rawContent?.includes('proxy_set_header Upgrade') || false,
        enableCors: false,
        corsOrigin: '*',
        corsMethods: 'GET, POST, OPTIONS',
        corsHeaders: 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range',
        enableRateLimit: false,
        rateLimitZone: 'general',
        rateLimitBurst: '10',
        enableCache: false,
        cacheTime: '10m',
        customHeaders: [],
        allowedIps: [],
        proxyTimeout: '60',
        enableBuffering: true,
        bufferSize: '4k',
        bufferCount: '8',
        customDirectives: ''
      }];
    }
    
    // Apply defaults to existing locations
    if (data.locations) {
      data.locations = data.locations.map(loc => ({
        path: loc.path || '/',
        targetIp: loc.targetIp || '',
        targetPort: loc.targetPort || '80',
        websocket: loc.websocket || false,
        enableCors: loc.enableCors || false,
        corsOrigin: loc.corsOrigin || '*',
        corsMethods: loc.corsMethods || 'GET, POST, OPTIONS',
        corsHeaders: loc.corsHeaders || 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range',
        enableRateLimit: loc.enableRateLimit || false,
        rateLimitZone: loc.rateLimitZone || 'general',
        rateLimitBurst: loc.rateLimitBurst || '10',
        enableCache: loc.enableCache || false,
        cacheTime: loc.cacheTime || '10m',
        customHeaders: loc.customHeaders || [],
        allowedIps: loc.allowedIps || [],
        proxyTimeout: loc.proxyTimeout || '60',
        enableBuffering: loc.enableBuffering !== false,
        bufferSize: loc.bufferSize || '4k',
        bufferCount: loc.bufferCount || '8',
        customDirectives: loc.customDirectives || ''
      }));
    }
    
    setFormData({ 
      ...data, 
      isEdit: true, 
      domain: data.domain || domain,
      email: data.email || localStorage.getItem('infraflow_renewal_email') || '',
      clientMaxBodySize: data.clientMaxBodySize || '10M',
      useSsl: data.useSsl !== false
    });
    setShowModal(true);
  };

  const handleDelete = async (domain) => {
    const domainName = domain.replace('.conf', '');
    if (!confirm(`Delete config for ${domainName}?`)) return;
    await fetch(`${API_BASE}/nginx/configs/${domainName}`, { method: 'DELETE' });
    fetchData();
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>Global Proxy Manager</h1>
        <button className="btn" onClick={() => {
          setFormData({ 
            domain: '', 
            locations: [{ 
              path: '/', 
              targetIp: '', 
              targetPort: '80', 
              websocket: false,
              enableCors: false,
              corsOrigin: '*',
              corsMethods: 'GET, POST, OPTIONS',
              corsHeaders: 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range',
              enableRateLimit: false,
              rateLimitZone: 'general',
              rateLimitBurst: '10',
              enableCache: false,
              cacheTime: '10m',
              customHeaders: [],
              allowedIps: [],
              proxyTimeout: '60',
              enableBuffering: true,
              bufferSize: '4k',
              bufferCount: '8',
              customDirectives: ''
            }], 
            useSsl: true, 
            email: localStorage.getItem('infraflow_renewal_email') || '', 
            clientMaxBodySize: '10M' 
          });
          setShowModal(true);
        }}><Plus size={20} /> New Proxy Host</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Domain</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(configs || []).map(c => (
              <tr key={c}>
                <td>{c.replace('.conf', '')}</td>
                <td><span className="badge badge-success">HTTPS Active</span></td>
                <td style={{ display: 'flex', gap: '1rem' }}>
                  <Edit2 size={18} onClick={() => handleEdit(c.replace('.conf', ''))} style={{ color: 'var(--primary)', cursor: 'pointer' }} />
                  <Trash2 size={18} onClick={() => handleDelete(c)} style={{ color: '#ef4444', cursor: 'pointer' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '850px', width: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <h2 style={{ margin: 0 }}>{formData.isEdit ? 'Edit Proxy Host' : 'New Proxy Host'}</h2>
              <div style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)', padding: '0.4rem 1rem', borderRadius: '2rem', fontSize: '0.8rem', fontWeight: '600' }}>
                Secure Mode Active
              </div>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
                <div className="form-group">
                  <label>Domain Name</label>
                  <input required value={formData.domain} onChange={e => setFormData({ ...formData, domain: e.target.value })} placeholder="e.g. app.example.com" />
                </div>
                <div className="form-group">
                  <label>Max Storage/Body Size</label>
                  <input value={formData.clientMaxBodySize} onChange={e => setFormData({ ...formData, clientMaxBodySize: e.target.value })} placeholder="e.g. 10M" />
                </div>
              </div>

              <div style={{ marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid #334155', paddingBottom: '0.5rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Internal Routing (Locations)</h3>
                  <button type="button" className="btn btn-small btn-secondary" onClick={addLocation}><Plus size={14} /> Add Route</button>
                </div>
                
                { (formData.locations || []).map((loc, index) => (
                  <div key={index} className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem', background: '#1e293b', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                      <span style={{ color: 'var(--primary)', fontWeight: '700', fontSize: '0.9rem' }}>ROUTE #{index + 1}</span>
                      {(formData.locations || []).length > 1 && (
                        <Trash2 size={16} onClick={() => removeLocation(index)} style={{ color: '#ef4444', cursor: 'pointer' }} />
                      )}
                    </div>
                    
                    {/* Basic Routing */}
                    <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'rgba(99, 102, 241, 0.08)', borderRadius: '0.5rem', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                        <span style={{ fontWeight: '600', color: 'var(--primary)' }}>🌐 {formData.domain || 'domain.com'}:443</span>
                        <span style={{ color: '#6366f1' }}>→</span>
                        <span style={{ fontWeight: '600', color: '#4ade80' }}>{loc.targetIp || '10.x.x.x'}:{loc.targetPort || '80'}</span>
                        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#64748b' }}>(Public → Docker Container)</span>
                      </div>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '1rem', alignItems: 'end' }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>Public Path</label>
                          <input required value={loc.path} onChange={e => updateLocation(index, 'path', e.target.value)} placeholder="/" />
                          <small style={{ color: '#94a3b8', fontSize: '0.7rem' }}>URL prefix</small>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>Docker Container IP</label>
                          <select 
                            required 
                            value={(loc.targetIp && (containers || []).some(c => Object.values(c.NetworkSettings?.Networks || {})[0]?.IPAddress === loc.targetIp)) ? loc.targetIp : (loc.targetIp ? 'custom' : '')} 
                            onChange={e => updateLocation(index, 'targetIp', e.target.value)}
                          >
                            <option value="">Select Container</option>
                            {(containers || []).map(c => {
                              const ip = Object.values(c.NetworkSettings?.Networks || {})[0]?.IPAddress;
                              return ip ? <option key={c.Id} value={ip}>{c.Names[0].replace('/', '')} ({ip})</option> : null;
                            })}
                            <option value="custom">Manual IP Entry...</option>
                          </select>
                          {((loc.targetIp && !(containers || []).some(c => Object.values(c.NetworkSettings?.Networks || {})[0]?.IPAddress === loc.targetIp)) || loc.targetIp === 'custom') && (
                             <input 
                               style={{ marginTop: '0.5rem' }}
                               value={loc.targetIp === 'custom' ? '' : loc.targetIp} 
                               onChange={e => updateLocation(index, 'targetIp', e.target.value)} 
                               placeholder="10.x.x.x" 
                             />
                          )}
                          <small style={{ color: '#94a3b8', fontSize: '0.7rem' }}>Target backend IP</small>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>Container Port</label>
                          <input required value={loc.targetPort} onChange={e => updateLocation(index, 'targetPort', e.target.value)} placeholder="80" />
                          <small style={{ color: '#94a3b8', fontSize: '0.7rem' }}>Backend port</small>
                        </div>
                      </div>
                    </div>
                    
                    {/* Connection Test */}
                    {loc.targetIp && loc.targetPort && (
                      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <button 
                          type="button" 
                          className="btn btn-small" 
                          onClick={() => testConnection(index)}
                          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', background: '#4ade80', color: '#000' }}
                        >
                          🔍 Test Connection
                        </button>
                        {loc.testResult && (
                          <span style={{ fontSize: '0.75rem', color: loc.testResult.success ? '#4ade80' : '#ef4444' }}>
                            {loc.testResult.success ? `✅ ${loc.testResult.message}` : `❌ ${loc.testResult.message}`}
                            {loc.testResult.suggestion && <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.25rem' }}>{loc.testResult.suggestion}</div>}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Quick Toggles */}
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                      <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 0, padding: '0.5rem 0.8rem', background: 'rgba(0,0,0,0.2)', borderRadius: '0.5rem', width: 'fit-content' }}>
                        <input type="checkbox" id={`ws-${index}`} checked={loc.websocket} onChange={e => updateLocation(index, 'websocket', e.target.checked)} style={{ width: 'auto', marginBottom: 0 }} />
                        <label htmlFor={`ws-${index}`} style={{ marginBottom: 0, fontSize: '0.8rem' }}>WebSockets</label>
                      </div>
                      <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 0, padding: '0.5rem 0.8rem', background: 'rgba(0,0,0,0.2)', borderRadius: '0.5rem', width: 'fit-content' }}>
                        <input type="checkbox" id={`cors-${index}`} checked={loc.enableCors} onChange={e => updateLocation(index, 'enableCors', e.target.checked)} style={{ width: 'auto', marginBottom: 0 }} />
                        <label htmlFor={`cors-${index}`} style={{ marginBottom: 0, fontSize: '0.8rem' }}>CORS</label>
                      </div>
                      <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 0, padding: '0.5rem 0.8rem', background: 'rgba(0,0,0,0.2)', borderRadius: '0.5rem', width: 'fit-content' }}>
                        <input type="checkbox" id={`cache-${index}`} checked={loc.enableCache} onChange={e => updateLocation(index, 'enableCache', e.target.checked)} style={{ width: 'auto', marginBottom: 0 }} />
                        <label htmlFor={`cache-${index}`} style={{ marginBottom: 0, fontSize: '0.8rem' }}>Caching</label>
                      </div>
                      <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 0, padding: '0.5rem 0.8rem', background: 'rgba(0,0,0,0.2)', borderRadius: '0.5rem', width: 'fit-content' }}>
                        <input type="checkbox" id={`rate-${index}`} checked={loc.enableRateLimit} onChange={e => updateLocation(index, 'enableRateLimit', e.target.checked)} style={{ width: 'auto', marginBottom: 0 }} />
                        <label htmlFor={`rate-${index}`} style={{ marginBottom: 0, fontSize: '0.8rem' }}>Rate Limiting</label>
                      </div>
                    </div>

                    {/* CORS Settings */}
                    {loc.enableCors && (
                      <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(99, 102, 241, 0.05)', borderRadius: '0.5rem', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                        <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--primary)' }}>CORS Configuration</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem' }}>
                          <div className="form-group">
                            <label>Allowed Origins</label>
                            <input value={loc.corsOrigin} onChange={e => updateLocation(index, 'corsOrigin', e.target.value)} placeholder="*" />
                          </div>
                          <div className="form-group">
                            <label>Allowed Methods</label>
                            <input value={loc.corsMethods} onChange={e => updateLocation(index, 'corsMethods', e.target.value)} placeholder="GET, POST, OPTIONS" />
                          </div>
                        </div>
                        <div className="form-group">
                          <label>Allowed Headers</label>
                          <input value={loc.corsHeaders} onChange={e => updateLocation(index, 'corsHeaders', e.target.value)} placeholder="DNT,User-Agent,X-Requested-With..." />
                        </div>
                      </div>
                    )}

                    {/* Caching Settings */}
                    {loc.enableCache && (
                      <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(34, 197, 94, 0.05)', borderRadius: '0.5rem', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                        <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#4ade80' }}>Caching Configuration</h4>
                        <div className="form-group">
                          <label>Cache Duration</label>
                          <input value={loc.cacheTime} onChange={e => updateLocation(index, 'cacheTime', e.target.value)} placeholder="10m" />
                          <small style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Examples: 10m (10 minutes), 1h (1 hour), 1d (1 day)</small>
                        </div>
                      </div>
                    )}

                    {/* Rate Limiting Settings */}
                    {loc.enableRateLimit && (
                      <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(234, 179, 8, 0.05)', borderRadius: '0.5rem', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                        <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#fde047' }}>Rate Limiting Configuration</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <div className="form-group">
                            <label>Zone Name</label>
                            <input value={loc.rateLimitZone} onChange={e => updateLocation(index, 'rateLimitZone', e.target.value)} placeholder="general" />
                          </div>
                          <div className="form-group">
                            <label>Burst Size</label>
                            <input value={loc.rateLimitBurst} onChange={e => updateLocation(index, 'rateLimitBurst', e.target.value)} placeholder="10" />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Advanced Collapsible Section */}
                    <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                      <div 
                        onClick={() => toggleSection(index, 'advanced')}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: '#94a3b8', fontSize: '0.85rem', fontWeight: '600' }}
                      >
                        <span style={{ transform: expandedSections[`${index}-advanced`] ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▶</span>
                        Advanced Settings
                      </div>
                      
                      {expandedSections[`${index}-advanced`] && (
                        <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '0.5rem' }}>
                          {/* Proxy Timeouts */}
                          <div className="form-group">
                            <label>Proxy Timeout (seconds)</label>
                            <input type="number" value={loc.proxyTimeout} onChange={e => updateLocation(index, 'proxyTimeout', e.target.value)} placeholder="60" />
                          </div>

                          {/* Buffer Settings */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                            <div className="form-group">
                              <label>Enable Buffering</label>
                              <select value={loc.enableBuffering ? 'true' : 'false'} onChange={e => updateLocation(index, 'enableBuffering', e.target.value === 'true')}>
                                <option value="true">On</option>
                                <option value="false">Off</option>
                              </select>
                            </div>
                            <div className="form-group">
                              <label>Buffer Size</label>
                              <input value={loc.bufferSize} onChange={e => updateLocation(index, 'bufferSize', e.target.value)} placeholder="4k" />
                            </div>
                            <div className="form-group">
                              <label>Buffer Count</label>
                              <input value={loc.bufferCount} onChange={e => updateLocation(index, 'bufferCount', e.target.value)} placeholder="8" />
                            </div>
                          </div>

                          {/* Custom Headers */}
                          <div style={{ marginTop: '1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                              <label style={{ marginBottom: 0 }}>Custom Headers</label>
                              <button type="button" className="btn btn-small" onClick={() => addCustomHeader(index)} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}>
                                <Plus size={12} /> Add Header
                              </button>
                            </div>
                            {(loc.customHeaders || []).map((header, hIndex) => (
                              <div key={hIndex} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <input 
                                  value={header.name} 
                                  onChange={e => updateCustomHeader(index, hIndex, 'name', e.target.value)} 
                                  placeholder="Header-Name" 
                                  style={{ marginBottom: 0 }}
                                />
                                <input 
                                  value={header.value} 
                                  onChange={e => updateCustomHeader(index, hIndex, 'value', e.target.value)} 
                                  placeholder="Header Value" 
                                  style={{ marginBottom: 0 }}
                                />
                                <Trash2 size={16} onClick={() => removeCustomHeader(index, hIndex)} style={{ color: '#ef4444', cursor: 'pointer', alignSelf: 'center' }} />
                              </div>
                            ))}
                          </div>

                          {/* IP Access Control */}
                          <div style={{ marginTop: '1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                              <label style={{ marginBottom: 0 }}>Allowed IPs (Leave empty for all)</label>
                              <button type="button" className="btn btn-small" onClick={() => addAllowedIp(index)} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}>
                                <Plus size={12} /> Add IP
                              </button>
                            </div>
                            {(loc.allowedIps || []).map((ip, ipIndex) => (
                              <div key={ipIndex} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <input 
                                  value={ip} 
                                  onChange={e => updateAllowedIp(index, ipIndex, e.target.value)} 
                                  placeholder="192.168.1.0/24" 
                                  style={{ marginBottom: 0 }}
                                />
                                <Trash2 size={16} onClick={() => removeAllowedIp(index, ipIndex)} style={{ color: '#ef4444', cursor: 'pointer', alignSelf: 'center' }} />
                              </div>
                            ))}
                          </div>

                          {/* Custom Directives */}
                          <div className="form-group" style={{ marginTop: '1rem' }}>
                            <label>Custom Nginx Directives</label>
                            <textarea
                              value={loc.customDirectives}
                              onChange={e => updateLocation(index, 'customDirectives', e.target.value)}
                              style={{ width: '100%', height: '100px', background: '#0f172a', color: '#e2e8f0', fontFamily: 'monospace', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #334155', fontSize: '0.8rem' }}
                              placeholder="# Add custom nginx directives here&#10;# Example:&#10;# proxy_ssl_verify off;"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ background: 'rgba(99, 102, 241, 0.05)', padding: '1.5rem', borderRadius: '1rem', border: '1px solid rgba(99, 102, 241, 0.2)', marginTop: '2rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--primary)', marginBottom: '1rem' }}>Security Settings</h3>
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{ color: 'var(--primary)' }}><Lock size={20} /></div>
                  <div>
                    <div style={{ fontWeight: '600' }}>SSL Certificate Strategy</div>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Dynamic HTTPS auto-configuration via Certbot (Let's Encrypt)</div>
                  </div>
                </div>
                <div className="form-group">
                  <label>Renewal Notification Email</label>
                  <input required type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="admin@example.com" />
                  {localStorage.getItem('infraflow_renewal_email') && (
                    <small style={{ color: '#4ade80', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.25rem' }}>
                      ✓ Remembered from last configuration
                    </small>
                  )}
                </div>
              </div>

              <div className="modal-actions" style={{ marginTop: '2.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => { 
                  setShowModal(false); 
                  setExpandedSections({});
                  setFormData({ 
                    domain: '', 
                    locations: [{ 
                      path: '/', 
                      targetIp: '', 
                      targetPort: '80', 
                      websocket: false,
                      enableCors: false,
                      corsOrigin: '*',
                      corsMethods: 'GET, POST, OPTIONS',
                      corsHeaders: 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range',
                      enableRateLimit: false,
                      rateLimitZone: 'general',
                      rateLimitBurst: '10',
                      enableCache: false,
                      cacheTime: '10m',
                      customHeaders: [],
                      allowedIps: [],
                      proxyTimeout: '60',
                      enableBuffering: true,
                      bufferSize: '4k',
                      bufferCount: '8',
                      customDirectives: ''
                    }], 
                    useSsl: true, 
                    email: localStorage.getItem('infraflow_renewal_email') || '', 
                    clientMaxBodySize: '10M' 
                  }); 
                }}>Cancel</button>
                <button type="submit" className="btn" disabled={loading} style={{ paddingLeft: '2.5rem', paddingRight: '2.5rem' }}>{loading ? 'Activating Proxy...' : (formData.isEdit ? 'Update Proxy' : 'Deploy Proxy')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </motion.div>
  );
};



const StreamsPage = () => {
  const [streams, setStreams] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', listenPort: '', targetIp: '', targetPort: '', protocol: 'tcp' });

  const fetchData = () => {
    fetch(`${API_BASE}/streams`)
      .then(r => r.json())
      .then(data => Array.isArray(data) ? setStreams(data) : setStreams([]))
      .catch(() => setStreams([]));
  };

  useEffect(fetchData, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await fetch(`${API_BASE}/streams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    setShowModal(false);
    setFormData({ name: '', listenPort: '', targetIp: '', targetPort: '', protocol: 'tcp' });
    fetchData();
  };

  const handleEdit = async (name) => {
    const data = await fetch(`${API_BASE}/streams/${name}`).then(r => r.json());
    setFormData(data);
    setShowModal(true);
  };

  const handleDelete = async (name) => {
    const streamName = name.replace('.conf', '');
    if (!confirm(`Delete stream ${streamName}?`)) return;
    await fetch(`${API_BASE}/streams/${streamName}`, { method: 'DELETE' });
    fetchData();
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>TCP/UDP Stream Forwarding</h1>
        <button className="btn" onClick={() => setShowModal(true)}><Plus size={20} /> Add Stream Proxy</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(streams || []).map(s => (
              <tr key={s}>
                <td>{s.replace('.conf', '')}</td>
                <td style={{ display: 'flex', gap: '1rem' }}>
                  <Edit2 size={18} onClick={() => handleEdit(s.replace('.conf', ''))} style={{ color: 'var(--primary)', cursor: 'pointer' }} />
                  <Trash2 size={18} onClick={() => handleDelete(s)} style={{ color: '#ef4444', cursor: 'pointer' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Add Stream Proxy</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Friendly Name</label>
                <input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. gitlab-ssh" />
              </div>
              <div className="form-group">
                <label>Protocol</label>
                <select value={formData.protocol} onChange={e => setFormData({ ...formData, protocol: e.target.value })}>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                </select>
              </div>
              <div className="form-group">
                <label>Listen Port (on Host)</label>
                <input required type="number" value={formData.listenPort} onChange={e => setFormData({ ...formData, listenPort: e.target.value })} placeholder="e.g. 2222" />
              </div>
              <div className="form-group">
                <label>Target IP (Docker Virtual IP)</label>
                <input required value={formData.targetIp} onChange={e => setFormData({ ...formData, targetIp: e.target.value })} placeholder="e.g. 10.255.255.20" />
              </div>
              <div className="form-group">
                <label>Target Port</label>
                <input required type="number" value={formData.targetPort} onChange={e => setFormData({ ...formData, targetPort: e.target.value })} placeholder="e.g. 22" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowModal(false); setFormData({ name: '', listenPort: '', targetIp: '', targetPort: '', protocol: 'tcp' }); }}>Cancel</button>
                <button type="submit" className="btn">Save Stream</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </motion.div>
  );
};

const NetworksPage = () => {
  const [networks, setNetworks] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', driver: 'bridge', subnet: '', gateway: '' });

  const fetchData = () => {
    fetch(`${API_BASE}/docker/networks`).then(r => r.json()).then(setNetworks);
  };

  useEffect(fetchData, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (formData.id) {
      // Logic for editing: Since Docker doesn't support updating IPAM config, 
      // we must delete and recreate (showing a warning).
      if (!confirm('To change network settings, the existing network will be deleted and recreated. This will disconnect any active containers. Continue?')) return;
      await fetch(`${API_BASE}/docker/networks/${formData.id}`, { method: 'DELETE' });
    }

    await fetch(`${API_BASE}/docker/networks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    setShowModal(false);
    setFormData({ name: '', driver: 'bridge', subnet: '', gateway: '' });
    fetchData();
  };

  const handleEdit = (network) => {
    setFormData({
      id: network.Id,
      name: network.Name,
      driver: network.Driver,
      subnet: network.IPAM?.Config?.[0]?.Subnet || '',
      gateway: network.IPAM?.Config?.[0]?.Gateway || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure? This will fail if containers are connected.')) return;
    await fetch(`${API_BASE}/docker/networks/${id}`, { method: 'DELETE' });
    fetchData();
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>Docker Networks</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={fetchData}><RefreshCw size={20} /> Refresh</button>
          <button className="btn" onClick={() => setShowModal(true)}><Plus size={20} /> Create Network</button>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Driver</th>
              <th>Subnet</th>
              <th>Gateway</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(networks || []).map(n => (
              <tr key={n.Id}>
                <td>{n.Name}</td>
                <td>{n.Driver}</td>
                <td>{n.IPAM?.Config?.[0]?.Subnet || 'N/A'}</td>
                <td>{n.IPAM?.Config?.[0]?.Gateway || 'N/A'}</td>
                <td style={{ display: 'flex', gap: '1rem' }}>
                  <Edit2 size={18} onClick={() => handleEdit(n)} style={{ color: 'var(--primary)', cursor: 'pointer' }} />
                  <Trash2 size={18} onClick={() => handleDelete(n.Id)} style={{ color: '#ef4444', cursor: 'pointer' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>{formData.id ? 'Edit Network' : 'New Network'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Network Name</label>
                <input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. my-network" />
              </div>
              <div className="form-group">
                <label>Driver</label>
                <select value={formData.driver} onChange={e => setFormData({ ...formData, driver: e.target.value })}>
                  <option value="bridge">bridge</option>
                  <option value="macvlan">macvlan</option>
                  <option value="ipvlan">ipvlan</option>
                </select>
              </div>
              <div className="form-group">
                <label>Subnet (CIDR)</label>
                <input value={formData.subnet} onChange={e => setFormData({ ...formData, subnet: e.target.value })} placeholder="e.g. 172.20.0.0/16" />
              </div>
              <div className="form-group">
                <label>Gateway</label>
                <input value={formData.gateway} onChange={e => setFormData({ ...formData, gateway: e.target.value })} placeholder="e.g. 172.20.0.1" />
              </div>
              {formData.id && (
                <p style={{ color: '#fbbf24', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Note: Updating will recreate the network.
                </p>
              )}
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowModal(false); setFormData({ name: '', driver: 'bridge', subnet: '', gateway: '' }); }}>Cancel</button>
                <button type="submit" className="btn">{formData.id ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </motion.div>
  );
};

const VolumesPage = () => {
  const [volumes, setVolumes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', driver: 'local' });

  const fetchData = () => {
    fetch(`${API_BASE}/docker/volumes`)
      .then(r => r.json())
      .then(data => Array.isArray(data) ? setVolumes(data) : setVolumes([]))
      .catch(() => setVolumes([]));
  };

  useEffect(fetchData, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await fetch(`${API_BASE}/docker/volumes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    setShowModal(false);
    setFormData({ name: '', driver: 'local' });
    fetchData();
  };

  const handleDelete = async (name) => {
    if (!confirm(`Are you sure you want to delete volume ${name}?`)) return;
    try {
      const res = await fetch(`${API_BASE}/docker/volumes/${name}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete volume');
      fetchData();
    } catch (error) {
      alert(error.message);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>Docker Volumes</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn btn-secondary" onClick={fetchData}><RefreshCw size={20} /> Refresh</button>
          <button className="btn" onClick={() => setShowModal(true)}><Plus size={20} /> Create Volume</button>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Driver</th>
              <th>Mountpoint</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(volumes || []).map(v => (
              <tr key={v.Name}>
                <td>{v.Name}</td>
                <td><span className="badge badge-info">{v.Driver}</span></td>
                <td style={{ fontSize: '0.8rem', color: '#94a3b8', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.Mountpoint}</td>
                <td style={{ display: 'flex', gap: '1rem' }}>
                  <Trash2 size={18} onClick={() => handleDelete(v.Name)} style={{ color: '#ef4444', cursor: 'pointer' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>New Volume</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Volume Name</label>
                <input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. my-data" />
              </div>
              <div className="form-group">
                <label>Driver</label>
                <select value={formData.driver} onChange={e => setFormData({ ...formData, driver: e.target.value })}>
                  <option value="local">local</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowModal(false); setFormData({ name: '', driver: 'local' }); }}>Cancel</button>
                <button type="submit" className="btn">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default App;
