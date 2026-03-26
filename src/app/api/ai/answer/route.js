import { NextResponse } from 'next/server';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import OpenAI from 'openai';

const AWS_REGION     = process.env.AWS_REGION            || 'us-east-1';
const AWS_KEY_ID     = process.env.AWS_ACCESS_KEY_ID     || '';
const AWS_SECRET     = process.env.AWS_SECRET_ACCESS_KEY || '';
const BEDROCK_MODEL  = process.env.BEDROCK_MODEL         || 'us.meta.llama3-3-70b-instruct-v1:0';
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY        || '';
const NVIDIA_MODEL   = process.env.NVIDIA_MODEL          || 'mistralai/devstral-2-123b-instruct-2512';
const NVIDIA_BASE    = 'https://integrate.api.nvidia.com/v1';

// ─── AWS Bedrock ──────────────────────────────────────────────────────────────
function buildPrompt(question, subject, resumeContext) {
  if (resumeContext) {
    return `You are a job candidate in an HR interview. Answer the question below as if you are the person described in this resume. Be specific — reference actual projects, skills, and experiences from the resume. Write 2–3 natural, first-person paragraphs. Do not mention that you are an AI.

RESUME:
${resumeContext}

HR Question: ${question}

Answer:`;
  }
  return `You are a highly skilled software developer in a technical interview for a ${subject || 'software development'} position.

Answer the following interview question with a clear, detailed, technically accurate response. Include specific examples, best practices, and relevant trade-offs. Write 2–4 well-structured paragraphs.

Question: ${question}

Answer:`;
}

async function callBedrock(question, subject, resumeContext) {
  if (!AWS_KEY_ID || !AWS_SECRET)
    throw new Error('AWS credentials not set.');

  const client = new BedrockRuntimeClient({
    region:      AWS_REGION,
    credentials: { accessKeyId: AWS_KEY_ID, secretAccessKey: AWS_SECRET },
  });

  const prompt = buildPrompt(question, subject, resumeContext);

  const bodyObj = BEDROCK_MODEL.startsWith('anthropic.')
    ? { anthropic_version: 'bedrock-2023-05-31', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }
    : BEDROCK_MODEL.startsWith('us.meta.') || BEDROCK_MODEL.startsWith('meta.')
    ? { prompt, max_gen_len: 800, temperature: 0.5 }
    : { inputText: prompt, textGenerationConfig: { maxTokenCount: 800, temperature: 0.5, topP: 0.9 } };

  const command = new InvokeModelCommand({
    modelId:     BEDROCK_MODEL,
    contentType: 'application/json',
    accept:      'application/json',
    body:        JSON.stringify(bodyObj),
  });

  const res = await client.send(command);
  const p   = JSON.parse(new TextDecoder().decode(res.body));

  let answer = '';
  if (BEDROCK_MODEL.startsWith('anthropic.'))
    answer = p.content?.[0]?.text || '';
  else if (BEDROCK_MODEL.startsWith('us.meta.') || BEDROCK_MODEL.startsWith('meta.'))
    answer = p.generation || '';
  else
    answer = p.results?.[0]?.outputText || '';

  if (!answer && p.message) throw new Error(p.message);
  return answer;
}

// ─── NVIDIA NIM ───────────────────────────────────────────────────────────────
async function callNvidia(question, subject, resumeContext, userApiKey = '') {
  const effectiveKey = userApiKey || NVIDIA_API_KEY;
  if (!effectiveKey) throw new Error('NVIDIA_API_KEY not set.');
  const client = new OpenAI({ apiKey: effectiveKey, baseURL: NVIDIA_BASE });

  const prompt = buildPrompt(question, subject, resumeContext);

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
    const { question, subject, provider = 'bedrock', resumeContext = null, apiKey = '' } = await request.json();
    if (!question) return NextResponse.json({ error: 'Missing question' }, { status: 400 });

    let answer = '';
    let usedProvider = provider;

    if (provider === 'nvidia') {
      try {
        answer = await callNvidia(question, subject, resumeContext, apiKey);
      } catch (e) {
        console.warn('[AI] NVIDIA failed, falling back to Bedrock:', e.message);
        answer = await callBedrock(question, subject, resumeContext);
        usedProvider = 'bedrock-fallback';
      }
    } else {
      answer = await callBedrock(question, subject, resumeContext);
    }

    return NextResponse.json({ answer, provider: usedProvider });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
