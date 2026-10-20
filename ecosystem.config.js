module.exports = {
  apps: [
    {
      name: "blastrr-engine",
      script: "./server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        PORT: 4480,
        NODE_ENV: 'production'
      }
    }
  ]
};
