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

  useEffect(() => {
    const token = sessionStorage.getItem("token");
    const user = sessionStorage.getItem("user");

    if (token) {
      setAuthToken(token);
    }

    if (user) {
      try {
        setCurrentUser(JSON.parse(user)); // <-- Restaurar usuario guardado
      } catch {
        setCurrentUser(null);
      }
    }
  }, []);

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

    // Detect token expiration
    if (res.status === 401) {
      handleLogout(); // <-- Auto logout
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
        if (!r.ok) {
          throw new Error(d.error || "Credenciales inválidas");
        }
        return d;
      });

      sessionStorage.setItem("token", data.token);
      sessionStorage.setItem("user", JSON.stringify(data.user)); // <-- 💾 GUARDAR USER
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
        if (!r.ok) {
          throw new Error(d.error || "Error registrando usuario");
        }
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

  useEffect(() => {
    const stored = sessionStorage.getItem("selectedRoom");
    if (stored && authToken) {
      try {
        const room = JSON.parse(stored);
        setSelectedRoom(room);
        loadRoomMessages(room.id);

        if (ws && ws.readyState === WebSocket.OPEN) {
          sendWs({ type: "join", roomId: room.id });
        }
      } catch {}
    }
  }, [ws, authToken]);

  // Cuando cambia selectedRoom → enviar join al WS si está conectado
  useEffect(() => {
    if (!selectedRoom) return;
    if (!ws) return;

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "join", roomId: selectedRoom.id }));
      console.log("[FRONT → WS] JOIN enviado a room", selectedRoom.id);
    } else {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "join", roomId: selectedRoom.id }));
        console.log(
          "[FRONT → WS] JOIN enviado en onopen a room",
          selectedRoom.id
        );
      };
    }
  }, [selectedRoom, ws]);

  function isTokenExpired(token) {
    try {
      const { exp } = JSON.parse(atob(token.split(".")[1]));
      return Date.now() >= exp * 1000;
    } catch {
      return true;
    }
  }

  useEffect(() => {
    if (!authToken) return;

    if (isTokenExpired(authToken)) {
      handleLogout();
      return;
    }

    const url = `${WS_BASE}/?token=${encodeURIComponent(authToken)}`;
    const socket = new WebSocket(url);
    setWs(socket);

    socket.onopen = () => {
      setWsStatus("Conectado");
      if (selectedRoom) {
        socket.send(JSON.stringify({ type: "join", roomId: selectedRoom.id }));
      }
    };

    socket.onclose = () => {
      setWsStatus("Desconectado");
    };

    socket.onerror = (err) => {
      console.error("WS error:", err);
      setWsStatus("Error en WebSocket");
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "error" && msg.reason === "invalid_token") {
          handleLogout();
          return;
        }

        if (msg.type === "message") {
          const message = msg.data;
          const roomIdFromMessage = message.room_id || message.roomId;
          if (!selectedRoom || roomIdFromMessage !== selectedRoom.id) return;

          setMessages((prev) => [...prev, message]);
        }
      } catch (e) {
        console.error("Error parseando mensaje WS:", e);
      }
    };

    return () => socket.close();
  }, [authToken]);

  function sendWs(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket no está conectado");
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
      sessionStorage.setItem("selectedRoom", JSON.stringify(room)); // <--- SAVE

      setMessages([]);

      await loadRoomMessages(room.id);

      if (ws && ws.readyState === WebSocket.OPEN) {
        sendWs({ type: "join", roomId: room.id });
      }
    } catch (err) {
      alert(err.message);
    }
  }

  async function loadRoomMessages(roomId) {
    try {
      const data = await http(`/rooms/${roomId}/messages?page=1&pageSize=50`);
      console.log("Raw data from API:", data);

      const msgs = Array.isArray(data.messages) ? data.messages : [];

      // Sort by created_at
      msgs.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      console.log("Sorted messages:", msgs);

      // Ensure each message has a user object
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

    // Enviar mensaje al WebSocket con uid
    sendWs({
      type: "message",
      roomId: selectedRoom.id,
      content: text,
      clientId,
      user: { id: currentUser.id, username: currentUser.username }, // <-- enviar uid
    });

    // Renderizado optimista
    setMessages((prev) => [
      ...prev,
      {
        id: clientId,
        room_id: selectedRoom.id,
        content: text,
        created_at: new Date().toISOString(),
        user: { id: currentUser.id, username: currentUser.username },
      },
    ]);

    input.value = "";
  }

  // Cargar salas cuando haya token
  useEffect(() => {
    if (authToken) {
      loadRooms();
    } else {
      setRooms([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  const roomTitle = useMemo(
    () =>
      selectedRoom
        ? `Sala: ${selectedRoom.name}`
        : "Selecciona una sala para empezar a chatear",
    [selectedRoom]
  );

  // ================= UI =================
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
