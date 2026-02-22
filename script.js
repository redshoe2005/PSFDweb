let jsonData = []; // 全域變數用來存放讀取的 JSON 資料
let selectedVariables = [];
let currentGroupName = "";         // ✅ 空字串代表「Home / 初始狀態」
let selectedSamples = [];          // 已選年份
let previousView = "main-view";    // 預設上一頁是 main-view

let sampleNames = [];              // 例如 ["CII2002", "CIII2004", ...]
let topicMap = {};                 // qid -> topic
let searchQuery = "";              // ✅ 搜尋字串（新增）

// 題組清單（左側 sidebar）
const variableGroups = [
  { id: "A 基本資料", label: "A 基本資料" },
  { id: "B 教育", label: "B 教育" },
  { id: "C 工作", label: "C 工作" },
  { id: "D 交往、婚姻與配偶資訊", label: "D 交往、婚姻與配偶資訊" },
  { id: "E 退休", label: "E 退休" },
  { id: "F 居住", label: "F 居住" },
  { id: "G 子女", label: "G 子女" },
  { id: "H 父母", label: "H 父母" },
  { id: "J 兄弟姊妹", label: "J 兄弟姊妹" },
  { id: "K 家庭決策與支出", label: "K 家庭決策與支出" },
  { id: "L 老年", label: "L 老年" },
  { id: "S 態度量表", label: "S 態度量表" },
  { id: "Selected Questions", label: "Selected Questions" } // cart
];

// 資料容器
const data = {
  "A 基本資料": [],
  "B 教育": [],
  "C 工作": [],
  "D 交往、婚姻與配偶資訊": [],
  "E 退休": [],
  "F 居住": [],
  "G 子女": [],
  "H 父母": [],
  "J 兄弟姊妹": [],
  "K 家庭決策與支出": [],
  "L 老年": [],
  "S 態度量表": [],
  "Selected Questions": []
};

// ========== ✅ CSV 解析（簡易版） ==========
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (lines.length === 0) return [];

  const headers = lines[0].split(",").map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const obj = {};
    headers.forEach((h, idx) => obj[h] = (cols[idx] ?? "").trim());
    rows.push(obj);
  }
  return rows;
}

function buildTopicMapFromCsvRows(rows) {
  const map = {};
  rows.forEach(r => {
    const qid = (r["question_column"] || "").trim();
    const topic = (r["topic"] || "").trim();
    if (!qid || !topic) return;
    map[qid] = topic;
  });
  return map;
}

// ========== 工具：從目前 data 裡找題目（購物車用） ==========
function findQuestionById(qid) {
  for (const groupLabel of Object.keys(data)) {
    if (groupLabel === "Selected Questions") continue;
    const list = data[groupLabel] || [];
    const found = list.find(item => item.number === qid);
    if (found) return found;
  }
  return null;
}

function buildSelectedQuestionsForCart() {
  const selectedList = [];
  selectedVariables.forEach(qid => {
    const q = findQuestionById(qid);
    if (q) {
      selectedList.push({
        number: q.number,
        name: q.name,
        desc: q.desc,
        values: q.values
      });
    }
  });
  data["Selected Questions"] = selectedList;
}

// ========== ✅ 用 topicMap 來分群 ==========
function buildGroupsFromJson(jsonData) {
  if (!jsonData || jsonData.length === 0) return;

  Object.keys(data).forEach(groupLabel => {
    if (groupLabel !== "Selected Questions") data[groupLabel] = [];
  });

  const allKeys = Object.keys(jsonData[0]);
  const questionKeys = allKeys.filter(k => k !== "YEAR" && k !== "ID");

  questionKeys.forEach(qid => {
    const groupLabel = topicMap[qid];
    if (!groupLabel || !data[groupLabel]) return;

    let rawText = "";
    for (let i = 0; i < jsonData.length; i++) {
      const val = jsonData[i][qid];
      if (val && val.trim() !== "") {
        rawText = val.trim();
        break;
      }
    }
    if (!rawText) return;

    const parts = rawText.split("｜");
    const code = parts[0] ? parts[0].trim() : "";
    const questionText = parts[1] ? parts[1].trim() : rawText;

    const presence = sampleNames.map((_, idx) => {
      const row = jsonData[idx];
      const v = row[qid];
      return (v && v.trim() !== "") ? "✓" : "";
    });

    data[groupLabel].push({
      number: qid,
      name: code,
      desc: questionText,
      values: presence
    });
  });

  Object.keys(data).forEach(groupLabel => {
    if (groupLabel === "Selected Questions") return;
    data[groupLabel].sort((a, b) => {
      const na = Number(a.number);
      const nb = Number(b.number);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return (a.number + "").localeCompare(b.number + "");
    });
  });
}

// ========== ✅ 搜尋：Home = 全部分類；分類頁 = 該分類 ==========
function getRowsForCurrentSearchScope(groupName) {
  const isHome = (!groupName || groupName.trim() === "");
  if (isHome) {
    const all = [];
    Object.keys(data).forEach(g => {
      if (g === "Selected Questions") return;
      (data[g] || []).forEach(item => {
        all.push({ ...item, __group: g });
      });
    });
    return all;
  }
  return (data[groupName] || []).map(item => ({ ...item, __group: groupName }));
}

function matchRowByQuery(row, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  const hay = [row.number, row.name, row.desc, row.__group].join(" ").toLowerCase();
  return hay.includes(needle);
}

// ========== Sidebar ==========
const groupListEl = document.getElementById("group-list");

variableGroups.forEach(g => {
  const li = document.createElement("li");
  li.textContent = g.label;

  li.onclick = () => {
    // active UI
    document.querySelectorAll("#group-list li").forEach(x => x.classList.remove("active"));
    li.classList.add("active");

    // 切換到該分類
    currentGroupName = g.id;
    loadGroup(g.id, g.id === "Selected Questions");

    // 切回主畫面
    document.getElementById('cart-view').style.display = 'none';
    document.getElementById('sample-view').style.display = 'none';
    document.getElementById('main-view').style.display = 'block';
  };

  groupListEl.appendChild(li);
});

// ========== 勾選題目（加入購物車） ==========
function updateCart(questionId, isChecked) {
  if (isChecked) {
    if (!selectedVariables.includes(questionId)) {
      selectedVariables.push(questionId);
    }
  } else {
    selectedVariables = selectedVariables.filter(v => v !== questionId);
  }
  document.getElementById("variable-count").textContent = selectedVariables.length;
  updateExtractButton();
}

// ========== View 切換 ==========
function showCartView() {
  buildSelectedQuestionsForCart();

  document.getElementById('main-view').style.display = 'none';
  document.getElementById('sample-view').style.display = 'none';
  document.getElementById('cart-view').style.display = 'block';

  loadGroup("Selected Questions", true);
  updateExtractButton();
}

function goBack() {
  document.getElementById('cart-view').style.display = 'none';
  document.getElementById('sample-view').style.display = 'none';
  document.getElementById('main-view').style.display = 'block';

  // 回到「當前分類」；若沒選分類則留在 home（可用搜尋全題庫）
  loadGroup(currentGroupName, false);
}

function selectSample() {
  if (document.getElementById('main-view').style.display !== 'none') {
    previousView = "main-view";
  } else if (document.getElementById('cart-view').style.display !== 'none') {
    previousView = "cart-view";
  }

  document.getElementById('main-view').style.display = 'none';
  document.getElementById('sample-view').style.display = 'block';
  document.getElementById('cart-view').style.display = 'none';

  const tbody = document.querySelector('#years-table tbody');
  tbody.innerHTML = '';

  sampleNames.forEach(sample => {
    const row = document.createElement('tr');

    const selectCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = sample;
    checkbox.checked = selectedSamples.includes(sample);
    checkbox.onchange = function () {
      if (this.checked) {
        if (!selectedSamples.includes(sample)) selectedSamples.push(sample);
      } else {
        selectedSamples = selectedSamples.filter(s => s !== sample);
      }
      document.getElementById('sample-count').textContent = selectedSamples.length;
      updateExtractButton();
    };
    selectCell.appendChild(checkbox);
    row.appendChild(selectCell);

    const nameCell = document.createElement('td');
    nameCell.textContent = sample;
    row.appendChild(nameCell);

    tbody.appendChild(row);
  });
}

function confirmSample() {
  document.getElementById('sample-view').style.display = 'none';
  document.getElementById(previousView).style.display = 'block';
  document.getElementById('sample-count').textContent = selectedSamples.length;
  updateExtractButton();

  // 回來後如果是 main-view，就重畫（讓 sample 勾勾欄仍保留）
  if (previousView === "main-view") loadGroup(currentGroupName, false);
  if (previousView === "cart-view") loadGroup("Selected Questions", true);
}

function updateExtractButton() {
  const extractBtn = document.getElementById('extract-btn');
  if (!extractBtn) return;
  if (selectedVariables.length > 0 && selectedSamples.length > 0) {
    extractBtn.style.display = 'inline-block';
  } else {
    extractBtn.style.display = 'none';
  }
}

// ========== 標題更新（修掉重複 id） ==========
function setMainTitle(text) {
  document.getElementById("group-title-main").textContent = text;
}
function setCartTitle(text) {
  document.getElementById("group-title-cart").textContent = text;
}
function setSampleTitle(text) {
  document.getElementById("group-title-sample").textContent = text;
}

// ========== 表格 ==========
function loadGroup(groupName, isCartView = false) {
  let tableHead, tableBody;

  if (isCartView) {
    setCartTitle("Data Cart");
    tableHead = document.querySelector("#cart-table-head");
    tableBody = document.querySelector("#cart-table-body");
  } else {
    // Home (groupName==""), 或分類
    setMainTitle(groupName && groupName.trim() ? groupName : "Select a Variable Group (Home: search all)");
    tableHead = document.getElementById("table-head");
    tableBody = document.getElementById("table-body");
  }

  tableHead.innerHTML = "";
  tableBody.innerHTML = "";

  // 表頭
  const headRow = document.createElement("tr");
  const baseHeaders = ["Select", "Number", "Question", "Description", "Codes"];
  baseHeaders.concat(sampleNames).forEach((title, index) => {
    const th = document.createElement("th");
    th.textContent = title;
    if (index < 5) th.classList.add("sticky");
    headRow.appendChild(th);
  });
  tableHead.appendChild(headRow);

  // rows: cart 固定 Selected Questions；main 則依 group/home
  let rows = [];
  if (isCartView) {
    rows = data["Selected Questions"] || [];
  } else {
    rows = getRowsForCurrentSearchScope(groupName);
    // ✅ Home 且沒輸入搜尋：不要塞滿整張表（避免太重）
    if ((!groupName || groupName.trim() === "") && (!searchQuery || !searchQuery.trim())) {
      // 顯示提示列
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5 + sampleNames.length;
      td.style.textAlign = "left";
      td.style.padding = "14px";
      td.style.color = "#64748b";
      td.style.fontWeight = "700";
      td.textContent = "Type in the search box to search across ALL groups. (選分類後則只搜尋該分類)";
      tr.appendChild(td);
      tableBody.appendChild(tr);
      return;
    }
  }

  // 套用搜尋
  const q = (searchQuery || "").trim();
  if (q) rows = rows.filter(r => matchRowByQuery(r, q));

  // 實際資料
  rows.forEach(variable => {
    const row = document.createElement("tr");

    // Select
    const selectCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedVariables.includes(variable.number);
    checkbox.onchange = () => updateCart(variable.number, checkbox.checked);
    selectCell.appendChild(checkbox);
    row.appendChild(selectCell);

    // Number
    const numberCell = document.createElement("td");
    numberCell.textContent = variable.number;
    row.appendChild(numberCell);

    // Question
    const qCell = document.createElement("td");
    qCell.textContent = variable.desc || variable.name;
    row.appendChild(qCell);

    // Description
    const descCell = document.createElement("td");
    descCell.textContent = "";
    row.appendChild(descCell);

    // Codes
    const codesCell = document.createElement("td");
    codesCell.textContent = variable.name;
    row.appendChild(codesCell);

    // sample 勾勾
    (variable.values || []).forEach(val => {
      const td = document.createElement("td");
      td.textContent = val;
      row.appendChild(td);
    });

    tableBody.appendChild(row);
  });
}

// ========== Extract ==========
function getExportHeaderForQuestion(qid) {
  const q = findQuestionById(qid);
  if (!q) return qid;
  return `${qid}_${q.name}`;
}

function escapeCsv(val) {
  const str = (val ?? "").toString();
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

document.getElementById("extract-btn").addEventListener("click", () => {
  if (selectedVariables.length === 0) {
    alert("請先勾選至少一個題目！");
    return;
  }
  if (selectedSamples.length === 0) {
    alert("請先勾選至少一個 sample！");
    return;
  }

  const headers = [
    "YEAR",
    ...selectedVariables.map(qid => getExportHeaderForQuestion(qid)),
    "ID"
  ];

  const rows = [];
  rows.push(headers.join(","));

  fetch('./merged_survey.csv')
    .then(resp => resp.text())
    .then(csvText => {
      const lines = csvText.split(/\r?\n/);
      if (lines.length === 0) {
        alert("CSV 內容是空的");
        return;
      }

      const headerCols = lines[0].split(',');
      const yearIdx = headerCols.indexOf("YEAR");
      const idIdx = headerCols.indexOf("ID");

      const questionIdxMap = {};
      selectedVariables.forEach(qid => {
        const idx = headerCols.indexOf(qid);
        if (idx !== -1) questionIdxMap[qid] = idx;
      });

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const cols = line.split(',');

        const rowYear = cols[yearIdx];
        if (!selectedSamples.includes(rowYear)) continue;

        const outRow = [];
        outRow.push(escapeCsv(rowYear));

        selectedVariables.forEach(qid => {
          const idx = questionIdxMap[qid];
          const val = idx !== undefined ? (cols[idx] || "") : "";
          outRow.push(escapeCsv(val));
        });

        const idVal = idIdx !== -1 ? (cols[idIdx] || "") : "";
        outRow.push(escapeCsv(idVal));

        rows.push(outRow.join(","));
      }

      const csvContent = rows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "data_extract.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    })
    .catch(err => {
      console.error(err);
      alert("讀取資料時發生錯誤");
    });
});

// ========== ✅ 主程式：先載入 question_topics.csv 再載入 merged_survey_first19.json ==========
Promise.all([
  fetch('./question_topics.csv').then(r => r.text()),
  fetch('./merged_survey_first19.json').then(r => r.json())
])
.then(([csvText, metaData]) => {
  // 1) topicMap
  const csvRows = parseCSV(csvText);
  topicMap = buildTopicMapFromCsvRows(csvRows);

  // 2) jsonData + sampleNames
  jsonData = metaData;
  sampleNames = jsonData.map(r => r.YEAR).filter(Boolean);

  // 3) 建立題組
  buildGroupsFromJson(jsonData);

  // 4) 初始化 counts
  document.getElementById("variable-count").textContent = selectedVariables.length;
  document.getElementById("sample-count").textContent = selectedSamples.length;

  // 5) ✅ 綁定搜尋框事件
  const searchInput = document.getElementById("search-input");
  const searchClear = document.getElementById("search-clear");

  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value || "";

    // cart-view: 重新 render cart
    if (document.getElementById('cart-view').style.display !== 'none') {
      loadGroup("Selected Questions", true);
      return;
    }

    // sample-view 不搜尋（需要我也可以幫你加）
    if (document.getElementById('sample-view').style.display !== 'none') return;

    // main-view: 若 currentGroupName=="" 就會搜全分類
    loadGroup(currentGroupName, false);
  });

  searchClear.addEventListener("click", () => {
    searchQuery = "";
    searchInput.value = "";

    if (document.getElementById('cart-view').style.display !== 'none') {
      loadGroup("Selected Questions", true);
      return;
    }
    if (document.getElementById('sample-view').style.display !== 'none') return;

    loadGroup(currentGroupName, false);
  });

  // 6) ✅ 初始畫面：不塞滿全表，只顯示提示（輸入搜尋才會顯示結果）
  currentGroupName = "";
  loadGroup(currentGroupName, false);

  // sample title 固定
  setSampleTitle("Select Sample Years");
})
.catch(err => console.error('讀取錯誤:', err));
