/**
 * ================================================
 * ER HANDOVER SYSTEM — Google Apps Script Backend
 * โรงพยาบาลยางชุมน้อย
 * ================================================
 * วิธีติดตั้ง:
 * 1. เปิด Google Sheets ใหม่
 * 2. Extensions → Apps Script
 * 3. วางโค้ดทั้งหมดนี้ แทนที่โค้ดเดิม → บันทึก
 * 4. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy URL มาวางใน HTML ที่ช่อง "Web App URL"
 * ================================================
 */

// ชื่อ Sheet ต่างๆ
const SHEET_USERS    = 'Users';
const SHEET_ER       = 'ER_Data';
const SHEET_EMS      = 'EMS_Data';
const SHEET_PATIENTS = 'Patients';
const SHEET_HISTORY  = 'History';
const SHEET_LOG      = 'ActivityLog';

// ================================================
// CORS + Router
// ================================================
function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    let data = {};
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      data = e.parameter;
    }

    const action = data.action || e.parameter?.action || 'ping';
    let result = {};

    switch (action) {
      case 'ping':
        result = { ok: true, message: 'ER Handover API พร้อมใช้งาน', ts: new Date().toLocaleString('th-TH') };
        break;

      // ====== USER MANAGEMENT ======
      case 'getUsers':
        result = getUsers();
        break;
      case 'saveUser':
        result = saveUser(data);
        break;
      case 'deleteUser':
        result = deleteUser(data.username);
        break;
      case 'login':
        result = loginUser(data.username, data.password);
        break;
      case 'resetPassword':
        result = resetPassword(data.username, data.newPassword);
        break;

      // ====== ER DATA ======
      case 'writeERData':
        result = writeERData(data);
        break;
      case 'writeEMSData':
        result = writeEMSData(data);
        break;
      case 'writePatientData':
        result = writePatientData(data);
        break;
      case 'writeHistory':
        result = writeHistory(data);
        break;

      // ====== ACTIVITY LOG ======
      case 'writeLog':
        result = writeLog(data);
        break;
      case 'getLogs':
        result = getLogs();
        break;

      default:
        result = { ok: false, error: 'Unknown action: ' + action };
    }

    output.setContent(JSON.stringify(result));
  } catch (err) {
    output.setContent(JSON.stringify({ ok: false, error: err.toString() }));
  }

  return output;
}

// ================================================
// SHEET HELPERS
// ================================================
function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length)
        .setBackground('#1e3a5f')
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setFontSize(11);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

// ================================================
// USER MANAGEMENT
// ================================================
function initUsersSheet() {
  const headers = ['username', 'password', 'fullname', 'role', 'active', 'createdAt', 'updatedAt'];
  const sheet = getOrCreateSheet(SHEET_USERS, headers);

  // สร้าง admin เริ่มต้นถ้าไม่มี
  const users = sheetToObjects(sheet);
  if (!users.find(u => u.username === 'admin')) {
    sheet.appendRow([
      'admin', '1234', 'ผู้ดูแลระบบ (Admin)', 'admin', 1,
      new Date().toLocaleString('th-TH'), ''
    ]);
  }
  return sheet;
}

function getUsers() {
  try {
    const sheet = initUsersSheet();
    const users = sheetToObjects(sheet).map(u => ({
      username: u.username,
      fullname: u.fullname,
      role:     u.role,
      active:   u.active == 1,
      createdAt: u.createdAt
      // ไม่ส่ง password กลับ
    }));
    return { ok: true, users };
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

function loginUser(username, password) {
  try {
    const sheet = initUsersSheet();
    const users = sheetToObjects(sheet);
    const user = users.find(u =>
      u.username.toLowerCase() === (username || '').toLowerCase() &&
      String(u.password) === String(password) &&
      u.active == 1
    );
    if (!user) return { ok: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกปิดใช้งาน' };
    return {
      ok: true,
      user: {
        username: user.username,
        fullname: user.fullname,
        role:     user.role,
        active:   user.active == 1
      }
    };
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

function saveUser(data) {
  try {
    const sheet = initUsersSheet();
    const { username, password, fullname, role, active } = data;

    if (!username || !password || !fullname) return { ok: false, error: 'ข้อมูลไม่ครบ' };
    if (!/^[a-zA-Z0-9]+$/.test(username)) return { ok: false, error: 'Username ต้องเป็นตัวอักษร/ตัวเลข' };
    if (!/^\d{4,6}$/.test(String(password))) return { ok: false, error: 'รหัสผ่านต้องเป็นตัวเลข 4-6 หลัก' };

    const allData = sheet.getDataRange().getValues();
    const headers = allData[0];
    const rows = allData.slice(1);

    const usernameIdx = headers.indexOf('username');
    const existIdx = rows.findIndex(r => r[usernameIdx].toLowerCase() === username.toLowerCase());

    if (existIdx >= 0) {
      // Update existing user
      const rowNum = existIdx + 2; // +2 for header and 1-indexed
      sheet.getRange(rowNum, headers.indexOf('password') + 1).setValue(password);
      sheet.getRange(rowNum, headers.indexOf('fullname') + 1).setValue(fullname);
      sheet.getRange(rowNum, headers.indexOf('role') + 1).setValue(role || 'user');
      sheet.getRange(rowNum, headers.indexOf('active') + 1).setValue(active == 1 ? 1 : 0);
      sheet.getRange(rowNum, headers.indexOf('updatedAt') + 1).setValue(new Date().toLocaleString('th-TH'));
      return { ok: true, action: 'updated' };
    } else {
      // Create new user
      sheet.appendRow([username, password, fullname, role || 'user', active == 1 ? 1 : 0, new Date().toLocaleString('th-TH'), '']);
      return { ok: true, action: 'created' };
    }
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

function deleteUser(username) {
  try {
    if (username === 'admin') return { ok: false, error: 'ไม่สามารถลบบัญชี admin ได้' };
    const sheet = initUsersSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const usernameIdx = headers.indexOf('username');
    const rowIdx = data.slice(1).findIndex(r => r[usernameIdx] === username);
    if (rowIdx < 0) return { ok: false, error: 'ไม่พบผู้ใช้' };
    sheet.deleteRow(rowIdx + 2);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

function resetPassword(username, newPassword) {
  try {
    if (!/^\d{4,6}$/.test(String(newPassword))) return { ok: false, error: 'รหัสผ่านต้องเป็นตัวเลข 4-6 หลัก' };
    const sheet = initUsersSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const usernameIdx = headers.indexOf('username');
    const passwordIdx = headers.indexOf('password');
    const rowIdx = data.slice(1).findIndex(r => r[usernameIdx] === username);
    if (rowIdx < 0) return { ok: false, error: 'ไม่พบผู้ใช้' };
    sheet.getRange(rowIdx + 2, passwordIdx + 1).setValue(newPassword);
    sheet.getRange(rowIdx + 2, headers.indexOf('updatedAt') + 1).setValue(new Date().toLocaleString('th-TH'));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

// ================================================
// ER / EMS / PATIENTS / HISTORY DATA
// ================================================
function writeERData(data) {
  try {
    const headers = ['วันที่', 'เวร', 'ประเภท', 'Trauma', 'NonTrauma', 'รวม', 'เวลาบันทึก', 'บันทึกโดย'];
    const sheet = getOrCreateSheet(SHEET_ER, headers);
    const { date, shift, rows, loggedBy, loggedByFullname, timestamp } = data;
    (rows || []).forEach(r => {
      sheet.appendRow([date, shift, r.label, r.trauma, r.nontrauma, r.total, timestamp, loggedByFullname || loggedBy]);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

function writeEMSData(data) {
  try {
    const headers = ['วันที่', 'เวร', 'ประเภท', 'Trauma', 'NonTrauma', 'ALS', 'BLS', 'FR', 'รวม', 'เวลาบันทึก', 'บันทึกโดย'];
    const sheet = getOrCreateSheet(SHEET_EMS, headers);
    const { date, shift, rows, loggedBy, loggedByFullname, timestamp } = data;
    (rows || []).forEach(r => {
      sheet.appendRow([date, shift, r.label, r.trauma, r.nontrauma, r.als, r.bls, r.fr, r.total, timestamp, loggedByFullname || loggedBy]);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

function writePatientData(data) {
  try {
    const headers = ['วันที่', 'เวร', 'HN', 'เพศ', 'วินิจฉัย', 'สถานะ', 'ผลวิกฤต/LAB', 'แผนรักษา', 'หมายเหตุ', 'เวลาบันทึก', 'บันทึกโดย'];
    const sheet = getOrCreateSheet(SHEET_PATIENTS, headers);
    const { date, shift, rows, loggedBy, loggedByFullname, timestamp } = data;
    (rows || []).forEach(p => {
      sheet.appendRow([date, shift, p.hn, p.gender, p.dx, p.status, p.abnormal || '', p.todo || '', p.remark || '', timestamp, loggedByFullname || loggedBy]);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

function writeHistory(data) {
  try {
    const headers = ['ID', 'วันที่', 'เวร', 'ER', 'EMS', 'Admit', 'Refer', 'ผู้ป่วยส่งเวร', 'เจ้าหน้าที่', 'บันทึกโดย', 'ชื่อผู้บันทึก', 'เวลาบันทึก'];
    const sheet = getOrCreateSheet(SHEET_HISTORY, headers);
    const { id, date, shift, stats, staffDisplay, patients, loggedBy, loggedByFullname, timestamp } = data;
    sheet.appendRow([
      id, date, shift,
      parseInt(stats?.er) || 0,
      parseInt(stats?.ems) || 0,
      parseInt(stats?.admit) || 0,
      parseInt(stats?.refer) || 0,
      patients ? patients.length : 0,
      (staffDisplay || []).join(' | '),
      loggedBy || '',
      loggedByFullname || '',
      timestamp
    ]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

// ================================================
// ACTIVITY LOG
// ================================================
function writeLog(data) {
  try {
    const headers = ['เวลา', 'Username', 'ชื่อ-นามสกุล', 'กิจกรรม'];
    const sheet = getOrCreateSheet(SHEET_LOG, headers);
    const { ts, username, fullname, action } = data;
    sheet.appendRow([ts || new Date().toLocaleString('th-TH'), username, fullname, action]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

function getLogs() {
  try {
    const sheet = getOrCreateSheet(SHEET_LOG, ['เวลา', 'Username', 'ชื่อ-นามสกุล', 'กิจกรรม']);
    const logs = sheetToObjects(sheet);
    return { ok: true, logs: logs.reverse().slice(0, 200) };
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

// ================================================
// SETUP — รันครั้งแรก
// ================================================
function setupAllSheets() {
  initUsersSheet();
  getOrCreateSheet(SHEET_ER,       ['วันที่','เวร','ประเภท','Trauma','NonTrauma','รวม','เวลาบันทึก','บันทึกโดย']);
  getOrCreateSheet(SHEET_EMS,      ['วันที่','เวร','ประเภท','Trauma','NonTrauma','ALS','BLS','FR','รวม','เวลาบันทึก','บันทึกโดย']);
  getOrCreateSheet(SHEET_PATIENTS, ['วันที่','เวร','HN','เพศ','วินิจฉัย','สถานะ','ผลวิกฤต/LAB','แผนรักษา','หมายเหตุ','เวลาบันทึก','บันทึกโดย']);
  getOrCreateSheet(SHEET_HISTORY,  ['ID','วันที่','เวร','ER','EMS','Admit','Refer','ผู้ป่วยส่งเวร','เจ้าหน้าที่','บันทึกโดย','ชื่อผู้บันทึก','เวลาบันทึก']);
  getOrCreateSheet(SHEET_LOG,      ['เวลา','Username','ชื่อ-นามสกุล','กิจกรรม']);

  SpreadsheetApp.getUi().alert('✅ ตั้งค่า Sheets เรียบร้อยแล้ว!\n\nบัญชี Admin เริ่มต้น:\nUsername: admin\nรหัสผ่าน: 1234\n\nกรุณาเปลี่ยนรหัสผ่านหลังใช้งานครั้งแรก');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ ER Handover')
    .addItem('🔧 ตั้งค่า Sheets ทั้งหมด', 'setupAllSheets')
    .addSeparator()
    .addItem('👥 ดูรายชื่อผู้ใช้', 'showUsers')
    .addToUi();
}

function showUsers() {
  const sheet = initUsersSheet();
  const users = sheetToObjects(sheet);
  const msg = users.map(u => `${u.username} | ${u.fullname} | ${u.role} | ${u.active==1?'เปิด':'ปิด'}`).join('\n');
  SpreadsheetApp.getUi().alert('👥 รายชื่อผู้ใช้:\n\n' + (msg || '(ไม่มีข้อมูล)'));
}
