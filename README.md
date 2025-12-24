# 🎥 WebRTC Video Chat

App de videollamadas P2P con WebRTC, Socket.IO y diseño mobile-first.

## � Quick Start

### Option 1: Node.js (Recomendado)
```bash
npm install
node server.js
```

### Option 2: Python
```bash
pip install Flask Flask-SocketIO python-socketio eventlet pyOpenSSL
python3 server.py
```

Abre: `https://localhost:3030`

---

## � Requisitos

- **Node.js** 16+ o **Python** 3.8+
- **Certificados SSL** (ver abajo)

---

## 🔐 Certificados SSL

Genera certificados autofirmados:

```bash
mkdir -p ssl
openssl req -x509 -newkey rsa:4096 \
  -keyout key.pem \
  -out cert.pem \
  -days 365 -nodes \
  -subj "/C=US/ST=State/L=City/O=Org/CN=localhost"
```

> Para producción usa [Let's Encrypt](https://letsencrypt.org/)

---

## ⚙️ Servidor TURN/STUN (Opcional)

### ¿Cuándo lo necesitas?

- ✅ **SÍ**: Conexiones por Internet o NAT estricto
- ❌ **NO**: Redes locales con múltiples VLANs

### Instalación rápida (coturn):

```bash
# Instalar
sudo apt-get install coturn

# Configurar
sudo nano /etc/turnserver.conf
```

Configuración mínima:
```conf
listening-port=3478
external-ip=YOUR_PUBLIC_IP
realm=localhost
user=webrtc:webrtc123
```

```bash
# Iniciar
sudo systemctl start coturn
```

---

## ✨ Características

- 📹 Video/Audio P2P
- 💬 Chat en tiempo real
- 📱 UI mobile optimizada
- � Auto-rejoin
- 📤 Compartir archivos
- 🌓 Dark/Light mode

---

## 📁 Estructura

```
webRTC/
├── public/          # Frontend (HTML/CSS/JS)
├── server.js        # Servidor Node.js
├── server.py        # Servidor Python (equivalente)
├── key.pem          # Clave privada SSL
└── cert.pem         # Certificado SSL
```

---

## � Producción

### PM2 (Node.js)
```bash
pm2 start server.js --name webrtc
```

### Gunicorn (Python)
```bash
gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:3030 \
  --certfile=cert.pem --keyfile=key.pem server:app
```

---

## 📄 Licencia

MIT
