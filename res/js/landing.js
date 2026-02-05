// Generate browser fingerprint for admin identification
// Uses origin-specific key so localhost, LAN IP, HTTP, and HTTPS all get separate fingerprints
function generateFingerprint() {
    const storageKey = 'sync-player-fingerprint-' + window.location.origin;
    const stored = localStorage.getItem(storageKey);
    if (stored) return stored;

    const fp = 'fp_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    localStorage.setItem(storageKey, fp);
    return fp;
}

const fingerprint = generateFingerprint();
const socket = io();

// Check for URL error parameters
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('error') === 'room_not_found') {
    showError('Room not found or has been deleted.');
}

// Socket connection handlers
socket.on('connect', () => {
    console.log('Connected to server');
    fetchPublicRooms();
});

socket.on('rooms-updated', (rooms) => {
    updateRoomsList(rooms);
});

// Toggle switch functionality
function toggleOption(element) {
    element.classList.toggle('active');
}

// Create room via socket
function createRoom() {
    const roomName = document.getElementById('roomName').value || 'Watch Party';
    const isPrivate = document.getElementById('togglePrivate').classList.contains('active');

    socket.emit('create-room', {
        name: roomName,
        isPrivate,
        fingerprint
    }, (response) => {
        if (response.success) {
            // Show the generated code
            document.getElementById('generatedCode').textContent = response.roomCode;
            document.getElementById('roomCodeDisplay').classList.add('visible');

            // Copy functionality
            document.getElementById('roomCodeDisplay').onclick = () => {
                navigator.clipboard.writeText(response.roomCode);
                document.querySelector('.copy-hint').textContent = 'Copied! ✓';
                setTimeout(() => {
                    document.querySelector('.copy-hint').textContent = 'Click to copy • Share with friends';
                }, 2000);
            };

            // Redirect to admin panel after short delay
            setTimeout(() => {
                window.location.href = `/admin/${response.roomCode}`;
            }, 1500);
        } else {
            showError(response.error || 'Failed to create room');
        }
    });
}

// Join room via socket
function joinRoom() {
    const roomCode = document.getElementById('roomCode').value.toUpperCase();
    const displayName = document.getElementById('displayName').value || 'Guest';

    if (roomCode.length !== 6) {
        showError('Please enter a valid 6-digit room code.');
        return;
    }

    // First check if room exists via API
    fetch(`/api/rooms/${roomCode}`)
        .then(res => {
            if (!res.ok) throw new Error('Room not found');
            return res.json();
        })
        .then(room => {
            // Store display name for the watch page
            sessionStorage.setItem('sync-player-name', displayName);
            sessionStorage.setItem('sync-player-room', roomCode);
            // Redirect to watch page
            window.location.href = `/watch/${roomCode}`;
        })
        .catch(err => {
            showError('Room not found. Please check the code and try again.');
        });
}

// Quick join from public rooms list
function quickJoin(roomCode) {
    document.getElementById('roomCode').value = roomCode;
    document.getElementById('roomCode').focus();
}

// Show error message
function showError(message) {
    const errorEl = document.getElementById('joinError');
    errorEl.textContent = message;
    errorEl.classList.add('visible');
    setTimeout(() => {
        errorEl.classList.remove('visible');
    }, 3000);
}

// Auto-format room code input
document.getElementById('roomCode').addEventListener('input', function (e) {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// Keyboard shortcuts
document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        if (document.activeElement.id === 'roomCode' || document.activeElement.id === 'displayName') {
            joinRoom();
        } else if (document.activeElement.id === 'roomName') {
            createRoom();
        }
    }
});

// Fetch public rooms from server
function fetchPublicRooms() {
    fetch('/api/rooms')
        .then(res => res.json())
        .then(rooms => {
            updateRoomsList(rooms);
        })
        .catch(err => {
            console.error('Failed to fetch rooms:', err);
            updateRoomsList([]);
        });
}

function updateRoomsList(rooms) {
    const list = document.getElementById('roomsList');
    const noRooms = document.getElementById('noRooms');

    // Remove example items first
    list.querySelectorAll('.room-item').forEach(item => item.remove());

    if (!rooms || rooms.length === 0) {
        noRooms.style.display = 'block';
    } else {
        noRooms.style.display = 'none';
        rooms.forEach(room => {
            const div = document.createElement('div');
            div.className = 'room-item';
            div.innerHTML = `
                <div class="room-info">
                    <div class="room-status"></div>
                    <span class="room-name">${escapeHtml(room.name)}</span>
                    <span class="room-viewers">👥 ${room.viewers} viewer${room.viewers !== 1 ? 's' : ''}</span>
                </div>
                <button class="btn-quick-join" onclick="quickJoin('${room.code}')">Join</button>
            `;
            list.insertBefore(div, noRooms);
        });
    }
}

// HTML escape helper
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initial fetch
fetchPublicRooms();
