#!/bin/bash
# Ntopia one-click deploy script
# Usage: ./deploy.sh ntopia.top

set -e
DOMAIN=${1:?请提供域名，如: ./deploy.sh ntopia.top}

echo "=== 1/6 安装依赖 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx

echo "=== 2/6 项目配置 ==="
cd "$(dirname "$0")"
npm install
if [ ! -f .env ]; then
  node -e "console.log('SESSION_SECRET='+require('crypto').randomBytes(32).toString('hex'))" > .env
  echo 'PORT=3000' >> .env
fi

echo "=== 3/6 Nginx HTTP ==="
sudo tee /etc/nginx/sites-available/ntopia <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        client_max_body_size 10m;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/ntopia /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "=== 4/6 SSL 证书 ==="
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN || true

echo "=== 5/6 PM2 进程守护 ==="
npm install -g pm2
pm2 delete ntopia 2>/dev/null || true
pm2 start server.js --name ntopia --max-memory-restart 300M
pm2 save && pm2 startup systemd -u $USER --hp $HOME

echo "=== 6/6 完成 ==="
echo "访问 https://$DOMAIN"
echo "第一个注册用户自动成为 Owner"
