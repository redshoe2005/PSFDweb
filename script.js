let jsonData = []; // 全域變數用來存放讀取的 JSON 資料
let selectedVariables = [];
let currentGroupName = "";
let selectedSamples = []; // 新增：已選年份
let previousView = "main-view"; // 預設上一頁是 main-view

// 年份標題
// 這裡不要寫死，用匯入的 JSON 裡的 YEAR 來生
let sampleNames = [];   // 例如 ["CII2002", "CIII2004", "CV2008", ...]
let responsesData = [];   // 放 merged_survey_responses.json（第20列以後，每人一筆）


// 模擬變數資料（含該變數在不同年份的狀態）
// 題組清單（你附圖那幾個）
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
  // 保留一個給購物車用的
  { id: "Selected Questions", label: "Selected Questions" }
];

// 這是之後 loadGroup 要用的容器，先準備好 key
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

const groupNameMap = {
  "A": "A 基本資料",
  "B": "B 教育",
  "C": "C 工作",
  "D": "D 交往、婚姻與配偶資訊",
  "E": "E 退休",
  "F": "F 居住",
  "G": "G 子女",
  "H": "H 父母",
  "J": "J 兄弟姊妹",
  "K": "K 家庭決策與支出",
  "L": "L 老年",
  "S": "S 態度量表"
};

function findQuestionById(qid) {
  // 不要找 Selected Questions 自己，避免迴圈
  const allGroupLabels = Object.values(groupNameMap);
  for (const label of allGroupLabels) {
    const list = data[label] || [];
    const found = list.find(item => item.number === qid);
    if (found) {
      return found;
    }
  }
  return null;
}


function buildSelectedQuestionsForCart() {
  const selectedList = [];
  selectedVariables.forEach(qid => {
    const q = findQuestionById(qid);
    if (q) {
      // 複製一份，避免之後改到原本的
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


function buildGroupsFromJson(jsonData) {
  if (!jsonData || jsonData.length === 0) return;

  // 進來時 sampleNames 應該已經是 ["CII2002", "CIII2004", ...]
  // 先清空各組
  Object.values(groupNameMap).forEach(groupLabel => {
    data[groupLabel] = [];
  });

  // 全部題號（欄位名）
  const allKeys = Object.keys(jsonData[0]);
  const questionKeys = allKeys.filter(k => k !== "YEAR" && k !== "ID");

  questionKeys.forEach(qid => {
    // 找這題在不同 sample 裡「第一個有字的版本」
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
    const questionText = parts[1] ? parts[1].trim() : "";

    if (!code) return;

    const firstLetter = code[0].toUpperCase();
    const groupLabel = groupNameMap[firstLetter];
    if (!groupLabel) {
      // 不在我們要的 A/B/C... 就先略過
      return;
    }

    // 這裡開始做「這題在哪些 sample 出現」
    // jsonData[i] 的順序就跟 sampleNames[i] 對得上
    const presence = sampleNames.map((_, idx) => {
      const row = jsonData[idx];
      const v = row[qid];
      return (v && v.trim() !== "") ? "✓" : "";   // 有值就打勾，沒有就空白
    });

    data[groupLabel].push({
      number: qid,         // 題目編號
      name: code,          // 題目代碼
      desc: questionText,  // 題目文字
      values: presence     // ← 這就是表格後面要顯示的一整排勾勾
    });
  });

  // 排序一下題號，比較好看
  Object.values(groupNameMap).forEach(groupLabel => {
    data[groupLabel].sort((a, b) => {
      const na = Number(a.number);
      const nb = Number(b.number);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return (a.number + "").localeCompare(b.number + "");
    });
  });
}


// 動態產生左邊的題組清單
const groupListEl = document.getElementById("group-list");
variableGroups.forEach(g => {
  const li = document.createElement("li");
  li.textContent = g.label;
  li.onclick = () => {
    currentGroupName = g.id;       // 記錄目前選到哪一組
    loadGroup(g.id);               // 叫你原本的畫表函式
    // 切回主畫面（如果你目前在 cart 或 sample）
    document.getElementById('cart-view').style.display = 'none';
    document.getElementById('sample-view').style.display = 'none';
    document.getElementById('main-view').style.display = 'block';
  };
  groupListEl.appendChild(li);
});



// 當點選群組時，載入對應的變數資料
function updateCart(questionId, isChecked) {
  if (isChecked) {
    if (!selectedVariables.includes(questionId)) {
      selectedVariables.push(questionId);
    }
  } else {
    selectedVariables = selectedVariables.filter(v => v !== questionId);
  }
  document.getElementById("variable-count").textContent = selectedVariables.length;
  updateExtractButton();  // 勾勾變化時順便更新一下按鈕顯示
}


function showCartView() {
  // 先用現在勾到的題號，做出購物車的資料
  buildSelectedQuestionsForCart();

  document.getElementById('main-view').style.display = 'none';
  document.getElementById('sample-view').style.display = 'none';
  document.getElementById('cart-view').style.display = 'block';

  // 這裡才畫表
  loadGroup("Selected Questions", true);
  updateExtractButton();
}


function goBack() {
  document.getElementById('cart-view').style.display = 'none';
  document.getElementById('sample-view').style.display = 'none';
  document.getElementById('main-view').style.display = 'block';
  loadGroup(currentGroupName); // 重新載入目前群組
  console.log("返回主畫面，載入群組:", currentGroupName);
}

function selectSample() {
  // 記錄目前顯示的 view
  if (document.getElementById('main-view').style.display !== 'none') {
    previousView = "main-view";
  } else if (document.getElementById('cart-view').style.display !== 'none') {
    previousView = "cart-view";
  }

  document.getElementById('main-view').style.display = 'none';
  document.getElementById('sample-view').style.display = 'block';
  document.getElementById('cart-view').style.display = 'none';

  // 動態產生 sample 表格
  const tbody = document.querySelector('#years-table tbody');
  tbody.innerHTML = '';

  // sampleNames 是我們讀 JSON 時抓到的 YEAR 陣列
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
}


function updateExtractButton() {
  const extractBtn = document.getElementById('extract-btn');
  // 只有當 sample 和 variable 都有選時才顯示
  if (selectedVariables.length > 0 && selectedSamples.length > 0) {
    extractBtn.style.display = 'inline-block';
  } else {
    extractBtn.style.display = 'none';
  }
}


function getExportHeaderForQuestion(qid) {
  const q = findQuestionById(qid);
  if (!q) return qid;  // 找不到就用編號
  // 你可以改成 `${qid}_${q.name}` 或 `${qid}_${q.desc}`
  // 我先給你一個比較好看的：編號+代碼
  return `${qid}_${q.name}`;
}


// 載入群組
function loadGroup(groupName, isCartView = false) {
  let tableHead, tableBody;
  document.getElementById("group-title").textContent = groupName;

  if (isCartView) {
    tableHead = document.querySelector("#cart-table-head");
    tableBody = document.querySelector("#cart-table-body");
  } else {
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

  // 實際資料
  const rows = data[groupName] || [];
  rows.forEach((variable, rowIndex) => {
    const row = document.createElement("tr");

    // Select
    const selectCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    // 用題號當 key
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
    descCell.textContent = ""; // 你要放別的也行
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


// 主函式///////////////////////

// 讀取 JSON 資料
// 只抓題目那份（前19列）→ 這個檔不大
fetch('./merged_survey_first19.json')
  .then(r => r.json())
  .then(metaData => {
    jsonData = metaData;

    // 建立 sample 名稱
    sampleNames = jsonData.map(r => r.YEAR).filter(Boolean);

    // 建立題組
    buildGroupsFromJson(jsonData);
  })
  .catch(err => console.error('讀取錯誤:', err));



function escapeCsv(val) {
  const str = val.toString();
  // 如果有逗號或雙引號，就用雙引號包起來
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

  // 我們要輸出的表頭：YEAR + (勾的題目) + ID
  const headers = [
    "YEAR",
    ...selectedVariables.map(qid => getExportHeaderForQuestion(qid)),
    "ID"
  ];

  // 先做一個陣列裝結果
  const rows = [];
  rows.push(headers.join(","));

  // 去抓原始 CSV（大的那個）
  fetch('./merged_survey.csv')
    .then(resp => resp.text())
    .then(csvText => {
      const lines = csvText.split(/\r?\n/);

      if (lines.length === 0) {
        alert("CSV 內容是空的");
        return;
      }

      // 第 1 行是欄位名
      const headerLine = lines[0];
      const headerCols = headerLine.split(',');

      // 找出我們需要的欄位 index：YEAR、ID、以及勾的題號
      const yearIdx = headerCols.indexOf("YEAR");
      const idIdx = headerCols.indexOf("ID");

      // 題號 → index 的對照
      const questionIdxMap = {};
      selectedVariables.forEach(qid => {
        const idx = headerCols.indexOf(qid);
        if (idx !== -1) {
          questionIdxMap[qid] = idx;
        }
      });

      // 從第 20 行開始才是受訪者（你說的第 20 列以後），但是這裡我們乾脆從第 2 行開始掃，遇到不是我們要的 sample 就跳過
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue; // 空行跳過
        const cols = line.split(',');

        const rowYear = cols[yearIdx];
        if (!selectedSamples.includes(rowYear)) {
          continue; // 不是勾的 sample 就略過
        }

        const outRow = [];
        // YEAR
        outRow.push(escapeCsv(rowYear));
        // 每個勾的題目
        selectedVariables.forEach(qid => {
          const idx = questionIdxMap[qid];
          const val = idx !== undefined ? (cols[idx] || "") : "";
          outRow.push(escapeCsv(val));
        });
        // ID
        const idVal = idIdx !== -1 ? (cols[idIdx] || "") : "";
        outRow.push(escapeCsv(idVal));

        rows.push(outRow.join(","));
      }

      // 全部組完，下載
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
