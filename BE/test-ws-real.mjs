import WebSocket from "ws";

const tourId = "humayun-s-tomb";
const ws = new WebSocket(`ws://127.0.0.1:3000/ws/tour/${tourId}`);

let chunks = [];
let lastSeq = 0;
let totalChunks = 0;

ws.on("open", () => {
  console.log("[connected] Tour:", tourId);
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case "tour_start":
      console.log(`\n[tour_start] ${msg.name}`);
      console.log(`  Spots: ${msg.spots?.length}`);
      console.log(`  Duration: ${msg.estimated_duration_minutes} min`);
      console.log(`  Route: ${msg.spots.map(s => s.name).join(" -> ")}`);
      break;

    case "narration": {
      lastSeq = msg.seq;
      chunks.push(msg.chunk);
      totalChunks++;
      const t = msg.chunk || "";
      if (chunks.length <= 3) {
        console.log(`[narration seq=${msg.seq} spot=${msg.spot_id}] "${t.substring(0, 100)}${t.length > 100 ? '...' : ''}"`);
      } else if (chunks.length === 4) {
        process.stdout.write("  ...");
      } else {
        process.stdout.write(".");
      }
      if (msg.is_final) {
        console.log(` [FINAL]`);
      }
      break;
    }

    case "stop_arrived":
      console.log(`\n[stop_arrived] ${msg.spot_id}`);
      chunks = [];
      break;

    case "tour_complete":
      console.log(`\n[tour_complete] spots_visited=${msg.spots_visited}, interactions=${msg.interaction_count}`);
      break;

    case "ack_interrupt":
      console.log(`[ack_interrupt] id=${msg.interrupt_id}, seq_stopped=${msg.seq_stopped}`);
      break;

    case "response":
      console.log(`[response seq=${msg.seq}] "${(msg.chunk || "").substring(0, 150)}"`);
      break;

    case "error":
      console.log(`[error] code=${msg.code}, message=${msg.message}`);
      break;

    default:
      console.log(`[${msg.type}]`, JSON.stringify(msg).substring(0, 150));
  }
});

ws.on("error", (err) => console.error("[ws error]", err.message));
ws.on("close", (code) => {
  console.log(`\n[closed] code=${code}, total narration chunks received: ${totalChunks}`);
});

// Test sequence:
// t=0:  Connect -> tour_start auto-sent -> narration begins for spot 1
// t=4s: Pause narration
// t=6s: Resume narration
// t=10s: Skip to next spot
// t=15s: End tour

setTimeout(() => {
  console.log("\n\n--- [4s] Sending PAUSE ---");
  ws.send(JSON.stringify({
    type: "interrupt:action",
    id: "test-pause-1",
    action: "pause",
  }));
}, 4000);

setTimeout(() => {
  console.log("\n--- [6s] Sending RESUME ---");
  ws.send(JSON.stringify({
    type: "interrupt:action",
    id: "test-resume-1",
    action: "resume",
  }));
}, 6000);

setTimeout(() => {
  console.log("\n\n--- [10s] Sending SKIP to next spot ---");
  ws.send(JSON.stringify({
    type: "interrupt:action",
    id: "test-skip-1",
    action: "skip",
  }));
}, 10000);

setTimeout(() => {
  console.log("\n\n--- [15s] Ending tour ---");
  ws.send(JSON.stringify({ type: "tour_end" }));
  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, 2000);
}, 15000);
