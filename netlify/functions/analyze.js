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
- Read ALL prices from the RIGHT-HAND price scale of each chart
- DO NOT use O/H/L/C values in the top header bar — those are individual candle values, not current price
- The current price is the highlighted/green label on the right side of the chart

ANALYSIS PROTOCOL — assess in this order:
1. Weekly — macro trend and key levels. REJECT if chart is unclear or missing price scale.
2. Daily — structure aligned with weekly? Flag if mid-range with no clear level.
3. 4H — defined entry zone? REJECT if price is mid-range or zone is off-screen.
4. 1H — specific entry trigger? Flag if no clear trigger.
5. Only issue LONG or SHORT if ALL FOUR timeframes align.
