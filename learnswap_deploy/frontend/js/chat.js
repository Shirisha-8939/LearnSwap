// Chat functionality - COMPLETE FIXED VERSION

// Global variables
let chatSocket = null;
let currentSessionId = null;
let currentUserId = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

// Make openChat globally available
window.openChat = function(sessionId) {
    console.log('Opening chat for session:', sessionId);
    
    // Store session ID
    currentSessionId = sessionId;
    
    // Get current user
    const user = getCurrentUser();
    if (!user) {
        showNotification('Please login first', 'error');
        return;
    }
    currentUserId = user.id;
    
    // Create or get chat modal
    createChatModal();
    
    // Show modal
    const chatModal = document.getElementById('chatModal');
    if (chatModal) {
        chatModal.style.display = 'block';
    }
    
    // Clear previous messages
    const messagesContainer = document.getElementById('chatMessages');
    if (messagesContainer) {
        messagesContainer.innerHTML = '<div style="text-align: center; color: #64748b; padding: 2rem;">Connecting to chat server...</div>';
    }
    
    // Initialize chat connection
    initializeChat(sessionId);
};

// Create chat modal if it doesn't exist
function createChatModal() {
    let chatModal = document.getElementById('chatModal');
    
    if (!chatModal) {
        chatModal = document.createElement('div');
        chatModal.id = 'chatModal';
        chatModal.className = 'modal';
        chatModal.style.display = 'none';
        
        chatModal.innerHTML = `
            <div class="modal-content chat-modal">
                <!-- Header -->
                <div class="chat-header">
                    <h3 style="margin: 0;"><i class="fas fa-comments"></i> Session Chat</h3>
                    <span onclick="closeChat()" style="color: white; font-size: 1.5rem; cursor: pointer; font-weight: bold;">&times;</span>
                </div>
                
                <!-- Messages Area -->
                <div id="chatMessages" class="chat-messages-area"></div>
                
                <!-- Typing Indicator -->
                <div id="typingIndicator" class="typing-indicator">Someone is typing...</div>
                
                <!-- Input Area -->
                <div class="chat-input-area">
                    <input type="text" id="chatInput" class="chat-input" placeholder="Type your message..." 
                           onkeypress="handleKeyPress(event)">
                    <button class="chat-send-btn" onclick="sendMessage()">
                        <i class="fas fa-paper-plane"></i> Send
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(chatModal);
    }
}

// Initialize socket connection
function initializeChat(sessionId) {
    console.log('🔄 Initializing chat for session:', sessionId);
    
    // Disconnect existing socket
    if (chatSocket) {
        chatSocket.disconnect();
        chatSocket = null;
    }
    
    const user = getCurrentUser();
    if (!user) {
        showNotification('User not found', 'error');
        return;
    }
    
    // Connect to Socket.IO server
    const serverUrl = 'http://localhost:5000';
    console.log('Connecting to:', serverUrl);
    
    chatSocket = io(serverUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000,
        forceNew: true
    });
    
    // Connection established
    chatSocket.on('connect', function() {
        console.log('Socket connected! ID:', chatSocket.id);
        reconnectAttempts = 0;
        
        // Join session room
        chatSocket.emit('join_session', {
            sessionId: sessionId,
            userId: user.id
        });
        console.log('📤 Sent join_session event');
        
        // Update UI
        const messagesContainer = document.getElementById('chatMessages');
        if (messagesContainer) {
            messagesContainer.innerHTML = '<div style="text-align: center; color: #64748b; padding: 2rem;">Loading messages...</div>';
        }
        
        // Load message history
        loadMessageHistory(sessionId);
    });
    
    // Handle incoming messages
    chatSocket.on('receive_message', function(data) {
        console.log('📩 Message received:', data);
        displayMessage(data);
    });
    
    // Handle typing indicators
    chatSocket.on('user_typing', function(data) {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) {
            if (data.userId !== user.id) {
                indicator.style.display = data.isTyping ? 'block' : 'none';
            }
        }
    });
    
    // Handle user joined
    chatSocket.on('user_joined', function(data) {
        console.log('👤 User joined:', data);
        if (data.userId !== user.id) {
            const container = document.getElementById('chatMessages');
            if (container) {
                const infoDiv = document.createElement('div');
                infoDiv.style.cssText = 'text-align: center; color: #64748b; font-size: 0.875rem; padding: 0.5rem;';
                infoDiv.textContent = '👤 Other user joined the chat';
                container.appendChild(infoDiv);
                container.scrollTop = container.scrollHeight;
            }
        }
    });
    
    // Connection error
    chatSocket.on('connect_error', function(error) {
        console.error('Connection error:', error);
        reconnectAttempts++;
        
        const messagesContainer = document.getElementById('chatMessages');
        if (messagesContainer) {
            messagesContainer.innerHTML = `
                <div style="text-align: center; color: #ef4444; padding: 2rem;">
                    <i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                    <p>Failed to connect to chat server.</p>
                    <p style="font-size: 0.875rem;">Attempt ${reconnectAttempts}/${maxReconnectAttempts}</p>
                    <button onclick="window.location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #6366f1; color: white; border: none; border-radius: 0.5rem; cursor: pointer;">
                        Retry Connection
                    </button>
                </div>
            `;
        }
    });
    
    // Disconnection
    chatSocket.on('disconnect', function(reason) {
        console.log('Socket disconnected:', reason);
        const messagesContainer = document.getElementById('chatMessages');
        if (messagesContainer && messagesContainer.children.length > 0) {
            const warningDiv = document.createElement('div');
            warningDiv.style.cssText = 'text-align: center; color: #ef4444; font-size: 0.875rem; padding: 0.5rem; background: #fee2e2; border-radius: 0.5rem; margin: 0.5rem 0;';
            warningDiv.textContent = '⚠ Disconnected from chat. Attempting to reconnect...';
            messagesContainer.appendChild(warningDiv);
        }
    });
    
    // Reconnection
    chatSocket.on('reconnect', function(attemptNumber) {
        console.log('Reconnected after', attemptNumber, 'attempts');
        
        // Rejoin session
        chatSocket.emit('join_session', {
            sessionId: sessionId,
            userId: user.id
        });
        
        // Reload messages
        loadMessageHistory(sessionId);
        
        // Show success message
        const messagesContainer = document.getElementById('chatMessages');
        if (messagesContainer) {
            const successDiv = document.createElement('div');
            successDiv.style.cssText = 'text-align: center; color: #10b981; font-size: 0.875rem; padding: 0.5rem; background: #d1fae5; border-radius: 0.5rem; margin: 0.5rem 0;';
            successDiv.textContent = 'Reconnected to chat';
            messagesContainer.appendChild(successDiv);
        }
    });
}

// Load message history
async function loadMessageHistory(sessionId) {
    console.log('📥 Loading message history for session:', sessionId);
    
    const token = localStorage.getItem('token');
    if (!token) {
        console.error('No token found');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/messages/${sessionId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('Messages loaded:', data.messages?.length || 0);
            
            const messagesContainer = document.getElementById('chatMessages');
            if (messagesContainer) {
                if (!data.messages || data.messages.length === 0) {
                    messagesContainer.innerHTML = '<div style="text-align: center; color: #64748b; padding: 2rem;">No messages yet. Start the conversation!</div>';
                } else {
                    messagesContainer.innerHTML = '';
                    data.messages.forEach(msg => displayMessage(msg, true));
                }
            }
        } else {
            console.error('Failed to load messages:', response.status);
            const messagesContainer = document.getElementById('chatMessages');
            if (messagesContainer) {
                messagesContainer.innerHTML = '<div style="text-align: center; color: #ef4444; padding: 2rem;">Failed to load messages.</div>';
            }
        }
    } catch (error) {
        console.error('Error loading messages:', error);
        const messagesContainer = document.getElementById('chatMessages');
        if (messagesContainer) {
            messagesContainer.innerHTML = '<div style="text-align: center; color: #ef4444; padding: 2rem;">Error loading messages.</div>';
        }
    }
}

// Display a message
function displayMessage(data, isHistory = false) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    
    const user = getCurrentUser();
    const isSent = data.senderId == user?.id;
    
    // Remove empty/loading messages
    if (!isHistory && container.children.length === 1) {
        const firstChild = container.children[0];
        if (firstChild.textContent.includes('No messages') || 
            firstChild.textContent.includes('Loading') ||
            firstChild.textContent.includes('Connecting')) {
            container.innerHTML = '';
        }
    }
    
    // Create message element
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isSent ? 'sent' : 'received'}`;
    
    // Add sender name for received messages
    let senderHtml = '';
    if (!isSent && data.senderName) {
        senderHtml = `<div class="sender-name" style="color: #667eea;">${escapeHtml(data.senderName)}</div>`;
    }
    
    // Format time
    let timeStr = 'Just now';
    if (data.timestamp) {
        const time = new Date(data.timestamp);
        timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (data.created_at) {
        const time = new Date(data.created_at);
        timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    messageDiv.innerHTML = `
        ${senderHtml}
        <div style="word-wrap: break-word;">${escapeHtml(data.content)}</div>
        <div class="message-time">${timeStr}</div>
    `;
    
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

// Send message
window.sendMessage = function() {
    const input = document.getElementById('chatInput');
    if (!input) {
        console.error('Chat input not found');
        return;
    }
    
    const message = input.value.trim();
    if (!message) {
        return;
    }
    
    if (!chatSocket || !chatSocket.connected) {
        showNotification('Not connected to chat server', 'error');
        return;
    }
    
    if (!currentSessionId) {
        console.error('No active session');
        return;
    }
    
    const user = getCurrentUser();
    if (!user) {
        showNotification('User not found', 'error');
        return;
    }
    
    console.log('📤 Sending message:', message);
    
    const messageData = {
        sessionId: currentSessionId,
        senderId: user.id,
        content: message
    };
    
    // Send via socket
    chatSocket.emit('send_message', messageData);
    
    // Clear input
    input.value = '';
    
    // Stop typing indicator
    stopTyping();
};

// Handle key press (Enter to send)
window.handleKeyPress = function(event) {
    if (event.key === 'Enter') {
        sendMessage();
    } else {
        startTyping();
    }
};

// Typing indicator
let typingTimer;
function startTyping() {
    if (!chatSocket || !chatSocket.connected || !currentSessionId) return;
    
    const user = getCurrentUser();
    if (!user) return;
    
    chatSocket.emit('typing', {
        sessionId: currentSessionId,
        userId: user.id,
        isTyping: true
    });
    
    clearTimeout(typingTimer);
    typingTimer = setTimeout(stopTyping, 2000);
}

function stopTyping() {
    if (!chatSocket || !chatSocket.connected || !currentSessionId) return;
    
    const user = getCurrentUser();
    if (!user) return;
    
    chatSocket.emit('typing', {
        sessionId: currentSessionId,
        userId: user.id,
        isTyping: false
    });
}

// Close chat
window.closeChat = function() {
    console.log('Closing chat');
    
    if (chatSocket) {
        stopTyping();
        
        if (currentSessionId) {
            const user = getCurrentUser();
            if (user) {
                chatSocket.emit('leave_session', {
                    sessionId: currentSessionId,
                    userId: user.id
                });
            }
        }
        
        chatSocket.disconnect();
        chatSocket = null;
    }
    
    const chatModal = document.getElementById('chatModal');
    if (chatModal) {
        chatModal.style.display = 'none';
    }
    
    currentSessionId = null;
    currentUserId = null;
};

// Escape HTML to prevent XSS
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}