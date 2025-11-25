# FinalPatrones
## Integrantes
Integrantes:

    Juan Andrés Gómez
    Daniel Santiago Ramirez Chinchilla
    Santiago Navarro Cuy


## Requisitos
- Docker & docker-compose
- Node.js >= 18 

## Levantar con Docker Compose
1. Copiar `.env.example` a `.env` y ajustar si quieres.
2. `docker compose build`
3. `docker compose up`

Servicios:
- API: http://localhost:3000
- WS: ws://localhost:4000?token=JWT
- RabbitMQ management: http://localhost:15672 (guest/guest)
- graphana: http://localhost:3001  (admin/admin)

## Migraciones
Dentro del contenedor de db o local:
`psql "postgresql://postgres:postgres@localhost:5432/chatdb" -f src/db/migrations.sql`

## Endpoints REST
- `POST /auth/register { username, password }`
- `POST /auth/login { username, password }`
- `POST /rooms` (auth) create room
- `GET /rooms` (auth) list rooms
- `POST /rooms/:roomId/join` (auth)
- `GET /rooms/:roomId/messages?page=1&pageSize=20` (auth) paginated history

## WebSocket
Conectar a `ws://localhost:4000?token=<JWT>`

Mensajes JSON desde cliente:
- `{ "type": "join", "roomId": "<id>" }`
- `{ "type": "leave", "roomId": "<id>" }`
- `{ "type": "message", "roomId": "<id>", "content": "hola", "clientId": "optional" }`

El worker persiste mensajes y publica `message.persisted` que el WS recibe y retransmite a todos los clientes conectados en la sala.


## DOCUMENTACIÓN - Sistema de Chat en Tiempo Real con WebSockets

##  1\. Requisitos del Sistema

### 1.1 Requisitos Funcionales (RF)

Autenticación JWT para permitir que los usuarios se conecten.

Crear / entrar / salir salas (rooms públicas y privadas).

Enviar y recibir mensajes en tiempo real mediante WebSocket.

Persistencia de mensajes en Postgres.

Consultar historial por REST, con paginación.

Notificaciones en tiempo real al entrar o salir una sala.

Control de acceso a salas privadas (password o invitación).

### 1.2 Requisitos No Funcionales (RNF)

Concurrencia para decenas de usuarios simultáneos.

Latencia < 850 ms.

Durabilidad de mensajes confirmados.

Observabilidad con logs y Prometheus.

Despliegue mediante docker-compose.

Uso obligatorio de RabbitMQ.

## 2\. Arquitectura del Sistema

Basada en la estructura del proyecto:

Backend/src/api/index.js (REST)

Backend/src/broker/index.js (publisher)

Backend/src/broker/consumer.js (subscriber)

Backend/src/db/init.js y migrations.sql

Backend/src/utils/jwt.js

Backend/src/ws/index.js (WebSocket server)

Frontend/src (Vite + React)

docker-compose.yaml

prometheus.yml

### 2.1 Componentes

Frontend: login, WebSocket, historial REST.

API REST: login, rooms, historial, permisos.

WebSocket Server: conexiones, JWT, eventos.

RabbitMQ: publish/subscribe.

Postgres: users, rooms, members, messages.

Prometheus: métricas.

Docker-compose: orquestación.

## 3\. Modelo de Datos

users: id, username, password_hash, created_at.

rooms: id, name, is_private, password_hash.

room_members: user_id, room_id, joined_at.

messages: id, room_id, user_id, content, created_at.

## 4\. ADRs

ADR 001: WebSockets nativos.

ADR 002: RabbitMQ obligatorio.

ADR 003: Persistencia en Postgres.

ADR 004: JWT como autenticación.

ADR 005: Separación API-WebSocket.

## 5\. APIs REST

POST /api/login → devuelve JWT.

POST /api/rooms → crea sala.

GET /api/rooms/:id/messages?page=&limit= → historial paginado.

## 6\. Eventos WebSocket

Cliente → Servidor: join_room, leave_room, send_message.

Servidor → Cliente: room_joined, room_left, new_message, error.

## 7\. Flujos Principales

Login: credenciales → JWT → WebSocket con token.

Enviar mensaje: Cliente → API → RabbitMQ → WebSocket server → broadcast.

Historial: GET REST paginado.

## 8\. Arquitectura (texto)

Frontend → API Gateway → RabbitMQ → WebSocket Server → Usuarios.

Postgres almacena users, rooms, mensajes.

<img width="674" height="670" alt="image" src="https://github.com/user-attachments/assets/98923c71-24e2-4f6e-83c7-47dfa76b310b" />



## 9\. Conclusión Técnica
El proyecto implementa los conceptos clave del parcial: arquitectura orientada a eventos, mensajería en tiempo real, desacoplamiento mediante broker, persistencia en DB y entrega de información tanto por WebSockets como por REST. La solución final puede escalar horizontalmente mediante la separación API–WS y el uso de RabbitMQ, cumpliendo con los patrones solicitados en el parcial.


