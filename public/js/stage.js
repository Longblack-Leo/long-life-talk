/* Long Life Talk — 무대 스크린 로직 (도착 순서대로 쌓이는 방식) */
(function () {
  const socket = io();

  const questionEl = document.getElementById('question');
  const answersEl = document.getElementById('answers');
  const offline = document.getElementById('offline');

  // 조별 액센트 색 — 핵심 팔레트(오렌지/탠) 계열의 따뜻한 톤
  // 현대 팔레트 계열 — 밝은 말풍선 위에서 읽히도록 충분히 진한 톤
  const GROUP_COLORS = [
    '#002c5f', // 네이비 (메인)
    '#00aad2', // 시안
    '#a36b4f', // 브라운
    '#1e5b8a', // 스틸 블루
    '#007a99', // 틸
    '#6b4a35', // 다크 브라운
    '#3a6098', // 슬레이트 블루
    '#0092b8', // 딥 시안
    '#8a5a40', // 브론즈 브라운
    '#26496f', // 딥 네이비
  ];
  const colorFor = (gid) => GROUP_COLORS[(gid - 1) % GROUP_COLORS.length];

  let groupCount = 7;       // 조 개수 (서버 스냅샷/이벤트로 갱신)
  let answers = [];         // 전체 답변 목록 (도착 순서, featured 플래그 포함)
  let focusGroup = null;    // 시상 스포트라이트: 특정 조만 노출 (null = 전체)

  // ── 질문 크기 맞춤 ────────────────────────────────────────
  //  1) 우선 한 줄로 시도 (짧은 질문은 한 줄 유지)
  //  2) 한 줄이 읽기 힘들 만큼 작아지면 줄바꿈을 허용하고 높이에 맞춰 축소
  const ONE_LINE_FLOOR = 34; // 한 줄을 포기하는 기준 크기(px)
  function fitQuestion() {
    const el = questionEl;
    if (!el.textContent.trim()) return;
    const maxSize = Math.max(Math.min(window.innerWidth * 0.046, 70), 22);

    // 1) 한 줄 시도
    el.style.whiteSpace = 'nowrap';
    let size = maxSize;
    el.style.fontSize = size + 'px';
    let guard = 100;
    while (el.scrollWidth > el.clientWidth && size > ONE_LINE_FLOOR && guard-- > 0) {
      size -= 1.5;
      el.style.fontSize = size + 'px';
    }
    if (el.scrollWidth <= el.clientWidth) return; // 한 줄로 충분히 들어감

    // 2) 한 줄이 너무 작아짐 → 줄바꿈 허용, 질문 영역 높이(화면의 약 24%) 안에서 최대 크기로
    el.style.whiteSpace = 'normal';
    const maxH = window.innerHeight * 0.24;
    size = maxSize;
    el.style.fontSize = size + 'px';
    guard = 120;
    while (el.scrollHeight > maxH && size > 18 && guard-- > 0) {
      size -= 1.5;
      el.style.fontSize = size + 'px';
    }
  }

  function setQuestion(text) {
    questionEl.textContent = text;
    fitQuestion();
  }

  window.addEventListener('resize', () => { fitQuestion(); fitAll(); });

  // ── 전체화면 + 유휴 시 커서 숨김 ─────────────────────────
  const fsBtn = document.getElementById('fsBtn');
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen && document.exitFullscreen();
    } else {
      const el = document.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
    }
  }
  if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    // 전체화면 중에는 버튼 숨김 (ESC로 종료)
    if (fsBtn) fsBtn.style.display = document.fullscreenElement ? 'none' : '';
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  });

  // 마우스가 멈추면 커서/버튼 숨김 (TV 화면용)
  let idleTimer = null;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
  }
  document.addEventListener('mousemove', wake);
  wake();

  // ── 말풍선 ────────────────────────────────────────────
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  // 화면에 보일 답변 수에 맞춰 격자 열 수 결정 (≤9 기준, 칸을 최대한 크게)
  function colsFor(n) {
    if (n <= 1) return 1;
    if (n <= 2) return 2;
    if (n <= 3) return 3;
    if (n <= 4) return 2;   // 2×2
    if (n <= 6) return 3;   // 3×2
    if (n <= 8) return 4;   // 4×2
    return 3;               // 9 → 3×3
  }

  function cellHtml(a) {
    return `
      <div class="cell" data-id="${a.id}">
        <div class="bubble" style="--g:${colorFor(a.groupId)};">
          <div class="tag">${a.groupId}조</div>
          <div class="text"><span class="text-inner">${escapeHtml(a.text)}</span></div>
        </div>
      </div>`;
  }

  // 칸 크기에 맞게 말풍선 글씨를 줄여 넘치지 않게 (실제 텍스트 높이 vs 가용 높이)
  function fitBubble(cell, maxSize, minSize) {
    const text = cell.querySelector('.bubble .text');
    const inner = text && text.querySelector('.text-inner');
    if (!text || !inner || !text.clientHeight) return;
    let size = maxSize;
    text.style.fontSize = size + 'px';
    let guard = 200;
    while (inner.scrollHeight > text.clientHeight && size > minSize && guard-- > 0) {
      size -= 2;
      text.style.fontSize = size + 'px';
    }
  }

  function fitAll() {
    // 평소: 9칸에 맞게 / 스포트라이트: 사회자 낭독용으로 큼직하게
    const maxSize = focusGroup ? 160 : 34;
    const minSize = focusGroup ? 24 : 11;
    answersEl.querySelectorAll('.cell').forEach((c) => fitBubble(c, maxSize, minSize));
  }

  // 격자 갱신 (도착 순서 유지)
  function render() {
    // 스포트라이트(시상): 선택 조의 답변만 / 평소: 채택된 답변만
    const visible = focusGroup
      ? answers.filter((a) => a.groupId === focusGroup).slice(-9)
      : answers.filter((a) => a.featured).slice(-9);
    answersEl.classList.toggle('focus', !!focusGroup);
    const liveIds = new Set(visible.map((a) => String(a.id)));

    // 사라진 칸 제거
    answersEl.querySelectorAll('.cell').forEach((el) => {
      if (!liveIds.has(el.dataset.id)) el.remove();
    });

    // 새로 들어온 답변을 순서대로 칸으로 추가
    for (const a of visible) {
      if (!answersEl.querySelector(`.cell[data-id="${a.id}"]`)) {
        answersEl.insertAdjacentHTML('beforeend', cellHtml(a));
      }
    }

    // 격자 구성: 평소엔 9칸(3×3) 고정, 스포트라이트는 답변 수에 맞춰 화면을 꽉 채움
    if (focusGroup) {
      const cols = colsFor(visible.length);
      const rows = Math.max(1, Math.ceil(visible.length / cols));
      answersEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      answersEl.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    } else {
      answersEl.style.gridTemplateColumns = 'repeat(3, 1fr)';
      answersEl.style.gridTemplateRows = 'repeat(3, 1fr)';
    }
    fitAll();
    requestAnimationFrame(fitAll); // 레이아웃 확정 후 한 번 더 보정
  }

  // ── 연결 상태 ──────────────────────────────────────────
  socket.on('connect', () => {
    socket.emit('stage:join');
    offline.classList.remove('show');
  });
  socket.on('disconnect', () => offline.classList.add('show'));

  // ── 상태 수신 ──────────────────────────────────────────
  socket.on('state:full', (s) => {
    setQuestion(s.question.text);
    groupCount = s.groupCount || groupCount;
    focusGroup = s.focusGroup ?? null;
    answers = s.answers || [];
    answersEl.innerHTML = '';
    render();
  });

  socket.on('groupCount:changed', ({ groupCount: gc }) => {
    groupCount = gc;
    render(); // 줄어들면 초과분은 빠지고, 늘어나면 더 많이 쌓일 수 있게
  });

  // 시상 스포트라이트 토글 (한 조만 / 전체)
  socket.on('focus:changed', ({ focusGroup: fg }) => {
    focusGroup = fg ?? null;
    answersEl.innerHTML = ''; // 모드 전환 시 깔끔하게 다시 그림
    render();
  });

  socket.on('question:changed', ({ question }) => {
    questionEl.style.opacity = '0';
    setTimeout(() => {
      setQuestion(question.text);
      questionEl.style.opacity = '1';
      answers = [];
      focusGroup = null;
      answersEl.innerHTML = '';
      render();
    }, 300);
  });

  // 새 답변이 무대에 채택됨 (auto 모드는 전송 즉시 이 이벤트)
  socket.on('answer:featured', ({ answer }) => {
    const cur = answers.find((a) => a.id === answer.id);
    if (cur) Object.assign(cur, answer);
    else answers.push(answer);
    render();
  });

  // 어드민이 채택/해제/삭제 등으로 목록을 통째로 갱신
  socket.on('stage:rerender', ({ answers: list }) => {
    answers = list || [];
    render();
  });

  socket.on('stage:cleared', () => {
    answers.forEach((a) => (a.featured = false));
    render(); // 스포트라이트 중이면 해당 조는 계속 보임, 평소엔 비워짐
  });

  socket.on('round:reset', () => {
    answers = [];
    focusGroup = null;
    answersEl.innerHTML = '';
    render();
  });
})();
