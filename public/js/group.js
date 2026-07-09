/* Long Life Talk — 조별 입력 페이지 로직 */
(function () {
  const socket = io();

  // 요소
  const dot = document.getElementById('dot');
  const connText = document.getElementById('connText');
  const picker = document.getElementById('picker');
  const composer = document.getElementById('composer');
  const groupGrid = document.getElementById('groupGrid');
  const myGroupEl = document.getElementById('myGroup');
  const questionEl = document.getElementById('question');
  const answerEl = document.getElementById('answer');
  const countEl = document.getElementById('count');
  const sendBtn = document.getElementById('sendBtn');
  const flash = document.getElementById('flash');
  const flashText = document.getElementById('flashText');

  let groupCount = 7;
  let myGroup = null; // 재접속(새로고침)할 때마다 조를 다시 선택하도록 저장하지 않음
  let mode = 'moderated';

  // ── 연결 상태 ────────────────────────────────────────────
  function setConn(on) {
    dot.className = 'status-dot ' + (on ? 'on' : 'off');
    connText.textContent = on ? '실시간 연결됨' : '연결 끊김 · 재접속 중…';
  }
  socket.on('connect', () => {
    setConn(true);
    if (myGroup) socket.emit('group:join', { groupId: myGroup });
  });
  socket.on('disconnect', () => setConn(false));

  // ── 조 선택 그리드 렌더 ──────────────────────────────────
  function renderPicker() {
    groupGrid.innerHTML = '';
    for (let i = 1; i <= groupCount; i++) {
      const btn = document.createElement('button');
      btn.className = 'group-btn';
      btn.innerHTML = `${i}<span>TABLE</span>`;
      btn.addEventListener('click', () => selectGroup(i));
      groupGrid.appendChild(btn);
    }
  }

  function selectGroup(n) {
    myGroup = n;
    socket.emit('group:join', { groupId: n });
    showComposer();
  }

  function showComposer() {
    myGroupEl.textContent = myGroup + '조';
    picker.style.display = 'none';
    composer.style.display = 'block';
    composer.style.animation = 'rise 0.5s ease both';
    answerEl.focus();
  }

  // ── 상태 수신 ────────────────────────────────────────────
  socket.on('state:full', (s) => {
    groupCount = s.groupCount;
    mode = s.mode;
    questionEl.textContent = s.question.text;
    if (myGroup && myGroup <= groupCount) {
      socket.emit('group:join', { groupId: myGroup });
      showComposer();
    } else {
      renderPicker();
    }
  });

  socket.on('question:changed', ({ question }) => {
    questionEl.textContent = question.text;
    // 새 질문이 오면 입력창을 비우고 다시 활성화
    answerEl.value = '';
    updateCount();
    answerEl.disabled = false;
    sendBtn.disabled = true;
    answerEl.focus();
  });

  socket.on('groupCount:changed', ({ groupCount: gc }) => {
    groupCount = gc;
    // 이미 고른 조가 줄어든 조 개수보다 크면 다시 선택하도록 선택 화면으로
    if (myGroup && myGroup > groupCount) {
      myGroup = null;
      composer.style.display = 'none';
      picker.style.display = 'block';
    }
    if (composer.style.display !== 'block') renderPicker();
  });

  socket.on('round:reset', () => {
    answerEl.value = '';
    answerEl.disabled = false;
    updateCount();
  });

  // 내 조의 전송이 서버에 반영되면 확인
  socket.on('group:submitted', ({ groupId }) => {
    if (groupId !== myGroup) return;
    flashText.textContent =
      mode === 'auto' ? '무대 스크린에 올라갔어요' : '진행자가 무대에 올려드릴 거예요';
    flash.classList.add('show');
    setTimeout(() => flash.classList.remove('show'), 1800);
  });

  socket.on('mode:changed', ({ mode: m }) => (mode = m));

  // ── 입력 ────────────────────────────────────────────────
  function updateCount() {
    const len = answerEl.value.trim().length;
    countEl.textContent = answerEl.value.length;
    sendBtn.disabled = len === 0;
  }
  answerEl.addEventListener('input', updateCount);

  // Cmd/Ctrl + Enter 로 전송
  answerEl.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send();
  });

  function send() {
    const text = answerEl.value.trim();
    if (!text || !myGroup) return;
    socket.emit('group:submit', { groupId: myGroup, text });
    // 입력창은 비우되, 같은 질문에 추가로 보낼 수도 있게 잠그진 않음
    answerEl.value = '';
    updateCount();
  }
  sendBtn.addEventListener('click', send);
})();
