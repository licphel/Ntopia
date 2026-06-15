#!/bin/bash
# Ntopia Docker deploy
# Usage: ./deploy.sh ntopia.top
set -e
DOMAIN=${1:?请提供域名，如: ./deploy.sh ntopia.top}

echo "=== 1/5 安装 Docker ==="
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker $USER
  echo "Docker installed. Please re-login and run this script again."
  exit 0
fi

echo "=== 2/5 构建镜像 ==="
cd "$(dirname "$0")"
docker compose build

echo "=== 3/5 环境文件 ==="
if [ ! -f .env ]; then
  node -e "console.log('SESSION_SECRET='+require('crypto').randomBytes(32).toString('hex'))" > .env
  echo 'PORT=3000' >> .env
  echo 'SITE_URL=https://'$DOMAIN >> .env
  echo ".env generated. Edit it to set SMTP, OWNER_PASSWORD, etc."
fi

echo "=== 4/5 Nginx ==="
sudo tee /etc/nginx/sites-available/ntopia <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_cache_valid 200 365d;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/ntopia /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "=== 5/5 SSL + 启动 ==="
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN || true

docker compose up -d

echo "Done. Visit https://$DOMAIN"
