// AirRO Water — pm2 process config for the backend API.
// From the project root on the VPS:  pm2 start deploy/ecosystem.config.js
// Then:  pm2 save  &&  pm2 startup   (so it survives reboots)
module.exports = {
  apps: [
    {
      name: 'airro-api',
      cwd: './server',
      script: 'src/server.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        // Bind to localhost only — Nginx is the public entry point.
        HOST: '127.0.0.1',
        PORT: '4000',
      },
    },
  ],
};
