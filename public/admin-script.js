// Admin Dashboard JavaScript

let refreshInterval = null;
let analyticsData = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    refreshData();
    startAutoRefresh();
});

// Check if user is authenticated
async function checkAuth() {
    try {
        const response = await fetch('/api/admin/analytics');
        if (response.status === 401) {
            window.location.href = '/admin.html';
        }
    } catch (error) {
        console.error('Auth check failed:', error);
    }
}

// Refresh data from server
async function refreshData() {
    try {
        const response = await fetch('/api/admin/analytics');
        
        if (response.status === 401) {
            window.location.href = '/admin.html';
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to fetch analytics');
        }

        analyticsData = await response.json();
        updateUI(analyticsData);
        updateLastRefreshTime();
    } catch (error) {
        console.error('Error fetching analytics:', error);
        showError('Failed to load analytics data');
    }
}

// Update UI with data
function updateUI(data) {
    // Update stats
    updateStats(data.stats);
    
    // Update online users
    updateOnlineUsers(data.currentOnline);
    
    // Update active rooms
    updateActiveRooms(data.rooms);
    
    // Update recent activity
    updateRecentActivity(data.sessions);
    
    // Update visitor history
    updateVisitorHistory(data.sessions);
}

// Update statistics cards
function updateStats(stats) {
    // Directly update values without animation to fix stuck numbers
   document.getElementById('totalConnections').textContent = stats.total_connections || 0;
    document.getElementById('uniqueUsers').textContent = stats.uniqueUsers || 0;
    document.getElementById('currentOnline').textContent = stats.currentOnlineCount || 0;
    document.getElementById('totalMessages').textContent = stats.total_messages || 0;
    document.getElementById('totalRooms').textContent = stats.total_rooms || 0;
    document.getElementById('peakConcurrent').textContent = stats.peak_concurrent_users || 0;
}

// Animate number changes (kept for future use)
function animateValue(element, start, end, duration = 1000) {
    if (!element) return;
    if (start === end) {
        element.textContent = end;
        return;
    }
    
    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;
    
    const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
            element.textContent = end;
            clearInterval(timer);
        } else {
            element.textContent = Math.floor(current);
        }
    }, 16);
}

// Cache previous data to prevent unnecessary re-renders
let previousData = {
    onlineUsers: null,
    rooms: null,
    sessions: null
};

// Update online users list
function updateOnlineUsers(users) {
    const container = document.getElementById('onlineUsersList');
    const countBadge = document.getElementById('onlineCount');
    
    if (!container) return;

    // Check if data changed
    const usersKey = JSON.stringify(users);
    if (previousData.onlineUsers === usersKey) return;
    previousData.onlineUsers = usersKey;

    countBadge.textContent = users.length;

    if (users.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <p>No users online</p>
            </div>
        `;
        return;
    }

    container.innerHTML = users.map(user => `
        <div class="user-item">
            <div class="user-info">
                <div class="user-avatar">${getInitials(user.username)}</div>
                <div class="user-details">
                    <h4>${escapeHtml(user.username)}</h4>
                    <p>Room: ${escapeHtml(user.room_id)}</p>
                </div>
            </div>
            <div class="user-time">${formatTime(user.joined_at)}</div>
        </div>
    `).join('');
}

// Update active rooms list
function updateActiveRooms(rooms) {
    const container = document.getElementById('roomsList');
    const countBadge = document.getElementById('roomsCount');
    
    if (!container) return;

    // Check if data changed
    const roomsKey = JSON.stringify(rooms);
    if (previousData.rooms === roomsKey) return;
    previousData.rooms = roomsKey;

    countBadge.textContent = rooms.length;

    if (rooms.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                </svg>
                <p>No active rooms</p>
            </div>
        `;
        return;
    }

    container.innerHTML = rooms.map(room => `
        <div class="room-item">
            <div class="room-header">
                <div class="room-id">${escapeHtml(room.roomId)}</div>
                <div class="room-count">${room.userCount} ${room.userCount === 1 ? 'user' : 'users'}</div>
            </div>
            <div class="room-users">
                ${room.users.map(u => `<span class="room-user-tag">${escapeHtml(u.username)}</span>`).join('')}
            </div>
        </div>
    `).join('');
}

// Update recent activity
function updateRecentActivity(sessions) {
    const container = document.getElementById('activityList');
    
    if (!container) return;

    // Check if data changed (only check first 50 for performance)
    const sessionsKey = JSON.stringify(sessions?.slice(0, 50));
    if (previousData.sessions === sessionsKey) return;
    previousData.sessions = sessionsKey;

    if (!sessions || sessions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                </svg>
                <p>No recent activity</p>
            </div>
        `;
        return;
    }

    // Limit to 50 most recent
    const recentSessions = sessions.slice(0, 50);

    container.innerHTML = recentSessions.map(session => {
        const icon = getActivityIcon(session.type);
        const message = getActivityMessage(session);
        
        return `
            <div class="activity-item">
                <div class="activity-icon ${session.type}">${icon}</div>
                <div class="activity-details">
                    <h4>${message}</h4>
                    <p>${escapeHtml(session.room_id || 'N/A')}</p>
                </div>
                <div class="activity-time">${formatTimeAgo(session.timestamp)}</div>
            </div>
        `;
    }).join('');
}

// Get activity icon
function getActivityIcon(type) {
    const icons = {
        'join': '👋',
        'disconnect': '👤',
        'file-share': '📁'
    };
    return icons[type] || '•';
}

// Get activity message
function getActivityMessage(session) {
    const username = escapeHtml(session.username || 'Unknown');
    
    switch (session.type) {
        case 'join':
            return `${username} joined`;
        case 'disconnect':
            return `${username} disconnected`;
        case 'file-share':
            return `${username} shared ${escapeHtml(session.file_name || 'a file')}`;
        default:
            return `${username} - ${session.type}`;
    }
}

// Get user initials
function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// Format timestamp
function formatTime(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
}

// Format time ago
function formatTimeAgo(timestamp) {
    if (!timestamp) return 'N/A';
    
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now - time;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    
    return time.toLocaleDateString();
}

// Update last refresh time
function updateLastRefreshTime() {
    const element = document.getElementById('lastUpdated');
    if (element) {
        element.textContent = new Date().toLocaleTimeString();
    }
}

// Start auto-refresh
function startAutoRefresh() {
    refreshInterval = setInterval(() => {
        refreshData();
    }, 5000); // Refresh every 5 seconds
}

// Stop auto-refresh
function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

// Export data
function exportData() {
    if (!analyticsData) {
        showError('No data to export');
        return;
    }

    const dataStr = JSON.stringify(analyticsData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `webrtc-analytics-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Logout
async function logout() {
    try {
        await fetch('/admin/logout', { method: 'POST' });
        window.location.href = '/admin.html';
    } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/admin.html';
    }
}

// Show error
function showError(message) {
    console.error(message);
    // You can add a toast notification here
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.toString().replace(/[&<>"']/g, m => map[m]);
}

// Update visitor history - Only show room joins with detailed info
function updateVisitorHistory(sessions) {
    const container = document.getElementById('historyList');
    const countBadge = document.getElementById('historyCount');
    
    if (!container) return;

    // Filter only 'join' events
    const joinSessions = sessions.filter(s => s.type === 'join');
    
    countBadge.textContent = joinSessions.length;

    if (joinSessions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                </svg>
                <p>No visitor history</p>
            </div>
        `;
        return;
    }

    // Limit to 100 most recent joins
    const recentJoins = joinSessions.slice(0, 100);

    container.innerHTML = recentJoins.map(session => {
        const userAgent = session.user_agent || 'Unknown';
        const browserInfo = parseBrowser(userAgent);
        const osInfo = parseOS(userAgent);
        const deviceInfo = parseDevice(userAgent);
        
        const timestamp = new Date(session.timestamp);
        const dateStr = timestamp.toLocaleDateString();
        const timeStr = timestamp.toLocaleTimeString();
        
        return `
            <div class="history-item">
                <div class="history-header">
                    <div class="history-user">
                        <div class="history-avatar">${getInitials(session.username)}</div>
                        <div class="history-user-info">
                            <h3>${escapeHtml(session.username)}</h3>
                            <p>Room: ${escapeHtml(session.room_id)}</p>
                        </div>
                    </div>
                    <div class="history-timestamp">
                        <div class="history-date">${dateStr}</div>
                        <div class="history-time">${timeStr}</div>
                    </div>
                </div>
                <div class="history-details">
                    <div class="history-detail-item">
                        <div class="history-detail-label">Browser</div>
                        <div class="history-detail-value browser">
                            <span class="browser-icon">${browserInfo.icon}</span>
                            <span>${browserInfo.name} ${browserInfo.version}</span>
                        </div>
                    </div>
                    <div class="history-detail-item">
                        <div class="history-detail-label">Operating System</div>
                        <div class="history-detail-value">${osInfo.name} ${osInfo.version}</div>
                    </div>
                    <div class="history-detail-item">
                        <div class="history-detail-label">Device</div>
                        <div class="history-detail-value">${deviceInfo}</div>
                    </div>
                    <div class="history-detail-item">
                        <div class="history-detail-label">IP Address</div>
                        <div class="history-detail-value">${escapeHtml(session.ip || 'N/A')}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Parse browser from user agent
function parseBrowser(ua) {
    if (!ua) return { name: 'Unknown', version: '', icon: '🌐' };
    
    ua = ua.toLowerCase();
    
    if (ua.includes('edg/')) {
        const match = ua.match(/edg\/([\d.]+)/);
        return { name: 'Edge', version: match ? match[1] : '', icon: '🔷' };
    }
    if (ua.includes('chrome/')) {
        const match = ua.match(/chrome\/([\d.]+)/);
        return { name: 'Chrome', version: match ? match[1] : '', icon: '🔵' };
    }
    if (ua.includes('firefox/')) {
        const match = ua.match(/firefox\/([\d.]+)/);
        return { name: 'Firefox', version: match ? match[1] : '', icon: '🦊' };
    }
    if (ua.includes('safari/') && !ua.includes('chrome')) {
        const match = ua.match(/version\/([\d.]+)/);
        return { name: 'Safari', version: match ? match[1] : '', icon: '🧭' };
    }
    if (ua.includes('opera/') || ua.includes('opr/')) {
        const match = ua.match(/(?:opera|opr)\/([\d.]+)/);
        return { name: 'Opera', version: match ? match[1] : '', icon: '🔴' };
    }
    
    return { name: 'Other', version: '', icon: '🌐' };
}

// Parse OS from user agent
function parseOS(ua) {
    if (!ua) return { name: 'Unknown', version: '' };
    
    ua = ua.toLowerCase();
    
    if (ua.includes('windows nt 10.0')) return { name: 'Windows', version: '10/11' };
    if (ua.includes('windows nt 6.3')) return { name: 'Windows', version: '8.1' };
    if (ua.includes('windows nt 6.2')) return { name: 'Windows', version: '8' };
    if (ua.includes('windows nt 6.1')) return { name: 'Windows', version: '7' };
    if (ua.includes('windows')) return { name: 'Windows', version: '' };
    
    if (ua.includes('mac os x')) {
        const match = ua.match(/mac os x ([\d_]+)/);
        const version = match ? match[1].replace(/_/g, '.') : '';
        return { name: 'macOS', version };
    }
    
    if (ua.includes('android')) {
        const match = ua.match(/android ([\d.]+)/);
        return { name: 'Android', version: match ? match[1] : '' };
    }
    
    if (ua.includes('iphone') || ua.includes('ipad')) {
        const match = ua.match(/os ([\d_]+)/);
        const version = match ? match[1].replace(/_/g, '.') : '';
        return { name: 'iOS', version };
    }
    
    if (ua.includes('linux')) return { name: 'Linux', version: '' };
    if (ua.includes('ubuntu')) return { name: 'Ubuntu', version: '' };
    if (ua.includes('fedora')) return { name: 'Fedora', version: '' };
    
    return { name: 'Unknown', version: '' };
}

// Parse device type from user agent
function parseDevice(ua) {
    if (!ua) return 'Unknown';
    
    ua = ua.toLowerCase();
    
    if (ua.includes('mobile')) return '📱 Mobile';
    if (ua.includes('tablet') || ua.includes('ipad')) return '📱 Tablet';
    if (ua.includes('android') && !ua.includes('mobile')) return '📱 Tablet';
    
    return '💻 Desktop';
}

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopAutoRefresh();
    } else {
        refreshData();
        startAutoRefresh();
    }
});
