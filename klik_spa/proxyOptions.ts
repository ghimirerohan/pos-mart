const common_site_config = require('../../../sites/common_site_config.json');
const { webserver_port, default_site } = common_site_config;

// Get site name from environment variable or use default from config
const site_name = process.env.VITE_FRAPPE_SITE || default_site || 'development.localhost';

export default {
	'^/(app|api|assets|files|private)': {
		target: `http://${site_name}:${webserver_port}`,
		changeOrigin: true,
		ws: true,
		configure: (proxy, _options) => {
			proxy.on('error', (err, _req, _res) => {
				console.log('Proxy error:', err);
			});
			proxy.on('proxyReq', (proxyReq, req, _res) => {
				// Set the Host header to the site name for proper routing
				proxyReq.setHeader('Host', `${site_name}:${webserver_port}`);
				console.log('Proxying request:', req.method, req.url, '->', `${site_name}:${webserver_port}`);
			});
			proxy.on('proxyRes', (proxyRes, req, _res) => {
				console.log('Proxy response:', proxyRes.statusCode, req.url);
			});
		}
	}
};
