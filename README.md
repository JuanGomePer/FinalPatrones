# FinalPatrones

## Requisitos
- Docker & docker-compose
- Node.js >= 18 

## Levantar con Docker Compose
1. Copiar `.env.example` a `.env` y ajustar si quieres.
2. `docker compose up --build`

Servicios:
- API: http://localhost:3000
- WS: ws://localhost:4000?token=JWT
- RabbitMQ management: http://localhost:15672 (guest/guest)

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
