import { NextResponse } from 'next/server';

const API_BASE = 'https://5i5g55qhv2.execute-api.us-west-2.amazonaws.com';
const REFERER  = 'https://adityauniversity.iqua.ai/';

export async function POST(request, { params }) {
  const { path: segments } = await params;
  const targetUrl = `${API_BASE}/prod/${segments.join('/')}`;

  const body = await request.text();

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'accept': 'application/json, text/plain, */*',
      'content-type': 'application/json',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'Referer': REFERER,
      'Origin': 'https://adityauniversity.iqua.ai',
    },
    body,
  });

  const data = await res.text();
  return new NextResponse(data, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
  });
}

export async function GET(request, { params }) {
  const { path: segments } = await params;
  const targetUrl = `${API_BASE}/prod/${segments.join('/')}`;

  const res = await fetch(targetUrl, {
    method: 'GET',
    headers: {
      'accept': 'application/json, text/plain, */*',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'Referer': REFERER,
      'Origin': 'https://adityauniversity.iqua.ai',
    },
  });

  const data = await res.text();
  return new NextResponse(data, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
  });
}
