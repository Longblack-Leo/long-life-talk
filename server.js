/**
 * Long Life Talk — 실시간 보드 서버
 * LG x Long Black 오프라인 커뮤니티 커피챗 (2026.06.12)
 *
 * 구조
 *  - /group  : 조별 노트북에서 답변을 입력/전송하는 페이지
 *  - /stage  : 무대 대형 스크린에 대질문 + 조별 답변(말풍선)을 띄우는 페이지
 *  - /admin  : 질문 변경 / 모드 전환 / 대표 답변 채택 등을 제어하는 어드민 페이지
 *
 * 모든 상태는 "메모리"에만 둡니다. (당일 1회성 행사 데이터)
 * 서버를 재시작하면 초기화됩니다. 필요하면 reset 으로 라운드만 비울 수 있습니다.
 */

const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');

const app = express();

// 단일 포트로 서비스 (클라우드 배포 호환). 호스팅이 주는 PORT 를 사용.
const PORT = Number(process.env.PORT || 3000);

// 운영팀(무대·어드민) 접근용 비밀키.
//  - 설정 시: /admin·/stage·/ 는 ?key=<KEY> 로 인증해야 접근(이후 쿠키로 유지)
//  - 미설정 시: 전체 개방 (같은 LAN 전용 로컬 개발 모드)
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// 구글 시트 아카이빙용 Apps Script 웹앱 URL (미설정 시 아카이빙 비활성)
const SHEETS_WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL || '';

const server = http.createServer(app);
const io = new Server(server, {
  // 끊김/재접속에 관대하게
  pingTimeout: 20000,
  pingInterval: 10000,
});

// ──────────────────────────────────────────────────────────────
// 상태 (메모리)
// ──────────────────────────────────────────────────────────────

// 진행 중 미리 채워둘 예시 질문들 (어드민에서 클릭 한 번으로 띄울 수 있게)
const PRESET_QUESTIONS = [
  // [0] = 서버 시작 시 무대에 뜨는 기본(대표) 질문
  '나의 업무에 가장 적용하고 싶은 방법론은 무엇인지 꼽아보고, 일에 어떻게 적용할 수 있을지 이야기 나누어 봅시다.',
  '여러분이 속해 있는 산업에 고객의 삶을 이해하기 위해 단 하나의 질문을 한다면 어떤 질문을 하시겠습니까?',
  '오늘 가장 인상적인 내용과 강연을 통해 새롭게 다짐한게 있다면? ',
];

let questionSeq = 1;
let answerSeq = 0;

let state = {
  question: { id: questionSeq, text: PRESET_QUESTIONS[0] },
  mode: 'moderated',        // 'moderated'(어드민이 채택해야 무대에 노출) | 'auto'(전송 즉시 무대 노출)
  onePerGroup: true,        // 무대에 한 조당 답변 1개만 노출
  groupCount: 7,            // 조 개수
  focusGroup: null,         // 시상용 스포트라이트: 특정 조만 무대에 노출 (null = 전체)
  answers: [],              // { id, groupId, text, ts, featured }
};

// groupId -> 연결된 소켓 수 (한 조가 새로고침/중복접속해도 카운트로 관리)
const groupConnections = {};

// ──────────────────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────────────────

function connectedGroupIds() {
  return Object.keys(groupConnections)
    .filter((g) => groupConnections[g] > 0)
    .map((g) => Number(g));
}

function snapshot() {
  return {
    question: state.question,
    mode: state.mode,
    onePerGroup: state.onePerGroup,
    groupCount: state.groupCount,
    focusGroup: state.focusGroup,
    answers: state.answers,
    connectedGroups: connectedGroupIds(),
  };
}

function broadcastGroupStatus() {
  io.to('admin').emit('groups:status', { connectedGroups: connectedGroupIds() });
}

function pushFullState(socket) {
  socket.emit('state:full', snapshot());
}

// 전송 시각을 한국시간 "YYYY-MM-DD HH:MM:SS" 로 포맷
function formatKST(ts) {
  return new Date(ts)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) // "2026-06-12 14:03:21"
    .replace('T', ' ');
}

// 제출된 답변 한 건을 구글 시트(Apps Script 웹앱)로 보낸다.
//  - 비동기 fire-and-forget: 실패해도 실시간 보드 동작에는 영향 없음
//  - 순번(A열)은 시트의 행 위치로 Apps Script가 계산 (서버 재시작과 무관)
function archiveToSheet(answer, questionText) {
  if (!SHEETS_WEBHOOK_URL) return;
  const payload = {
    question: questionText || '',
    group: `${answer.groupId}조`,
    text: answer.text,
    time: formatKST(answer.ts),
  };
  fetch(SHEETS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  }).catch((err) => console.error('[sheets] 아카이브 실패:', err.message));
}

// 서버 로컬 IP (행사장 LAN 접속 안내용)
function localIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

// ──────────────────────────────────────────────────────────────
// 접근 분기 (비밀키 기준)
//  - 운영팀 페이지(메인/무대/어드민)는 ?key=<ADMIN_KEY> 또는 쿠키로 인증
//  - 참가자(/group)와 정적 자원은 누구나 접근
//  - ADMIN_KEY 미설정 시 전체 개방 (로컬/LAN 개발용)
// ──────────────────────────────────────────────────────────────

const COOKIE_NAME = 'llt_key';

// 쿠키 문자열에서 운영팀 키가 유효한지
function cookieHasKey(cookieHeader) {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((c) => c.trim() === `${COOKIE_NAME}=${ADMIN_KEY}`);
}

// 이 요청이 운영팀(전체 접근) 권한인지
function isOperatorReq(req) {
  if (!ADMIN_KEY) return true; // 키 미설정 → 개방
  if (req.query && req.query.key === ADMIN_KEY) return true;
  return cookieHasKey(req.headers.cookie);
}

// 운영팀만 볼 수 있는 경로 (참가자 페이지 외)
const OPERATOR_PATHS = new Set([
  '/', '/index.html', '/stage', '/stage.html', '/admin', '/admin.html',
]);

app.use((req, res, next) => {
  if (!OPERATOR_PATHS.has(req.path)) return next(); // 참가자/정적 자원 통과
  if (isOperatorReq(req)) {
    // ?key= 로 처음 인증되면 쿠키로 저장 → 이후 네비게이션·소켓에서 유지
    if (ADMIN_KEY && req.query.key === ADMIN_KEY) {
      res.setHeader(
        'Set-Cookie',
        `${COOKIE_NAME}=${ADMIN_KEY}; Path=/; Max-Age=86400; SameSite=Lax`
      );
    }
    return next();
  }
  return res.redirect('/group'); // 키 없으면 참가자 페이지로
});

// ──────────────────────────────────────────────────────────────
// 정적 파일 & 라우팅
// ──────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);
app.get('/group', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'group.html'))
);
app.get('/stage', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'stage.html'))
);
app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
);

// ──────────────────────────────────────────────────────────────
// 소켓 이벤트
// ──────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  // 접속 즉시 현재 전체 상태 전달
  pushFullState(socket);

  // 이 소켓이 운영팀 권한인지 (핸드셰이크 쿠키의 비밀키로 판별, 페이지 차단 우회 방지)
  const fullAccess = !ADMIN_KEY || cookieHasKey(socket.handshake.headers.cookie);
  // 어드민 전용 이벤트는 운영팀만 처리
  const onAdmin = (event, handler) => {
    socket.on(event, (...args) => {
      if (!fullAccess) return;
      handler(...args);
    });
  };

  // ── 역할 등록 ──────────────────────────────────────────────
  socket.on('stage:join', () => {
    if (!fullAccess) return; // 무대 화면도 권한 호스트만
    socket.join('stage');
  });

  onAdmin('admin:join', () => {
    socket.join('admin');
    broadcastGroupStatus();
  });

  socket.on('group:join', ({ groupId } = {}) => {
    const gid = Number(groupId);
    if (!gid) return;
    socket.data.groupId = gid;
    socket.join('group');
    groupConnections[gid] = (groupConnections[gid] || 0) + 1;
    broadcastGroupStatus();
  });

  // ── 조 → 답변 전송 ────────────────────────────────────────
  socket.on('group:submit', ({ groupId, text } = {}) => {
    const gid = Number(groupId);
    const body = (text || '').toString().trim();
    if (!gid || !body) return;
    if (body.length > 300) return; // 과도한 입력 방지 (무대 가독성 위해 300자 제한)

    const featured = state.mode === 'auto';

    // auto + onePerGroup 이면, 같은 조의 기존 노출 답변은 내림
    if (featured && state.onePerGroup) {
      state.answers.forEach((a) => {
        if (a.groupId === gid) a.featured = false;
      });
      io.to('stage').emit('stage:rerender', { answers: state.answers });
    }

    const answer = {
      id: ++answerSeq,
      groupId: gid,
      text: body,
      ts: Date.now(),
      featured,
    };
    state.answers.push(answer);

    // 구글 시트 아카이빙 (보낸 시점의 대질문과 함께, 실패해도 보드 동작엔 영향 없음)
    archiveToSheet(answer, state.question.text);

    // 어드민에는 항상 도착 알림
    io.to('admin').emit('answer:new', { answer });
    // 조 본인에게 전송 확인 (해당 조의 모든 소켓)
    io.to('group').emit('group:submitted', { groupId: gid, answer });

    // 무대 노출
    if (featured) {
      io.to('stage').emit('answer:featured', { answer });
    }
  });

  // ── 어드민 제어 ──────────────────────────────────────────
  onAdmin('admin:setQuestion', ({ text } = {}) => {
    const body = (text || '').toString().trim();
    if (!body) return;
    state.question = { id: ++questionSeq, text: body };
    state.answers = []; // 새 라운드 시작 → 이전 답변 정리
    state.focusGroup = null; // 스포트라이트 해제
    io.emit('question:changed', { question: state.question });
  });

  // 시상용 스포트라이트: 특정 조만 무대에 (groupId=null 이면 전체로 복귀)
  onAdmin('admin:setFocus', ({ groupId } = {}) => {
    state.focusGroup = groupId == null ? null : Number(groupId);
    io.emit('focus:changed', { focusGroup: state.focusGroup });
  });

  onAdmin('admin:setMode', ({ mode } = {}) => {
    if (mode !== 'auto' && mode !== 'moderated') return;
    state.mode = mode;
    io.to('admin').emit('mode:changed', { mode });
  });

  onAdmin('admin:setOnePerGroup', ({ onePerGroup } = {}) => {
    state.onePerGroup = !!onePerGroup;
    io.to('admin').emit('settings:changed', { onePerGroup: state.onePerGroup });
  });

  onAdmin('admin:setGroupCount', ({ count } = {}) => {
    const n = Math.max(1, Math.min(9, Number(count) || state.groupCount)); // 최대 9개 조
    state.groupCount = n;
    io.emit('groupCount:changed', { groupCount: n });
  });

  // 대표 답변 채택 (무대 노출)
  onAdmin('admin:feature', ({ answerId } = {}) => {
    const ans = state.answers.find((a) => a.id === Number(answerId));
    if (!ans) return;

    // 한 조당 1개만 노출 옵션이면 같은 조의 다른 답변은 내림
    if (state.onePerGroup) {
      state.answers.forEach((a) => {
        if (a.groupId === ans.groupId && a.id !== ans.id && a.featured) {
          a.featured = false;
        }
      });
    }
    ans.featured = true;

    io.to('admin').emit('answer:updated', { answer: ans });
    io.to('stage').emit('stage:rerender', { answers: state.answers });
  });

  // 무대에서 내리기
  onAdmin('admin:unfeature', ({ answerId } = {}) => {
    const ans = state.answers.find((a) => a.id === Number(answerId));
    if (!ans) return;
    ans.featured = false;
    io.to('admin').emit('answer:updated', { answer: ans });
    io.to('stage').emit('stage:rerender', { answers: state.answers });
  });

  // 답변 삭제 (오타/부적절 등)
  onAdmin('admin:deleteAnswer', ({ answerId } = {}) => {
    state.answers = state.answers.filter((a) => a.id !== Number(answerId));
    io.to('admin').emit('answer:deleted', { answerId: Number(answerId) });
    io.to('stage').emit('stage:rerender', { answers: state.answers });
  });

  // 무대 비우기 (전체 내림, 답변 기록은 유지)
  onAdmin('admin:clearStage', () => {
    state.answers.forEach((a) => (a.featured = false));
    io.to('admin').emit('settings:changed', {});
    io.to('admin').emit('state:answersReset', { answers: state.answers });
    io.to('stage').emit('stage:cleared');
  });

  // 라운드 리셋 (질문 유지, 답변 전체 삭제)
  onAdmin('admin:resetRound', () => {
    state.answers = [];
    state.focusGroup = null; // 스포트라이트 해제
    io.emit('round:reset');
  });

  // ── 연결 종료 ────────────────────────────────────────────
  socket.on('disconnect', () => {
    const gid = socket.data.groupId;
    if (gid && groupConnections[gid]) {
      groupConnections[gid] = Math.max(0, groupConnections[gid] - 1);
      broadcastGroupStatus();
    }
  });
});

// ──────────────────────────────────────────────────────────────
// 서버 시작
// ──────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  const ips = localIPs();
  console.log('\n  Long Life Talk 보드 서버가 시작되었습니다.\n');
  console.log(`  포트 ${PORT}`);
  console.log(`  로컬:      http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`  네트워크:  http://${ip}:${PORT}`));
  console.log('');

  if (ADMIN_KEY) {
    console.log('  ▣ 참가자:  /group        (공개)');
    console.log('  ▣ 운영팀:  /admin?key=***  /stage?key=***  (비밀키 인증, 이후 쿠키 유지)');
    console.log('     · ADMIN_KEY 로 보호됨. key 없이 운영팀 페이지 접근 시 /group 으로 이동');
  } else {
    console.log('  ▣ 전체 개방 모드 (ADMIN_KEY 미설정 · 로컬/LAN 개발용)');
    console.log('     /group · /stage · /admin 모두 접근 가능');
    console.log('     ※ 공개 배포 시 반드시 ADMIN_KEY 환경변수를 설정하세요.');
  }
  console.log('');
  console.log(
    SHEETS_WEBHOOK_URL
      ? '  구글 시트 아카이빙: 켜짐'
      : '  구글 시트 아카이빙: 꺼짐 (SHEETS_WEBHOOK_URL 환경변수로 설정)'
  );
  console.log('');
});
