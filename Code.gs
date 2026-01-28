// NOTE: After updating this file, redeploy the Apps Script web app for changes to take effect.

const CONFIG_SHEET_NAME = "config";
const AUDIT_SHEET_NAME = "audit";
const API_KEY = "IwillUpdatethepaswordlater";
const CHUNK_SIZE = 45000;
const DEFAULT_CONFIG = { version: 1, models: {} };

function doGet(e) {
  try {
    enforceApiKey_(e);
    const sheet = getConfigSheet_();
    const keyValues = readKeyValues_(sheet);
    const meta = {
      updated_at: keyValues.updated_at || "",
      updated_by: keyValues.updated_by || "",
      schema_version: keyValues.schema_version || ""
    };

    const partsCount = parseInt(keyValues.config_parts_count, 10);
    if (!Number.isFinite(partsCount) || partsCount < 1) {
      if (keyValues.config_json) {
        const data = JSON.parse(keyValues.config_json);
        return jsonResponse_({ ok: true, data: data, meta: meta });
      }
      return jsonResponse_({ ok: true, data: DEFAULT_CONFIG, meta: meta });
    }

    const parts = [];
    for (var i = 1; i <= partsCount; i++) {
      parts.push(keyValues["config_part_" + i] || "");
    }
    const raw = parts.join("");
    const parsed = raw ? JSON.parse(raw) : DEFAULT_CONFIG;
    return jsonResponse_({ ok: true, data: parsed, meta: meta });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    enforceApiKey_(e);
    const sheet = getConfigSheet_();
    const keyValues = readKeyValues_(sheet);
    const payload = getPayloadString_(e);

    if (!payload) {
      throw new Error("Missing payload.");
    }

    const obj = JSON.parse(payload);
    if (!obj || typeof obj !== "object" || !obj.models || typeof obj.models !== "object") {
      throw new Error("Invalid config: models must be an object.");
    }

    const serialized = JSON.stringify(obj);
    const parts = chunkString_(serialized, CHUNK_SIZE);

    upsertKeyValue_(sheet, "config_parts_count", String(parts.length));
    parts.forEach(function (part, index) {
      upsertKeyValue_(sheet, "config_part_" + (index + 1), part);
    });

    const previousCount = parseInt(keyValues.config_parts_count, 10);
    if (Number.isFinite(previousCount) && previousCount > parts.length) {
      for (var i = parts.length + 1; i <= previousCount; i++) {
        upsertKeyValue_(sheet, "config_part_" + i, "");
      }
    }

    upsertKeyValue_(sheet, "config_json", "");
    const now = new Date();
    const updatedBy = Session.getActiveUser().getEmail() || "unknown";
    upsertKeyValue_(sheet, "updated_at", now.toISOString());
    upsertKeyValue_(sheet, "updated_by", updatedBy);

    appendAuditRow_(now, updatedBy, serialized.length, parts.length);

    return jsonResponse_({ ok: true });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err.message || err) });
  }
}

function enforceApiKey_(e) {
  if (!API_KEY) {
    return;
  }
  const provided = getProvidedKey_(e);
  if (!provided || provided !== API_KEY) {
    throw new Error("Unauthorized");
  }
}

function getProvidedKey_(e) {
  if (e && e.parameter && e.parameter.key) {
    return String(e.parameter.key);
  }
  if (e && e.postData && e.postData.contents) {
    const params = parseQueryString_(e.postData.contents);
    if (params.key) {
      return params.key;
    }
  }
  return "";
}

function getPayloadString_(e) {
  if (e && e.parameter && e.parameter.payload) {
    return String(e.parameter.payload);
  }
  if (e && e.postData && e.postData.contents) {
    const params = parseQueryString_(e.postData.contents);
    if (params.payload) {
      return params.payload;
    }
    return String(e.postData.contents);
  }
  return "";
}

function parseQueryString_(raw) {
  const result = {};
  if (!raw) {
    return result;
  }
  raw.split("&").forEach(function (pair) {
    const idx = pair.indexOf("=");
    if (idx === -1) {
      return;
    }
    const key = decodeURIComponent(pair.slice(0, idx));
    const value = decodeURIComponent(pair.slice(idx + 1));
    result[key] = value;
  });
  return result;
}

function chunkString_(value, size) {
  const chunks = [];
  for (var i = 0; i < value.length; i += size) {
    chunks.push(value.slice(i, i + size));
  }
  return chunks.length ? chunks : [""];
}

function getConfigSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = findSheetByName_(ss, CONFIG_SHEET_NAME);
  if (!sheet) {
    throw new Error("Config sheet not found.");
  }
  return sheet;
}

function findSheetByName_(ss, name) {
  const direct = ss.getSheetByName(name);
  if (direct) {
    return direct;
  }
  const target = String(name || "").toLowerCase();
  const all = ss.getSheets();
  for (var i = 0; i < all.length; i++) {
    if (String(all[i].getName()).toLowerCase() === target) {
      return all[i];
    }
  }
  return null;
}

function readKeyValues_(sheet) {
  const range = sheet.getDataRange();
  const values = range.getValues();
  const map = {};
  for (var i = 0; i < values.length; i++) {
    const key = values[i][0];
    if (!key) {
      continue;
    }
    map[String(key).trim()] = values[i][1] !== undefined ? String(values[i][1]) : "";
  }
  return map;
}

function upsertKeyValue_(sheet, key, value) {
  const range = sheet.getDataRange();
  const values = range.getValues();
  const trimmedKey = String(key).trim();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === trimmedKey) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([trimmedKey, value]);
}

function appendAuditRow_(timestamp, updatedBy, configSize, partsCount) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const auditSheet = findSheetByName_(ss, AUDIT_SHEET_NAME);
  if (!auditSheet) {
    return;
  }
  auditSheet.appendRow([
    timestamp.toISOString(),
    updatedBy,
    "config_update",
    configSize,
    partsCount
  ]);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
