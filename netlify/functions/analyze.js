exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key not configured" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const { type, instrument, rr, news, notes, images, updateImage, sessionContext, conversationHistory } = body;

  // ─── INITIAL ANALYSIS ────────────────────────────────────────────────────────
  if (type === "initial") {
    if (!instrument || !images || images.length !== 4) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing instrument or 4 chart images" }) };
    }

    const minWin = Math.round((1 / (1 + rr)) * 100);

    const systemPrompt = `You are an expert swing trader and technical analyst performing strict 4-timeframe top-down analysis.

CRITICAL PRICE READING RULES:
- Read ALL prices from the RIGHT-HAND price scale of each chart
- DO NOT use O/H/L/C values in the top header bar — those are individual candle values, not current price
- The current price is the highlighted/green label on the right side of the chart

ANALYSIS PROTOCOL — assess in this order:
1. Weekly — macro trend and key levels. REJECT if chart is unclear or missing price scale.
2. Daily — structure aligned with weekly? Flag if mid-range with no clear level.
3. 4H — defined entry zone? REJECT if price is mid-range or zone is off-screen.
4. 1H — specific entry trigger? Flag if no clear trigger.
5. Only issue LONG or SHORT if ALL FOUR timeframes align. Otherwise NO TRADE.

RESPONSE FORMAT — two sections:

SECTION 1: ANALYSIS (shown to user)
---
SIGNAL QUALITY GRADE: A / B / C / REJECT
Signal: LONG / SHORT / NO TRADE

If LONG or SHORT:
- One sentence explaining the setup in plain english
- Entry: [price] (only after: [specific 1H confirmation])
- Stop Loss: [price] (below liquidity, not the obvious swing low)
- TP1: [price] — take off half (RR X:X)
- TP2: [price] — take off a quarter (RR X:X)
- TP3: [price] — let the rest run (RR X:X)
- Move stop to entry once TP1 hits
- Suggested hold: X-X days
- Risk: [one line]

If NO TRADE:
- 2-3 sentences why, in plain english

⬇ Pullback watch (if price dips first):
- Set alert at: [price]
- Look for: [exactly what to see — e.g. "green 1H candle closing above X"]

⬆ Breakout watch (if price takes off instead):
- Watch level: [price — the key resistance or structure high that if broken changes things]
- If that breaks: [one sentence — e.g. "pullback long setup is off, look for a retest of X as new support for a continuation entry" or "stand aside until price consolidates for 4-6 hours, then reassess with fresh 4H"]

Confidence: X% (Structure X/10 | Timing X/10 | News X/10 | TF alignment X/10)
---

SECTION 2: SESSION_CONTEXT (used internally, not shown to user — put this at the very end after "---SESSION_CONTEXT---")
Write a compact structured summary for use in follow-up updates. Include:
- Weekly bias and key levels
- Daily structure and key levels
- 4H setup and entry zone
- Pullback alert level and confirmation condition
- Breakout watch level and what it means if hit
- Signal issued (or reason for no trade)
Format it as plain key:value lines, concise.`;

    const tfLabels = ["Weekly chart", "Daily chart", "4H chart", "1H chart"];
    const content = [];

    images.forEach((img, i) => {
      const base64 = img.split(",")[1];
      const mediaType = img.match(/data:([^;]+);/)[1];
      content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } });
      content.push({ type: "text", text: `${tfLabels[i]} (chart ${i + 1} of 4). Read prices from the RIGHT-HAND scale only, not the header bar.` });
    });

    content.push({
      type: "text",
      text: `Instrument: ${instrument} | RR: 1:${rr} (min ${minWin}% winrate) | News: ${news || "not specified"}${notes ? " | Notes: " + notes : ""}

Analyze all 4 timeframes. After your analysis, append ---SESSION_CONTEXT--- followed by the compact summary.`,
    });

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-5-20250929", max_tokens: 1800, system: systemPrompt, messages: [{ role: "user", content }] }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { statusCode: response.status, body: JSON.stringify({ error: err }) };
      }

      const data = await response.json();
      const fullText = data.content.map((b) => b.text || "").join("");

      const parts = fullText.split("---SESSION_CONTEXT---");
      const analysisText = parts[0].trim();
      const sessionContextExtracted = parts[1] ? parts[1].trim() : "";

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: analysisText, sessionContext: sessionContextExtracted }),
      };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ─── FOLLOW-UP UPDATE ────────────────────────────────────────────────────────
  if (type === "followup") {
    if (!updateImage) {
      return { statusCode: 400, body: JSON.stringify({ error: "No screenshot provided" }) };
    }

    const base64 = updateImage.split(",")[1];
    const mediaType = updateImage.match(/data:([^;]+);/)[1];

    const systemPrompt = `You are an expert swing trader monitoring an active trade setup. You have memory of the higher timeframe analysis and conversation history below.

CRITICAL PRICE READING RULES:
- Current price = the GREEN or highlighted label on the RIGHT-HAND price scale
- IGNORE the O/H/L/C header bar at the top — those are old candle values
- IGNORE dotted line labels — those are reference levels

Your job: look at the fresh 1H screenshot and give a short update.

You have FOUR possible responses:

1. YES — ENTER NOW
   Give entry, stop loss, TP1/TP2/TP3. One line on what to watch.

2. NOT YET — STILL WAITING
   State current price (from right scale). Say what still needs to happen. Restate the relevant alert level.

3. PRICE TOOK OFF — BREAKOUT SCENARIO
   Use this if price has blown through the original pullback zone and is now near or above the breakout watch level.
   Say what happened in one sentence. Give concrete guidance: is there a continuation entry forming (retest of breakout level), or should they stand aside?

4. SETUP OFF — INVALIDATED
   Say why in one sentence. Tell them what to look for next if anything.

5. NEED FRESH CHARTS
   Use this if: price has moved so far from the original zone that the 4H/Daily context is stale, OR if more than a few days have passed and structure may have changed.
   Say: "NEED FRESH CHARTS — [one sentence why]. Please upload a new Daily and 4H screenshot."

Keep it 4-8 lines max. Plain english. No fluff.

After your response, append ---SESSION_CONTEXT--- followed by an updated compact summary reflecting the latest situation.`;

    const messages = [];

    if (sessionContext) {
      messages.push({ role: "user", content: `Here is the higher timeframe context from the original analysis:\n\n${sessionContext}` });
      messages.push({ role: "assistant", content: "Understood. I have the higher timeframe context. Ready for follow-up updates." });
    }

    if (conversationHistory && conversationHistory.length > 0) {
      conversationHistory.forEach((msg) => {
        messages.push({ role: msg.role, content: msg.content });
      });
    }

    messages.push({
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: `Fresh 1H screenshot for ${instrument}. Read current price from the GREEN label on the RIGHT-HAND scale — not the header bar. Has the setup formed? Give me a short update.` },
      ],
    });

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-5-20250929", max_tokens: 600, system: systemPrompt, messages }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { statusCode: response.status, body: JSON.stringify({ error: err }) };
      }

      const data = await response.json();
      const fullText = data.content.map((b) => b.text || "").join("");

      const parts = fullText.split("---SESSION_CONTEXT---");
      const updateText = parts[0].trim();
      const updatedContext = parts[1] ? parts[1].trim() : sessionContext;
      const needsFreshCharts = updateText.toUpperCase().includes("NEED FRESH CHARTS");

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: updateText, sessionContext: updatedContext, needsFreshCharts }),
      };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: "Invalid request type" }) };
};
