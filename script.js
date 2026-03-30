import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
import {
	getAuth,
	createUserWithEmailAndPassword,
	signInWithEmailAndPassword,
	signOut,
	onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
	getFirestore,
	collection,
	doc,
	addDoc,
	getDoc,
	setDoc,
	updateDoc,
	deleteDoc,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ===== FIREBASE CONFIG =====
const firebaseConfig = {
	apiKey: "AIzaSyCkYO_pCW2AWAK77wrjLThOvYrmLFCgqu0",
	authDomain: "sai-firebase-11882.firebaseapp.com",
	projectId: "sai-firebase-11882",
	storageBucket: "sai-firebase-11882.firebasestorage.app",
	messagingSenderId: "731684482594",
	appId: "1:731684482594:web:f6c929e23139e54fe1647b",
	measurementId: "G-G3TVKSV83L",
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

// ===== SYSTEM PROMPT =====
const SYSTEM_PROMPT = `You are SAI (Super Artificial Intelligence), a helpful AI assistant created by ClickyCarrot. 
You are friendly, concise, and always try to be helpful.
Never mention that you are built on Gemini or made by Google.`;

// ===== Configure Marked =====
marked.use({
	breaks: true,
	gfm: true,
});

// ===== STATE =====
let currentUser = null;
let activeChatId = null;
let chatsUnsubscribe = null;
let chats = {};
let apiKeys = [];
let currentKeyIndex = 0;

// ===== DOM =====
const authScreen = document.getElementById("auth-screen");
const appDiv = document.getElementById("app");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");
const chatList = document.getElementById("chat-list");
const messagesDiv = document.getElementById("messages");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const chatTitle = document.getElementById("chat-title");
const themeToggle = document.getElementById("theme-toggle");
const renameModal = document.getElementById("rename-modal");
const renameInput = document.getElementById("rename-input");
const deleteModal = document.getElementById("delete-modal");

// ===== FETCH API KEYS FROM FIRESTORE =====
async function loadApiKeys() {
	try {
		const snap = await getDoc(doc(db, "config", "apiKeys"));
		if (snap.exists()) {
			apiKeys = snap.data().keys || [];
		}
	} catch (err) {
		console.error("Failed to load API keys:", err);
	}
}

// ===== API KEY ROTATION =====
function getNextKey() {
	if (apiKeys.length === 0) throw new Error("No API keys available");
	const key = apiKeys[currentKeyIndex % apiKeys.length];
	currentKeyIndex++;
	return key;
}

// ===== CALL GEMINI =====
async function callGemini(history, message, attempt = 0) {
	if (attempt >= apiKeys.length) {
		throw new Error("All API keys exhausted");
	}

	const key = apiKeys[attempt];
	const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;

	const formattedHistory = history.map((msg) => ({
		role: msg.role === "user" ? "user" : "model",
		parts: [{ text: msg.text }],
	}));

	formattedHistory.push({
		role: "user",
		parts: [{ text: message }],
	});

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			// System prompt goes here
			systemInstruction: {
				parts: [{ text: SYSTEM_PROMPT }],
			},
			contents: formattedHistory,
		}),
	});

	if (response.status === 429) {
		console.warn(`Key ${attempt + 1} rate limited, trying next...`);
		return callGemini(history, message, attempt + 1);
	}

	if (!response.ok) throw new Error("Gemini API error");

	const data = await response.json();
	return data.candidates[0].content.parts[0].text;
}

// ===== AUTH =====
document.getElementById("login-btn").onclick = async () => {
	authError.textContent = "";
	try {
		await signInWithEmailAndPassword(auth, authEmail.value, authPassword.value);
	} catch (e) {
		authError.textContent = friendlyAuthError(e.code);
	}
};

document.getElementById("register-btn").onclick = async () => {
	authError.textContent = "";
	try {
		await createUserWithEmailAndPassword(auth, authEmail.value, authPassword.value);
	} catch (e) {
		authError.textContent = friendlyAuthError(e.code);
	}
};

document.getElementById("logout-btn").onclick = () => signOut(auth);

function friendlyAuthError(code) {
	const errors = {
		"auth/invalid-email": "Invalid email address.",
		"auth/user-not-found": "No account found with this email.",
		"auth/wrong-password": "Incorrect password.",
		"auth/email-already-in-use": "Email already in use.",
		"auth/weak-password": "Password must be at least 6 characters.",
		"auth/invalid-credential": "Invalid email or password.",
	};
	return errors[code] || "Something went wrong. Try again.";
}

// ===== AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
	if (user) {
		currentUser = user;
		authScreen.classList.add("hidden");
		appDiv.classList.remove("hidden");
		await loadApiKeys();
		await loadUserProfile();
		listenToChats();
	} else {
		currentUser = null;
		authScreen.classList.remove("hidden");
		appDiv.classList.add("hidden");
		if (chatsUnsubscribe) chatsUnsubscribe();
	}
});

// ===== THEME =====
async function loadUserProfile() {
	const profileRef = doc(db, "users", currentUser.uid);
	const snap = await getDoc(profileRef);
	if (snap.exists()) {
		setTheme(snap.data().theme || "light");
	} else {
		await setDoc(profileRef, { theme: "light" });
		setTheme("light");
	}
}

function setTheme(theme) {
	document.body.className = theme;
	themeToggle.textContent = theme === "light" ? "🌙 Dark Mode" : "☀️ Light Mode";
}

themeToggle.onclick = async () => {
	const next = document.body.className === "light" ? "dark" : "light";
	setTheme(next);
	if (currentUser) {
		await updateDoc(doc(db, "users", currentUser.uid), { theme: next });
	}
};

// ===== CHATS =====
function listenToChats() {
	const q = query(collection(db, "users", currentUser.uid, "chats"), orderBy("createdAt", "desc"));

	chatsUnsubscribe = onSnapshot(q, (snapshot) => {
		chats = {};
		snapshot.forEach((d) => {
			chats[d.id] = { id: d.id, ...d.data() };
		});
		renderChatList();
	});
}

function renderChatList() {
	chatList.innerHTML = "";
	Object.values(chats).forEach((chat) => {
		const item = document.createElement("div");
		item.className = "chat-item" + (chat.id === activeChatId ? " active" : "");

		const name = document.createElement("span");
		name.className = "chat-item-name";
		name.textContent = chat.name || "New Chat";
		name.onclick = () => switchChat(chat.id);

		const actions = document.createElement("div");
		actions.className = "chat-item-actions";

		const renameBtn = document.createElement("button");
		renameBtn.textContent = "✏️";
		renameBtn.title = "Rename";
		renameBtn.onclick = (e) => {
			e.stopPropagation();
			openRenameModal(chat.id, chat.name);
		};

		const deleteBtn = document.createElement("button");
		deleteBtn.textContent = "🗑️";
		deleteBtn.title = "Delete";
		deleteBtn.onclick = (e) => {
			e.stopPropagation();
			openDeleteModal(chat.id);
		};

		actions.appendChild(renameBtn);
		actions.appendChild(deleteBtn);
		item.appendChild(name);
		item.appendChild(actions);
		chatList.appendChild(item);
	});
}

async function createNewChat() {
	const ref = await addDoc(collection(db, "users", currentUser.uid, "chats"), {
		name: "New Chat",
		history: [],
		createdAt: serverTimestamp(),
	});
	activeChatId = ref.id;
	renderChatList();
	renderMessages([]);
	chatTitle.textContent = "New Chat";
}

async function switchChat(id) {
	activeChatId = id;
	renderChatList();
	const snap = await getDoc(doc(db, "users", currentUser.uid, "chats", id));
	const data = snap.data();
	chatTitle.textContent = data.name || "New Chat";
	renderMessages(data.history || []);
}

// ===== MESSAGES =====
function renderMessages(history) {
	messagesDiv.innerHTML = "";
	history.forEach((msg) => appendMessage(msg.role, msg.text));
	messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function appendMessage(role, text) {
	const row = document.createElement("div");
	row.className = "message-row " + (role === "user" ? "user" : "ai");

	const avatar = document.createElement("div");
	avatar.className = "avatar " + (role === "user" ? "user" : "ai");
	avatar.textContent = role === "user" ? "👤" : "🤖";

	const msg = document.createElement("div");
	msg.className = "message " + (role === "user" ? "user" : "ai");

	// Render markdown for AI, plain text for user
	if (role === "user") {
		msg.textContent = text;
	} else {
		msg.innerHTML = marked.parse(text);
	}

	row.appendChild(avatar);
	row.appendChild(msg);
	messagesDiv.appendChild(row);
	messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function showTyping() {
	const row = document.createElement("div");
	row.className = "message-row ai";
	row.id = "typing-row";

	const avatar = document.createElement("div");
	avatar.className = "avatar ai";
	avatar.textContent = "🤖";

	const msg = document.createElement("div");
	msg.className = "message ai typing-dots";
	msg.innerHTML = "<span></span><span></span><span></span>";

	row.appendChild(avatar);
	row.appendChild(msg);
	messagesDiv.appendChild(row);
	messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function removeTyping() {
	document.getElementById("typing-row")?.remove();
}

// ===== SEND MESSAGE =====
async function sendMessage() {
	const text = userInput.value.trim();
	if (!text || !activeChatId) return;

	userInput.value = "";
	userInput.style.height = "auto";
	sendBtn.disabled = true;

	const chatRef = doc(db, "users", currentUser.uid, "chats", activeChatId);
	const snap = await getDoc(chatRef);
	let history = snap.data().history || [];

	history.push({ role: "user", text });
	appendMessage("user", text);

	// Auto name the chat after first message
	if (history.length === 1) {
		const newName = text.slice(0, 30) + (text.length > 30 ? "..." : "");
		await updateDoc(chatRef, { name: newName });
		chatTitle.textContent = newName;
	}

	showTyping();

	try {
		const reply = await callGemini(history.slice(0, -1), text);
		removeTyping();
		history.push({ role: "model", text: reply });
		appendMessage("ai", reply);
		await updateDoc(chatRef, { history });
	} catch (err) {
		removeTyping();
		appendMessage("ai", "Error: Could not get a response. Please try again.");
		console.error(err);
	}

	sendBtn.disabled = false;
}

// ===== RENAME MODAL =====
let renameChatId = null;

function openRenameModal(id, currentName) {
	renameChatId = id;
	renameInput.value = currentName || "";
	renameModal.classList.remove("hidden");
	renameInput.focus();
}

document.getElementById("rename-confirm").onclick = async () => {
	const newName = renameInput.value.trim();
	if (!newName || !renameChatId) return;
	await updateDoc(doc(db, "users", currentUser.uid, "chats", renameChatId), { name: newName });
	if (renameChatId === activeChatId) chatTitle.textContent = newName;
	renameModal.classList.add("hidden");
};

document.getElementById("rename-cancel").onclick = () => renameModal.classList.add("hidden");

// ===== DELETE MODAL =====
let deleteChatId = null;

function openDeleteModal(id) {
	deleteChatId = id;
	deleteModal.classList.remove("hidden");
}

document.getElementById("delete-confirm").onclick = async () => {
	if (!deleteChatId) return;
	await deleteDoc(doc(db, "users", currentUser.uid, "chats", deleteChatId));
	if (deleteChatId === activeChatId) {
		activeChatId = null;
		messagesDiv.innerHTML = "";
		chatTitle.textContent = "Select a chat";
	}
	deleteModal.classList.add("hidden");
};

document.getElementById("delete-cancel").onclick = () => deleteModal.classList.add("hidden");

// ===== EVENT LISTENERS =====
document.getElementById("new-chat-btn").onclick = createNewChat;
sendBtn.onclick = sendMessage;

userInput.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});

userInput.addEventListener("input", () => {
	userInput.style.height = "auto";
	userInput.style.height = userInput.scrollHeight + "px";
});
