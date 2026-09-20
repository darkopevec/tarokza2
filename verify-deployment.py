#!/usr/bin/env python3
"""Read-only public HTTP, TLS, readiness, assets, and WebSocket smoke checks."""
import base64
import json
import os
import re
import socket
import ssl
import urllib.request

for host in ('tarok.moonlitgarden.cc', 'tarok.moonlitgarden.xyz'):
    base = 'https://' + host
    with urllib.request.urlopen(base, timeout=15) as response:
        html = response.read().decode()
        assert response.status == 200
        assert "frame-ancestors 'none'" in response.headers.get('Content-Security-Policy', '')
        assert "script-src 'self'" in response.headers.get('Content-Security-Policy', '')
        assert response.headers.get('X-Frame-Options') == 'DENY'
        assert response.headers.get('Strict-Transport-Security') == 'max-age=31536000'
        assert response.headers.get('Permissions-Policy')
        assert len(response.headers.get_all('Referrer-Policy')) == 1
    for path in re.findall(r'(?:src|href)="(/assets/[^\"]+)"', html):
        with urllib.request.urlopen(base + path, timeout=15) as response:
            assert response.status == 200
        assert "frame-ancestors 'none'" in response.headers.get('Content-Security-Policy', '')
        assert "script-src 'self'" in response.headers.get('Content-Security-Policy', '')
        assert response.headers.get('X-Frame-Options') == 'DENY'
        assert response.headers.get('Strict-Transport-Security') == 'max-age=31536000'
        assert response.headers.get('Permissions-Policy')
        assert len(response.headers.get_all('Referrer-Policy')) == 1
    for path in ('/health', '/ready'):
        with urllib.request.urlopen(base + path, timeout=15) as response:
            data = json.load(response)
            assert response.status == 200 and data['ok'], data
    with urllib.request.urlopen(base + '/socket.io/?EIO=4&transport=polling', timeout=15) as response:
        packet = response.read().decode()
        assert packet.startswith('0') and 'websocket' in json.loads(packet[1:])['upgrades']
    with ssl.create_default_context().wrap_socket(socket.create_connection((host, 443), timeout=15), server_hostname=host) as sock:
        key = base64.b64encode(os.urandom(16)).decode()
        sock.sendall((f'GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: {host}\r\nOrigin: {base}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        received = b''
        while b'\r\n\r\n' not in received:
            received += sock.recv(4096)
        headers, frame = received.split(b'\r\n\r\n', 1)
        assert headers.startswith(b'HTTP/1.1 101'), headers
        while len(frame) < 2:
            frame += sock.recv(4096)
        assert frame[0] == 0x81, frame
    print(host + ': HTTPS, assets, health, readiness, polling and WebSocket upgrade passed')
