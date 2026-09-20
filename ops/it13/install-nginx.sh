#!/usr/bin/env bash
set -euo pipefail
source_config=/home/pi-node/tarokza2/nginx.it13.conf
target=/etc/nginx/sites-available/tarok
link=/etc/nginx/sites-enabled/tarok
test -s /etc/letsencrypt/live/tarok/fullchain.pem
nginx -t
backup=$(mktemp -d /var/backups/tarok-nginx.XXXXXX)
if [[ -e "$target" ]]; then cp -a "$target" "$backup/tarok"; fi
rollback() {
    if [[ -e "$backup/tarok" ]]; then
        cp -a "$backup/tarok" "$target"
    else
        rm -f "$link" "$target"
    fi
    nginx -t && systemctl reload nginx
}
trap rollback ERR
install -m 644 "$source_config" "$target"
ln -sfn "$target" "$link"
nginx -t
systemctl reload nginx
trap - ERR
echo "Tarok Nginx configuration installed; backup: $backup"
