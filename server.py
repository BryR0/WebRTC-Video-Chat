import socketio
import aiohttp.web
from aiohttp import web
import ssl
import json
import sqlite3
import os
import datetime
import uuid
import sys
from collections import defaultdict

# ==========================================
# CONFIGURATION
# ==========================================
PORT = 3030
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')
DB_FILE = os.path.join(BASE_DIR, 'analytics.db')
CERT_FILE = os.path.join(BASE_DIR, 'cert.pem')
KEY_FILE = os.path.join(BASE_DIR, 'key.pem')

ADMIN_CREDENTIALS = {
    'username': 'admin',
    'password': 'NewM00n'
}

# ==========================================
# SETUP
# ==========================================
@web.middleware
async def global_headers_middleware(request, handler):
    response = await handler(request)
    # Explicitly allow camera/mic access (removed COEP/COOP as they block CDN resources)
    response.headers['Permissions-Policy'] = 'camera=*, microphone=*'
    return response

# Create Socket.IO server (Asynchronous)
sio = socketio.AsyncServer(async_mode='aiohttp', cors_allowed_origins='*')
app = web.Application(middlewares=[global_headers_middleware])
sio.attach(app)

# In-memory rooms storage (equivalent to rooms = {} in JS)
# Structure: {room_id: {socket_id: {username, id}}}
rooms = defaultdict(dict)

# In-memory session tokens for admin
admin_sessions = set()

# ==========================================
# DATABASE
# ==========================================
def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Sessions table
    c.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            username TEXT,
            room_id TEXT,
            socket_id TEXT,
            user_agent TEXT,
            ip TEXT,
            file_name TEXT,
            file_size INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Stats table
    c.execute('''
        CREATE TABLE IF NOT EXISTS stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            total_connections INTEGER DEFAULT 0,
            total_rooms INTEGER DEFAULT 0,
            total_messages INTEGER DEFAULT 0,
            total_files_shared INTEGER DEFAULT 0,
            peak_concurrent_users INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Initialize stats if empty
    c.execute("SELECT COUNT(*) FROM stats")
    if c.fetchone()[0] == 0:
        c.execute("INSERT INTO stats (id) VALUES (1)")
    
    # Online users table
    c.execute('''
        CREATE TABLE IF NOT EXISTS online_users (
            socket_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            room_id TEXT NOT NULL,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

# Database helper functions
def execute_query(query, args=(), commit=False):
    """Sync wrapper for sqlite execution"""
    try:
        conn = sqlite3.connect(DB_FILE)
        # Return dict-like rows
        conn.row_factory = sqlite3.Row 
        c = conn.cursor()
        c.execute(query, args)
        if commit:
            conn.commit()
            last_row_id = c.lastrowid
            conn.close()
            return last_row_id
        else:
            rows = c.fetchall()
            conn.close()
            # Convert sqlite3.Row items to dicts
            return [dict(row) for row in rows]
    except Exception as e:
        print(f"DB Error: {e}")
        return []

def execute_single(query, args=()):
    rows = execute_query(query, args)
    return rows[0] if rows else None

def log_session(data):
    query = '''
        INSERT INTO sessions (type, username, room_id, socket_id, user_agent, ip, file_name, file_size) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    '''
    execute_query(query, (
        data.get('type'),
        data.get('username'),
        data.get('roomId'),
        data.get('socketId'),
        data.get('userAgent'),
        data.get('ip'),
        data.get('fileName'),
        data.get('fileSize')
    ), commit=True)

def update_stats(field, increment=1):
    query = f"UPDATE stats SET {field} = {field} + ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1"
    execute_query(query, (increment,), commit=True)

def add_online_user(socket_id, username, room_id):
    query = "INSERT OR REPLACE INTO online_users (socket_id, username, room_id) VALUES (?, ?, ?)"
    execute_query(query, (socket_id, username, room_id), commit=True)
    
    # Check peak users
    users = execute_single("SELECT COUNT(*) as count FROM online_users")
    if users:
        current_count = users['count']
        stats = execute_single("SELECT peak_concurrent_users FROM stats WHERE id = 1")
        if stats and current_count > stats['peak_concurrent_users']:
            execute_query("UPDATE stats SET peak_concurrent_users = ? WHERE id = 1", (current_count,), commit=True)

def remove_online_user(socket_id):
    execute_query("DELETE FROM online_users WHERE socket_id = ?", (socket_id,), commit=True)

# ==========================================
# ROUTES & HANDLERS
# ==========================================

async def index_handler(request):
    return web.FileResponse(os.path.join(PUBLIC_DIR, 'index.html'))

async def webrtc_config_handler(request):
    is_linux = sys.platform.startswith('linux')
    # Use generic hostname or request host
    host = request.host
    
    if is_linux:
        config = {
            'iceServers': [
                {'urls': 'stun:stun.l.google.com:19302'},
                {'urls': f'turn:{host}:3478', 'username': 'webrtcuser', 'credential': 'webrtckey'}
            ]
        }
    else:
        config = {
            'iceServers': [{'urls': 'stun:stun.l.google.com:19302'}]
        }
    return web.json_response(config)

# --- Admin Routes ---

def is_authenticated(request):
    # Check simple session cookie/token
    cookie = request.cookies.get('admin_token')
    return cookie in admin_sessions

async def admin_login_page(request):
    return web.FileResponse(os.path.join(PUBLIC_DIR, 'admin.html'))

async def admin_dashboard_page(request):
    if not is_authenticated(request):
        return web.HTTPFound('/admin/login')
    return web.FileResponse(os.path.join(PUBLIC_DIR, 'admin-dashboard.html'))

async def admin_login_api(request):
    try:
        data = await request.json()
    except:
        return web.json_response({'success': False, 'error': 'Invalid JSON'}, status=400)
        
    username = data.get('username')
    password = data.get('password')
    
    if username == ADMIN_CREDENTIALS['username'] and password == ADMIN_CREDENTIALS['password']:
        # Create user session
        token = str(uuid.uuid4())
        admin_sessions.add(token)
        
        response = web.json_response({'success': True})
        response.set_cookie('admin_token', token, max_age=86400, httponly=True, secure=True)
        return response
    else:
        return web.json_response({'success': False, 'error': 'Invalid credentials'}, status=401)

async def admin_logout_api(request):
    token = request.cookies.get('admin_token')
    if token in admin_sessions:
        admin_sessions.remove(token)
    
    response = web.json_response({'success': True})
    response.del_cookie('admin_token')
    return response

async def admin_check_api(request):
    if is_authenticated(request):
        return web.json_response({'authenticated': True, 'username': ADMIN_CREDENTIALS['username']})
    else:
        return web.json_response({'authenticated': False}, status=401)

async def admin_analytics_api(request):
    if not is_authenticated(request):
        return web.json_response({'error': 'Unauthorized'}, status=401)
    
    try:
        stats = execute_single("SELECT * FROM stats WHERE id = 1")
        # Ensure stats exist
        if not stats: 
            stats = {}
            
        sessions = execute_query("SELECT * FROM sessions ORDER BY timestamp DESC LIMIT 100")
        online_users = execute_query("SELECT * FROM online_users ORDER BY joined_at DESC")
        unique_users = execute_single("SELECT COUNT(DISTINCT username) as unique_count FROM sessions")
        
        # Format rooms for JSON
        rooms_info = []
        for room_id, users in rooms.items():
            user_list = list(users.values())
            rooms_info.append({
                'roomId': room_id,
                'users': user_list,
                'userCount': len(user_list)
            })
            
        return web.json_response({
            'sessions': sessions,
            'stats': {
                **dict(stats),
                'uniqueUsers': unique_users['unique_count'] if unique_users else 0,
                'currentOnlineCount': len(online_users),
                'activeRooms': len(rooms)
            },
            'currentOnline': online_users,
            'rooms': rooms_info,
            'timestamp': datetime.datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"Analytics Error: {e}")
        return web.json_response({'error': 'Internal Server Error'}, status=500)


# ==========================================
# SOCKET.IO EVENTS
# ==========================================

@sio.event
async def join(sid, data):
    # Force string type for consistency
    room_id = str(data.get('roomId', '')).strip()
    username = str(data.get('username', '')).strip()
    
    if not room_id or not username:
        return

    print(f"DEBUG: User {username} joining room '{room_id}'") # Debug log
    
    # Initialize room if not exists
    if room_id not in rooms:
        rooms[room_id] = {}
        update_stats('total_rooms')

    # Check username collision
    current_usernames = [u['username'] for u in rooms[room_id].values()]
    if username in current_usernames:
        await sio.emit('join-error', {'message': 'Username already taken'}, room=sid)
        return

    # Store socket info
    async with sio.session(sid) as session:
        session['username'] = username
        session['room_id'] = room_id

    await sio.enter_room(sid, room_id)
    rooms[room_id][sid] = {'username': username, 'id': sid}

    # Log session
    environ = sio.get_environ(sid)
    # Try to get IP (handling proxies if needed, but keeping it simple)
    ip_address = environ.get('REMOTE_ADDR')
    user_agent = environ.get('HTTP_USER_AGENT', '')

    log_session({
        'type': 'join',
        'username': username,
        'roomId': room_id,
        'socketId': sid,
        'userAgent': user_agent,
        'ip': ip_address
    })

    # Stats
    update_stats('total_connections')
    add_online_user(sid, username, room_id)

    # Inform others
    existing_users = [u for socket_id, u in rooms[room_id].items() if socket_id != sid]
    
    print(f"DEBUG: Sending existing users to {sid}: {existing_users}")
    await sio.emit('existing-users', {'users': existing_users}, room=sid)
    
    print(f"DEBUG: Broadcasting user-joined to room {room_id} (skipping {sid})")
    await sio.emit('user-joined', {
        'userId': sid,
        'username': username
    }, room=room_id, skip_sid=sid)

    # System message
    print(f"DEBUG: Sending system message to room {room_id}")
    await sio.emit('chat-message', {
        'username': 'System',
        'message': f'{username} joined the room',
        'timestamp': datetime.datetime.now().timestamp() * 1000,
        'isSystem': True
    }, room=room_id)

@sio.event
async def chat_message(sid, data): # Python doesn't allow hyphens in func names, socketio maps 'chat-message' to chat_message
    async with sio.session(sid) as session:
        username = session.get('username')
        room_id = session.get('room_id')
    
    if room_id:
        await sio.emit('chat-message', {
            'username': username,
            'message': data.get('message'),
            'timestamp': datetime.datetime.now().timestamp() * 1000,
            'isSystem': False
        }, room=room_id)
        
        update_stats('total_messages')

# We need to explicitly map the event name with hyphen
@sio.on('chat-message')
async def on_chat_message(sid, data):
    await chat_message(sid, data)

@sio.event
async def offer(sid, data):
    async with sio.session(sid) as session:
        username = session.get('username')
    
    await sio.emit('offer', {
        'offer': data.get('offer'),
        'from': sid,
        'username': username
    }, room=data.get('to'))

# Helper to get username from session in handlers that don't pass it
async def get_username(sid):
    async with sio.session(sid) as session:
        return session.get('username')

@sio.on('answer')
async def on_answer(sid, data):
    async with sio.session(sid) as session:
        username = session.get('username')
    
    await sio.emit('answer', {
        'answer': data.get('answer'),
        'from': sid,
        'username': username
    }, room=data.get('to'))

@sio.on('ice-candidate')
async def on_ice_candidate(sid, data):
    await sio.emit('ice-candidate', {
        'candidate': data.get('candidate'),
        'from': sid
    }, room=data.get('to'))

@sio.on('file-share')
async def on_file_share(sid, data):
    async with sio.session(sid) as session:
        username = session.get('username')
        room_id = session.get('room_id')

    if room_id:
        await sio.emit('file-share', {
            'username': username,
            'fileName': data.get('fileName'),
            'fileSize': data.get('fileSize'),
            'fileType': data.get('fileType'),
            'fileData': data.get('fileData'),
            'timestamp': datetime.datetime.now().timestamp() * 1000
        }, room=room_id)
        
        log_session({
            'type': 'file-share',
            'username': username,
            'roomId': room_id,
            'socketId': sid,
            'fileName': data.get('fileName'),
            'fileSize': data.get('fileSize')
        })
        update_stats('total_files_shared')

@sio.on('mute-status')
async def on_mute_status(sid, data):
    async with sio.session(sid) as session:
        room_id = session.get('room_id')
    
    if room_id:
        # Broadcast mute status to all users in room except sender
        await sio.emit('mute-status', {
            'userId': sid,
            'audioEnabled': data.get('audioEnabled')
        }, room=room_id, skip_sid=sid)

@sio.event
async def disconnect(sid):
    print(f"DEBUG: Client disconnecting: {sid}")
    
    # Retrieve session data before cleanup
    async with sio.session(sid) as session:
        username = session.get('username')
        room_id = session.get('room_id')
    
    print(f"DEBUG: User {username} from room {room_id} disconnecting")

    if room_id and room_id in rooms:
        if sid in rooms[room_id]:
            del rooms[room_id][sid]
            print(f"DEBUG: Removed {sid} from room {room_id}. Remaining users: {len(rooms[room_id])}")
            
            # Remove room if empty
            if not rooms[room_id]:
                del rooms[room_id]
                print(f"DEBUG: Room {room_id} is empty, deleted")

            remove_online_user(sid)

            log_session({
                'type': 'disconnect',
                'username': username,
                'roomId': room_id,
                'socketId': sid
            })

            # Notify others in room
            print(f"DEBUG: Broadcasting user-left to room {room_id}")
            await sio.emit('user-left', {
                'userId': sid
            }, room=room_id)

            await sio.emit('chat-message', {
                'username': 'System',
                'message': f'{username} left the room',
                'timestamp': datetime.datetime.now().timestamp() * 1000,
                'isSystem': True
            }, room=room_id)
    else:
        print(f"DEBUG: Disconnect cleanup - user {sid} not found in any room")

# ==========================================
# APP SETUP
# ==========================================

# Static files
# Serve index.html for root
app.router.add_get('/', index_handler)

# Serve static files but disable directory listing
# We use a helper function or specific routes for assets to be cleaner 
# or mapped everything under root but without show_index
app.router.add_static('/', PUBLIC_DIR, show_index=False)

# Routes
app.router.add_get('/webrtc-config', webrtc_config_handler)

# Admin Routes
app.router.add_get('/admin', lambda r: web.HTTPFound('/admin.html'))
app.router.add_get('/admin/login', lambda r: web.HTTPFound('/admin.html')) # Catch manual entry to POST url
app.router.add_get('/admin.html', admin_login_page)
app.router.add_get('/admin-dashboard.html', admin_dashboard_page)
app.router.add_get('/admin/dashboard', lambda r: web.HTTPFound('/admin-dashboard.html'))

# Admin API
app.router.add_post('/admin/login', admin_login_api)
app.router.add_post('/admin/logout', admin_logout_api)
app.router.add_get('/admin/check', admin_check_api)
app.router.add_get('/api/admin/analytics', admin_analytics_api)

if __name__ == '__main__':
    # Initialize DB
    init_db()
    
    print("========================================")
    print("   PYTHON WebRTC Server Running")
    print("========================================")
    print(f"URL: https://localhost:{PORT}")
    print(f"Admin: https://localhost:{PORT}/admin")
    print("========================================")

    # SSL Context
    ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ssl_context.load_cert_chain(CERT_FILE, KEY_FILE)

    web.run_app(app, port=PORT, ssl_context=ssl_context)
