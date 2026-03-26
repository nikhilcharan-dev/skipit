import { NextResponse } from 'next/server';

const API_BASE = 'https://5i5g55qhv2.execute-api.us-west-2.amazonaws.com';
const IQUA_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'content-type': 'application/json',
  'Referer': 'https://adityauniversity.iqua.ai/',
  'Origin': 'https://adityauniversity.iqua.ai',
};

const MINIMAL_WEBM = Buffer.from([
  0x1A, 0x45, 0xDF, 0xA3, 0x9F,
  0x42, 0x86, 0x81, 0x01, 0x42, 0xF7, 0x81, 0x01,
  0x42, 0xF2, 0x81, 0x04, 0x42, 0xF3, 0x81, 0x08,
  0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6D,
  0x42, 0x87, 0x81, 0x04, 0x42, 0x85, 0x81, 0x02,
  0x18, 0x53, 0x80, 0x67,
  0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
]);

function buildPayload(userid, profile, interviewType, accessToken) {
  const subjects = (profile.subjects_selected_lst_dict || []).map(s => ({
    id: s.id, label: s.display_name, value: s.display_name, display_name: s.display_name,
  }));
  return {
    sts: { sts: true, err: '', msg: 'Successfully generated pre-signed url for introductory SME question.' },
    userid,
    profileid: {
      dept: profile.dept,
      sem: profile.sem,
      profile_id: profile.profile_id,
      set_id: 1,
      experience: '0',
    },
    resume: { file: {}, psurl: {} },
    subjects: [],
    resume_subjects: [],
    introq: {},
    interview_panel: [],
    subjects_selected: subjects,
    interview_type_code: interviewType,
    q: {
      violations: { Tabswitch: 0, Fullscreen: 0, Externaldisplay: 0 },
      max_count: 16,
      qid: null,
      qno: 16,
      qtype: 'OPN',
      choice: '',
      question: '',
      response: null,
      subject: subjects[0] || {},
      start: '00:00:00',
      end: '00:15:00',
    },
    violations: { Tabswitch: 0, Fullscreen: 0, Externaldisplay: 0 },
    screen_violations: { exitCount: 0, isFullscreen: false, lastExitTime: null, exitHistory: [] },
    total_violations: { Tabswitch: 0, Fullscreen: 0, Externaldisplay: 0 },
    interview_type: interviewType,
    voice: { INT: { voice_name: 'Matthew', language_code: 'en-US' } },
    access_token: accessToken,
    video: {
      file: { name: profile.interview_video, type: 'video/webm;codecs=vp8,opus', size: MINIMAL_WEBM.length },
      psurl: {},
    },
    audio_file: { file: { name: null, type: 'audio/wav', size: 0 } },
    video_file: {},
    interview_conversation: [],
  };
}

export async function POST(request) {
  const debug = {};
  try {
    const { userid, profile, interviewType, accessToken } = await request.json();
    if (!userid || !profile?.profile_id || !profile?.interview_video || !accessToken) {
      return NextResponse.json({ error: 'Missing required fields', debug }, { status: 400 });
    }

    const payload = buildPayload(userid, profile, interviewType || 'SKILL', accessToken);
    debug.videoFilename = profile.interview_video;
    debug.profileId = profile.profile_id;

    // Step 1: Get video presigned URL
    const psRes = await fetch(
      `${API_BASE}/prod/update-profile/api/sdt/update-profile/interview-presigned-url`,
      { method: 'POST', headers: IQUA_HEADERS, body: JSON.stringify(payload) }
    );
    const psData = await psRes.json();
    debug.step1_status = psRes.status;
    debug.step1_sts = psData?.sts;
    debug.step1_video = psData?.video?.file;
    debug.step1_has_psurl = !!(psData?.video?.psurl?.url);

    const videoPsurl = psData?.video?.psurl;
    if (!videoPsurl?.url || !videoPsurl?.fields) {
      return NextResponse.json({ error: 'No video psurl returned', debug }, { status: 500 });
    }

    // Step 2: Upload minimal WebM to S3
    const form = new FormData();
    for (const [k, v] of Object.entries(videoPsurl.fields)) form.append(k, v);
    form.append('file', new Blob([MINIMAL_WEBM], { type: 'video/webm' }), profile.interview_video);

    const s3Res = await fetch(videoPsurl.url, { method: 'POST', body: form });
    debug.step2_s3_status = s3Res.status;
    debug.step2_s3_ok = s3Res.ok;
    debug.step2_s3_key = videoPsurl.fields?.key;

    if (!s3Res.ok) {
      const s3Body = await s3Res.text().catch(() => '');
      debug.step2_s3_error = s3Body.slice(0, 300);
      return NextResponse.json({ error: `S3 upload failed: ${s3Res.status}`, debug }, { status: 500 });
    }

    // Step 3: Update interview profile
    const updateRes = await fetch(
      `${API_BASE}/prod/update-profile/api/sdt/update-profile/update-interview-profile`,
      { method: 'POST', headers: IQUA_HEADERS, body: JSON.stringify(payload) }
    );
    const updateData = await updateRes.json();
    debug.step3_status = updateRes.status;
    debug.step3_sts = updateData?.sts;

    return NextResponse.json({
      success: updateRes.ok && updateData?.sts?.sts === true,
      debug,
    });
  } catch (err) {
    debug.exception = err.message;
    return NextResponse.json({ error: err.message, debug }, { status: 500 });
  }
}
