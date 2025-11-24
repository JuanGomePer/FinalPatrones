import React, { useEffect, useMemo, useState } from "react";

// Puedes cambiar estas URLs si tu backend está en otro host/puerto
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";
const WS_BASE = import.meta.env.VITE_WS_URL || "ws://localhost:4000";

function App() {
  const [authToken, setAuthToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginError, setLoginError] = useState("");

  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [messages, setMessages] = useState([]);

  const [ws, setWs] = useState(null);
  const [wsStatus, setWsStatus] = useState("Desconectado");

  const isLoggedIn = !!authToken;

  // 1. Restore Session
  useEffect(() => {
    const token = sessionStorage.getItem("token");
    const user = sessionStorage.getItem("user");

    if (token) setAuthToken(token);
    if (user) {
      try {
        setCurrentUser(JSON.parse(user));
      } catch {
        setCurrentUser(null);
      }
    }
  }, []);

  // 2. HTTP Helper
  async function http(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      handleLogout();
      throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
    }

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const msg = data?.error || data?.message || "Error en la petición";
      throw new Error(msg);
    }

    return data;
  }

  // ---- Auth ----
  async function handleLogin(e) {
    e.preventDefault();
    setLoginError("");

    const username = e.target.username.value.trim();
    const password = e.target.password.value;

    try {
      const data = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      }).then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Credenciales inválidas");
        return d;
      });

      sessionStorage.setItem("token", data.token);
      sessionStorage.setItem("user", JSON.stringify(data.user));
      setAuthToken(data.token);
      setCurrentUser(data.user);
    } catch (err) {
      console.error(err);
      setLoginError(err.message);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setLoginError("");

    const username = e.target.username.value.trim();
    const password = e.target.password.value;

    try {
      await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      }).then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Error registrando usuario");
        return d;
      });

      setLoginError(
        "Usuario creado correctamente, ahora puedes iniciar sesión."
      );
      e.target.reset();
    } catch (err) {
      console.error(err);
      setLoginError(err.message);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem("token");
    setAuthToken(null);
    setCurrentUser(null);
    setSelectedRoom(null);
    setMessages([]);
    if (ws) {
      ws.close();
    }
    setWs(null);
  }

  // =========================================================
  //  CORE WEBSOCKET LOGIC (FIXED)
  // =========================================================

  // EFFECT A: Connect (Only runs when Auth changes)
  useEffect(() => {
    if (!authToken) return;

    const socket = new WebSocket(
      `${WS_BASE}/?token=${encodeURIComponent(authToken)}`
    );
    setWs(socket);

    socket.onopen = () => {
      setWsStatus("Conectado");
    };

    socket.onclose = (event) => {
      setWsStatus("Desconectado");
    };

    socket.onerror = (err) => {
      console.error("[WS] Error:", err);
      setWsStatus("Error en WS");
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "message") {
          setMessages((prev) => {
            // FIX: Prevent duplicates from crashing the browser
            const exists = prev.some(
              (m) =>
                (m.id && m.id === msg.data.id) ||
                (m.id && m.id === msg.data.clientGeneratedId)
            );
            if (exists) return prev;
            return [...prev, msg.data];
          });
        }
      } catch (error) {
        console.error("WS Parse Error");
      }
    };

    return () => {
      socket.close();
    };
  }, [authToken]); // <-- Fixed: Removed selectedRoom dependency

  // EFFECT B: Join Room (Runs when room changes OR socket connects)
  useEffect(() => {
    if (!selectedRoom || !ws) return;

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "join", roomId: selectedRoom.id }));
    }
  }, [selectedRoom, ws, wsStatus]);

  function sendWs(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Avoid throwing error to prevent crash, just warn
      console.warn("WebSocket no está conectado");
      return;
    }
    ws.send(JSON.stringify(payload));
  }

  // ---- Rooms ----

  async function loadRooms() {
    try {
      const data = await http("/rooms");
      setRooms(Array.isArray(data) ? data : data.rooms || []);
    } catch (e) {
      console.error("Error cargando salas:", e);
    }
  }

  // Reload rooms on login
  useEffect(() => {
    if (authToken) loadRooms();
  }, [authToken]);

  async function handleCreateRoom(e) {
    e.preventDefault();
    const form = e.target;
    const name = form.name.value.trim();
    const isPrivate = form.isPrivate.checked;
    const password = form.password.value;

    if (!name) return;

    const body = { name, is_private: isPrivate };
    if (isPrivate && password) {
      body.password = password;
    }

    try {
      await http("/rooms", {
        method: "POST",
        body: JSON.stringify(body),
      });
      form.reset();
      await loadRooms();
    } catch (err) {
      alert(err.message);
    }
  }

  async function joinRoom(room) {
    let password = null;
    if (room.is_private) {
      password = window.prompt("Sala privada, ingresa el password:");
      if (password === null) return;
    }

    try {
      await http(`/rooms/${room.id}/join`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });

      setSelectedRoom(room);
      sessionStorage.setItem("selectedRoom", JSON.stringify(room));
      setMessages([]); // Clear chat

      await loadRoomMessages(room.id);

      // WS Join handled by Effect B
    } catch (err) {
      alert(err.message);
    }
  }

  async function loadRoomMessages(roomId) {
    try {
      const data = await http(`/rooms/${roomId}/messages?page=1&pageSize=50`);
      const msgs = Array.isArray(data.messages) ? data.messages : [];

      msgs.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      const messagesWithUser = msgs.map((m) => ({
        ...m,
        user: m.user || { id: m.user_id, username: m.username || "Unknown" },
      }));

      setMessages(messagesWithUser);
    } catch (err) {
      console.error("Error cargando mensajes:", err);
    }
  }

  // ---- Mensajes ----

  async function handleSendMessage(e) {
    e.preventDefault();
    const input = e.target.message;
    const text = input.value.trim();
    if (!text || !selectedRoom || !currentUser?.id) return;

    const clientId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;

    // Enviar mensaje al WebSocket
    sendWs({
      type: "message",
      roomId: selectedRoom.id,
      content: text,
      clientId,
      user: { id: currentUser.id, username: currentUser.username },
    });

    // Renderizado optimista
    setMessages((prev) => [
      ...prev,
      {
        id: clientId, // Use optimistic ID
        room_id: selectedRoom.id,
        content: text,
        created_at: new Date().toISOString(),
        user: { id: currentUser.id, username: currentUser.username },
      },
    ]);

    input.value = "";
  }

  const roomTitle = useMemo(
    () =>
      selectedRoom
        ? `Sala: ${selectedRoom.name}`
        : "Selecciona una sala para empezar a chatear",
    [selectedRoom]
  );

  // ================= UI (EXACTLY AS REQUESTED) =================
  if (!isLoggedIn) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Chat en tiempo real – Parcial III</h1>
        </header>

        <main className="card auth-layout">
          <section>
            <h2>Iniciar sesión</h2>
            <form onSubmit={handleLogin} className="form">
              <label>
                Usuario
                <input name="username" type="text" required />
              </label>
              <label>
                Contraseña
                <input name="password" type="password" required />
              </label>
              <button type="submit">Entrar</button>
            </form>
          </section>

          <section>
            <h2>Registro rápido</h2>
            <form onSubmit={handleRegister} className="form">
              <label>
                Usuario
                <input name="username" type="text" required />
              </label>
              <label>
                Contraseña
                <input name="password" type="password" required />
              </label>
              <button type="submit">Registrarse</button>
            </form>
          </section>

          {loginError && <p className="error">{loginError}</p>}
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Chat en tiempo real – Parcial III</h1>
        <div className="user-info">
          <span>Conectado como {currentUser?.username}</span>
          <button onClick={handleLogout}>Cerrar sesión</button>
        </div>
      </header>

      <p className="ws-status">Estado WS: {wsStatus}</p>

      <main className="layout">
        {/* Sidebar salas */}
        <aside className="card sidebar">
          <h2>Salas</h2>

          <form onSubmit={handleCreateRoom} className="form small-form">
            <h3>Crear sala</h3>
            <label>
              Nombre
              <input name="name" type="text" required />
            </label>
            <label className="inline">
              <input name="isPrivate" type="checkbox" />
              Sala privada
            </label>
            <label>
              Password (solo si es privada)
              <input name="password" type="password" />
            </label>
            <button type="submit">Crear</button>
          </form>

          <div className="rooms-header">
            <h3>Listado</h3>
            <button type="button" onClick={loadRooms}>
              Refrescar
            </button>
          </div>

          <ul className="rooms-list">
            {rooms.map((room) => (
              <li key={room.id}>
                <span>
                  {room.name}
                  {room.is_private && " 🔒"}
                </span>
                <button type="button" onClick={() => joinRoom(room)}>
                  Entrar
                </button>
              </li>
            ))}
            {rooms.length === 0 && (
              <li className="empty">No hay salas creadas todavía.</li>
            )}
          </ul>
        </aside>

        {/* Chat */}
        <section className="card chat">
          <header className="chat-header">
            <h2>{roomTitle}</h2>
          </header>

          <section className="messages">
            {messages.map((m) => {
              const isSelf =
                m.user && currentUser && m.user.id === currentUser.id;
              const isSystem = m.type === "system";

              return (
                <div
                  key={m.id}
                  className={
                    "message" +
                    (isSelf ? " self" : "") +
                    (isSystem ? " system" : "")
                  }
                >
                  <div className="meta">
                    <span className="time">
                      {new Date(m.created_at).toLocaleTimeString()}
                    </span>
                    {!isSystem && (
                      <span className="user">
                        {" "}
                        · {m.user?.username || "desconocido"}
                      </span>
                    )}
                  </div>
                  <div className="content">{m.content}</div>
                </div>
              );
            })}

            {selectedRoom && messages.length === 0 && (
              <p className="empty">Aún no hay mensajes en esta sala.</p>
            )}
          </section>

          <form className="message-form" onSubmit={handleSendMessage}>
            <input
              name="message"
              type="text"
              placeholder={
                selectedRoom
                  ? "Escribe un mensaje..."
                  : "Selecciona una sala para escribir"
              }
              disabled={!selectedRoom}
              autoComplete="off"
            />
            <button type="submit" disabled={!selectedRoom}>
              Enviar
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

export default App;
