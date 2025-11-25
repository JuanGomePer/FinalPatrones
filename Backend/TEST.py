import asyncio
import json
import time
import websockets

WS_URL = "ws://localhost:4000"
MSG_INTERVAL = 2  # segundos entre mensajes
NUM_MESSAGES = 5   # cuántos mensajes envía cada usuario

# --- Carga JSON ---
with open("rooms_users.json") as f:
    data = json.load(f)

user_tokens = {u["name"]: u["token"] for u in data["users"]}

start_event = asyncio.Event()  # sincroniza inicio de envío

latencies = []  # lista global para latencias

async def ws_client(user, room_id):
    token = user_tokens[user["username"]]
    url = f"{WS_URL}/?token={token}"

    async with websockets.connect(url) as ws:
        await ws.send(json.dumps({"type": "join", "roomId": room_id}))
        print(f"[JOIN] {user['username']} joined room {room_id}")

        await start_event.wait()  # espera a que todos estén listos

        for i in range(NUM_MESSAGES):
            msg_content = f"Message {i+1} from {user['username']}"
            send_time = time.time()
            await ws.send(
                json.dumps({"type": "message", "roomId": room_id, "content": msg_content})
            )
            print(f"[SEND] {user['username']} -> {msg_content} at {send_time:.3f}")

            # Espera a recibir el mismo mensaje de vuelta por el WS (broadcast)
            try:
                while True:
                    raw = await ws.recv()
                    recv_time = time.time()
                    payload = json.loads(raw)
                    if payload.get("type") == "message" and payload["data"]["content"] == msg_content:
                        latency = recv_time - send_time
                        latencies.append(latency)
                        print(f"[RECV] {user['username']} received '{msg_content}' at {recv_time:.3f} | latency: {latency:.3f}s")
                        break
            except websockets.ConnectionClosed:
                print(f"[CLOSE] Connection closed for {user['username']}")
                break

            await asyncio.sleep(MSG_INTERVAL)

async def main():
    tasks = []
    for room in data["rooms"]:
        for user in room["users"]:
            tasks.append(ws_client(user, room["id"]))

    # Lanza todas las tareas bloqueadas esperando evento
    task_group = asyncio.gather(*tasks)

    # Da un momento para que todos se conecten
    await asyncio.sleep(1)
    start_event.set()  # todos empiezan a enviar mensajes simultáneamente

    await task_group

    if latencies:
        avg_latency = sum(latencies) / len(latencies)
        print(f"\n✅ Average latency across all messages: {avg_latency:.3f}s")

if __name__ == "__main__":
    asyncio.run(main())
