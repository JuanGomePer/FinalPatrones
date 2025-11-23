import React, { useEffect, useMemo, useState } from "react";

// Puedes cambiar estas URLs si tu backend está en otro host/puerto
const API_BASE =
  import.meta.env.VITE_API_URL || "http://localhost:3000";
const WS_BASE =
  import.meta.env.VITE_WS_URL || "ws://localhost:4000";

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

  // ---- Helpers HTTP ----
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

      // Asumo estructura { token, user: { id, username } }
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
    setAuthToken(null);
    setCurrentUser(null);
    setSelectedRoom(null);
    setMessages([]);
    if (ws) {
      ws.close();
    }
    setWs(null);
  }

  // ---- WebSocket ----

  // Creamos el WS cuando tengamos token
  useEffect(() => {
    if (!authToken) {
      if (ws) ws.close();
      setWs(null);
      setWsStatus("Desconectado");
      return;
    }

    const url = `${WS_BASE}/?token=${encodeURIComponent(authToken)}`;
    const socket = new WebSocket(url);
    setWs(socket);

    socket.onopen = () => {
      setWsStatus("Conectado");
      // Si ya teníamos una sala seleccionada, rejoin:
      if (selectedRoom) {
        socket.send(
          JSON.stringify({ type: "join", roomId: selectedRoom.id })
        );
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

        if (msg.type === "message") {
          const message = msg.data; // viene de tu server: {id, content, created_at, user, ...}

          // Solo mostramos si es de la sala actual
          const roomIdFromMessage = message.room_id || message.roomId;
          if (!selectedRoom || roomIdFromMessage !== selectedRoom.id) {
            return;
          }

          setMessages((prev) => [...prev, message]);
        }
      } catch (e) {
        console.error("Error parseando mensaje WS:", e);
      }
    };

    return () => {
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Si es privada pedimos password
    let password = null;
    if (room.is_private) {
      password = window.prompt("Sala privada, ingresa el password:");
      if (password === null) return;
    }

    try {
      // Validar / entrar a la sala vía API
      await http(`/rooms/${room.id}/join`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });

      setSelectedRoom(room);
      setMessages([]);

      // Historial
      await loadRoomMessages(room.id);

      // Avisar por WS
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

      const msgs = Array.isArray(data)
        ? data
        : data.items || data.messages || [];

      // Ordenar por fecha ascendente
      msgs.sort(
        (a, b) =>
          new Date(a.created_at).getTime() -
          new Date(b.created_at).getTime()
      );

      setMessages(msgs);
    } catch (err) {
      console.error("Error cargando mensajes:", err);
    }
  }

  // ---- Mensajes ----

  async function handleSendMessage(e) {
    e.preventDefault();
    const input = e.target.message;
    const text = input.value.trim();
    if (!text || !selectedRoom) return;

    const clientId =
      (crypto && crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}`;

    try {
      sendWs({
        type: "message",
        roomId: selectedRoom.id,
        content: text,
        clientId,
      });

      // Pintamos optimista
      const fakeMessage = {
        id: clientId,
        room_id: selectedRoom.id,
        content: text,
        created_at: new Date().toISOString(),
        user: currentUser,
      };
      setMessages((prev) => [...prev, fakeMessage]);
      input.value = "";
    } catch (err) {
      alert("No se pudo enviar mensaje: " + err.message);
    }
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
