import asyncio
import websockets
import json

WS_URL = "ws://localhost:4000"  # Adjust if needed

USERS = [
    {"name": "user1", "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJ1c2VybmFtZSI6InVzZXIxIiwiaWF0IjoxNzYzOTIzMjcxLCJleHAiOjE3NjQ1MjgwNzF9.ZF8JK2lmBrqaksy8FUoBpVgeQGa3WBVm7OnwOrqhYaw"},
    {"name": "user2", "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyMjIyMjIyMi0yMjIyLTIyMjItMjIyMi0yMjIyMjIyMjIyMjIiLCJ1c2VybmFtZSI6InVzZXIyIiwiaWF0IjoxNzYzOTIzMjcxLCJleHAiOjE3NjQ1MjgwNzF9.iUOxy1pbfcTBv5ilaWOyZP9IfIC4MgcOJpgb1d8vmok"}
]

ROOM_ID = "YOUR_TEST_ROOM_ID"  # Replace with a valid room id from your DB
MESSAGES = ["Hola!", "¿Cómo estás?", "Test message", "Bye!"]

async def ws_client(user):
    url = f"{WS_URL}/?token={user['token']}"
    async with websockets.connect(url) as ws:
        print(f"{user['name']} connected")

        # Join the room
        await ws.send(json.dumps({"type": "join", "roomId": ROOM_ID}))

        async def send_messages():
            for msg in MESSAGES:
                payload = {
                    "type": "message",
                    "roomId": ROOM_ID,
                    "content": f"{user['name']} says: {msg}"
                }
                await ws.send(json.dumps(payload))
                await asyncio.sleep(0.5)  # small delay

        async def receive_messages(expected_count=len(MESSAGES)*len(USERS)):
            received = 0
            while received < expected_count:
                try:
                    resp = await ws.recv()
                    data = json.loads(resp)
                    if data.get("type") == "message":
                        print(f"[{user['name']} received]: {data['data']}")
                        received += 1
                except websockets.ConnectionClosed:
                    break

        await asyncio.gather(send_messages(), receive_messages())

async def main():
    await asyncio.gather(*(ws_client(user) for user in USERS))

asyncio.run(main())
