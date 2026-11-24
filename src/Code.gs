// 會議室預約看板：給 BFF 呼叫的 API（講師提供，貼到 Apps Script 即可，整門課只要部署這一版）。
// 只開放固定的幾個動作、只碰兩張工作表，而且要帶對通行碼才會動作。
// 查詢只用到 rooms、bookings；新增、修改、刪除才用到 createBooking、updateBooking、deleteBooking。

// 白名單：BFF 只能碰這兩張工作表，其他工作表（例如「員工」）一律碰不到。
const SHEETS = { rooms: '會議室', bookings: '預約' };
// 預約工作表的欄位順序（第一列的欄名要一模一樣）。
const BOOKING_HEADERS = ['編號', '主旨', '會議室編號', '開始時間', '結束時間'];
// 一次最多回傳的預約筆數，超過就標示 truncated: true。
const MAX_ROWS = 100;
// 日期時間格式：2026-11-24 09:00
const DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

// BFF 用 POST 呼叫。通行碼放在本文（不放網址），因為網址容易被記錄下來。
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    const token = PropertiesService.getScriptProperties().getProperty('BFF_TOKEN');
    if (!token) return reply_({ ok: false, code: 'token_not_set' });
    if (typeof body.token !== 'string' || body.token !== token) {
      return reply_({ ok: false, code: 'unauthorized' });
    }

    switch (body.action) {
      case 'rooms':
        return reply_({ ok: true, data: { records: readSheet_(SHEETS.rooms), truncated: false } });
      case 'bookings':
        return listBookings_(body);
      case 'createBooking':
      case 'updateBooking':
      case 'deleteBooking':
        return withLock_(function () { return WRITERS[body.action](body); });
      default:
        return reply_({ ok: false, code: 'unknown_action' });
    }
  } catch (err) {
    // 詳細原因只留在 Apps Script 的「執行作業」紀錄，不回給呼叫的人。
    console.error(err);
    return reply_({ ok: false, code: 'script_error' });
  }
}

// ---------- 查詢 ----------

function listBookings_(body) {
  if (!DATETIME.test(String(body.from)) || !DATETIME.test(String(body.to))) {
    return reply_({ ok: false, code: 'invalid_range' });
  }
  const all = readSheet_(SHEETS.bookings);
  // 開始時間不是日期時間的列（打錯字、公式錯誤）直接回報是第幾列，不要默默略過。
  for (let i = 0; i < all.length; i++) {
    if (!DATETIME.test(all[i]['開始時間'])) {
      return reply_({ ok: false, code: 'invalid_data', sheet: SHEETS.bookings, row: i + 2 });
    }
  }
  // 這個格式的文字可以直接比大小（"2026-11-24 09:00" < "2026-11-24 10:00"）。
  const records = all.filter(function (r) {
    return r['開始時間'] >= body.from && r['開始時間'] <= body.to;
  });
  return reply_({
    ok: true,
    data: { records: records.slice(0, MAX_ROWS), truncated: records.length > MAX_ROWS },
  });
}

// ---------- 新增、修改、刪除 ----------
// 業務規則（主旨長度、時段衝突）由 BFF 檢查；這裡只做「資料能不能安全寫進去」的基本檢查。

const WRITERS = {
  createBooking: function (body) {
    const input = checkInput_(body);
    if (input.error) return reply_({ ok: false, code: input.error });
    const sheet = bookingSheet_();
    const id = nextId_(sheet);
    sheet.appendRow([id, input.topic, input.roomId, input.start, input.end]);
    return reply_({ ok: true, data: { record: findById_(sheet, id).record } });
  },

  updateBooking: function (body) {
    const input = checkInput_(body);
    if (input.error) return reply_({ ok: false, code: input.error });
    const sheet = bookingSheet_();
    const found = findById_(sheet, body.id);
    if (!found) return reply_({ ok: false, code: 'not_found' });
    sheet.getRange(found.row, 2, 1, 4).setValues([[input.topic, input.roomId, input.start, input.end]]);
    return reply_({ ok: true, data: { record: findById_(sheet, body.id).record } });
  },

  deleteBooking: function (body) {
    const sheet = bookingSheet_();
    const found = findById_(sheet, body.id);
    if (!found) return reply_({ ok: false, code: 'not_found' });
    sheet.deleteRow(found.row);
    return reply_({ ok: true, data: { id: String(body.id) } });
  },
};

// 同一時間只讓一個寫入進行，避免兩個請求同時改到同一列、或拿到同一個編號。
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return reply_({ ok: false, code: 'busy' });
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// 檢查寫入的值，並把時間文字轉成試算表的日期時間（用試算表的時區）。
function checkInput_(body) {
  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const roomId = typeof body.roomId === 'string' ? body.roomId.trim() : '';
  if (!topic || topic.length > 100) return { error: 'invalid_input' };
  if (!DATETIME.test(String(body.startsAt)) || !DATETIME.test(String(body.endsAt))) return { error: 'invalid_input' };
  if (!(body.endsAt > body.startsAt)) return { error: 'invalid_input' };
  const roomIds = readSheet_(SHEETS.rooms).map(function (r) { return r['編號']; });
  if (roomIds.indexOf(roomId) === -1) return { error: 'room_not_found' };
  // 開頭是 = + - @ 的文字會被試算表當成公式，前面加一個 ' 讓它保持純文字。
  const safeTopic = /^[=+\-@]/.test(topic) ? "'" + topic : topic;
  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return {
    topic: safeTopic,
    roomId: roomId,
    start: Utilities.parseDate(body.startsAt, timeZone, 'yyyy-MM-dd HH:mm'),
    end: Utilities.parseDate(body.endsAt, timeZone, 'yyyy-MM-dd HH:mm'),
  };
}

function bookingSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.bookings);
  if (!sheet) throw new Error('找不到工作表：' + SHEETS.bookings);
  const headers = sheet.getRange(1, 1, 1, BOOKING_HEADERS.length).getValues()[0].map(function (h) { return String(h).trim(); });
  if (headers.join() !== BOOKING_HEADERS.join()) throw new Error('預約工作表第一列的欄名和規定不同');
  return sheet;
}

// 新編號：B 加三位數，取目前最大的編號再加一（B003 → B004）。
function nextId_(sheet) {
  const ids = readSheet_(SHEETS.bookings).map(function (r) { return r['編號']; });
  let max = 0;
  ids.forEach(function (id) {
    const m = /^B(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'B' + String(max + 1).padStart(3, '0');
}

// 用編號找預約：回傳它在第幾列（含標題列）和整理好的資料；找不到回傳 null。
function findById_(sheet, id) {
  if (typeof id !== 'string' || !id) return null;
  // 直接看 A 欄每一列（不能用 readSheet_ 的順序算列號，因為它會略過空白列）。
  const ids = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (let i = 1; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) {
      const record = readSheet_(SHEETS.bookings).filter(function (r) { return r['編號'] === id; })[0];
      return { row: i + 1, record: record };
    }
  }
  return null;
}

// ---------- 共用 ----------

// 讀一張工作表：第一列是欄位名稱，之後每一列變成一筆 { 欄位名稱: 值 }。
function readSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('找不到工作表：' + name);

  const timeZone = ss.getSpreadsheetTimeZone();
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });

  return values.slice(1)
    .filter(function (row) { return row.some(function (v) { return v !== ''; }); }) // 跳過空白列
    .map(function (row) {
      const record = {};
      headers.forEach(function (h, i) {
        const v = row[i];
        // 試算表的日期時間是 Date 物件，統一轉成 "YYYY-MM-DD HH:mm" 文字。
        // 不用 instanceof Date：試算表傳回的日期物件不一定判斷得出來，這個寫法比較可靠。
        const isDate = Object.prototype.toString.call(v) === '[object Date]';
        record[h] = isDate ? Utilities.formatDate(v, timeZone, 'yyyy-MM-dd HH:mm') : String(v).trim();
      });
      return record;
    });
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
