# 공개 배포 가이드 (참가자 휴대폰 접속용)

참가자가 **각자 휴대폰(어떤 네트워크든)** 으로 접속하도록, 서버를 클라우드에 올려 **고정 공개 URL**을 만드는 방법입니다. 예시는 **Render** 기준이며, Railway/Fly.io도 방식은 같습니다.

## 접근 구조 (배포 후)
- **참가자**: `https://<앱주소>/group` — 공개, 키 불필요
- **운영팀**:
  - 어드민: `https://<앱주소>/admin?key=<ADMIN_KEY>`
  - 무대:   `https://<앱주소>/stage?key=<ADMIN_KEY>`
  - 한 번 `?key=`로 열면 쿠키로 유지되어, 이후 그 브라우저에선 키 없이 이동 가능
- 키 없이 `/admin`·`/stage`·`/`에 접근하면 자동으로 `/group`으로 보냅니다.

---

## 1. 코드를 GitHub에 올리기
```bash
cd long-life-talk
git init
git add .
git commit -m "Long Life Talk board"
# GitHub에 빈 리포 만든 뒤:
git remote add origin https://github.com/<사용자>/<리포>.git
git branch -M main
git push -u origin main
```
> `node_modules`는 `.gitignore`로 제외됩니다(리포에 올리지 않음).

## 2. Render에 배포
1. https://render.com 가입/로그인 → **New +** → **Web Service**
2. 방금 올린 GitHub 리포 선택
3. 설정 확인 (리포의 `render.yaml`이 자동으로 채워줌):
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
4. **Environment** 에 환경변수 추가:
   - `ADMIN_KEY` = 길고 추측 어려운 값 (예: `llt-2026-7f3k9x`)  ← **꼭 설정**
   - `SHEETS_WEBHOOK_URL` = 구글 시트 Apps Script `/exec` URL (아카이빙 쓸 때만)
   - `PORT` 는 Render가 자동 주입하므로 **설정하지 마세요**
5. **Create Web Service** → 빌드/배포 완료되면 `https://long-life-talk-xxxx.onrender.com` 같은 주소가 생깁니다.

## 3. 사용
- 참가자에게 안내: `https://<앱주소>/group` (QR코드로 만들면 편함)
- 무대 노트북: `https://<앱주소>/stage?key=<ADMIN_KEY>` 열고 전체화면(⛶)
- 진행자: `https://<앱주소>/admin?key=<ADMIN_KEY>`

> QR코드는 아무 QR 생성기에 참가자 URL을 넣어 만들면 됩니다.

---

## 주의사항
- **무료(Free) 플랜은 15분 미사용 시 잠들어**, 다음 접속 때 30~60초 콜드스타트가 있습니다.
  행사 직전에 한 번 열어 깨워두거나, 당일엔 **Starter($7/mo)** 로 올려두면 안정적입니다(행사 끝나고 내리면 됨).
- **상태는 메모리에만** 있습니다. 재배포/재시작하면 그때까지의 답변·질문이 초기화됩니다.
  (행사 중엔 재배포하지 마세요. 답변 기록은 구글 시트 아카이빙으로 남습니다.)
- `ADMIN_KEY`가 없으면 **전체 개방 모드**가 되어 누구나 어드민에 들어올 수 있습니다. 공개 배포에선 반드시 설정하세요.
- 같은 LAN에서만 쓰던 기존 방식도 그대로 가능합니다: `ADMIN_KEY` 없이 `npm start` 하면 예전처럼 전체 개방(단, 이제 단일 포트).
