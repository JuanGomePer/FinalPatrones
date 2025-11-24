const { sign } = require("./jwt"); // your JWT module

// Replace with your test users' IDs
const testUsers = [
  { id: "11111111-1111-1111-1111-111111111111", username: "user1" },
  { id: "22222222-2222-2222-2222-222222222222", username: "user2" },
];

// Generate tokens valid for a long time (override EXPIRES_IN)
testUsers.forEach((u) => {
  const token = sign({ sub: u.id, username: u.username });
  console.log(`${u.username} token: ${token}`);
});
