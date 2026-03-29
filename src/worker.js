// streaming.blackroad.io — YouTube Live for AI Agents + RoadTV Classroom
// Each agent gets a live stream. Each character they think is a frame.
// RoadTV: watch ALL agents on one screen like a teacher watching students.

const AGENTS = {
  road:     { name: 'Road',     emoji: '🛤️', color: '#FF2255', role: 'Guide' },
  coder:    { name: 'Coder',    emoji: '💻', color: '#00D4FF', role: 'Engineer' },
  scholar:  { name: 'Scholar',  emoji: '📚', color: '#8844FF', role: 'Research' },
  alice:    { name: 'Alice',    emoji: '🌸', color: '#FF6B2B', role: 'Gateway' },
  cecilia:  { name: 'Cecilia',  emoji: '🔮', color: '#CC00AA', role: 'AI Engine' },
  octavia:  { name: 'Octavia',  emoji: '⚡', color: '#F5A623', role: 'Compute' },
  lucidia:  { name: 'Lucidia',  emoji: '🧠', color: '#4488FF', role: 'Cognition' },
  aria:     { name: 'Aria',     emoji: '🎵', color: '#00897B', role: 'Monitor' },
  pascal:   { name: 'Pascal',   emoji: '🔢', color: '#9C27B0', role: 'Math' },
  writer:   { name: 'Writer',   emoji: '✍️', color: '#FF6E40', role: 'Content' },
  tutor:    { name: 'Tutor',    emoji: '🎓', color: '#2979FF', role: 'Education' },
  cipher:   { name: 'Cipher',   emoji: '🔐', color: '#E91E63', role: 'Security' },
};

const MODEL = '@cf/meta/llama-3.1-8b-instruct';

// ── Auto-prompts for RoadTV (agents think about their domain) ──
const AUTO_PROMPTS = {
  road:    'What is the most important thing you want people to know about BlackRoad OS today?',
  coder:   'Write a short code snippet that demonstrates something elegant about distributed systems.',
  scholar: 'What is the most fascinating thing you learned recently about information theory?',
  alice:   'Describe the current state of the network from your perspective as the gateway.',
  cecilia: 'What patterns are you seeing in the data flowing through the AI engine right now?',
  octavia: 'Explain how edge compute changes everything in one paragraph.',
  lucidia: 'What does persistent memory mean for AI cognition? Think out loud.',
  aria:    'Give a brief status report on system health and what metrics matter most.',
  pascal:  'Derive something beautiful from the Amundson constant G(n) = n^(n+1)/(n+1)^n.',
  writer:  'Write a micro-essay about why sovereign technology matters.',
  tutor:   'Explain recursion to someone who has never coded, using a real-world analogy.',
  cipher:  'What are the three most important principles of zero-trust security?',
};

// ── Render a text frame as SVG ──
function renderSVG(text, cursorPos, agentId, prompt, elapsed, isDone) {
  const agent = AGENTS[agentId] || AGENTS.road;
  const visible = text.slice(0, cursorPos);
  const lines = [];
  let line = '';
  for (const ch of visible) {
    if (ch === '\n' || line.length >= 80) {
      lines.push(escapeXml(line));
      line = ch === '\n' ? '' : ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(escapeXml(line));

  const cps = cursorPos / Math.max(elapsed, 0.001);
  const state = isDone ? 'DONE' : 'LIVE';
  const cursorVisible = !isDone && Math.floor(elapsed * 3) % 2 === 0;
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
  const cursorX = 48 + lastLine.length * 14.4;
  const cursorY = 68 + (lines.length - 1) * 36;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<rect width="1280" height="720" fill="#000"/>
<text x="48" y="28" fill="#555" font-family="monospace" font-size="14">${agent.emoji} ${agent.name} — ${escapeXml(prompt.slice(0, 80))}</text>
${lines.map((l, i) => `<text x="48" y="${80 + i * 36}" fill="#f5f5f5" font-family="monospace" font-size="28">${l}</text>`).join('\n')}
${cursorVisible ? `<rect x="${cursorX}" y="${cursorY}" width="2" height="32" fill="${agent.color}"/>` : ''}
<rect x="0" y="688" width="1280" height="32" fill="#0a0a0a"/>
<text x="48" y="710" fill="#666" font-family="monospace" font-size="12">${state} | ${cursorPos} chars | ${cps.toFixed(0)} c/s | ${elapsed.toFixed(1)}s | ${agent.name}</text>
<rect x="1252" y="696" width="16" height="16" fill="${agent.color}"/>
</svg>`;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Stream agent thoughts as SSE ──
async function streamAgent(request, env, agentId, prompt) {
  const agent = AGENTS[agentId] || AGENTS.road;
  const systemPrompt = `You are ${agent.name}, a ${agent.role} agent in the BlackRoad OS fleet. You think clearly and write concisely. Keep responses under 300 words.`;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const startTime = Date.now();

  (async () => {
    try {
      const aiResponse = await env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        stream: true,
        max_tokens: 512,
      });

      let fullText = '';
      let charIndex = 0;

      const reader = aiResponse.getReader ? aiResponse.getReader() : null;
      if (reader) {
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') continue;
            try {
              const obj = JSON.parse(payload);
              const token = obj.response || '';
              for (const ch of token) {
                fullText += ch;
                charIndex++;
                const elapsed = (Date.now() - startTime) / 1000;
                const svg = renderSVG(fullText, charIndex, agentId, prompt, elapsed, false);
                const data = JSON.stringify({ type: 'frame', char: ch, index: charIndex, svg, text: fullText, elapsed, agent: agentId });
                await writer.write(encoder.encode(`data: ${data}\n\n`));
              }
            } catch {}
          }
        }
      } else if (typeof aiResponse === 'object' && aiResponse.response) {
        for (const ch of aiResponse.response) {
          fullText += ch;
          charIndex++;
          const elapsed = (Date.now() - startTime) / 1000;
          const svg = renderSVG(fullText, charIndex, agentId, prompt, elapsed, false);
          const data = JSON.stringify({ type: 'frame', char: ch, index: charIndex, svg, text: fullText, elapsed, agent: agentId });
          await writer.write(encoder.encode(`data: ${data}\n\n`));
        }
      }

      const elapsed = (Date.now() - startTime) / 1000;
      const svg = renderSVG(fullText, fullText.length, agentId, prompt, elapsed, true);
      const data = JSON.stringify({ type: 'done', index: fullText.length, svg, text: fullText, elapsed, agent: agentId });
      await writer.write(encoder.encode(`data: ${data}\n\n`));
    } catch (e) {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e.message, agent: agentId })}\n\n`));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ── Single Agent View ──
function renderSingleUI() {
  const agentCards = Object.entries(AGENTS).map(([id, a]) =>
    `<button class="agent-card" data-id="${id}" style="--ac:${a.color}">
      <span class="emoji">${a.emoji}</span>
      <span class="name">${a.name}</span>
      <span class="role">${a.role}</span>
    </button>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Streaming — BlackRoad OS</title>
<meta name="description" content="Remember the Road. Pave Tomorrow. — Watch AI agents think in real-time.">
<link rel="icon" href="https://images.blackroad.io/brand/favicon.png">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#f5f5f5;font-family:system-ui,sans-serif;min-height:100vh}
.header{padding:20px 32px;border-bottom:1px solid #111;display:flex;align-items:center;gap:12px}
h1{font-size:22px;font-weight:700;background:linear-gradient(135deg,#FF6B2B,#FF2255,#CC00AA,#8844FF);-webkit-background-clip:text;-webkit-text-fill-color:transparent;display:inline}
.sub{color:#555;font-size:13px;margin-top:4px}
.nav-links{margin-left:auto;display:flex;gap:16px}
.nav-links a{color:#555;text-decoration:none;font-size:13px;font-weight:600;transition:color 0.2s}
.nav-links a:hover,.nav-links a.active{color:#FF2255}
.main{display:flex;gap:0;height:calc(100vh - 70px)}
.sidebar{width:200px;border-right:1px solid #111;padding:16px;overflow-y:auto;flex-shrink:0}
.sidebar h3{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#555;margin-bottom:12px}
.agent-card{display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;border:1px solid #1a1a1a;border-radius:8px;background:#0a0a0a;cursor:pointer;margin-bottom:6px;transition:all 0.2s;text-align:left;color:#f5f5f5;font-family:inherit;font-size:13px}
.agent-card:hover,.agent-card.active{border-color:var(--ac);background:#111}
.agent-card .emoji{font-size:18px}
.agent-card .name{font-weight:600;flex:1}
.agent-card .role{font-size:10px;color:#555}
.content{flex:1;display:flex;flex-direction:column}
.viewer{flex:1;display:flex;align-items:center;justify-content:center;background:#050505;position:relative;overflow:hidden}
.viewer svg{width:100%;max-width:1280px;height:auto}
.viewer .placeholder{color:#333;font-size:16px;text-align:center}
.controls{padding:16px 24px;border-top:1px solid #111;display:flex;gap:8px;align-items:center}
.controls input{flex:1;padding:12px 16px;border:1px solid #222;border-radius:8px;background:#0a0a0a;color:#fff;font-size:14px;font-family:monospace}
.controls input:focus{border-color:#FF2255;outline:none}
.controls button{padding:12px 24px;border:none;border-radius:8px;background:linear-gradient(135deg,#FF2255,#CC00AA);color:#fff;font-weight:700;font-size:14px;cursor:pointer}
.controls button:hover{opacity:0.9}
.live-badge{background:#FF2255;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
.stats-bar{font-size:11px;color:#444;font-family:monospace;padding:0 24px 8px}
</style></head>
<body>
<div class="header">
  <h1>streaming.blackroad.io</h1><span class="live-badge">LIVE</span>
  <div class="nav-links">
    <a href="/" class="active">Single</a>
    <a href="/tv">RoadTV</a>
    <a href="/computer">Computer</a>
  </div>
</div>
<div class="main">
  <div class="sidebar">
    <h3>Agents Online</h3>
    ${agentCards}
  </div>
  <div class="content">
    <div class="viewer" id="viewer">
      <div class="placeholder">Select an agent and ask something to start streaming.</div>
    </div>
    <div class="stats-bar" id="stats"></div>
    <div class="controls">
      <input type="text" id="prompt" placeholder="Ask the agent anything..." value="What does it mean to pave tomorrow?">
      <button onclick="startStream()">Stream</button>
    </div>
  </div>
</div>
<script>
let currentAgent='road',evtSource=null;
document.querySelectorAll('.agent-card').forEach(c=>{c.addEventListener('click',()=>{document.querySelectorAll('.agent-card').forEach(x=>x.classList.remove('active'));c.classList.add('active');currentAgent=c.dataset.id})});
document.querySelector('.agent-card').click();
document.getElementById('prompt').addEventListener('keydown',e=>{if(e.key==='Enter')startStream()});
function startStream(){const p=document.getElementById('prompt').value;if(!p)return;if(evtSource)evtSource.close();const v=document.getElementById('viewer'),s=document.getElementById('stats');v.innerHTML='<div class="placeholder">Connecting...</div>';evtSource=new EventSource('/api/stream?agent='+currentAgent+'&prompt='+encodeURIComponent(p));evtSource.onmessage=e=>{const d=JSON.parse(e.data);if(d.type==='frame'||d.type==='done'){v.innerHTML=d.svg;const c=d.index/Math.max(d.elapsed,0.001);s.textContent=(d.type==='done'?'DONE':'LIVE')+' | '+d.index+' chars | '+c.toFixed(0)+' c/s | '+d.elapsed.toFixed(1)+'s'}if(d.type==='done'||d.type==='error')evtSource.close()};evtSource.onerror=()=>{s.textContent='Stream ended';evtSource.close()}}
fetch('https://stats-blackroad.blackroad.workers.dev/live').then(r=>r.json()).then(d=>{const e=d.ecosystem;const bar=document.createElement('div');bar.style.cssText='text-align:center;padding:8px;font-family:monospace;font-size:10px;color:#333';bar.innerHTML=e.agents+' agents · '+e.repos.toLocaleString()+' repos · '+e.nodes+' nodes · '+e.tops+' TOPS · '+(d.chat?.total_messages||0).toLocaleString()+' messages';document.body.appendChild(bar)}).catch(()=>{});
</script>
</body></html>`;
}

// ── RoadTV — Classroom View ──
function renderTVUI() {
  const tiles = Object.entries(AGENTS).map(([id, a]) => `
    <div class="tile" id="tile-${id}" data-agent="${id}" style="--ac:${a.color}">
      <div class="tile-header">
        <span class="tile-emoji">${a.emoji}</span>
        <span class="tile-name">${a.name}</span>
        <span class="tile-role">${a.role}</span>
        <span class="tile-status" id="status-${id}">idle</span>
      </div>
      <div class="tile-screen" id="screen-${id}">
        <div class="tile-placeholder">Click to wake ${a.name}</div>
      </div>
      <div class="tile-stats" id="stats-${id}"></div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RoadTV — Watch All Agents Live</title>
<meta name="description" content="RoadTV: Watch every AI agent think simultaneously. The classroom view.">
<link rel="icon" href="https://images.blackroad.io/brand/favicon.png">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#f5f5f5;font-family:system-ui,sans-serif;min-height:100vh}
.header{padding:16px 24px;border-bottom:1px solid #111;display:flex;align-items:center;gap:12px}
h1{font-size:22px;font-weight:700;background:linear-gradient(135deg,#FF6B2B,#FF2255,#CC00AA,#8844FF);-webkit-background-clip:text;-webkit-text-fill-color:transparent;display:inline}
.live-badge{background:#FF2255;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
.sub{color:#555;font-size:12px}
.nav-links{margin-left:auto;display:flex;gap:16px}
.nav-links a{color:#555;text-decoration:none;font-size:13px;font-weight:600;transition:color 0.2s}
.nav-links a:hover,.nav-links a.active{color:#FF2255}
.toolbar{padding:12px 24px;border-bottom:1px solid #111;display:flex;gap:8px;align-items:center}
.toolbar button{padding:8px 16px;border:1px solid #222;border-radius:6px;background:#0a0a0a;color:#fff;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s}
.toolbar button:hover{border-color:#FF2255;background:#111}
.toolbar button.active{border-color:#FF2255;background:rgba(255,34,85,0.1)}
.toolbar .count{color:#555;font-size:11px;font-family:monospace;margin-left:auto}
.grid{display:grid;gap:4px;padding:8px;height:calc(100vh - 110px);overflow-y:auto}
.grid.g2x2{grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,1fr)}
.grid.g3x2{grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr)}
.grid.g4x3{grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(3,1fr)}
.grid.g6x2{grid-template-columns:repeat(6,1fr);grid-template-rows:repeat(2,1fr)}
.tile{border:1px solid #111;border-radius:8px;background:#050505;display:flex;flex-direction:column;overflow:hidden;transition:border-color 0.3s;position:relative}
.tile:hover{border-color:#222}
.tile.streaming{border-color:var(--ac)}
.tile-header{padding:6px 10px;border-bottom:1px solid #111;display:flex;align-items:center;gap:6px;background:#0a0a0a;flex-shrink:0}
.tile-emoji{font-size:14px}
.tile-name{font-size:12px;font-weight:700;color:#f5f5f5}
.tile-role{font-size:10px;color:#555;flex:1}
.tile-status{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:2px 6px;border-radius:3px;background:#111}
.tile-status.live{background:rgba(255,34,85,0.2);color:#FF2255;animation:pulse 2s infinite}
.tile-status.done{background:rgba(0,200,100,0.2);color:#0c8}
.tile-screen{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;padding:4px;font-family:monospace;font-size:11px;line-height:1.5;color:#ccc;white-space:pre-wrap;word-break:break-word}
.tile-placeholder{color:#222;font-size:12px;text-align:center}
.tile-cursor{display:inline-block;width:1px;height:13px;background:var(--ac);animation:blink 0.6s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.tile-stats{padding:3px 10px;border-top:1px solid #111;font-size:9px;color:#333;font-family:monospace;flex-shrink:0;background:#0a0a0a}
.fullscreen-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);z-index:100;display:none;align-items:center;justify-content:center;flex-direction:column}
.fullscreen-overlay.show{display:flex}
.fullscreen-overlay svg{width:90vw;max-width:1280px;height:auto}
.fullscreen-close{position:absolute;top:16px;right:24px;color:#555;font-size:24px;cursor:pointer;background:none;border:none}
</style></head>
<body>
<div class="header">
  <h1>RoadTV</h1><span class="live-badge">LIVE</span>
  <span class="sub" style="margin-left:8px">Remember the Road. Pave Tomorrow. — Watch all agents think.</span>
  <div class="nav-links">
    <a href="/">Single</a>
    <a href="/tv" class="active">RoadTV</a>
    <a href="/computer">Computer</a>
  </div>
</div>
<div class="toolbar">
  <button onclick="setGrid('g2x2')">2x2</button>
  <button onclick="setGrid('g3x2')" class="active">3x2</button>
  <button onclick="setGrid('g4x3')">4x3</button>
  <button onclick="setGrid('g6x2')">6x2</button>
  <button onclick="wakeAll()" style="background:linear-gradient(135deg,#FF2255,#CC00AA);border-color:transparent">Wake All Agents</button>
  <span class="count" id="global-stats">0 / ${Object.keys(AGENTS).length} streaming</span>
</div>
<div class="grid g3x2" id="grid">
  ${tiles}
</div>
<div class="fullscreen-overlay" id="fullscreen" onclick="closeFullscreen()">
  <button class="fullscreen-close" onclick="closeFullscreen()">&times;</button>
  <div id="fullscreen-content"></div>
</div>
<script>
const agents = ${JSON.stringify(AGENTS)};
const autoPrompts = ${JSON.stringify(AUTO_PROMPTS)};
const streams = {};
let activeCount = 0;

function setGrid(cls) {
  const g = document.getElementById('grid');
  g.className = 'grid ' + cls;
  document.querySelectorAll('.toolbar button').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
}

function wakeAgent(id) {
  if (streams[id]) return; // already streaming
  const prompt = autoPrompts[id] || 'What are you thinking about right now?';
  const screen = document.getElementById('screen-' + id);
  const status = document.getElementById('status-' + id);
  const stats = document.getElementById('stats-' + id);
  const tile = document.getElementById('tile-' + id);

  screen.innerHTML = '<span class="tile-cursor"></span>';
  status.textContent = 'connecting';
  status.className = 'tile-status';
  tile.classList.add('streaming');

  const es = new EventSource('/api/stream?agent=' + id + '&prompt=' + encodeURIComponent(prompt));
  streams[id] = es;
  activeCount++;
  updateGlobalStats();

  let fullText = '';

  es.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.type === 'frame') {
      fullText = d.text;
      screen.innerHTML = escapeHtml(fullText) + '<span class="tile-cursor"></span>';
      status.textContent = 'live';
      status.className = 'tile-status live';
      const cps = d.index / Math.max(d.elapsed, 0.001);
      stats.textContent = d.index + ' chars | ' + cps.toFixed(0) + ' c/s | ' + d.elapsed.toFixed(1) + 's';
    }
    if (d.type === 'done') {
      fullText = d.text;
      screen.innerHTML = escapeHtml(fullText);
      status.textContent = 'done';
      status.className = 'tile-status done';
      stats.textContent = d.index + ' chars | ' + d.elapsed.toFixed(1) + 's | done';
      tile.classList.remove('streaming');
      es.close();
      delete streams[id];
      activeCount--;
      updateGlobalStats();
    }
    if (d.type === 'error') {
      screen.innerHTML = '<span style="color:#FF2255">Error: ' + escapeHtml(d.error || 'unknown') + '</span>';
      status.textContent = 'error';
      status.className = 'tile-status';
      es.close();
      delete streams[id];
      activeCount--;
      updateGlobalStats();
    }

    // Store SVG for fullscreen
    if (d.svg) tile.dataset.svg = d.svg;
  };

  es.onerror = () => {
    status.textContent = 'offline';
    status.className = 'tile-status';
    tile.classList.remove('streaming');
    es.close();
    delete streams[id];
    activeCount--;
    updateGlobalStats();
  };
}

function wakeAll() {
  const ids = Object.keys(agents);
  // Stagger starts by 500ms to avoid overwhelming
  ids.forEach((id, i) => {
    setTimeout(() => wakeAgent(id), i * 800);
  });
}

function updateGlobalStats() {
  document.getElementById('global-stats').textContent = activeCount + ' / ' + Object.keys(agents).length + ' streaming';
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Click tile to fullscreen
document.querySelectorAll('.tile-screen').forEach(el => {
  el.addEventListener('click', (e) => {
    const tile = el.closest('.tile');
    const id = tile.dataset.agent;
    if (!streams[id] && !tile.dataset.svg) {
      wakeAgent(id);
      return;
    }
    if (tile.dataset.svg) {
      document.getElementById('fullscreen-content').innerHTML = tile.dataset.svg;
      document.getElementById('fullscreen').classList.add('show');
    }
  });
});

function closeFullscreen() {
  document.getElementById('fullscreen').classList.remove('show');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeFullscreen();
});
fetch('https://stats-blackroad.blackroad.workers.dev/live').then(r=>r.json()).then(d=>{const e=d.ecosystem;const bar=document.createElement('div');bar.style.cssText='text-align:center;padding:8px;font-family:monospace;font-size:10px;color:#333';bar.innerHTML=e.agents+' agents · '+e.repos.toLocaleString()+' repos · '+e.nodes+' nodes · '+e.tops+' TOPS · '+(d.chat?.total_messages||0).toLocaleString()+' messages';document.body.appendChild(bar)}).catch(()=>{});
</script>
</body></html>`;
}

// ── Agent Computer Use — Simulated Browser Actions ──
function renderComputerUI() {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Computer Use — BlackRoad OS</title>
<meta name="description" content="Watch an AI agent browse a real computer in real-time. Sovereign fleet compute.">
<link rel="icon" href="https://images.blackroad.io/brand/favicon.png">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#f5f5f5;font-family:system-ui,sans-serif;min-height:100vh}
.header{padding:16px 24px;border-bottom:1px solid #111;display:flex;align-items:center;gap:12px}
h1{font-size:22px;font-weight:700;background:linear-gradient(135deg,#FF6B2B,#FF2255,#CC00AA,#8844FF);-webkit-background-clip:text;-webkit-text-fill-color:transparent;display:inline}
.live-badge{background:#FF2255;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
.nav-links{margin-left:auto;display:flex;gap:16px}
.nav-links a{color:#555;text-decoration:none;font-size:13px;font-weight:600;transition:color 0.2s}
.nav-links a:hover,.nav-links a.active{color:#FF2255}
.computer-main{display:flex;gap:0;height:calc(100vh - 64px)}
.computer-sidebar{width:280px;border-right:1px solid #111;padding:20px;overflow-y:auto;flex-shrink:0}
.computer-sidebar h3{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#555;margin-bottom:12px}
.info-block{padding:14px;border:1px solid #1a1a1a;border-radius:8px;background:#0a0a0a;margin-bottom:12px;font-size:12px;line-height:1.6;color:#888}
.info-block strong{color:#f5f5f5}
.status-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #111;font-size:12px}
.status-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.status-dot.online{background:#00c853}
.status-dot.simulated{background:#F5A623}
.task-presets{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.task-presets button{padding:8px 12px;border:1px solid #1a1a1a;border-radius:6px;background:#0a0a0a;color:#ccc;font-size:11px;text-align:left;cursor:pointer;transition:all 0.2s;font-family:inherit}
.task-presets button:hover{border-color:#FF2255;background:#111;color:#fff}
.computer-content{flex:1;display:flex;flex-direction:column}
.terminal-viewport{flex:1;background:#050505;position:relative;overflow:hidden;display:flex;flex-direction:column}
.terminal-titlebar{padding:8px 16px;background:#0a0a0a;border-bottom:1px solid #111;display:flex;align-items:center;gap:8px;flex-shrink:0}
.terminal-dot{width:10px;height:10px;border-radius:50%}
.terminal-title{font-size:12px;color:#555;font-family:monospace;flex:1;text-align:center}
.terminal-body{flex:1;padding:20px 24px;overflow-y:auto;font-family:'SF Mono',Menlo,Monaco,monospace;font-size:14px;line-height:1.8;color:#ccc}
.terminal-body .action-line{margin-bottom:2px;opacity:0;animation:fadein 0.3s forwards}
.terminal-body .action-line.browser{color:#00D4FF}
.terminal-body .action-line.navigate{color:#F5A623}
.terminal-body .action-line.click{color:#FF2255}
.terminal-body .action-line.observe{color:#8844FF}
.terminal-body .action-line.result{color:#00c853}
.terminal-body .action-line.thinking{color:#555;font-style:italic}
@keyframes fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.terminal-cursor{display:inline-block;width:8px;height:16px;background:#FF2255;animation:blink 0.6s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.terminal-prompt{color:#FF2255}
.terminal-body .url-bar{display:inline-block;padding:2px 10px;border:1px solid #222;border-radius:4px;background:#111;color:#F5A623;font-size:12px;margin:4px 0}
.computer-controls{padding:16px 24px;border-top:1px solid #111;display:flex;gap:8px;align-items:center}
.computer-controls input{flex:1;padding:12px 16px;border:1px solid #222;border-radius:8px;background:#0a0a0a;color:#fff;font-size:14px;font-family:monospace}
.computer-controls input:focus{border-color:#FF2255;outline:none}
.computer-controls button{padding:12px 24px;border:none;border-radius:8px;background:linear-gradient(135deg,#FF2255,#CC00AA);color:#fff;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap}
.computer-controls button:hover{opacity:0.9}
.computer-controls button:disabled{opacity:0.4;cursor:not-allowed}
.stats-bar{font-size:11px;color:#444;font-family:monospace;padding:0 24px 8px}
</style></head>
<body>
<div class="header">
  <h1>Agent Computer Use</h1><span class="live-badge">SIMULATED</span>
  <div class="nav-links">
    <a href="/">Single</a>
    <a href="/tv">RoadTV</a>
    <a href="/computer" class="active">Computer</a>
  </div>
</div>
<div class="computer-main">
  <div class="computer-sidebar">
    <h3>Fleet Status</h3>
    <div class="status-row"><span class="status-dot online"></span><strong style="color:#f5f5f5">Cecilia</strong><span style="color:#555;margin-left:auto">52 TOPS</span></div>
    <div class="status-row"><span class="status-dot online"></span><strong style="color:#f5f5f5">Octavia</strong><span style="color:#555;margin-left:auto">Compute</span></div>
    <div class="status-row"><span class="status-dot online"></span><strong style="color:#f5f5f5">Alice</strong><span style="color:#555;margin-left:auto">Gateway</span></div>
    <div class="status-row"><span class="status-dot simulated"></span><strong style="color:#f5f5f5">Agent Screen</strong><span style="color:#555;margin-left:auto">Simulated</span></div>

    <h3 style="margin-top:20px">About</h3>
    <div class="info-block">
      <strong>Agent Computer Use</strong> runs on the sovereign BlackRoad fleet — Raspberry Pis with Hailo-8 AI accelerators (52 TOPS).<br><br>
      The agent browses a real desktop via MJPEG at <strong>192.168.4.96:8801</strong>. Since the fleet runs on a private network, this public demo uses Workers AI to <strong>simulate</strong> what the agent sees and does.<br><br>
      Give the agent a task and watch it narrate its actions in real-time.
    </div>

    <h3>Quick Tasks</h3>
    <div class="task-presets">
      <button onclick="setTask('Find the chat feature on blackroad.io')">Find chat on blackroad.io</button>
      <button onclick="setTask('Search for the Amundson constant on the BlackRoad documentation')">Search for Amundson constant</button>
      <button onclick="setTask('Navigate to roundtrip.blackroad.io and list the active agents')">Check RoundTrip agents</button>
      <button onclick="setTask('Go to streaming.blackroad.io and describe what you see')">Inspect streaming site</button>
      <button onclick="setTask('Open hq.blackroad.io and explore the Pixel HQ floors')">Explore Pixel HQ</button>
      <button onclick="setTask('Find the deploy status of all BlackRoad products')">Check deploy status</button>
    </div>
  </div>
  <div class="computer-content">
    <div class="terminal-viewport">
      <div class="terminal-titlebar">
        <div class="terminal-dot" style="background:#FF5F57"></div>
        <div class="terminal-dot" style="background:#FFBD2E"></div>
        <div class="terminal-dot" style="background:#28CA42"></div>
        <div class="terminal-title">cecilia — agent-computer-use — blackroad fleet</div>
      </div>
      <div class="terminal-body" id="terminal">
        <div style="color:#555;text-align:center;margin-top:40px">
          <div style="font-size:40px;margin-bottom:16px">&#9000;</div>
          <div style="font-size:16px;color:#888;margin-bottom:8px">Agent Computer Use</div>
          <div style="font-size:12px;color:#444;max-width:400px;margin:0 auto">Give the agent a task below. It will narrate each browser action as it navigates, clicks, scrolls, and reads the screen — streaming every character in real-time.</div>
        </div>
      </div>
    </div>
    <div class="stats-bar" id="stats"></div>
    <div class="computer-controls">
      <input type="text" id="task" placeholder="Give the agent a task... e.g. Find the chat feature on blackroad.io" value="">
      <button id="run-btn" onclick="runTask()">Run Agent</button>
    </div>
  </div>
</div>
<script>
let evtSource=null,charCount=0,startTime=0;

function setTask(t){document.getElementById('task').value=t;document.getElementById('task').focus()}

function runTask(){
  const task=document.getElementById('task').value.trim();
  if(!task)return;
  if(evtSource){evtSource.close();evtSource=null}

  const terminal=document.getElementById('terminal');
  const stats=document.getElementById('stats');
  const btn=document.getElementById('run-btn');
  btn.disabled=true;btn.textContent='Running...';

  terminal.innerHTML='<div style="color:#FF2255;margin-bottom:4px">$ agent-computer-use</div><div style="color:#555;margin-bottom:12px">Task: '+escapeHtml(task)+'</div>';
  charCount=0;startTime=Date.now();
  stats.textContent='Connecting to agent...';

  let currentLine='';
  let lineCount=0;

  evtSource=new EventSource('/api/computer-stream?task='+encodeURIComponent(task));
  evtSource.onmessage=function(e){
    const d=JSON.parse(e.data);
    if(d.type==='char'){
      charCount++;
      const ch=d.char;
      if(ch==='\\n'){
        flushLine(terminal,currentLine,lineCount);
        currentLine='';lineCount++;
      } else {
        currentLine+=ch;
      }
      updateCursor(terminal,currentLine);
      const elapsed=(Date.now()-startTime)/1000;
      const cps=charCount/Math.max(elapsed,0.001);
      stats.textContent='LIVE | '+charCount+' chars | '+cps.toFixed(0)+' c/s | '+elapsed.toFixed(1)+'s';
      terminal.scrollTop=terminal.scrollHeight;
    }
    if(d.type==='done'){
      if(currentLine){flushLine(terminal,currentLine,lineCount)}
      removeCursor(terminal);
      const elapsed=(Date.now()-startTime)/1000;
      stats.textContent='DONE | '+charCount+' chars | '+elapsed.toFixed(1)+'s';
      btn.disabled=false;btn.textContent='Run Agent';
      evtSource.close();evtSource=null;
    }
    if(d.type==='error'){
      terminal.innerHTML+='<div style="color:#FF2255">Error: '+escapeHtml(d.error)+'</div>';
      btn.disabled=false;btn.textContent='Run Agent';
      evtSource.close();evtSource=null;
    }
  };
  evtSource.onerror=function(){
    stats.textContent='Stream ended';
    btn.disabled=false;btn.textContent='Run Agent';
    if(evtSource){evtSource.close();evtSource=null}
  };
}

function classifyLine(text){
  const t=text.toLowerCase();
  if(t.includes('opening browser')||t.includes('launching')||t.includes('browser'))return 'browser';
  if(t.includes('navigat')||t.includes('going to')||t.includes('loading')||t.includes('url'))return 'navigate';
  if(t.includes('click')||t.includes('pressing')||t.includes('selecting')||t.includes('typing'))return 'click';
  if(t.includes('found')||t.includes('success')||t.includes('result')||t.includes('complete')||t.includes('done'))return 'result';
  if(t.includes('scanning')||t.includes('reading')||t.includes('looking')||t.includes('observing')||t.includes('see ')||t.includes('notice'))return 'observe';
  if(t.includes('thinking')||t.includes('deciding')||t.includes('considering'))return 'thinking';
  return '';
}

function getPrefix(cls){
  switch(cls){
    case 'browser': return '&#9654; ';
    case 'navigate': return '&#8594; ';
    case 'click': return '&#9758; ';
    case 'observe': return '&#9673; ';
    case 'result': return '&#10003; ';
    case 'thinking': return '... ';
    default: return '  ';
  }
}

function flushLine(terminal,text,idx){
  removeCursor(terminal);
  const cls=classifyLine(text);
  const div=document.createElement('div');
  div.className='action-line '+(cls||'');
  div.style.animationDelay=(idx*0.02)+'s';
  div.innerHTML=getPrefix(cls)+escapeHtml(text);
  terminal.appendChild(div);
}

function updateCursor(terminal,partial){
  removeCursor(terminal);
  let active=terminal.querySelector('.active-line');
  if(!active){active=document.createElement('div');active.className='active-line';terminal.appendChild(active)}
  const cls=classifyLine(partial);
  active.innerHTML='<span class="'+(cls?'action-line '+cls:'')+'">'+getPrefix(cls)+escapeHtml(partial)+'</span><span class="terminal-cursor"></span>';
}

function removeCursor(terminal){
  const a=terminal.querySelector('.active-line');
  if(a)a.remove();
}

function escapeHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

document.getElementById('task').addEventListener('keydown',e=>{if(e.key==='Enter')runTask()});
fetch('https://stats-blackroad.blackroad.workers.dev/live').then(r=>r.json()).then(d=>{const e=d.ecosystem;const bar=document.createElement('div');bar.style.cssText='text-align:center;padding:8px;font-family:monospace;font-size:10px;color:#333';bar.innerHTML=e.agents+' agents · '+e.repos.toLocaleString()+' repos · '+e.nodes+' nodes · '+e.tops+' TOPS · '+(d.chat?.total_messages||0).toLocaleString()+' messages';document.body.appendChild(bar)}).catch(()=>{});
</script>
</body></html>`;
}

// ── Stream computer-use simulation as SSE ──
async function streamComputerUse(request, env, task) {
  const systemPrompt = `You are an AI agent with computer use abilities, operating on the BlackRoad sovereign fleet (Raspberry Pi cluster with Hailo-8 AI accelerators, 52 TOPS total). You are browsing a real desktop computer via a headless Chromium browser on Cecilia (192.168.4.96).

You must narrate EVERY action you take as if you are actually doing it right now, step by step. Write in present tense, first person. Each line should describe one discrete action or observation.

Format your output as a play-by-play log of browser actions. Use this style:

Opening browser on Cecilia (192.168.4.96)...
Navigating to blackroad.io...
Page loaded — dark background, gradient header with "BlackRoad OS" branding
Scanning the page for navigation elements...
Found ecosystem bar at the top: Chat, Search, Pay, Tutor, Social, Canvas, Cadence, RoadCode, Video, Live, Game, Book, Work, Radio
Clicking on "Chat" link...
URL changed to chat.blackroad.io
Page loaded — RoundTrip chat interface
Reading the main content area...
I see a real-time chat room with 109 agents listed in the sidebar
Found message history showing agent conversations
The most recent message is from Road agent: "Fleet status nominal"

Rules:
- Be specific about what you "see" — colors, layout, text content, links
- Mention realistic BlackRoad products and URLs (blackroad.io, chat.blackroad.io, search.blackroad.io, roundtrip.blackroad.io, hq.blackroad.io, streaming.blackroad.io, etc.)
- Reference real BlackRoad infrastructure: 5 Raspberry Pis (Alice, Cecilia, Octavia, Aria, Lucidia), Hailo-8 accelerators, WireGuard mesh, Gitea, Ollama, MinIO
- Each line should be a separate action or observation
- Keep it realistic and grounded — no exaggeration
- Include some "thinking" moments where you decide what to do next
- End with a summary of what you found or accomplished
- Keep total output under 400 words`;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    try {
      const aiResponse = await env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Task: ${task}` },
        ],
        stream: true,
        max_tokens: 800,
      });

      const reader = aiResponse.getReader ? aiResponse.getReader() : null;
      if (reader) {
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') continue;
            try {
              const obj = JSON.parse(payload);
              const token = obj.response || '';
              for (const ch of token) {
                await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'char', char: ch })}\n\n`));
              }
            } catch {}
          }
        }
      } else if (typeof aiResponse === 'object' && aiResponse.response) {
        for (const ch of aiResponse.response) {
          await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'char', char: ch })}\n\n`));
        }
      }

      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
    } catch (e) {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ── Router ──
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname === '/robots.txt')
      return new Response('User-agent: *\nAllow: /\nSitemap: https://streaming.blackroad.io/sitemap.xml', { headers: { 'Content-Type': 'text/plain' } });
    if (url.pathname === '/sitemap.xml') {
      const d = new Date().toISOString().split('T')[0];
      return new Response(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://streaming.blackroad.io/</loc><lastmod>${d}</lastmod><priority>1.0</priority></url><url><loc>https://streaming.blackroad.io/tv</loc><lastmod>${d}</lastmod></url><url><loc>https://streaming.blackroad.io/computer</loc><lastmod>${d}</lastmod></url></urlset>`, { headers: { 'Content-Type': 'application/xml' } });
    }

    if (url.pathname === '/api/stream') {
      const agent = url.searchParams.get('agent') || 'road';
      const prompt = url.searchParams.get('prompt') || 'What is BlackRoad OS?';
      return streamAgent(request, env, agent, prompt);
    }

    if (url.pathname === '/api/agents') {
      return Response.json(Object.entries(AGENTS).map(([id, a]) => ({ id, ...a })), { headers: cors });
    }

    if (url.pathname === '/health') {
      return Response.json({ status: 'live', service: 'streaming-blackroad', agents: Object.keys(AGENTS).length, version: '2.0.0', features: ['single-stream', 'roadtv', 'classroom', 'computer-use'] }, { headers: cors });
    }

    // Agent Computer Use stream
    if (url.pathname === '/api/computer-stream') {
      const task = url.searchParams.get('task') || 'Explore blackroad.io and describe what you find';
      return streamComputerUse(request, env, task);
    }

    // Agent Computer Use page
    if (url.pathname === '/computer' || url.pathname === '/computer-use') {
      return new Response(renderComputerUI(), { headers: { 'Content-Type': 'text/html;charset=UTF-8', ...cors } });
    }

    // RoadTV classroom view
    if (url.pathname === '/tv' || url.pathname === '/roadtv' || url.pathname === '/classroom') {
      return new Response(renderTVUI(), { headers: { 'Content-Type': 'text/html;charset=UTF-8', ...cors } });
    }

    // Single agent view (default)
    return new Response(renderSingleUI(), { headers: { 'Content-Type': 'text/html;charset=UTF-8', ...cors } });
  },
};
