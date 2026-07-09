# 구글 시트 아카이빙 설정 (Apps Script 웹앱)

조별 노트북에서 의견을 전송할 때마다, 서버가 그 내용을 구글 시트에 한 줄씩 기록합니다.

| 열 | 내용 |
|----|------|
| A | no (순번, 4행=1) |
| B | 전송 시점의 무대 대질문 |
| C | 조 (예: `3조`) |
| D | 내용 |
| E | 전송 시간 (한국시간 `YYYY-MM-DD HH:MM:SS`) |

데이터는 **4행부터** 채워집니다.

---

## 1단계 — 시트에 Apps Script 붙여넣기

1. 대상 구글 시트를 엽니다.
2. 상단 메뉴 **확장 프로그램 → Apps Script**.
3. 기본 `Code.gs` 내용을 모두 지우고 아래 코드를 붙여넣습니다.

```javascript
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // 동시 전송 시 줄 꼬임 방지
  try {
    var data = JSON.parse(e.postData.contents);
    // 첫 번째 시트에 기록 (시트 이름을 쓰려면 getSheetByName('시트1') 로 교체)
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

    var row = Math.max(sheet.getLastRow() + 1, 4); // 4행부터 시작
    var no = row - 3;                               // 4행 = 1번

    sheet.getRange(row, 1, 1, 5).setValues([[
      no,
      data.question,
      data.group,
      data.text,
      data.time
    ]]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, row: row, no: no }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
```

4. 저장(💾).

> 헤더(1~3행)는 미리 만들어 두세요. 코드는 "현재 시트에서 내용이 있는 마지막 행 다음"에 쓰되 최소 4행부터 기록하므로, 1~3행에 제목/헤더가 있어도 첫 데이터는 4행(no=1)에 들어갑니다.

---

## 2단계 — 웹앱으로 배포

1. 우측 상단 **배포 → 새 배포**.
2. 톱니바퀴(유형 선택) → **웹 앱**.
3. 설정:
   - **실행 계정(Execute as)**: 나
   - **액세스 권한(Who has access)**: **모든 사용자(Anyone)**
4. **배포** 클릭 → 권한 승인(본인 구글 계정으로 허용).
5. 표시되는 **웹 앱 URL**을 복사합니다. (형식: `https://script.google.com/macros/s/XXXXXXXX/exec`)

> 코드를 수정하면 **새 버전으로 다시 배포**해야 반영됩니다(같은 배포 관리 → 편집 → 새 버전).

---

## 3단계 — 서버에 URL 지정

복사한 URL을 `SHEETS_WEBHOOK_URL` 환경변수로 주고 서버를 실행합니다.

```bash
SHEETS_WEBHOOK_URL="https://script.google.com/macros/s/XXXXXXXX/exec" \
ADMIN_PORT=3000 PUBLIC_PORT=8080 \
npm start
```

서버 시작 로그에 `구글 시트 아카이빙: 켜짐` 이 보이면 정상입니다.
(URL을 주지 않으면 아카이빙은 자동으로 꺼진 채로 보드만 동작합니다.)

---

## 확인 / 문제 해결

- 조별 페이지에서 한 건 전송 → 시트 4행부터 채워지는지 확인.
- 안 채워지면 서버 콘솔에 `[sheets] 아카이브 실패: ...` 가 찍히는지 보세요.
  - 흔한 원인: 배포 액세스 권한이 "모든 사용자"가 아님 / 코드 수정 후 재배포 안 함 / URL이 `/exec`로 끝나지 않음.
- 전송 시간은 한국시간(Asia/Seoul) 기준입니다.
