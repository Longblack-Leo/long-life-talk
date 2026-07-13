/* Long Life Talk — 어드민 콘솔 로직 */
(function () {
  const socket = io();

  const GROUP_COLORS = [
    '#002c5f', '#00aad2', '#a36b4f', '#1e5b8a', '#007a99',
    '#6b4a35', '#3a6098', '#0092b8', '#8a5a40', '#26496f',
  ];
  const colorFor = (gid) => GROUP_COLORS[(gid - 1) % GROUP_COLORS.length];

  const PRESETS = [
    '우리 조가 생각하는 건강한 삶이란?',
    '내가 매일 챙기는 나만의 건강 루틴 한 가지는?',
    '오래, 잘 살기 위해 요즘 새로 시작한 것이 있다면?',
    '10년 뒤의 나에게 건강에 대해 한마디 한다면?',
    '오늘 가장 인상적인 내용과 강연을 통해 새롭게 다짐한게 있다면?',
  ];

  // 요소
  const dot = document.getElementById('dot');
  const connText = document.getElementById('connText');
  const curQ = document.getElementById('curQ');
  const presetsEl = document.getElementById('presets');
  const qInput = document.getElementById('qInput');
  const setQBtn = document.getElementById('setQ');
  const modeSeg = document.getElementById('modeSeg');
  const oneSwitch = document.getElementById('oneSwitch');
  const gMinus = document.getElementById('gMinus');
  const gPlus = document.getElementById('gPlus');
  const gCountEl = document.getElementById('gCount');
  const groupsStatus = document.getElementById('groupsStatus');
  const focusGrid = document.getElementById('focusGrid');
  const focusAllBtn = document.getElementById('focusAll');
  const clearStageBtn = document.getElementById('clearStage');
  const resetRoundBtn = document.getElementById('resetRound');
  const feedEl = document.getElementById('feed');
  const totalCount = document.getElementById('totalCount');
  const featuredCount = document.getElementById('featuredCount');
  const featuredCount2 = document.getElementById('featuredCount2');

  const MIN_GROUPS = 1;
  const MAX_GROUPS = 9; // 최대 9개 조

  let answers = [];
  let groupCount = 7;
  let connectedGroups = [];

  // 조 개수 표시 + 경계에서 +/- 버튼 비활성화
  function updateGroupCountUI() {
    gCountEl.textContent = groupCount;
    gMinus.disabled = groupCount <= MIN_GROUPS;
    gPlus.disabled = groupCount >= MAX_GROUPS;
  }
  let mode = 'moderated';
  let onePerGroup = true;
  let focusGroup = null; // 시상 스포트라이트 대상 조 (null = 전체)

  // 스포트라이트: 조 버튼 렌더 + 현재 선택 표시
  function renderFocus() {
    focusGrid.innerHTML = '';
    for (let i = 1; i <= groupCount; i++) {
      const btn = document.createElement('button');
      btn.className = 'focus-btn' + (focusGroup === i ? ' active' : '');
      btn.textContent = i + '조';
      btn.addEventListener('click', () => {
        // 이미 선택된 조를 다시 누르면 해제(전체)
        socket.emit('admin:setFocus', { groupId: focusGroup === i ? null : i });
      });
      focusGrid.appendChild(btn);
    }
    focusAllBtn.classList.toggle('active', focusGroup == null);
  }

  // ── 연결 ──────────────────────────────────────────────
  function setConn(on) {
    dot.className = 'status-dot ' + (on ? 'on' : 'off');
    connText.textContent = on ? '실시간 연결됨' : '연결 끊김';
    document.getElementById('offline').classList.toggle('show', !on);
  }
  socket.on('connect', () => { setConn(true); socket.emit('admin:join'); });
  socket.on('disconnect', () => setConn(false));

  // ── 프리셋 칩 ─────────────────────────────────────────
  PRESETS.forEach((q) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = q;
    b.addEventListener('click', () => socket.emit('admin:setQuestion', { text: q }));
    presetsEl.appendChild(b);
  });

  setQBtn.addEventListener('click', () => {
    const t = qInput.value.trim();
    if (!t) return;
    socket.emit('admin:setQuestion', { text: t });
    qInput.value = '';
  });
  qInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') setQBtn.click(); });

  // ── 모드 / 설정 ───────────────────────────────────────
  modeSeg.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => socket.emit('admin:setMode', { mode: b.dataset.mode }));
  });
  function renderMode() {
    modeSeg.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('active', b.dataset.mode === mode)
    );
  }
  oneSwitch.addEventListener('click', () => {
    socket.emit('admin:setOnePerGroup', { onePerGroup: !onePerGroup });
  });
  focusAllBtn.addEventListener('click', () => socket.emit('admin:setFocus', { groupId: null }));

  gMinus.addEventListener('click', () => {
    if (groupCount > MIN_GROUPS) socket.emit('admin:setGroupCount', { count: groupCount - 1 });
  });
  gPlus.addEventListener('click', () => {
    if (groupCount < MAX_GROUPS) socket.emit('admin:setGroupCount', { count: groupCount + 1 });
  });

  clearStageBtn.addEventListener('click', () => {
    if (confirm('무대에 노출된 답변을 모두 내릴까요? (답변 기록은 남습니다)')) {
      socket.emit('admin:clearStage');
    }
  });
  resetRoundBtn.addEventListener('click', () => {
    if (confirm('이번 라운드의 답변을 모두 삭제할까요? (되돌릴 수 없습니다)')) {
      socket.emit('admin:resetRound');
    }
  });

  // ── 렌더 ──────────────────────────────────────────────
  function renderGroupsStatus() {
    let html = '';
    for (let i = 1; i <= groupCount; i++) {
      const on = connectedGroups.includes(i);
      html += `<span class="gchip ${on ? 'on' : ''}">
        <span class="status-dot ${on ? 'on' : ''}"></span>${i}조</span>`;
    }
    groupsStatus.innerHTML = html;
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function renderFeed() {
    const featured = answers.filter((a) => a.featured);
    totalCount.textContent = answers.length;
    featuredCount.textContent = featured.length;
    featuredCount2.textContent = featured.length;

    if (answers.length === 0) {
      feedEl.innerHTML = `<div class="empty-feed">
        <div class="overline">WAITING</div>
        <p>아직 들어온 답변이 없어요</p>
      </div>`;
      return;
    }

    // 조별로 묶기
    const byGroup = {};
    answers.forEach((a) => {
      (byGroup[a.groupId] = byGroup[a.groupId] || []).push(a);
    });

    const groups = Object.keys(byGroup).map(Number).sort((a, b) => a - b);
    let html = '<div class="group-cols">';
    groups.forEach((gid) => {
      const list = byGroup[gid].sort((a, b) => b.ts - a.ts); // 최신 먼저
      const color = colorFor(gid);
      html += `<div class="gcol">
        <div class="gcol-head">
          <span class="gname"><span class="dot" style="background:${color}"></span>${gid}조</span>
          <span class="gcount">${list.length}개</span>
        </div>
        <div class="gcol-body">`;
      list.forEach((a) => {
        html += `<div class="ans ${a.featured ? 'featured' : ''}">
          <div class="meta">
            <span class="time">${fmtTime(a.ts)}</span>
            ${a.featured ? '<span class="on-stage">● 무대 노출 중</span>' : ''}
          </div>
          <div class="body">${escapeHtml(a.text)}</div>
          <div class="actions">
            ${a.featured
              ? `<button class="btn ghost sm" data-act="unfeature" data-id="${a.id}">내리기</button>`
              : `<button class="btn sm" data-act="feature" data-id="${a.id}">무대 채택</button>`}
            <button class="btn danger sm" data-act="delete" data-id="${a.id}">삭제</button>
          </div>
        </div>`;
      });
      html += `</div></div>`;
    });
    html += '</div>';
    feedEl.innerHTML = html;
  }

  // 이벤트 위임
  feedEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const act = btn.dataset.act;
    if (act === 'feature') socket.emit('admin:feature', { answerId: id });
    else if (act === 'unfeature') socket.emit('admin:unfeature', { answerId: id });
    else if (act === 'delete') {
      if (confirm('이 답변을 삭제할까요?')) socket.emit('admin:deleteAnswer', { answerId: id });
    }
  });

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  // ── 상태 수신 ─────────────────────────────────────────
  socket.on('state:full', (s) => {
    answers = s.answers;
    groupCount = s.groupCount;
    connectedGroups = s.connectedGroups || [];
    mode = s.mode;
    onePerGroup = s.onePerGroup;
    focusGroup = s.focusGroup ?? null;
    curQ.textContent = s.question.text;
    updateGroupCountUI();
    oneSwitch.classList.toggle('on', onePerGroup);
    renderMode();
    renderGroupsStatus();
    renderFocus();
    renderFeed();
  });

  // 시상 스포트라이트 상태 동기화 (여러 어드민 탭 간에도 일치)
  socket.on('focus:changed', ({ focusGroup: fg }) => {
    focusGroup = fg ?? null;
    renderFocus();
  });

  socket.on('answer:new', ({ answer }) => {
    answers.push(answer);
    renderFeed();
  });
  socket.on('answer:updated', ({ answer }) => {
    const i = answers.findIndex((a) => a.id === answer.id);
    if (i >= 0) answers[i] = answer;
    else answers.push(answer);
    renderFeed();
  });
  socket.on('answer:deleted', ({ answerId }) => {
    answers = answers.filter((a) => a.id !== answerId);
    renderFeed();
  });
  socket.on('state:answersReset', ({ answers: a }) => { answers = a; renderFeed(); });

  socket.on('question:changed', ({ question }) => {
    curQ.textContent = question.text;
    answers = [];
    focusGroup = null; renderFocus();
    renderFeed();
  });
  socket.on('mode:changed', ({ mode: m }) => { mode = m; renderMode(); });
  socket.on('settings:changed', (d) => {
    if (typeof d.onePerGroup === 'boolean') { onePerGroup = d.onePerGroup; oneSwitch.classList.toggle('on', onePerGroup); }
    renderFeed();
  });
  socket.on('groupCount:changed', ({ groupCount: gc }) => {
    groupCount = gc; updateGroupCountUI(); renderGroupsStatus(); renderFocus();
  });
  socket.on('groups:status', ({ connectedGroups: cg }) => {
    connectedGroups = cg; renderGroupsStatus();
  });
  socket.on('round:reset', () => { answers = []; focusGroup = null; renderFocus(); renderFeed(); });
})();
