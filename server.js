const express = require("express");
const https = require("https");
const fs = require("fs");
const path = require("path");
const socketIO = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);

const app = express();
const isLinux = process.platform === "linux";

const server = https.createServer(
	{
		key: fs.readFileSync("key.pem"),
		cert: fs.readFileSync("cert.pem"),
	},
	app
);

const io = socketIO(server);

const rooms = {};

// ============================================
// SQLITE DATABASE SETUP
// ============================================
const DB_FILE = path.join(__dirname, "analytics.db");
const db = new sqlite3.Database(DB_FILE);

// Initialize database tables
db.serialize(() => {
	// Sessions table
	db.run(`
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
	`);

	// Stats table
	db.run(`
		CREATE TABLE IF NOT EXISTS stats (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			total_connections INTEGER DEFAULT 0,
			total_rooms INTEGER DEFAULT 0,
			total_messages INTEGER DEFAULT 0,
			total_files_shared INTEGER DEFAULT 0,
			peak_concurrent_users INTEGER DEFAULT 0,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`);

	// Initialize stats if empty
	db.get("SELECT COUNT(*) as count FROM stats", (err, row) => {
		if (!err && row.count === 0) {
			db.run("INSERT INTO stats (id) VALUES (1)");
		}
	});

	// Current online users table
	db.run(`
		CREATE TABLE IF NOT EXISTS online_users (
			socket_id TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			room_id TEXT NOT NULL,
			joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`);
});

// Database helper functions
function logSession(data) {
	return new Promise((resolve, reject) => {
		const { type, username, roomId, socketId, userAgent, ip, fileName, fileSize } = data;
		
		db.run(
			`INSERT INTO sessions (type, username, room_id, socket_id, user_agent, ip, file_name, file_size) 
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[type, username, roomId, socketId, userAgent, ip, fileName || null, fileSize || null],
			function(err) {
				if (err) reject(err);
				else resolve(this.lastID);
			}
		);
	});
}

function updateStats(field, increment = 1) {
	db.run(
		`UPDATE stats SET ${field} = ${field} + ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
		[increment]
	);
}

function addOnlineUser(socketId, username, roomId) {
	db.run(
		`INSERT OR REPLACE INTO online_users (socket_id, username, room_id) VALUES (?, ?, ?)`,
		[socketId, username, roomId],
		() => {
			// Update peak concurrent users
			db.get("SELECT COUNT(*) as count FROM online_users", (err, row) => {
				if (!err && row) {
					db.get("SELECT peak_concurrent_users FROM stats WHERE id = 1", (err2, stats) => {
						if (!err2 && stats && row.count > stats.peak_concurrent_users) {
							db.run("UPDATE stats SET peak_concurrent_users = ? WHERE id = 1", [row.count]);
						}
					});
				}
			});
		}
	);
}

function removeOnlineUser(socketId) {
	db.run("DELETE FROM online_users WHERE socket_id = ?", [socketId]);
}


// ============================================
// SESSION & MIDDLEWARE SETUP
// ============================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
	store: new SQLiteStore({ db: 'sessions.db', dir: __dirname }),
	secret: 'webrtc-secret-key-2025',
	resave: false,
	saveUninitialized: false,
	cookie: {
		maxAge: 24 * 60 * 60 * 1000, // 24 hours
		secure: true,
		httpOnly: true
	}
}));

app.use(express.static("public"));

app.get("/webrtc-config", (req, res) => {
	const config = isLinux
		? {
				iceServers: [
					{ urls: "stun:stun.l.google.com:19302" },
					{
						urls: `turn:${req.hostname}:3478`,
						username: "webrtcuser",
						credential: "webrtckey",
					},
				],
		  }
		: {
				iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
		  };
	res.json(config);
});

// ============================================
// ADMIN AUTHENTICATION
// ============================================
const ADMIN_CREDENTIALS = {
	username: 'admin',
	password: 'NewM00n'
};

// Admin middleware
function requireAdmin(req, res, next) {
	if (req.session && req.session.isAdmin) {
		next();
	} else {
		res.status(401).json({ error: "Unauthorized" });
	}
}

// Admin routes - redirect to HTML files
app.get("/admin", (req, res) => {
	res.redirect('/admin.html');
});

app.get("/admin/dashboard", requireAdmin, (req, res) => {
	res.redirect('/admin-dashboard.html');
});

// Check if user is authenticated (for AJAX calls)
app.get("/admin/check", (req, res) => {
	if (req.session && req.session.isAdmin) {
		res.json({ authenticated: true, username: req.session.username });
	} else {
		res.status(401).json({ authenticated: false });
	}
});

// Admin login endpoint
app.post("/admin/login", (req, res) => {
	const { username, password } = req.body;
	
	if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
		req.session.isAdmin = true;
		req.session.username = username;
		res.json({ success: true });
	} else {
		res.status(401).json({ success: false, error: "Invalid credentials" });
	}
});

// Admin logout endpoint
app.post("/admin/logout", (req, res) => {
	req.session.destroy();
	res.json({ success: true });
});

// Admin analytics API
app.get("/api/admin/analytics", requireAdmin, (req, res) => {
	// Get stats
	db.get("SELECT * FROM stats WHERE id = 1", (err, stats) => {
		if (err) {
			return res.status(500).json({ error: "Database error" });
		}

		// Get recent sessions
		db.all("SELECT * FROM sessions ORDER BY timestamp DESC LIMIT 100", (err2, sessions) => {
			if (err2) {
				return res.status(500).json({ error: "Database error" });
			}

			// Get online users
			db.all("SELECT * FROM online_users ORDER BY joined_at DESC", (err3, onlineUsers) => {
				if (err3) {
					return res.status(500).json({ error: "Database error" });
				}

				// Get unique users count
				db.get("SELECT COUNT(DISTINCT username) as unique_count FROM sessions", (err4, uniqueData) => {
					if (err4) {
						return res.status(500).json({ error: "Database error" });
					}

					// Prepare room information
					const roomsInfo = Object.keys(rooms).map(roomId => ({
						roomId,
						users: Object.values(rooms[roomId]),
						userCount: Object.keys(rooms[roomId]).length
					}));

					res.json({
						sessions,
						stats: {
							...stats,
							uniqueUsers: uniqueData.unique_count,
							currentOnlineCount: onlineUsers.length,
							activeRooms: Object.keys(rooms).length
						},
						currentOnline: onlineUsers,
						rooms: roomsInfo,
						timestamp: new Date().toISOString()
					});
				});
			});
		});
	});
});

io.on("connection", (socket) => {
	socket.on("join", (data) => {
		const { roomId, username } = data;

		if (!rooms[roomId]) {
			rooms[roomId] = {};
			updateStats('total_rooms');
		}

		const usernames = Object.values(rooms[roomId]).map((u) => u.username);
		if (usernames.includes(username)) {
			socket.emit("join-error", { message: "Username already taken" });
			return;
		}

		socket.userId = socket.id;
		socket.username = username;
		socket.roomId = roomId;
		socket.join(roomId);

		rooms[roomId][socket.id] = { username, id: socket.id };

		// Log the session
		logSession({
			type: "join",
			username,
			roomId,
			socketId: socket.id,
			userAgent: socket.handshake.headers["user-agent"],
			ip: socket.handshake.address
		});

		// Update stats and online users
		updateStats('total_connections');
		addOnlineUser(socket.id, username, roomId);

		const existingUsers = Object.values(rooms[roomId]).filter(
			(u) => u.id !== socket.id
		);

		socket.emit("existing-users", { users: existingUsers });

		socket.to(roomId).emit("user-joined", {
			userId: socket.id,
			username: username,
		});

		// Mensaje de sistema
		io.to(roomId).emit("chat-message", {
			username: "System",
			message: `${username} joined the room`,
			timestamp: Date.now(),
			isSystem: true,
		});
	});

	socket.on("chat-message", (data) => {
		io.to(socket.roomId).emit("chat-message", {
			username: socket.username,
			message: data.message,
			timestamp: Date.now(),
			isSystem: false,
		});
		
		// Log message
		updateStats('total_messages');
	});

	socket.on("offer", (data) => {
		io.to(data.to).emit("offer", {
			offer: data.offer,
			from: socket.id,
			username: socket.username,
		});
	});

	socket.on("answer", (data) => {
		io.to(data.to).emit("answer", {
			answer: data.answer,
			from: socket.id,
			username: socket.username,
		});
	});

	socket.on("ice-candidate", (data) => {
		io.to(data.to).emit("ice-candidate", {
			candidate: data.candidate,
			from: socket.id,
		});
	});

	socket.on("file-share", (data) => {
		io.to(socket.roomId).emit("file-share", {
			username: socket.username,
			fileName: data.fileName,
			fileSize: data.fileSize,
			fileType: data.fileType,
			fileData: data.fileData,
			timestamp: Date.now(),
		});
		
		// Log file share
		logSession({
			type: "file-share",
			username: socket.username,
			roomId: socket.roomId,
			fileName: data.fileName,
			fileSize: data.fileSize
		});
		updateStats('total_files_shared');
	});

	socket.on("disconnect", () => {
		if (socket.roomId && rooms[socket.roomId]) {
			const username = socket.username;
			delete rooms[socket.roomId][socket.id];

			// Remove from online users
			removeOnlineUser(socket.id);

			// Log disconnect
			logSession({
				type: "disconnect",
				username,
				roomId: socket.roomId,
				socketId: socket.id
			});

			socket.to(socket.roomId).emit("user-left", {
				userId: socket.id,
			});

			io.to(socket.roomId).emit("chat-message", {
				username: "System",
				message: `${username} left the room`,
				timestamp: Date.now(),
				isSystem: true,
			});
		}
	});
});

const PORT = process.env.PORT || 3030;
server.listen(PORT, "0.0.0.0", () => {
	console.log(`Server running on https://localhost:${PORT}`);
});
