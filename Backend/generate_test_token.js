const fetch = require("node-fetch");
const fs = require("fs");
const { sign } = require("./src/utils/jwt"); // tu módulo JWT
const API_URL = "http://localhost:3000"; // Ajusta si tu API está en otra URL

const NUM_USERS = 40;
const NUM_ROOMS = 10;
const USERS_PER_ROOM = 4;
const CREATOR_USERNAME = "load_user_1";
const CREATOR_PASSWORD = "123456";

// Helper para POST JSON
async function post(url, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(
      `POST ${url} failed: ${resp.status} ${err.error || resp.statusText}`
    );
  }
  return resp.json();
}

// --- Crear o login del creator ---
async function ensureCreator() {
  try {
    const loginResp = await post(`${API_URL}/auth/login`, {
      username: CREATOR_USERNAME,
      password: CREATOR_PASSWORD,
    });
    console.log(`[Info] Creator ${CREATOR_USERNAME} exists.`);
    return loginResp.token;
  } catch {
    const newUser = await post(`${API_URL}/auth/register`, {
      username: CREATOR_USERNAME,
      password: CREATOR_PASSWORD,
    });
    console.log(`[Info] Creator ${CREATOR_USERNAME} created.`);
    return sign({ sub: newUser.id, username: newUser.username });
  }
}

// --- Crear todos los usuarios de prueba ---
async function createUsers() {
  const users = [];
  for (let i = 1; i <= NUM_USERS; i++) {
    const username = `load_user_${i}`;
    try {
      const user = await post(`${API_URL}/auth/register`, {
        username,
        password: "123456",
      });
      users.push(user);
    } catch (err) {
      // Si ya existe, hacemos login
      const login = await post(`${API_URL}/auth/login`, {
        username,
        password: "123456",
      });
      users.push({ id: login.user.id, username });
    }
  }
  return users;
}

// --- Crear rooms ---
async function createRooms(creatorToken) {
  const rooms = [];
  for (let i = 1; i <= NUM_ROOMS; i++) {
    const is_private = i % 2 === 0;
    const roomConfig = {
      name: `Load_Room_${i}`,
      is_private,
      password: is_private ? "secret" : null,
    };

    try {
      const newRoom = await post(`${API_URL}/rooms`, roomConfig, creatorToken);
      rooms.push({ id: newRoom.id, name: newRoom.name, users: [] });
      console.log(`[Success] Created Room ${i}: ${newRoom.name}`);
    } catch (err) {
      console.error(
        `[Error] Could not create room ${roomConfig.name}: ${err.message}`
      );
    }
  }
  return rooms;
}

// --- Asignar usuarios a rooms ---
function assignUsersToRooms(users, rooms) {
  let userIndex = 0;
  for (const room of rooms) {
    room.users = [];
    for (let i = 0; i < USERS_PER_ROOM; i++) {
      if (userIndex >= users.length) break;
      room.users.push(users[userIndex]);
      userIndex++;
    }
  }
}

// --- Main ---
(async () => {
  try {
    const creatorToken = await ensureCreator();
    const allUsers = await createUsers();
    const allRooms = await createRooms(creatorToken);

    // Asignar usuarios a rooms
    assignUsersToRooms(allUsers, allRooms);

    // Crear JSON para Python
    const dataToWrite = {
      users: allUsers.map((u) => ({
        name: u.username,
        token: sign({ sub: u.id, username: u.username }),
      })),
      rooms: allRooms,
    };
    fs.writeFileSync("rooms_users.json", JSON.stringify(dataToWrite, null, 2));
    console.log("[Info] rooms_users.json file created successfully.");
  } catch (err) {
    console.error("[Fatal] Script failed:", err);
  }
})();
