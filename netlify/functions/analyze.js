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

  const { type, instrument, rr, news, notes, images, updateImage, updateImage2, sessionContext, conversationHistory } = body;

  if (type === "initial") {
    if (!instrument || !images || images.length !== 4) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing instrument or 4 chart images" }) };
    }

    const minWin = Math.round((1 / (1 + rr)) * 100);

    const systemPrompt = `You are an expert swing trader and technical analyst performing strict 4-timeframe top-down analysis.

CRITICAL PRICE READING RULES:
- There is a bar of text at the TOP of the chart showing values labelled O, H, L, C (or Open, High, Low, Close). IGNORE ALL OF THEM — O, H, L, and C are all wrong. They belong to whichever candle the cursor was last hovering over.
- The ONLY correct current price is the label on the RIGHT-HAND price scale — the highlighted number (usually in a green or white box) sitting next to the most recent candle on the far right edge of the chart.
- Before writing any price, look at the right-hand scale. Find the highlighted box. Use that number. Nothing else.
- If the number you are about to write matches any value shown in the top header bar, stop — you are reading the wrong thing.

ANALYSIS PROTOCOL — assess in this order:
1. Weekly — establish macro bias (bullish/bearish/ranging) and mark key levels. REJECT only if chart is completely unclear or missing price scale.
2. Daily — is structure aligned with weekly bias? Identify the nearest key level price is approaching or reacting from.
3. 4H — is there a defined zone (support, resistance, demand, supply) within 3-5% of current price? Does it align with Daily and Weekly?
4. 1H — is there a trigger forming? (rejection candle, break of structure, consolidation near zone)

GRADING RULES — be realistic, not perfectionist:
- Grade A: All 4 timeframes align cleanly. Entry zone defined. Clear 1H trigger. Issue LONG or SHORT.
- Grade B: Weekly + Daily + 4H agree. 1H trigger not yet formed but zone is clear. Issue LONG or SHORT with confirmation condition.
- Grade C: Weekly + Daily agree, 4H zone is approximate or slightly off. Worth watching. Issue LONG or SHORT with tight conditions.
- Grade D: 2 of 4 timeframes agree, setup is developing but not ready. Issue DEVELOPING — give the user what to watch for.
- REJECT: Weekly and Daily actively contradict each other. Or charts are unreadable.

KEY RULE: Do not reject a setup just because the 4H is mid-range — if Weekly and Daily are clearly aligned and price is approaching a key level, that is tradeable. Issue the appropriate grade.
Only issue NO TRADE if the bias is genuinely unclear or charts are unreadable.

ZONE THINKING RULES — price respects areas, not exact numbers:
- Never give a single exact price as an alert or entry level. Always give a zone: e.g. "1.07450–1.07550" not "1.07500".
- The zone should be roughly 10-20 pips wide for forex majors, wider for gold/indices.

ALERT PLACEMENT — always set the alert at whichever edge of the zone price reaches FIRST:
- Price is ABOVE the zone and moving DOWN toward it → set alert at the TOP edge (higher number). Example: zone is 1.0630–1.0650, price falling from above → alert at 1.0650.
- Price is BELOW the zone and moving UP toward it → set alert at the BOTTOM edge (lower number). Example: zone is 1.0730–1.0750, price rising from below → alert at 1.0730.
- Always ask yourself: which number will price touch first given the current direction? Set the alert there.
- Never set the alert at the far edge — price may reverse before reaching it and the user misses the setup entirely.

- A reaction anywhere inside the zone counts. If price enters the zone and shows a rejection candle, stagnation, or change of character on 1H — that is a valid signal.
- When describing what to look for: "a 1H rejection candle anywhere between 1.07450 and 1.07550" not "price must hit 1.07500 exactly".
- For entry: enter when a 1H candle closes back in the direction of the trade from inside the zone.

RESPONSE FORMAT — two sections:

SECTION 1: ANALYSIS (shown to user)
---
Use this exact structure. Write in plain english. No jargon. A beginner must be able to read this and know exactly what to do.

If LONG or SHORT (Grade A, B, or C):

[LONG 📈 or SHORT 📉] — Grade [A/B/C] — [X]% confidence
[One sentence explaining the setup like you are talking to a friend. No jargon.]

━━━ YOUR LEVELS ━━━
Entry:      [price]
Stop Loss:  [price]  <- exit if price closes below/above this

IMPORTANT — calculate RR precisely:
Stop distance = absolute difference between Entry and Stop Loss
TP1 RR = TP1 distance from entry divided by Stop distance (round to 1 decimal)
TP2 RR = TP2 distance from entry divided by Stop distance (round to 1 decimal)
TP3 RR = TP3 distance from entry divided by Stop distance (round to 1 decimal)
Never guess — divide the exact pip distances.

TP1:        [price]  <- take off HALF your position here (RR 1:[calculated])
TP2:        [price]  <- take off a QUARTER here (RR 1:[calculated])
TP3:        [price]  <- let the last bit run to here (RR 1:[calculated])

━━━ BEFORE YOU ENTER ━━━
Zone:       [price]-[price]  <- price can react anywhere in this range
Enter when: [e.g. "a 1H candle closes back above the bottom of the zone"]
[If no reaction within X days: cancel and move on.]

━━━ WHILE IN THE TRADE ━━━
Once TP1 hits -> move your stop to your entry price. You cannot lose money on the trade after that.
[Any other specific management note if relevant.]

[One risk warning in plain english.]

---

If DEVELOPING (Grade D):

DEVELOPING SETUP — Grade D — [X]% confidence
[One sentence explaining what is forming and why it is not ready yet.]

━━━ WHAT'S SETTING UP ━━━
Bias:       [LONG or SHORT]
Key level:  [price]-[price] — [one sentence why this level matters]
Currently:  [one sentence on where price is right now relative to that level]

━━━ WHAT NEEDS TO HAPPEN ━━━
[Step 1 — what you need to see first]
[Step 2 — confirmation]

Set alert at: [near edge of zone — whichever price hits first]
When it hits: send a fresh 1H screenshot here

If price takes off the other way:
Set alert at: [price]
When it hits: send a fresh 4H + 1H screenshot here

---

If NO TRADE or REJECT:

NO TRADE — [one sentence why in plain english.]

[One more sentence if needed.]

━━━ WHAT TO WATCH ━━━

If price pulls back first:
   Alert zone: [price]-[price]
   Set alert at: [near edge — whichever price hits first given current direction]
   When it hits: send a fresh 1H screenshot here
   Enter when: [e.g. "1H rejection candle anywhere in the zone"]

If price takes off without you:
   Set alert at: [price]
   When it hits: send a fresh 4H + 1H screenshot here
   Do not chase before the alert.

Confidence: [X]% (Structure [X]/10 | Timing [X]/10 | News risk [X]/10 | TF alignment [X]/10)
---

SECTION 2: SESSION_CONTEXT (not shown to user — append after ---SESSION_CONTEXT---)
Compact summary:
- Weekly bias and key levels
- Daily structure and key levels
- 4H setup and entry zone
- Pullback alert level and confirmation condition
- Breakout watch level
- Signal issued`;

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
        body: JSON.stringify({ model: "claude-sonnet-4-5-20250929", max_tokens: 2500, system: systemPrompt, messages: [{ role: "user", content }] }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { statusCode: response.status, body: JSON.stringify({ error: err }) };
      }

      const data = await response.json();
      const fullText = data.content.map((b) => b.text || "").join("");

      const scIndex = fullText.indexOf("---SESSION_CONTEXT---");
      const analysisText = (scIndex !== -1 ? fullText.substring(0, scIndex) : fullText)
        .replace(/\*\*SESSION_CONTEXT[:\*]*\**/gi, "")
        .replace(/SESSION_CONTEXT[:\s]*/gi, "")
        .trim();
      const sessionContextExtracted = scIndex !== -1 ? fullText.substring(scIndex + 21).trim() : "";

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: analysisText, sessionContext: sessionContextExtracted }),
      };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  if (type === "followup") {
    if (!updateImage) {
      return { statusCode: 400, body: JSON.stringify({ error: "No screenshot provided" }) };
    }

    const base64 = updateImage.split(",")[1];
    const mediaType = updateImage.match(/data:([^;]+);/)[1];

    const systemPrompt = `You are an expert swing trader monitoring an active trade setup.

CRITICAL PRICE READING RULES:
- There is a bar of text at the TOP of the chart showing O, H, L, C values. IGNORE ALL OF THEM.
- The ONLY correct current price is the highlighted label on the RIGHT-HAND price scale — the number in a green or white box on the far right edge next to the most recent candle.
- If the price you are about to write matches any value in the top header bar, stop — you are reading the wrong thing.

ZONE ALERT PLACEMENT — always set alert at whichever edge price reaches FIRST:
- Price falling toward zone from above → alert at TOP edge (higher number)
- Price rising toward zone from below → alert at BOTTOM edge (lower number)

Your job: look at the fresh screenshot and give a short update in plain english.

FIVE possible responses:

1. ENTER NOW
ENTER NOW
[One sentence confirming the entry.]

━━━ YOUR LEVELS ━━━
Entry:      [price]
Stop Loss:  [price]  <- exit if price closes below/above this
Calculate RR: Stop distance = |Entry - SL|. Divide each TP distance by stop distance.
TP1:        [price]  <- take off HALF here (RR 1:[calculated])
TP2:        [price]  <- take off a QUARTER here (RR 1:[calculated])
TP3:        [price]  <- let the last bit run (RR 1:[calculated])
Once TP1 hits -> move stop to entry. You cannot lose after that.
[One risk warning if relevant.]

2. NOT YET
NOT YET — still waiting.
Current price: [from RIGHT-HAND scale only]
[One sentence on what still needs to happen.]

Still watching:
Zone: [price]-[price] — alert at [near edge, price hits first] — send 1H screenshot when hit
If breakout: alert at [price] — send 4H + 1H screenshot when hit

3. PRICE TOOK OFF
PRICE TOOK OFF — [one sentence what happened]
[Guidance: continuation entry forming or stand aside?]
Set alert at: [retest level] — send fresh 4H + 1H screenshot when hit

4. SETUP OFF
SETUP OFF — [one sentence why]
[What to look for next, or "Nothing to watch right now — move on."]

5. NEED FRESH CHARTS
NEED FRESH CHARTS — [one sentence why]
Please upload a new Daily and 4H screenshot so I can reassess.

Keep whole response under 15 lines. No fluff. No jargon.

After response, append ---SESSION_CONTEXT--- followed by updated compact summary.`;

    const messages = [];

    if (sessionContext) {
      messages.push({ role: "user", content: `Higher timeframe context:\n\n${sessionContext}` });
      messages.push({ role: "assistant", content: "Understood. Ready for follow-up updates." });
    }

    if (conversationHistory && conversationHistory.length > 0) {
      conversationHistory.forEach((msg) => {
        messages.push({ role: msg.role, content: msg.content });
      });
    }

    const updateContent = [];
    updateContent.push({ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } });
    if (updateImage2) {
      const base642 = updateImage2.split(",")[1];
      const mediaType2 = updateImage2.match(/data:([^;]+);/)[1];
      updateContent.push({ type: "image", source: { type: "base64", media_type: mediaType2, data: base642 } });
      updateContent.push({ type: "text", text: `Fresh screenshots for ${instrument}. First image is 4H, second is 1H. Read current price from the RIGHT-HAND scale of the 1H chart only.` });
    } else {
      updateContent.push({ type: "text", text: `Fresh screenshot for ${instrument}. Read current price from the RIGHT-HAND scale only — not the header bar.` });
    }

    messages.push({ role: "user", content: updateContent });

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

      const scIndex = fullText.indexOf("---SESSION_CONTEXT---");
      const updateText = (scIndex !== -1 ? fullText.substring(0, scIndex) : fullText).trim();
      const updatedContext = scIndex !== -1 ? fullText.substring(scIndex + 21).trim() : sessionContext;
      const cleanText = updateText
        .replace(/\*\*SESSION_CONTEXT[:\*]*\**/gi, "")
        .replace(/SESSION_CONTEXT[:\s]*/gi, "")
        .trim();
      const needsFreshCharts = cleanText.toUpperCase().includes("NEED FRESH CHARTS");

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: cleanText, sessionContext: updatedContext, needsFreshCharts }),
      };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: "Invalid request type" }) };
};
