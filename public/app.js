let localStream;
let screenStream;
let peerConnections = {};
let iceCandidateBuffers = {};
let socket;
let roomId;
let config;
let username;
let audioEnabled = true;
let videoEnabled = true;
let screenShareActive = false;
let usernames = {};
let unreadCount = 0;
let isMobileChatOpen = false;
let mainVideoId = "local";

// Basic Router/View System
const VIEWS = {
    LOBBY: 'lobby',
    ROOM: 'room',
    LOADING: 'loading'
};

function navigateTo(viewName) {
    const lobby = document.getElementById("joinPanel");
    const mediaControls = document.getElementById("mediaControls");
    const videosContainer = document.getElementById("videosContainer");
    const floatChat = document.getElementById("floatingChatBtn");
    const loadingScreen = document.getElementById("loadingScreen");
    
    // Reset/Hide Default States
    if(lobby) lobby.style.display = "none";
    if(mediaControls) mediaControls.style.display = "none";
    if(videosContainer) videosContainer.style.display = "none";
    if(floatChat) floatChat.style.display = "none";
    if(loadingScreen) loadingScreen.style.display = "none";
    
    if (viewName === VIEWS.LOBBY) {
        if(lobby) lobby.style.display = "flex";
        document.body.classList.remove("joined-mode");
    } else if (viewName === VIEWS.ROOM) {
        if(mediaControls) mediaControls.style.display = "flex";
        if(videosContainer) videosContainer.style.display = "block";
        document.body.classList.add("joined-mode");
        
        // Show floating chat only on mobile
        if (window.innerWidth <= 768 && floatChat) {
            floatChat.style.display = "flex";
        }
    } else if (viewName === VIEWS.LOADING) {
        // Show elegant loading spinner
        if(loadingScreen) loadingScreen.style.display = "flex";
    }
}

async function ensureConfig() {
	if (!config) config = await fetch("/webrtc-config").then((r) => r.json());
}

// Cargar tema: preferencia guardada > preferencia del sistema > dark
// Variables globales para Green Room
let audioContext;
let analyser;
let microphone;
let javascriptNode;

function updateThemeIcon() {
	const theme = document.documentElement.getAttribute("data-theme");
	const icon = document.getElementById("themeIcon");
    if(!icon) return;

	if (theme === "dark") {
		// Icono de sol para cambiar a modo claro
		icon.innerHTML =
			'<path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/>';
	} else {
		// Icono de luna para cambiar a modo oscuro
		icon.innerHTML =
			'<path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>';
	}
}

function showError(message) {
	const errorDiv = document.getElementById("errorMessage");
    if(!errorDiv) {
        console.error("Error:", message);
        return;
    }
	errorDiv.textContent = message;
	errorDiv.style.display = "block";

	setTimeout(() => {
		errorDiv.style.display = "none";
	}, 5000);
}

document.addEventListener("DOMContentLoaded", async () => {
    // Theme setup
	const savedTheme = localStorage.getItem("theme");
	const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
	const theme = savedTheme || systemTheme;
	document.documentElement.setAttribute("data-theme", theme);
	updateThemeIcon();

	// Auto-fill room
	const urlParams = new URLSearchParams(window.location.search);
	const roomParam = urlParams.get("room_id");
	if (roomParam) {
		document.getElementById("roomId").value = roomParam;
	}

    // ====================================================================
    // SOLUCIÓN DEFINITIVA: Verificar PRIMERO si el usuario salió explícitamente
    // ====================================================================
    const EXIT_FLAG_KEY = 'webrtc_explicit_exit';
    if (sessionStorage.getItem(EXIT_FLAG_KEY) === 'true') {
        console.log("🚫 User explicitly left. Clearing session and staying in lobby.");
        // REMOVE el flag después de procesarlo
        sessionStorage.removeItem(EXIT_FLAG_KEY);
        clearSession();
        // NO continuar con auto-rejoin
        return;
    }

    // Auto-rejoin functionality
    const activeSession = sessionStorage.getItem(SESSION_KEY);
	console.log("🔍 Checking for active session...", activeSession ? "Found" : "None");
	if (activeSession) {
		try {
			const session = JSON.parse(activeSession);
			console.log("📦 Session data:", session);
            
            // Backup Check: Exit flag in session object
            if (session.isExplicitLeave) {
                console.log("🚫 User explicitly left (Session Backup). Clearing.");
                clearSession();
                return;
            }

            // Session valid for 2 hours
			const sessionAge = Date.now() - session.timestamp;
			console.log("⏱️ Session age:", Math.floor(sessionAge / 1000), "seconds");
			
			if (sessionAge < 7200000) {
				if(session.roomId) {
					document.getElementById("roomId").value = session.roomId;
					console.log("✅ Room ID restored:", session.roomId);
				}
				if(session.username) {
					document.getElementById("username").value = session.username;
					console.log("✅ Username restored:", session.username);
				}
				
                // EVITAR FLASH: Ocultar lobby inmediatamente
                console.log("🔄 Auto-rejoining session in 500ms...");
                navigateTo(VIEWS.LOADING);
				// Small delay to ensure everything is initialized
				setTimeout(() => {
                    console.log("▶️ Calling joinRoom() now...");
					joinRoom();
                }, 500);
			} else {
                console.log("⏱️ Session expired. Clearing.");
                clearSession();
            }
		} catch(e) { 
            console.error("❌ Auto-rejoin failed:", e); 
            clearSession();
        }
	}

    // No auto-start, wait for user click
});

async function startGreenRoom() {
    try {
        // Pedir permisos iniciales
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        // Hide overlay
        document.getElementById('permissionsOverlay').classList.add('hidden');

        // Mostrar preview
        const previewVideo = document.getElementById('previewVideo');
        previewVideo.srcObject = localStream;
        
        // Listar dispositivos
        await getDevices();
        
        // Iniciar medidor de audio
        startAudioLevelMeter();
        
        // Manejar cambios de dispositivos
        navigator.mediaDevices.addEventListener('devicechange', getDevices);
        
    } catch (error) {
        showError("Camera/Microphone access required. Please click 'Start Camera' and allow permissions.");
        console.error(error);
    }
}

async function getDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameraSelect = document.getElementById('cameraSelect');
    const micSelect = document.getElementById('micSelect');
    
    // Guardar selección actual
    const currentCamera = cameraSelect.value;
    const currentMic = micSelect.value;
    
    cameraSelect.innerHTML = '';
    micSelect.innerHTML = '';
    
    devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `${device.kind} ${device.deviceId.slice(0,5)}`;
        
        if (device.kind === 'videoinput') {
            cameraSelect.appendChild(option);
        } else if (device.kind === 'audioinput') {
            micSelect.appendChild(option);
        }
    });

    // Restaurar selección o seleccionar el track actual
    const videoTrack = localStream.getVideoTracks()[0];
    const audioTrack = localStream.getAudioTracks()[0];
    
    if (videoTrack) cameraSelect.value = videoTrack.getSettings().deviceId;
    if (audioTrack) micSelect.value = audioTrack.getSettings().deviceId;
}

async function changeCamera() {
    const deviceId = document.getElementById('cameraSelect').value;
    const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
        audio: false
    });
    
    const newTrack = newStream.getVideoTracks()[0];
    const sender = localStream.getVideoTracks()[0];
    
    localStream.removeTrack(sender);
    localStream.addTrack(newTrack);
    sender.stop();
    
    document.getElementById('previewVideo').srcObject = localStream;
}

async function changeMicrophone() {
    const deviceId = document.getElementById('micSelect').value;
    const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
        video: false
    });
    
    const newTrack = newStream.getAudioTracks()[0];
    const sender = localStream.getAudioTracks()[0];
    
    localStream.removeTrack(sender);
    localStream.addTrack(newTrack);
    sender.stop();
    
    // Reiniciar medidor de audio con nuevo track
    startAudioLevelMeter();
}

function togglePreviewVideo() {
    if(!localStream) return;
    const tracks = localStream.getVideoTracks();
    if (tracks.length > 0) {
        const track = tracks[0];
        track.enabled = !track.enabled;
        const btn = document.getElementById('previewVideoBtn');
        btn.classList.toggle('off', !track.enabled);
        
        // Actualizar icono
        btn.innerHTML = track.enabled ? 
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>' :
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 21v-3.08c3.39-.49 6-3.39 6-6.92 0-3.53-2.61-6.43-6-6.92V3c0-.55-.45-1-1-1s-1 .45-1 1v1h-1c-3.87 0-7 3.13-7 7v1H2v2h2v7h12zm4-11c0 2.2-1.8 4-4 4s-4-1.8-4-4 1.8-4 4-4 4 1.8 4 4z"/></svg>';
    }
}

function togglePreviewAudio() {
    if(!localStream) return;
    const tracks = localStream.getAudioTracks();
    if (tracks.length > 0) {
        const track = tracks[0];
        track.enabled = !track.enabled;
        const btn = document.getElementById('previewAudioBtn');
        btn.classList.toggle('off', !track.enabled);
        
        // Icon update
        btn.innerHTML = track.enabled ?
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>' :
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 2.76 2.24 5 5 5 .52 0 1.03-.08 1.5-.21L19.73 21 21 19.73 4.27 3z"/></svg>';
    }
}

function connectSignaling() {
	console.log("🔌 Connecting to signaling server...");
	socket = io();

	socket.on("connect", () => {
		console.log("✅ Socket connected! ID:", socket.id);
	});

	socket.on("disconnect", () => {
		console.log("❌ Socket disconnected");
	});

	socket.on("join-error", (data) => {
		console.error("❌ Join error:", data.message);
		showError(data.message);
		if (localStream) {
			localStream.getTracks().forEach((track) => track.stop());
		}
	});

	socket.on("existing-users", async (data) => {
		console.log("👥 Received existing users:", data.users);
		for (const user of data.users) {
			usernames[user.id] = user.username;
			iceCandidateBuffers[user.id] = [];
			await createOffer(user.id);
		}
	});

	socket.on("offer", async (data) => {
		console.log("📨 Received offer from:", data.from);
		if (!peerConnections[data.from]) {
			usernames[data.from] = data.username;
			iceCandidateBuffers[data.from] = [];
		}
		await handleOffer(data.offer, data.from);
	});

	socket.on("answer", async (data) => {
		console.log("📬 Received answer from:", data.from);
		await handleAnswer(data.answer, data.from);
	});

	socket.on("ice-candidate", async (data) => {
		console.log("🧊 Received ICE candidate from:", data.from);
		await handleIceCandidate(data.candidate, data.from);
	});

	socket.on("user-joined", (data) => {
		console.log("👤 User joined:", data.username, data.userId);
		usernames[data.userId] = data.username;
	});

	socket.on("user-left", (data) => {
		console.log("👋 User left:", data.userId);
		if (peerConnections[data.userId]) {
			peerConnections[data.userId].close();
			delete peerConnections[data.userId];
			delete usernames[data.userId];
			delete iceCandidateBuffers[data.userId];

			const videoWrapper = document.getElementById("wrapper-" + data.userId);
			if (videoWrapper) {
				videoWrapper.remove();
			}

			if (mainVideoId === data.userId) {
				switchMainVideo("local");
			}

			// Cuando no hay usuarios remotos, el layout ya está en modo simple
			// No es necesario llamar a resetToSimpleLayout()
		}
	});

	socket.on("chat-message", (data) => {
		displayMessage(data);
		if (window.innerWidth <= 768 && !isMobileChatOpen) {
			unreadCount++;
			updateUnreadBadge();
		}
	});

	socket.on("file-share", (data) => {
		displayFileMessage(data);
		if (window.innerWidth <= 768 && !isMobileChatOpen) {
			unreadCount++;
			updateUnreadBadge();
		}
	});

	// Escuchar cambios de mute de otros usuarios
	socket.on("mute-status", (data) => {
		console.log(`🔇 User ${data.userId} mute status:`, data.audioEnabled);
		const wrapper = document.getElementById("wrapper-" + data.userId);
		if (wrapper) {
			const muteIcon = wrapper.querySelector('.mute-status');
			if (muteIcon) {
				muteIcon.style.display = data.audioEnabled ? 'none' : 'flex';
			}
		}
	});
}

function startAudioLevelMeter() {
    if (audioContext) audioContext.close();
    
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    microphone = audioContext.createMediaStreamSource(localStream);
    javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;

    microphone.connect(analyser);
    analyser.connect(javascriptNode);
    javascriptNode.connect(audioContext.destination);

    javascriptNode.onaudioprocess = function() {
        const array = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(array);
        
        let values = 0;
        const length = array.length;
        for (let i = 0; i < length; i++) {
            values += array[i];
        }

        const average = values / length;
        const fill = document.getElementById('audioLevel');
        if (fill) fill.style.width = Math.min(100, average * 2) + '%';
    }
}

const SESSION_KEY = 'webrtc_active_session';

// CRITICAL FIX: Restaurar isExplicitLeave desde sessionStorage al iniciar
// De lo contrario, siempre será false en cada recarga
let isExplicitLeave = false;
try {
    const existingSession = sessionStorage.getItem(SESSION_KEY);
    if (existingSession) {
        const session = JSON.parse(existingSession);
        if (session.isExplicitLeave === true) {
            isExplicitLeave = true;
            console.log("🔄 Restored isExplicitLeave from storage: true");
        }
    }
} catch(e) {
    console.error("Failed to restore isExplicitLeave:", e);
}

function saveSession(forceExitFlag = null) {
    if (!roomId || !username) {
		console.log("⚠️ saveSession skipped: roomId or username missing", {roomId, username});
		return;
	}
    
    // Determinar el valor del flag de salida
    let exitFlag = forceExitFlag !== null ? forceExitFlag : isExplicitLeave;
    
    // VALIDACIÓN: Solo bloquear guardado si NO es un guardado forzado de salida
    // y el flag ya está marcado como true
    if (forceExitFlag === null) {
        // Guardado normal (desde toggles, etc)
        if (isExplicitLeave) {
            console.log("🚫 Skipping saveSession: User explicitly left");
            return;
        }
        
        // Verificar si ya hay una sesión con isExplicitLeave = true
        try {
            const existingSession = sessionStorage.getItem(SESSION_KEY);
            if (existingSession) {
                const existing = JSON.parse(existingSession);
                if (existing.isExplicitLeave === true) {
                    console.log("🚫 Skipping saveSession: Session marked as left");
                    return;
                }
            }
        } catch(e) {}
    }
    
    const session = {
        roomId: roomId,
        username: username,
        videoEnabled: videoEnabled,
        audioEnabled: audioEnabled,
        isExplicitLeave: exitFlag,
        timestamp: Date.now()
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    console.log("💾 Session saved:", {
		roomId: session.roomId,
		username: session.username,
		video: session.videoEnabled,
		audio: session.audioEnabled,
		isExplicitLeave: session.isExplicitLeave
	});
}

function clearSession() {
    // REMOVE strategy: Eliminar completamente la clave de sessionStorage
    // Esto asegura que el auto-rejoin no se bloquee por isExplicitLeave: true
    sessionStorage.removeItem(SESSION_KEY);
    console.log("🗑️ Session cleared completely");
    
    // Safety clear del flag de salida explícita
    sessionStorage.removeItem('webrtc_explicit_exit');
    
    // Safety clear de localStorage just in case
    try { localStorage.removeItem(SESSION_KEY); } catch(e) {}
}

function leaveRoom() {
    console.log("👋 Leaving room explicitly...");
    
    // 1. Update Global State
    isExplicitLeave = true; 

    // 2. Set Dedicated Flag (Primary Guard)
    sessionStorage.setItem('webrtc_explicit_exit', 'true');
    
    // 3. Update Session Object (Backup Guard)
    try { saveSession(true); } catch(e) {}
    
    // 4. Stop Tracks
    if (localStream) {
        try { localStream.getTracks().forEach(t => t.stop()); } catch(e) {}
    }
    
    // 5. Redirect with Safe Delay (Race condition fix)
    setTimeout(() => {
        window.location.href = "/";
    }, 200);
}

// Mobile Chat Toggle
function toggleMobileChat() {
    const chat = document.getElementById("chatSection");
    const backdrop = document.getElementById("chatBackdrop");
    if (!chat) return;
    
    // Usar 'active' para coincidir con el CSS que espera #chatSection.active
    const isOpen = chat.classList.contains("active");
    
    if (isOpen) {
        chat.classList.remove("active");
        if (backdrop) backdrop.classList.remove("active");
        isMobileChatOpen = false;
    } else {
        chat.classList.add("active");
        if (backdrop) backdrop.classList.add("active");
        isMobileChatOpen = true;
        
        unreadCount = 0;
        updateUnreadBadge();
        
        const messages = document.getElementById("chatMessages");
        if(messages) {
            setTimeout(() => {
                messages.scrollTop = messages.scrollHeight;
            }, 100);
        }
    }
}

async function joinRoom() {
	await ensureConfig();
	username = document.getElementById("username").value.trim();
	roomId = document.getElementById("roomId").value.trim();

	if (!username || !roomId) {
		showError(!username ? "Please enter your name" : "Please enter a room ID");
		return;
	}
    
    // NOTA: Movemos saveSession más abajo para no guardar estado por defecto antes de restaurar


	try {
        // Detener analizador de audio visual
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }

		// Crear video local dentro del mainVideoWrapper existente
		const mainVideoWrapper = document.getElementById("mainVideoWrapper");
		mainVideoWrapper.innerHTML = "";

		const localWrapper = document.createElement("div");
		localWrapper.id = "wrapper-local";
		localWrapper.className = "video-wrapper local";

        // Si no tenemos stream (ej: usuario no autorizó o auto-rejoin), intentar obtener streams
        if (!localStream) {
            try {
                console.log("No localStream found, requesting default Audio+Video");
                // Intento #1: Pedir TODO (Audio y Video) por defecto
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            } catch(e) {
                console.warn("Could not get video+audio. Trying audio only.", e);
                try {
                    // Intento #2: Fallback a solo Audio si no hay cámara
                    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                } catch(err2) {
                    console.warn("Could not get any media stream. Joining as listener.", err2);
                    // Intento #3: Modo espectador (sin media)
                    localStream = new MediaStream();
                }
            }
        }

		const localVideo = document.createElement("video");
		localVideo.id = "localVideo";
		localVideo.autoplay = true;
		localVideo.muted = true;
		localVideo.playsinline = true;
		
        // === RESTORE MEDIA STATE ===
        // Antes de procesar tracks, verificamos si venimos de un reload con estado guardado
        const savedSession = sessionStorage.getItem(SESSION_KEY);
        if (savedSession) {
            try {
                const s = JSON.parse(savedSession);
                if (s.roomId === roomId && s.username === username) {
                     console.log("Restoring media state:", s);
                     // Si el estado guardado es FALSE, deshabilitamos el track
                     if (s.videoEnabled === false && localStream.getVideoTracks()[0]) {
                         localStream.getVideoTracks()[0].enabled = false;
                     }
                     if (s.audioEnabled === false && localStream.getAudioTracks()[0]) {
                         localStream.getAudioTracks()[0].enabled = false;
                     }
                }
            } catch(e) { console.error("Error restoring media state", e); }
        }

        // Verificar si hay video y audio tracks
        const videoTrack = localStream?.getVideoTracks()[0];
        const audioTrack = localStream?.getAudioTracks()[0];
        
        // Actualizar estados globales basados en tracks reales Y su estado enabled
        // Si hay track, usar su estado enabled; si no hay track, mantener false
        if (videoTrack) {
            videoEnabled = videoTrack.enabled;
        } else {
            videoEnabled = false;
        }
        
        if (audioTrack) {
            audioEnabled = audioTrack.enabled;
        } else {
            audioEnabled = false;
        }
        
        // Guardamos la sesión ahora que tenemos el estado correcto
        saveSession();

        const hasVideo = videoTrack && videoEnabled;
        
        if (hasVideo) {
		    localVideo.srcObject = localStream;
        } else {
            // Sin video: mostrar placeholder visual con el avatar
            // Crear ícono de usuario con la clase correcta
            const avatarIcon = document.createElement("div");
            avatarIcon.id = "localAvatar";
            avatarIcon.className = "avatar-placeholder";
            avatarIcon.innerHTML = `
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5">
                    <circle cx="12" cy="8" r="5"/>
                    <path d="M3 21c0-4 4-7 9-7s9 3 9 7"/>
                </svg>
            `;
            avatarIcon.style.opacity = "0.7";
            localWrapper.appendChild(avatarIcon);
            localWrapper.classList.add("audio-only");
        }

		const overlay = document.createElement("div");
		overlay.className = "video-overlay";

		const label = document.createElement("div");
		label.id = "localLabel";
		label.className = "video-label";
		label.textContent = username + " (You)";

		overlay.appendChild(label);
		localWrapper.appendChild(localVideo);
		localWrapper.appendChild(overlay);
		mainVideoWrapper.appendChild(localWrapper);

		overlay.appendChild(label);
		localWrapper.appendChild(localVideo);
		localWrapper.appendChild(overlay);
		mainVideoWrapper.appendChild(localWrapper);

        // Switch View using Router
        navigateTo(VIEWS.ROOM);

		if (window.innerWidth > 768) {
			document.getElementById("chatSection").style.display = "flex";
		}

		document.getElementById("headerStatus").textContent = "Connected";
		document.getElementById("headerStatus").classList.add("connected");
		document.getElementById("currentRoom").textContent = `Room: ${roomId}`;
		document.getElementById("roomInfo").textContent = `Room: ${roomId}`;

        // Actualizar botones basados en estado real
        updateMediaButtons();

		connectSignaling();
		console.log("🚀 Emitting join event:", { roomId, username });
		socket.emit("join", { roomId, username });

		document.getElementById("chatInput").addEventListener("keypress", (e) => {
			if (e.key === "Enter") sendMessage();
		});

		if (window.innerWidth <= 768) {
			document.getElementById("chatSection").classList.remove("mobile-open");
		}
	} catch (error) {
		showError("Error joining room: " + error.message);
	}
}
async function createOffer(userId) {
	const pc = createPeerConnection(userId);

	// Log todos los senders antes de crear offer
	const senders = pc.getSenders();
	console.log(
		`Senders for ${userId} before offer:`,
		senders.map((s) => ({
			kind: s.track?.kind,
			label: s.track?.label,
			id: s.track?.id,
		}))
	);

	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);

	console.log(
		`Offer created for ${userId}, transceivers:`,
		pc.getTransceivers().length
	);

	socket.emit("offer", {
		offer: offer,
		to: userId,
	});
}

async function handleOffer(offer, from) {
	console.log(`Received offer from ${from}`);

	// Usar peer connection existente o crear nueva
	let pc = peerConnections[from];
	
	// Manejo de Colisiones (Perfect Negotiation / Polite Peer)
	// Si ya tenemos conexión y estamos tratando de negociar (no stable), hay colisión
	if (pc && pc.signalingState !== "stable") {
		console.warn(`⚠️ Collision detected with ${from}. State: ${pc.signalingState}`);
		// Decidir quién cede basado en orden alfabético de IDs
		const polite = socket.id < from;
		
		if (!polite) {
			console.log(`✋ We are IMPOLITE (Winning). Ignoring colliding offer from ${from}`);
			return;
		}
		
		console.log(`🙇 We are POLITE (Yielding). Rolling back to accept offer from ${from}`);
		try {
			// Rollback nos devuelve a estado 'stable' para aceptar la oferta remota
			await pc.setLocalDescription({ type: "rollback" });
		} catch(err) {
			console.error("Rollback failed:", err);
			// Si falla el rollback (ej. Safari antiguo), limpiamos y recreamos
			pc.close();
			delete peerConnections[from];
			pc = null;
		}
	}

	const isNewConnection = !pc;

	if (!pc) {
		pc = createPeerConnection(from);
		iceCandidateBuffers[from] = [];
	}

	await pc.setRemoteDescription(new RTCSessionDescription(offer));

	// Log transceivers después de setRemoteDescription
	console.log(
		`After setRemoteDescription from ${from}, transceivers:`,
		pc.getTransceivers().map((t) => ({
			mid: t.mid,
			direction: t.direction,
			kind: t.receiver?.track?.kind,
		}))
	);

	// Log senders antes de crear answer
	console.log(
		`Senders before creating answer for ${from}:`,
		pc.getSenders().map((s) => ({
			kind: s.track?.kind,
			label: s.track?.label,
		}))
	);

	await processIceCandidateBuffer(from);

	const answer = await pc.createAnswer();
	await pc.setLocalDescription(answer);

	console.log(
		`Answer created for ${from}, local transceivers:`,
		pc.getTransceivers().length
	);

	socket.emit("answer", {
		answer: answer,
		to: from,
	});

	// Si es nueva conexión Y tenemos screen share activo, renegociar para agregar screen share
	if (isNewConnection && screenStream && screenStream.active) {
		console.log(`Will renegotiate with ${from} to add screen share`);
		// Esperar a que la conexión se estabilice completamente
		setTimeout(async () => {
			try {
				// Verificar que la conexión sigue activa y estable
				if (!peerConnections[from]) {
					console.log(
						`Connection to ${from} no longer exists, skipping renegotiation`
					);
					return;
				}

				const pc = peerConnections[from];
				if (
					pc.connectionState === "failed" ||
					pc.connectionState === "closed"
				) {
					console.log(
						`Connection to ${from} is ${pc.connectionState}, skipping renegotiation`
					);
					return;
				}

				console.log(
					`Renegotiating with ${from}, connectionState: ${pc.connectionState}, iceConnectionState: ${pc.iceConnectionState}`
				);

				const newOffer = await pc.createOffer();
				await pc.setLocalDescription(newOffer);
				socket.emit("offer", { offer: newOffer, to: from });
				console.log(`Sent renegotiation offer with screen share to ${from}`);
			} catch (error) {
				console.error(`Error renegotiating with ${from}:`, error);
			}
		}, 1500);
	}
}

async function handleAnswer(answer, from) {
	const pc = peerConnections[from];
	console.log(
		`Received answer from ${from}, signalingState: ${pc?.signalingState}`
	);

	if (pc && pc.signalingState !== "stable") {
		await pc.setRemoteDescription(new RTCSessionDescription(answer));

		console.log(
			`After setRemoteDescription (answer) from ${from}, transceivers:`,
			pc.getTransceivers().map((t) => ({
				mid: t.mid,
				direction: t.direction,
				kind: t.receiver?.track?.kind,
				hasTrack: !!t.receiver?.track,
			}))
		);

		await processIceCandidateBuffer(from);
	} else {
		console.log(`Skipped answer from ${from} - no pc or already stable`);
	}
}

async function handleIceCandidate(candidate, from) {
	const pc = peerConnections[from];

	if (!pc) return;

	if (!pc.remoteDescription || !pc.remoteDescription.type) {
		if (!iceCandidateBuffers[from]) {
			iceCandidateBuffers[from] = [];
		}
		iceCandidateBuffers[from].push(candidate);
		return;
	}

	try {
		await pc.addIceCandidate(new RTCIceCandidate(candidate));
	} catch (error) {
		console.error("Error adding ice candidate:", error);
	}
}

async function processIceCandidateBuffer(userId) {
	if (!iceCandidateBuffers[userId]) return;

	const pc = peerConnections[userId];
	if (!pc) return;

	for (const candidate of iceCandidateBuffers[userId]) {
		try {
			await pc.addIceCandidate(new RTCIceCandidate(candidate));
		} catch (error) {
			console.error("Error processing buffered ice candidate:", error);
		}
	}

	iceCandidateBuffers[userId] = [];
}

function createPeerConnection(userId) {
	const pc = new RTCPeerConnection(config);
	peerConnections[userId] = pc;

	console.log(
		`Creating peer connection for ${userId}, screenShareActive: ${screenShareActive}, has screenStream: ${!!screenStream}`
	);

	localStream.getTracks().forEach((track) => {
		pc.addTrack(track, localStream);
		console.log(
			`Added local ${track.kind} track (${track.label}) for ${userId}`
		);
	});

	// Si screen share está activo, agregar también ese track
	if (screenStream && screenStream.active) {
		screenStream.getTracks().forEach((track) => {
			if (track.readyState === "live") {
				pc.addTrack(track, screenStream);
				console.log(
					`Added screen share ${track.kind} track (${track.label}) for ${userId}`
				);
			}
		});
	} else {
		console.log(
			`No screen share to add for ${userId} (screenStream: ${!!screenStream}, active: ${
				screenStream?.active
			})`
		);
	}

	pc.onicecandidate = (event) => {
		if (event.candidate) {
			socket.emit("ice-candidate", {
				candidate: event.candidate,
				to: userId,
			});
		}
	};

	pc.ontrack = (event) => {
		console.log(
			`Track received from ${userId}:`,
			event.track.kind,
			event.track.label,
			`enabled: ${event.track.enabled}, readyState: ${event.track.readyState}`
		);

		let videoWrapper = document.getElementById("wrapper-" + userId);

		if (!videoWrapper) {
			const thumbnailContainer = document.getElementById("thumbnailVideos");

			videoWrapper = document.createElement("div");
			videoWrapper.id = "wrapper-" + userId;
			videoWrapper.className = "video-wrapper thumbnail";
			videoWrapper.style.position = "relative";

			// Status Icons Container
			const statusContainer = document.createElement("div");
			statusContainer.className = "status-icons";
			
			// Mute Icon
			const muteIcon = document.createElement("div");
			muteIcon.className = "status-icon mute-status";
			muteIcon.style.display = "none";
			muteIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
			
			// Network Icon
			const netIcon = document.createElement("div");
			netIcon.className = "status-icon network-status network-good";
			netIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/></svg>'; // Placeholder signal
			netIcon.title = "Connection: Good";

			statusContainer.appendChild(muteIcon);
			statusContainer.appendChild(netIcon);
			videoWrapper.appendChild(statusContainer);

			const overlay = document.createElement("div");
			overlay.className = "video-overlay";

			const label = document.createElement("div");
			label.className = "video-label";
			label.textContent = usernames[userId] || "User";

			overlay.appendChild(label);
			videoWrapper.appendChild(overlay);
			thumbnailContainer.appendChild(videoWrapper);

			// Hacer que todos los thumbnails sean clickeables
			updateThumbnailClicks();
            
            // Iniciar monitoreo de red
            startNetworkMonitor(pc, userId);
		}
		
		// Actualizar label si el username llega después
		const updateUsernameLabel = () => {
			const label = videoWrapper.querySelector('.video-label');
			if (label && usernames[userId]) {
				label.textContent = usernames[userId];
			}
		};
		
		// Reintenta actualizar el username después de un delay
		setTimeout(updateUsernameLabel, 100);
		setTimeout(updateUsernameLabel, 500);

		// Detectar tipo de track
		if (event.track.kind === "video") {
			// Mejorar detección de screen share:
			const trackLabel = event.track.label.toLowerCase();
			const existingVideos = videoWrapper.querySelectorAll("video").length;
			const isScreenShare =
				trackLabel.includes("screen") ||
				trackLabel.includes("window") ||
				trackLabel.includes("monitor") ||
				existingVideos > 0;

			console.log(
				`Video track detection - Label: "${event.track.label}", Existing videos: ${existingVideos}, IsScreenShare: ${isScreenShare}`
			);

			const video = document.createElement("video");
			video.id = isScreenShare ? `screen-${userId}` : `video-${userId}`;
			video.autoplay = true;
			video.playsinline = true;

			if (!isScreenShare) {
				video.srcObject = event.streams[0];
				console.log(`Using complete stream for camera (includes audio)`);
			} else {
				video.srcObject = new MediaStream([event.track]);
				console.log(`Using video-only stream for screen share`);
			}

			if (isScreenShare) {
				video.className = "screen-share-video";
				const screenLabel = document.createElement("div");
				screenLabel.className = "screen-label";
				screenLabel.textContent = "Screen Share";
				videoWrapper.appendChild(video);
				videoWrapper.appendChild(screenLabel);
				videoWrapper.classList.add("dual-video");
				console.log(`Added screen share video for user ${userId}`);
			} else {
				// Cuando llega video de cámara, eliminar avatar placeholder si existe
				const existingAvatar = videoWrapper.querySelector(`#avatar-${userId}`);
				if (existingAvatar) {
					console.log(`Removing audio-only placeholder for ${userId}, video arrived`);
					existingAvatar.remove();
					videoWrapper.classList.remove('audio-only');
				}
				
				// También eliminar el elemento de audio standalone si existe (el video incluye audio)
				const audioElement = videoWrapper.querySelector(`#audio-${userId}`);
				if (audioElement) {
					audioElement.remove();
				}
				
				videoWrapper.insertBefore(video, videoWrapper.firstChild);
				console.log(`Added camera video for user ${userId}`);
			}

			event.track.onended = () => {
				console.log(`Track ended for ${userId}, removing video`);
				video.remove();
				if (isScreenShare) {
					videoWrapper.classList.remove("dual-video");
					const screenLabel = videoWrapper.querySelector(".screen-label");
					if (screenLabel) screenLabel.remove();
				}
			};
		} else if (event.track.kind === "audio") {
			console.log(
				`Audio track received from ${userId}, will be included in video element stream`
			);
            
            // Configurar detector de voz
            setupAudioMonitor(event.streams[0], userId);
            
            // Detectar si está muteado inicialmente
            const muteIcon = videoWrapper.querySelector('.mute-status');
            if(muteIcon) {
                muteIcon.style.display = event.track.enabled ? 'none' : 'flex';
            }
            
            // Si solo llega audio (sin video), crear placeholder después de un delay
            // El delay permite que el video llegue si va a llegar
            setTimeout(() => {
                const existingVideo = videoWrapper.querySelector('video');
                const existingAvatar = videoWrapper.querySelector(`#avatar-${userId}`);
                
                if (!existingVideo && !existingAvatar) {
                    console.log(`No video track for ${userId}, creating audio-only placeholder`);
                    
                    // Crear elemento de audio hidden para reproducir el audio
                    const audioElement = document.createElement('audio');
                    audioElement.id = `audio-${userId}`;
                    audioElement.srcObject = event.streams[0];
                    audioElement.autoplay = true;
                    audioElement.style.display = 'none';
                    videoWrapper.appendChild(audioElement);
                    
                    // Crear placeholder visual con avatar
                    const placeholder = document.createElement('div');
                    placeholder.id = `avatar-${userId}`;
                    placeholder.className = 'avatar-placeholder';
                    
                    placeholder.innerHTML = `
                        <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" style="opacity: 0.7">
                            <circle cx="12" cy="8" r="5"/>
                            <path d="M3 21c0-4 4-7 9-7s9 3 9 7"/>
                        </svg>
                    `;
                    
                    videoWrapper.insertBefore(placeholder, videoWrapper.firstChild);
                    videoWrapper.classList.add('audio-only');
                }
            }, 500); // Esperar 500ms para ver si llega video
            
            // Escuchar cambios de mute (esto requiere señalización adicional en una implementación real, 
            // pero podemos inferir por volumen bajo constante o eventos de track)
		}
	};

	return pc;
}

function switchMainVideo(videoId) {
	const mainWrapper = document.getElementById("mainVideoWrapper");
	const thumbnailContainer = document.getElementById("thumbnailVideos");

	// Si ya es el video principal, no hacer nada
	if (mainVideoId === videoId) return;

	// Obtener el wrapper actual principal
	const currentMainWrapper = document.getElementById("wrapper-" + mainVideoId);

	// Obtener el nuevo wrapper a mostrar
	const newMainWrapper = document.getElementById("wrapper-" + videoId);

	if (currentMainWrapper && newMainWrapper) {
		// Preservar dual-video class si existe
		const currentHasDual = currentMainWrapper.classList.contains("dual-video");
		const newHasDual = newMainWrapper.classList.contains("dual-video");

		// Mover el actual al thumbnail
		currentMainWrapper.className = "video-wrapper thumbnail";
		if (currentHasDual) currentMainWrapper.classList.add("dual-video");
		thumbnailContainer.appendChild(currentMainWrapper);

		// Mover el nuevo al main
		newMainWrapper.className =
			videoId === "local" ? "video-wrapper local" : "video-wrapper";
		if (newHasDual) newMainWrapper.classList.add("dual-video");
		mainWrapper.innerHTML = "";
		mainWrapper.appendChild(newMainWrapper);

		mainVideoId = videoId;

		// Actualizar los clicks
		updateThumbnailClicks();
	}
}

function updateThumbnailClicks() {
	// Hacer que todos los thumbnails sean clickeables
	document.querySelectorAll(".thumbnail").forEach((wrapper) => {
		const wrapperId = wrapper.id.replace("wrapper-", "");
		wrapper.style.cursor = "pointer";
		wrapper.onclick = () => switchMainVideo(wrapperId);
	});
}

function sendMessage() {
	const input = document.getElementById("chatInput");
	const message = input.value.trim();

	if (message) {
		socket.emit("chat-message", { message });
		input.value = "";
	}
}

function selectFile() {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = "*/*";
	input.onchange = (e) => {
		const file = e.target.files[0];
		if (file) {
			if (file.size > 10 * 1024 * 1024) {
				showError("File too large (max 10MB)");
				return;
			}
			sendFile(file);
		}
	};
	input.click();
}

function sendFile(file) {
	const reader = new FileReader();
	reader.onload = () => {
		socket.emit("file-share", {
			fileName: file.name,
			fileSize: file.size,
			fileType: file.type,
			fileData: reader.result,
		});
	};
	reader.readAsDataURL(file);
}

function displayFileMessage(data) {
	const messagesDiv = document.getElementById("chatMessages");
	const messageEl = document.createElement("div");

	const isOwn = data.username === username;
	messageEl.className = `chat-message ${isOwn ? "own" : "other"}`;

	const time = new Date(data.timestamp).toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
	});

	const fileSize = (data.fileSize / 1024).toFixed(1);
	const isImage = data.fileType.startsWith("image/");

	const bubble = document.createElement("div");
	bubble.className = "message-bubble file-message";

	if (isImage) {
		// Mostrar preview de imagen
		bubble.innerHTML = `
			${
				!isOwn
					? `<div class="message-username">${escapeHtml(data.username)}</div>`
					: ""
			}
			<div class="image-preview">
				<img src="${data.fileData}" alt="${escapeHtml(
			data.fileName
		)}" class="chat-image">
			</div>
			<div class="file-info" style="margin-top: 8px;">
				<div class="file-name">${escapeHtml(data.fileName)}</div>
				<div class="file-size">${fileSize} KB</div>
			</div>
			<a href="${data.fileData}" download="${
			data.fileName
		}" class="file-download" style="margin-top: 8px; display: inline-block; padding: 6px 12px; background: var(--accent); color: white; border-radius: 6px; text-decoration: none; font-size: 12px;">Download</a>
			<div class="message-time">${time}</div>
		`;

		// Agregar event listener después de crear el elemento
		setTimeout(() => {
			const img = bubble.querySelector(".chat-image");
			if (img) {
				img.addEventListener("click", (e) => {
					e.stopPropagation();
					openImageModal(data.fileData);
				});
			}
		}, 0);
	} else {
		// Mostrar icono de archivo normal
		const fileIcon = getFileIcon(data.fileType);
		bubble.innerHTML = `
			${
				!isOwn
					? `<div class="message-username">${escapeHtml(data.username)}</div>`
					: ""
			}
			<div class="file-preview">
				<div class="file-icon">${fileIcon}</div>
				<div class="file-info">
					<div class="file-name">${escapeHtml(data.fileName)}</div>
					<div class="file-size">${fileSize} KB</div>
				</div>
				<a href="${data.fileData}" download="${data.fileName}" class="file-download">
					<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
						<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
					</svg>
				</a>
			</div>
			<div class="message-time">${time}</div>
		`;
	}

	messageEl.appendChild(bubble);
	messagesDiv.appendChild(messageEl);
	messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function getFileIcon(fileType) {
	if (fileType.startsWith("image/")) return "🖼️";
	if (fileType.startsWith("video/")) return "🎬";
	if (fileType.startsWith("audio/")) return "🎵";
	if (fileType.includes("pdf")) return "📄";
	if (fileType.includes("zip") || fileType.includes("rar")) return "📦";
	return "📄";
}

function displayMessage(data) {
	const messagesDiv = document.getElementById("chatMessages");
	const messageEl = document.createElement("div");

	if (data.isSystem) {
		messageEl.className = "chat-message system";
		messageEl.innerHTML = `<div class="message-bubble">${escapeHtml(
			data.message
		)}</div>`;
	} else {
		const isOwn = data.username === username;
		messageEl.className = `chat-message ${isOwn ? "own" : "other"}`;

		const time = new Date(data.timestamp).toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
		});

		const bubble = document.createElement("div");
		bubble.className = "message-bubble";
		bubble.innerHTML = `
            ${
							!isOwn
								? `<div class="message-username">${escapeHtml(
										data.username
								  )}</div>`
								: ""
						}
            <div class="message-text">${escapeHtml(data.message)}</div>
            <div class="message-time">${time}</div>
        `;

		messageEl.appendChild(bubble);
	}

	messagesDiv.appendChild(messageEl);
	messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function escapeHtml(text) {
	const div = document.createElement("div");
	div.textContent = text;
	return div.innerHTML;
}

function toggleScreenShare() {
	if (screenShareActive) {
		stopScreenShare();
	} else {
		startScreenShare();
	}
}

function startScreenShare() {
	navigator.mediaDevices
		.getDisplayMedia({ video: true })
		.then(async (stream) => {
			screenStream = stream;
			const screenTrack = stream.getVideoTracks()[0];
			console.log("Screen share started, track label:", screenTrack.label);

			// Agregar screen track a todas las conexiones y renegociar
			for (const [userId, pc] of Object.entries(peerConnections)) {
				try {
					pc.addTrack(screenTrack, screenStream);
					console.log(`Added screen share track to peer ${userId}`);

					// Renegociar para que el peer remoto reciba el nuevo track
					const offer = await pc.createOffer();
					await pc.setLocalDescription(offer);
					socket.emit("offer", { offer: offer, to: userId });
					console.log(`Sent renegotiation offer to ${userId}`);
				} catch (error) {
					console.error(`Error adding screen share for user ${userId}:`, error);
				}
			}

			// Crear elemento de video para screen share local
			const localWrapper = document.getElementById("wrapper-local");
			let screenVideo = document.getElementById("screenVideo");

			if (!screenVideo) {
				screenVideo = document.createElement("video");
				screenVideo.id = "screenVideo";
				screenVideo.autoplay = true;
				screenVideo.muted = true;
				screenVideo.playsinline = true;
				screenVideo.className = "screen-share-video";

				const screenLabel = document.createElement("div");
				screenLabel.className = "screen-label";
				screenLabel.textContent = "Screen Share";

				localWrapper.appendChild(screenVideo);
				localWrapper.appendChild(screenLabel);
			}

			screenVideo.srcObject = screenStream;
			localWrapper.classList.add("dual-video");

			// Actualizar UI
			screenShareActive = true;
			updateScreenShareButton();
			console.log(
				"Screen share UI updated, screenShareActive:",
				screenShareActive
			);

			// Manejar cuando el usuario detiene el compartir desde el navegador
			screenTrack.onended = () => {
				stopScreenShare();
			};
		})
		.catch((error) => {
			console.error("Error sharing screen:", error);
			showError("Could not share screen");
		});
}

function stopScreenShare() {
	if (screenStream) {
		const screenTrack = screenStream.getVideoTracks()[0];

		// Remover screen track de todas las conexiones y renegociar
		Object.entries(peerConnections).forEach(async ([userId, pc]) => {
			const sender = pc.getSenders().find((s) => s.track === screenTrack);
			if (sender) {
				pc.removeTrack(sender);

				// Renegociar para que el peer remoto sepa que se removió el track
				try {
					const offer = await pc.createOffer();
					await pc.setLocalDescription(offer);
					socket.emit("offer", { offer: offer, to: userId });
				} catch (error) {
					console.error(
						"Error renegotiating after removing screen share:",
						error
					);
				}
			}
		});

		screenStream.getTracks().forEach((track) => track.stop());
		screenStream = null;
	}

	// Remover elemento de video de screen share
	const screenVideo = document.getElementById("screenVideo");
	if (screenVideo) screenVideo.remove();

	const localWrapper = document.getElementById("wrapper-local");
	if (localWrapper) {
		localWrapper.classList.remove("dual-video");
		const screenLabel = localWrapper.querySelector(".screen-label");
		if (screenLabel) screenLabel.remove();
	}

	// Actualizar UI
	screenShareActive = false;
	updateScreenShareButton();
}

function updateScreenShareButton() {
	const btn = document.getElementById("screenBtn");
	const icon = document.getElementById("screenIcon");

	if (screenShareActive) {
		// Compartiendo - botón rojo con icono de "stop"
		btn.className = "control-btn danger";
		btn.title = "Stop Sharing";
		icon.innerHTML = `
			<path d="M1 4.27L2.28 3 3 3.72V6c0 1.1.9 2 2 2h9.73L21 14.27V6c0-1.1-.9-2-2-2H6.73z"/>
			<path d="M21 18l-3-3H5c-1.1 0-2-.9-2-2V7.27L1 5.27 2.28 4 3 4.73V13c0 1.1.9 2 2 2h10.73L21 20.27V18z"/>
			<path d="M0 20h24v2H0z"/>
		`;
	} else {
		// No compartiendo - botón normal con icono de "share"
		btn.className = "control-btn";
		btn.title = "Share Screen";
		icon.innerHTML = `
			<path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.11-.9-2-2-2H4c-1.11 0-2 .89-2 2v10c0 1.1.89 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
		`;
	}
}

function toggleAudio() {
	const audioTrack = localStream.getAudioTracks()[0];
	if (audioTrack) {
		audioEnabled = !audioEnabled;
		audioTrack.enabled = audioEnabled;

		const btn = document.getElementById("audioBtn");
		const icon = document.getElementById("audioIcon");

		if (audioEnabled) {
			btn.className = "control-btn success";
			icon.innerHTML = `
				<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
				<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
			`;
		} else {
			btn.className = "control-btn danger";
			icon.innerHTML = `
				<path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
			`;
		}
		
		// Notificar a otros usuarios del cambio de mute
		if (socket) {
			socket.emit("mute-status", { audioEnabled });
		}
        
        // Guardar estado en sesión
        saveSession();
	}
}

function updateMediaButtons() {
	// Actualizar botón de video
	const videoBtn = document.getElementById("videoBtn");
	const videoIcon = document.getElementById("videoIcon");
	
	if (videoBtn && videoIcon) {
		if (videoEnabled) {
			videoBtn.className = "control-btn success";
			videoIcon.innerHTML = `
				<path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
			`;
		} else {
			videoBtn.className = "control-btn danger";
			videoIcon.innerHTML = `
				<path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/>
			`;
		}
	}
	
	// Actualizar botón de audio
	const audioBtn = document.getElementById("audioBtn");
	const audioIcon = document.getElementById("audioIcon");
	
	if (audioBtn && audioIcon) {
		if (audioEnabled) {
			audioBtn.className = "control-btn success";
			audioIcon.innerHTML = `
				<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
				<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
			`;
		} else {
			audioBtn.className = "control-btn danger";
			audioIcon.innerHTML = `
				<path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
			`;
		}
	}
}

async function toggleVideo() {
	const videoTrack = localStream.getVideoTracks()[0];
	const localVideo = document.getElementById("localVideo");
	const wrapper = document.getElementById("wrapper-local");
	
	if (videoTrack) {
		// Ya tiene video, solo toggle
		videoEnabled = !videoEnabled;
		videoTrack.enabled = videoEnabled;
		
		console.log(`📹 Video track toggled: ${videoEnabled ? 'ON' : 'OFF'}`, {
			readyState: videoTrack.readyState,
			enabled: videoTrack.enabled
		});

		// Mostrar/ocultar avatar
		if (!videoEnabled) {
			// Apagar video: mostrar avatar
			if (wrapper && !document.getElementById("localAvatar")) {
				const avatarIcon = document.createElement("div");
				avatarIcon.id = "localAvatar";
				avatarIcon.className = "avatar-placeholder";
				avatarIcon.innerHTML = `
					<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" style="opacity: 0.7">
						<circle cx="12" cy="8" r="5"/>
						<path d="M3 21c0-4 4-7 9-7s9 3 9 7"/>
					</svg>
				`;
				wrapper.appendChild(avatarIcon);
				wrapper.classList.add("audio-only");
			}
		} else {
			// Encender video: quitar avatar y forzar refresh
			if (wrapper) {
				wrapper.classList.remove("audio-only");
				wrapper.style.background = "transparent";
				const avatar = document.getElementById("localAvatar");
				if (avatar) avatar.remove();
			}
			
			// CRÍTICO: Forzar refresh del video element después de habilitar el track
			// Especialmente necesario después de auto-rejoin donde el track puede estar "muerto"
			if (localVideo && videoTrack.readyState === 'live') {
				console.log("🎬 Forcing video refresh after enabling track...");
				console.log("Current srcObject:", localVideo.srcObject);
				console.log("LocalStream tracks:", {
					video: localStream.getVideoTracks().length,
					audio: localStream.getAudioTracks().length
				});
				
				// Desvincular y revincular para refresh
				localVideo.srcObject = null;
				
				await new Promise(resolve => setTimeout(resolve, 50));
				
				// Asignar el localStream completo (no currentStream que puede estar null)
				localVideo.srcObject = localStream;
				localVideo.style.display = "block";
				localVideo.style.opacity = "1";
				localVideo.style.background = "transparent";
				
				console.log("New srcObject assigned:", localVideo.srcObject);
				console.log("Video element tracks:", localVideo.srcObject ? localVideo.srcObject.getTracks().length : 0);
				
				try {
					await localVideo.play();
					console.log("▶️ Video refreshed and playing");
				} catch(e) {
					console.error("❌ Video play after refresh failed:", e);
				}
			} else {
				console.warn("⚠️ Cannot refresh video:", {
					hasLocalVideo: !!localVideo,
					trackReadyState: videoTrack?.readyState
				});
			}
		}

		updateMediaButtons();
        
        // Guardar estado en sesión
        saveSession();
		
	} else {
		// No tiene video, pedir permisos
		try {
			console.log("📹 Requesting camera permission...");
			const videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
			const newVideoTrack = videoStream.getVideoTracks()[0];
			
			console.log("📹 New video track obtained:", {
				id: newVideoTrack.id,
				label: newVideoTrack.label,
				readyState: newVideoTrack.readyState,
				enabled: newVideoTrack.enabled
			});
			
			// LIMPIEZA CRÍTICA: Remover tracks de video viejos/muertos para evitar pantalla negra
            // Si el navegador intenta reproducir el track[0] y está 'ended', se queda negro.
			const oldVideoTracks = localStream.getVideoTracks();
			if (oldVideoTracks && oldVideoTracks.length > 0) {
				oldVideoTracks.forEach(track => {
					console.log("🧹 Cleaning old video track:", track.readyState);
					track.stop();
					localStream.removeTrack(track);
				});
			}

			// Agregar track nuevo y fresco al stream local
			localStream.addTrack(newVideoTrack);
			console.log("✅ New video track added to localStream");
			
			// Actualizar video local (Force Refresh)
			if (localVideo) {
                console.log("🎬 Updating localVideo element...");
				
				// Paso 1: Desvincular completamente
                localVideo.srcObject = null;
				
				// Paso 2: Delay para asegurar que el navegador procese el cambio
				await new Promise(resolve => setTimeout(resolve, 100));
				
				// Paso 3: Re-vincular con el stream actualizado
				localVideo.srcObject = localStream;
				
				// Paso 4: Asegurar visibilidad
				localVideo.style.background = "transparent";
				localVideo.style.display = "block";
				localVideo.style.opacity = "1";
				
                console.log("🎬 Video element configured, attempting play...");
				
                // Paso 5: Asegurar que se reproduzca
                try {
                    await localVideo.play();
					console.log("▶️ Video playing successfully!");
                } catch(e) {
                    console.error("❌ Force play failed:", e);
					// Intento de recuperación
					setTimeout(async () => {
						try {
							await localVideo.play();
							console.log("▶️ Recovery play successful");
						} catch(e2) {
							console.error("❌ Recovery play also failed:", e2);
						}
					}, 200);
                }
			}
            
            // Actualizar estado global
            videoEnabled = true;
            updateMediaButtons();
            saveSession();
			
			// Quitar avatar y clase audio-only
			if (wrapper) {
				console.log("🧹 Removing audio-only class and avatar...");
				wrapper.classList.remove("audio-only");
				wrapper.style.background = "transparent";
				
				const avatar = document.getElementById("localAvatar");
				if (avatar) {
					avatar.remove();
					console.log("✅ Avatar removed");
				}
			}
			
			// Agregar el track a todas las conexiones peer existentes
			const peerCount = Object.keys(peerConnections).length;
			console.log(`🔄 Updating ${peerCount} peer connection(s)...`);
			
			for (const [userId, pc] of Object.entries(peerConnections)) {
				const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
				if (!sender) {
					// No tiene sender de video, agregarlo
					pc.addTrack(newVideoTrack, localStream);
					console.log(`➕ Added video track to peer ${userId}`);
					
					// Renegociar
					const offer = await pc.createOffer();
					await pc.setLocalDescription(offer);
					socket.emit("offer", { offer, to: userId });
				} else {
                    // Ya tiene sender, reemplazar el track viejo por el nuevo
                    console.log(`🔄 Replacing video track for peer ${userId}`);
                    await sender.replaceTrack(newVideoTrack);
                }
			}
			
			console.log("✅ Camera reactivation complete!");
			
		} catch (error) {
			console.error("❌ Failed to get camera:", error);
			showError("Could not access camera. Please check permissions.");
		}
	}
}

async function shareRoomLink() {
	const url = `${window.location.origin}?room_id=${encodeURIComponent(roomId)}`;
	const shareData = {
		title: "Join Video Chat",
		text: `Join room "${roomId}"`,
		url: url,
	};

	try {
		if (navigator.share && navigator.canShare(shareData)) {
			await navigator.share(shareData);
		} else {
			await navigator.clipboard.writeText(url);
			showShareToast("Link copied to clipboard!");
		}
	} catch (err) {
		if (err.name !== "AbortError") {
			await navigator.clipboard.writeText(url);
			showShareToast("Link copied to clipboard!");
		}
	}
}

function showShareToast(message) {
	let toast = document.getElementById("shareToast");
	if (!toast) {
		toast = document.createElement("div");
		toast.id = "shareToast";
		toast.className = "share-toast";
		document.body.appendChild(toast);
	}
	toast.textContent = message;
	toast.classList.add("show");
	setTimeout(() => toast.classList.remove("show"), 2500);
}


window.addEventListener("resize", () => {
	const chatSection = document.getElementById("chatSection");
	const backdrop = document.getElementById("chatBackdrop");
	
	if (window.innerWidth > 768) {
		// Desktop: mostrar chat con inline style, cerrar si estaba abierto en mobile
		chatSection.classList.remove("active");
		if (backdrop) backdrop.classList.remove("active");
		isMobileChatOpen = false;
		
		// En desktop, mostrar el chat si estamos en joined-mode
		if (document.body.classList.contains("joined-mode")) {
			chatSection.style.display = "flex";
		}
	} else {
		// Mobile: quitar inline style, el chat se maneja con clases
		chatSection.style.display = "";
	}
});

function openImageModal(imageSrc) {
	const modal = document.getElementById("imageModal");
	const modalImage = document.getElementById("modalImage");

	modalImage.src = imageSrc;
	modal.classList.add("active");

	// Prevenir scroll del body
	document.body.style.overflow = "hidden";
}

function closeImageModal(event) {
	const modal = document.getElementById("imageModal");
	modal.classList.remove("active");

	// Restaurar scroll del body
	document.body.style.overflow = "";
}

// Cerrar modal con tecla ESC
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		closeImageModal();
	}
});

// ==========================================
// MONITORING HELPERS
// ==========================================

function setupAudioMonitor(stream, userId) {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        const scriptProcessor = audioContext.createScriptProcessor(2048, 1, 1);

        analyser.smoothingTimeConstant = 0.3;
        analyser.fftSize = 1024;

        microphone.connect(analyser);
        analyser.connect(scriptProcessor);
        scriptProcessor.connect(audioContext.destination);

        let silenceStart = Date.now();
        const THRESHOLD = 15; // Nivel de volumen para considerar "hablando"

        scriptProcessor.onaudioprocess = function() {
            const array = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(array);
            
            let values = 0;
            const length = array.length;
            for (let i = 0; i < length; i++) {
                values += array[i];
            }

            const average = values / length;
            const container = document.getElementById('wrapper-' + userId);
            
            if (average > THRESHOLD) {
                if(container) container.classList.add('speaking');
                silenceStart = Date.now();
            } else {
                if (Date.now() - silenceStart > 500) { // Delay para evitar parpadeo
                    if(container) container.classList.remove('speaking');
                }
            }
        };
    } catch(e) {
        console.error("Audio monitor setup failed for", userId, e);
    }
}

function startNetworkMonitor(pc, userId) {
    // Solo monitorear si RTCPeerConnection existe
    if (!pc) return;

    // Ejecutar cada 2 segundos
    setInterval(async () => {
        try {
            if (pc.connectionState !== 'connected' && pc.connectionState !== 'checking') return;

            // Obtener estadísticas WebRTC
            const stats = await pc.getStats();
            let rtt = 0;
            // Buscar pair candidato activo
            stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    rtt = report.currentRoundTripTime ? report.currentRoundTripTime * 1000 : 0;
                }
            });

            const container = document.getElementById('wrapper-' + userId);
            if (!container) return; // El usuario ya se fue

            const netIcon = container.querySelector('.network-status');
            if (netIcon) {
                // Limpiar clases previas
                netIcon.classList.remove('network-good', 'network-fair', 'network-poor');
                
                // Determinar calidad visual
                if (rtt < 100) {
                    netIcon.classList.add('network-good');
                    netIcon.title = `Good Connection (${Math.round(rtt)}ms)`;
                    // Icono WiFi lleno
                    netIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.01 21.49L23.64 7c-.45-.34-4.93-4-11.64-4C5.28 3 .81 6.66.36 7l11.63 14.49.01.01.01-.01z"/></svg>';
                } else if (rtt < 300) {
                    netIcon.classList.add('network-fair');
                    netIcon.title = `Weak Connection (${Math.round(rtt)}ms)`;
                    // Icono WiFi medio
                    netIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z"/></svg>';
                } else {
                    netIcon.classList.add('network-poor');
                    netIcon.title = `Poor Connection (${Math.round(rtt)}ms)`;
                    // Icono WiFi bajo/alerta
                    netIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
                }
            }

        } catch (e) {
            // Silenciar errores de stats o desconexiones
        }
    }, 2000);
}


// ==========================================
// STABILITY IMPROVEMENTS: Cleanup on Exit
// ==========================================
window.addEventListener('beforeunload', () => {
    // Save final state ONLY if not leaving explicitly
    if (!isExplicitLeave) {
        saveSession();
    }

    console.log('🧹 Cleaning up WebRTC resources...');
    
    // 1. Detener tracks locales
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
        });
    }
    
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }

    // 2. Cerrar todas las PeerConnections
    Object.keys(peerConnections).forEach(userId => {
        const pc = peerConnections[userId];
        if (pc) {
            pc.close();
        }
    });
    
    // 3. Desconectar socket explícitamente
    if (socket) {
        socket.disconnect();
    }
});


// Update unread messages badge
function updateUnreadBadge() {
    const badge = document.getElementById('unreadBadge');
    if (!badge) return;
    if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}
