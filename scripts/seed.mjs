const BASE = "http://localhost:80/api";

async function api(method, path, body, token, userId) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (userId) headers["x-user-id"] = String(userId);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON from ${method} ${path}: ${text}`);
  }
}

async function register(username, password, name) {
  const existing = await api("POST", "/users/login", { username, password });
  if (existing.token) {
    console.log(`  ↩  ${username} already exists, logging in`);
    return existing;
  }
  return api("POST", "/users/register", { username, password, name });
}

async function addContact(fromId, fromToken, toId) {
  return api("POST", "/contacts", { contactUserId: toId }, fromToken, fromId);
}

async function createSession(userId, token, title, description) {
  return api("POST", "/sessions", { title, description }, token, userId);
}

async function invite(creatorId, creatorToken, sessionId, targetUserId) {
  return api("POST", `/sessions/${sessionId}/invite`, { userId: targetUserId }, creatorToken, creatorId);
}

async function join(userId, token, sessionId) {
  return api("POST", `/sessions/${sessionId}/join`, {}, token, userId);
}

async function sendMessage(userId, token, sessionId, content) {
  return api("POST", `/sessions/${sessionId}/messages`, { content }, token, userId);
}

async function completeSession(userId, token, sessionId) {
  return api("PATCH", `/sessions/${sessionId}`, { status: "completed" }, token, userId);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

console.log("\n🌱  Seeding Intentional Link test data...\n");

console.log("1/5  Creating users...");
const demo  = await register("demo",  "demo123",  "Demo User");
const alice = await register("alice", "alice123", "Alice Chen");
const bob   = await register("bob",   "bob123",   "Bob Martinez");
const carol = await register("carol", "carol123", "Carol Kim");

if (!demo.token)  { console.error("Failed to create demo:",  demo);  process.exit(1); }
if (!alice.token) { console.error("Failed to create alice:", alice); process.exit(1); }
if (!bob.token)   { console.error("Failed to create bob:",   bob);   process.exit(1); }
if (!carol.token) { console.error("Failed to create carol:", carol); process.exit(1); }

const demoId = demo.id, aliceId = alice.id, bobId = bob.id, carolId = carol.id;
console.log(`   demo  (id:${demoId})  alice (id:${aliceId})  bob (id:${bobId})  carol (id:${carolId})`);

console.log("\n2/5  Adding contacts (mutual)...");
await addContact(demoId,  demo.token,  aliceId);
await addContact(demoId,  demo.token,  bobId);
await addContact(demoId,  demo.token,  carolId);
await addContact(aliceId, alice.token, demoId);
await addContact(aliceId, alice.token, bobId);
await addContact(bobId,   bob.token,   demoId);
await addContact(bobId,   bob.token,   aliceId);
await addContact(carolId, carol.token, demoId);
console.log("   Done.");

console.log("\n3/5  Creating sessions with participants...");

const s1 = await createSession(demoId, demo.token, "Morning Check-in", "Daily sync to share blockers and priorities");
await invite(demoId, demo.token, s1.id, aliceId);
await invite(demoId, demo.token, s1.id, bobId);
await join(aliceId, alice.token, s1.id);
await join(bobId,   bob.token,   s1.id);
console.log(`   ✓ "Morning Check-in" (active, id:${s1.id})`);

const s2 = await createSession(demoId, demo.token, "Product Planning", "Q2 roadmap discussion — features and priorities");
await invite(demoId, demo.token, s2.id, bobId);
await join(bobId, bob.token, s2.id);
console.log(`   ✓ "Product Planning" (active, id:${s2.id})`);

const s3 = await createSession(aliceId, alice.token, "Design Feedback", "Review new onboarding flow mockups");
await invite(aliceId, alice.token, s3.id, demoId);
await join(demoId, demo.token, s3.id);
console.log(`   ✓ "Design Feedback" (active, id:${s3.id})`);

const s4 = await createSession(carolId, carol.token, "Catch-up", "Long overdue catch-up!");
await invite(carolId, carol.token, s4.id, demoId);
console.log(`   ✓ "Catch-up" (active, pending invite for demo, id:${s4.id})`);

const s5 = await createSession(demoId, demo.token, "Weekly Sync", "Weekly team check-in");
await invite(demoId, demo.token, s5.id, aliceId);
await join(aliceId, alice.token, s5.id);
console.log(`   ✓ "Weekly Sync" (will complete, id:${s5.id})`);

const s6 = await createSession(demoId, demo.token, "Q1 Review", "Reviewing goals and outcomes from Q1");
await invite(demoId, demo.token, s6.id, carolId);
await join(carolId, carol.token, s6.id);
console.log(`   ✓ "Q1 Review" (will complete, id:${s6.id})`);

console.log("\n4/5  Sending messages...");

await sendMessage(demoId,  demo.token,  s1.id, "Hey everyone — good morning! Quick question before we start: anyone blocked on anything from yesterday?");
await sleep(50);
await sendMessage(aliceId, alice.token, s1.id, "Morning! I'm waiting on design approval for the onboarding screens. Should have it by EOD.");
await sleep(50);
await sendMessage(bobId,   bob.token,   s1.id, "Morning! Nothing blocking me. I'll be finishing the API integration today.");
await sleep(50);
await sendMessage(demoId,  demo.token,  s1.id, "Nice. Alice, who do you need approval from? Can we unblock you faster?");
await sleep(50);
await sendMessage(aliceId, alice.token, s1.id, "Just waiting on the design lead. She said she'd look at it first thing this morning.");
await sleep(50);
await sendMessage(bobId,   bob.token,   s1.id, "I can help review it too if that speeds things up. Just send it over.");
await sleep(50);
await sendMessage(aliceId, alice.token, s1.id, "Thanks Bob! Sending it over now in the design channel.");
await sleep(50);
await sendMessage(demoId,  demo.token,  s1.id, "Great. Let's wrap up — everyone good for the standup at 10?");
await sleep(50);
await sendMessage(bobId,   bob.token,   s1.id, "👍");
await sleep(50);
await sendMessage(aliceId, alice.token, s1.id, "All good!");

await sleep(100);
await sendMessage(demoId, demo.token, s2.id, "Bob, I wanted to get aligned on which features we're prioritizing for Q2. Do you have the list handy?");
await sleep(50);
await sendMessage(bobId,  bob.token,  s2.id, "Yep — top of the list is push notifications, then the search improvements, then offline mode.");
await sleep(50);
await sendMessage(demoId, demo.token, s2.id, "I'd push offline mode lower — it's a big lift. What about the contacts redesign?");
await sleep(50);
await sendMessage(bobId,  bob.token,  s2.id, "Contacts is scoped small, we could knock it out early and it'll improve daily use a lot.");
await sleep(50);
await sendMessage(demoId, demo.token, s2.id, "Agreed. Let's lock in: notifications → contacts → search → offline. I'll update the roadmap doc.");
await sleep(50);
await sendMessage(bobId,  bob.token,  s2.id, "Perfect. I'll start the notification spike this week.");

await sleep(100);
await sendMessage(aliceId, alice.token, s3.id, "Thanks for jumping in on this! I've been iterating on the onboarding flow and want fresh eyes.");
await sleep(50);
await sendMessage(demoId,  demo.token,  s3.id, "Happy to help. Share the screens and I'll give honest feedback.");
await sleep(50);
await sendMessage(aliceId, alice.token, s3.id, "The big question is: should step 3 ask for contact permissions upfront or defer until they try to invite someone?");
await sleep(50);
await sendMessage(demoId,  demo.token,  s3.id, "Defer it. Asking for permissions before they see value creates drop-off. Wait until the first invite.");
await sleep(50);
await sendMessage(aliceId, alice.token, s3.id, "That's what I was thinking too. I'll update the flow. Anything else stand out?");
await sleep(50);
await sendMessage(demoId,  demo.token,  s3.id, "The welcome screen copy is a bit generic. Lead with the core value — intentional communication. Make it feel different.");
await sleep(50);
await sendMessage(aliceId, alice.token, s3.id, "Yes! Working on new copy with the writer now. This was really helpful, thank you.");

await sleep(100);
await sendMessage(demoId,  demo.token,  s5.id, "Hey Alice — let's do our weekly sync. How's the onboarding going overall?");
await sleep(50);
await sendMessage(aliceId, alice.token, s5.id, "Really well! Got design approval, dev is underway. We're on track for the sprint goal.");
await sleep(50);
await sendMessage(demoId,  demo.token,  s5.id, "Excellent. Anything I can do to support from my end?");
await sleep(50);
await sendMessage(aliceId, alice.token, s5.id, "Just keep the stakeholders updated — they keep pinging me for progress. Maybe a quick email?");
await sleep(50);
await sendMessage(demoId,  demo.token,  s5.id, "On it. I'll send an update tonight. Great work this week.");
await sleep(50);
await sendMessage(aliceId, alice.token, s5.id, "Thanks! Have a good weekend.");
await sleep(50);
await sendMessage(demoId,  demo.token,  s5.id, "You too! Marking this one done.");

await sleep(100);
await sendMessage(demoId,  demo.token,  s6.id, "Carol, wanted to do a proper Q1 review. Overall — I think the quarter went well despite the late start.");
await sleep(50);
await sendMessage(carolId, carol.token, s6.id, "Agreed! We shipped 3 of the 4 targets. The one we missed was scope-creep — should've caught it earlier.");
await sleep(50);
await sendMessage(demoId,  demo.token,  s6.id, "Totally. For Q2 I want to add scope check-ins mid-sprint. What do you think?");
await sleep(50);
await sendMessage(carolId, carol.token, s6.id, "Love it. Weekly 15-min scope check would've saved us 2 weeks of rework.");
await sleep(50);
await sendMessage(demoId,  demo.token,  s6.id, "Let's make it official. I'll add it to the team process doc. Great work this quarter Carol.");
await sleep(50);
await sendMessage(carolId, carol.token, s6.id, "Thanks! Excited for Q2. Lots of good stuff coming.");

console.log("   Done.");

console.log("\n5/5  Completing old sessions...");
await completeSession(demoId, demo.token, s5.id);
console.log(`   ✓ "Weekly Sync" marked complete`);
await completeSession(demoId, demo.token, s6.id);
console.log(`   ✓ "Q1 Review" marked complete`);

console.log(`
✅  Seed complete!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TEST ACCOUNT
  Username : demo
  Password : demo123
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  What you'll see when logged in as demo:
  • 3 active sessions (Morning Check-in, Product Planning, Design Feedback)
  • 1 pending invite  (Catch-up from Carol — shows badge on Sessions tab)
  • 2 completed sessions (Weekly Sync, Q1 Review)
  • 3 contacts: Alice Chen, Bob Martinez, Carol Kim
  • Full message history in every session

  Other accounts (all pass = username + "123"):
  • alice / alice123
  • bob   / bob123
  • carol / carol123
`);
