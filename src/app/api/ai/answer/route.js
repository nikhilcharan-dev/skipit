import { NextResponse } from 'next/server';
import https from 'https';
import crypto from 'crypto';
import OpenAI from 'openai';

const AWS_REGION    = process.env.AWS_REGION            || 'us-east-1';
const AWS_KEY_ID    = process.env.AWS_ACCESS_KEY_ID     || '';
const AWS_SECRET    = process.env.AWS_SECRET_ACCESS_KEY || '';
const BEDROCK_MODEL = process.env.BEDROCK_MODEL         || 'us.meta.llama3-3-70b-instruct-v1:0';
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';
const NVIDIA_MODEL   = process.env.NVIDIA_MODEL   || 'mistralai/devstral-2-123b-instruct-2512';
const NVIDIA_BASE    = 'https://integrate.api.nvidia.com/v1';

// ─── AWS SigV4 helpers ────────────────────────────────────────────────────────
function hmacSha256(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }
function sha256hex(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function hmacHex(key, data) { return crypto.createHmac('sha256', key).update(data).digest('hex'); }

async function callBedrock(question, subject) {
  if (!AWS_KEY_ID || !AWS_SECRET)
    throw new Error('AWS credentials not set. Use AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars.');

  const host    = `bedrock-runtime.${AWS_REGION}.amazonaws.com`;
  const urlPath = `/model/${encodeURIComponent(BEDROCK_MODEL)}/invoke`;

  const prompt = `You are a highly skilled software developer in a technical interview for a ${subject || 'software development'} position.

Answer the following interview question with a clear, detailed, technically accurate response. Include specific examples, best practices, and relevant trade-offs. Write 2–4 well-structured paragraphs.

Question: ${question}

Answer:`;

  const bodyObj = BEDROCK_MODEL.startsWith('anthropic.')
    ? { anthropic_version: 'bedrock-2023-05-31', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }
    : BEDROCK_MODEL.startsWith('us.meta.') || BEDROCK_MODEL.startsWith('meta.')
    ? { prompt, max_gen_len: 800, temperature: 0.5 }
    : { inputText: prompt, textGenerationConfig: { maxTokenCount: 800, temperature: 0.5, topP: 0.9 } };

  const bodyStr    = JSON.stringify(bodyObj);
  const now        = new Date();
  const amzDate    = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp  = amzDate.slice(0, 8);
  const service    = 'bedrock';

  const payloadHash      = sha256hex(bodyStr);
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders    = 'content-type;host;x-amz-date';
  const canonicalReq     = ['POST', urlPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credScope        = `${dateStamp}/${AWS_REGION}/${service}/aws4_request`;
  const strToSign        = ['AWS4-HMAC-SHA256', amzDate, credScope, sha256hex(canonicalReq)].join('\n');
  const sigKey           = hmacSha256(hmacSha256(hmacSha256(hmacSha256('AWS4' + AWS_SECRET, dateStamp), AWS_REGION), service), 'aws4_request');
  const signature        = hmacHex(sigKey, strToSign);
  const authHeader       = `AWS4-HMAC-SHA256 Credential=${AWS_KEY_ID}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: host, port: 443, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Amz-Date': amzDate, 'Authorization': authHeader, 'Content-Length': Buffer.byteLength(bodyStr) } },
      res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          clearTimeout(reqTimer);
          try {
            const p = JSON.parse(data);
            let answer = '';
            if (BEDROCK_MODEL.startsWith('anthropic.')) answer = p.content?.[0]?.text || '';
            else if (BEDROCK_MODEL.startsWith('us.meta.') || BEDROCK_MODEL.startsWith('meta.')) answer = p.generation || '';
            else answer = p.results?.[0]?.outputText || '';
            if (!answer && p.message) throw new Error(p.message);
            if (!answer && p.error) throw new Error(JSON.stringify(p.error));
            resolve(answer);
          } catch (e) { reject(new Error(`Bedrock error: ${e.message} | raw: ${data.slice(0, 300)}`)); }
        });
      }
    );
    const reqTimer = setTimeout(() => {
      req.destroy(new Error('Bedrock request timed out after 20s'));
    }, 20000);
    req.on('error', (e) => { clearTimeout(reqTimer); reject(e); });
    req.write(bodyStr);
    req.end();
  });
}

// ─── NVIDIA NIM ───────────────────────────────────────────────────────────────
async function callNvidia(question, subject) {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY not set.');
  const client = new OpenAI({ apiKey: NVIDIA_API_KEY, baseURL: NVIDIA_BASE });

  const prompt = `You are a highly skilled ${subject || 'software development'} expert in a technical interview.
Answer the following interview question clearly and in detail. Include examples, best practices, and trade-offs. Write 2-4 well-structured paragraphs only — no headers, no bullet points.

Question: ${question}

Answer:`;

  const stream = await client.chat.completions.create({
    model: NVIDIA_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.15,
    top_p: 0.95,
    max_tokens: 800,
    stream: true,
  });

  let answer = '';
  for await (const chunk of stream) answer += chunk.choices[0]?.delta?.content || '';
  if (!answer) throw new Error('NVIDIA returned empty response');
  return answer;
}

export async function POST(request) {
  try {
    const { question, subject, provider = 'bedrock' } = await request.json();
    if (!question) return NextResponse.json({ error: 'Missing question' }, { status: 400 });

    const answer = provider === 'nvidia'
      ? await callNvidia(question, subject)
      : await callBedrock(question, subject);

    return NextResponse.json({ answer, provider });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
