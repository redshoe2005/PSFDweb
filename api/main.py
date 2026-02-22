from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
import csv
import tempfile

import boto3
from botocore.config import Config


app = FastAPI()

# ✅ 先用 * 方便測試；穩定後可改成只允許 GitHub Pages 網域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ====== R2 / CSV 設定（用 Render 環境變數） ======
R2_ENDPOINT = os.environ.get("R2_ENDPOINT")  # e.g. https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")
R2_BUCKET = os.environ.get("R2_BUCKET")
R2_OBJECT_KEY = os.environ.get("R2_OBJECT_KEY", "merged_survey.csv")  # 你在 R2 的 object key

LOCAL_CSV_PATH = os.environ.get("LOCAL_CSV_PATH", "/tmp/merged_survey.csv")

# 你的 merged_survey.csv 結構：第2~18列是題目列（共17列），第19列後才是答案列
QUESTION_ROWS_COUNT = int(os.environ.get("QUESTION_ROWS_COUNT", "18"))


class ExtractRequest(BaseModel):
    samples: list[str]        # 例如 ["CII2002","RR2002", ...]
    variables: list[str]      # 題號欄位，例如 ["91","92"]
    exportHeaders: list[str]  # 對應 variables 的輸出欄名，例如 ["91_d17a1","92_d19"]

def normalize_header(h: str) -> str:
    return (h or "").strip().lstrip("\ufeff")

def ensure_csv_local():
    """確保大 CSV 已下載到本機（Render 的 /tmp 可用）"""
    if os.path.exists(LOCAL_CSV_PATH) and os.path.getsize(LOCAL_CSV_PATH) > 0:
        return

    missing = [k for k, v in {
        "R2_ENDPOINT": R2_ENDPOINT,
        "R2_ACCESS_KEY_ID": R2_ACCESS_KEY_ID,
        "R2_SECRET_ACCESS_KEY": R2_SECRET_ACCESS_KEY,
        "R2_BUCKET": R2_BUCKET,
    }.items() if not v]
    if missing:
        raise RuntimeError(f"Missing env vars: {', '.join(missing)}")

    s3 = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )

    os.makedirs(os.path.dirname(LOCAL_CSV_PATH), exist_ok=True)
    s3.download_file(R2_BUCKET, R2_OBJECT_KEY, LOCAL_CSV_PATH)


@app.on_event("startup")
def startup():
    # 啟動就先下載一次，避免第一次 Extract 才等很久
    ensure_csv_local()


@app.get("/health")
def health():
    ok = os.path.exists(LOCAL_CSV_PATH) and os.path.getsize(LOCAL_CSV_PATH) > 0
    return {
        "ok": True,
        "csv_ready": ok,
        "path": LOCAL_CSV_PATH,
        "object_key": R2_OBJECT_KEY,
        "question_rows_count": QUESTION_ROWS_COUNT
    }
@app.get("/debug_header")
def debug_header():
    ensure_csv_local()
    with open(LOCAL_CSV_PATH, "r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header_raw = next(reader, None)
    header = [normalize_header(h) for h in (header_raw or [])]
    return {"header_raw_first5": (header_raw or [])[:5], "header_norm_first5": header[:5]}


@app.post("/extract")
def extract(req: ExtractRequest):
    if len(req.samples) == 0:
        raise HTTPException(status_code=400, detail="samples is empty")
    if len(req.variables) == 0:
        raise HTTPException(status_code=400, detail="variables is empty")
    if len(req.exportHeaders) != len(req.variables):
        raise HTTPException(status_code=400, detail="exportHeaders must match variables length")

    ensure_csv_local()

    # ✅ sample code 精準比對（同一年可能有兩個 sample，所以不要用 4 位數年份）
    allowed_samples = set((s or "").strip() for s in req.samples)

    variables = req.variables
    export_headers = req.exportHeaders

    # 先讀 header 計算 index（避免中途才出錯）
    with open(LOCAL_CSV_PATH, "r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if not header:
            raise HTTPException(status_code=500, detail="CSV is empty")

        if "YEAR" not in header:
            raise HTTPException(status_code=500, detail="YEAR column not found")

        year_idx = header.index("YEAR")
        id_idx = header.index("ID") if "ID" in header else None

        idx_map = {qid: (header.index(qid) if qid in header else None) for qid in variables}

    # ✅ 先寫到暫存檔再回傳（避免 Streaming 空檔）
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".csv", mode="w", encoding="utf-8", newline="")
    out_path = tmp.name
    writer = csv.writer(tmp)

    out_header = ["YEAR", *export_headers]
    if id_idx is not None:
        out_header.append("ID")
    writer.writerow(out_header)

    with open(LOCAL_CSV_PATH, "r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        next(reader, None)  # skip header row

        # ✅ 跳過題目列（第2~18列，共 17 列）
        for _ in range(QUESTION_ROWS_COUNT):
            next(reader, None)

        # ✅ 從答案列開始
        for row in reader:
            if not row:
                continue
            if year_idx >= len(row):
                continue

            sample = (row[year_idx] or "").strip()
            if sample not in allowed_samples:
                continue

            out = [sample]
            for qid in variables:
                idx = idx_map.get(qid)
                out.append(row[idx] if (idx is not None and idx < len(row)) else "")

            if id_idx is not None:
                out.append(row[id_idx] if id_idx < len(row) else "")

            writer.writerow(out)

    tmp.close()

    return FileResponse(
        out_path,
        media_type="text/csv; charset=utf-8",
        filename="data_extract.csv",
    )