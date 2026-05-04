module.exports = {
  apps: [{
    name: 'eidosform-whatsapp',
    script: 'server.js',
    cwd: '/home/sidney/eidosform/services/whatsapp',
    env: {
      WHATSAPP_API_KEY: 'd740b16263d6e361d169d5a9b0a7c714054160f069756eff60456ee20b8d6d76',
      PORT: '3457',
    },
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    error_file: '/home/sidney/eidosform/services/whatsapp/logs/error.log',
    out_file: '/home/sidney/eidosform/services/whatsapp/logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    restart_delay: 5000,
    max_restarts: 20,
    kill_timeout: 5000,
  }],
}
