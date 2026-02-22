from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
import csv
import boto3
from botocore.config import Config

app = FastAPI()

# 先用 *，你穩定後再改成只允許你的 GitHub Pages 網域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ====== R2 / CSV 設定（用環境變數） ======
R2_ENDPOINT = os.environ.get("R2_ENDPOINT")  # e.g. https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")
R2_BUCKET = os.environ.get("R2_BUCKET")
R2_OBJECT_KEY = os.environ.get("R2_OBJECT_KEY", "merged_survey.csv")  # 你在 R2 裡的檔名/key

LOCAL_CSV_PATH = os.environ.get("LOCAL_CSV_PATH", "/tmp/merged_survey.csv")


class ExtractRequest(BaseModel):
    samples: list[str]            # selectedSamples
    variables: list[str]          # selectedVariables (qid)
    exportHeaders: list[str]      # 你前端用 getExportHeaderForQuestion() 算出的欄名（對應 variables 順序）


def ensure_csv_local():
    """啟動時/需要時，確保大 CSV 在本機（Render 的 /tmp 是可用的）"""
    if os.path.exists(LOCAL_CSV_PATH) and os.path.getsize(LOCAL_CSV_PATH) > 0:
        return

    # 檢查必要環境變數
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
    return {"ok": True, "csv_ready": ok, "path": LOCAL_CSV_PATH, "object_key": R2_OBJECT_KEY}


@app.post("/extract")
def extract(req: ExtractRequest):
    if len(req.samples) == 0:
        raise HTTPException(status_code=400, detail="samples is empty")
    if len(req.variables) == 0:
        raise HTTPException(status_code=400, detail="variables is empty")
    if len(req.exportHeaders) != len(req.variables):
        raise HTTPException(status_code=400, detail="exportHeaders must match variables length")

    ensure_csv_local()

    samples_set = set(req.samples)
    variables = req.variables
    export_headers = req.exportHeaders

    def generate():
        # 逐行讀、逐行輸出（不吃爆記憶體）
        with open(LOCAL_CSV_PATH, "r", encoding="utf-8", newline="") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            if not header:
                return

            # 找 YEAR/ID 欄位
            try:
                year_idx = header.index("YEAR")
            except ValueError:
                raise HTTPException(status_code=500, detail="YEAR column not found in CSV")

            try:
                id_idx = header.index("ID")
            except ValueError:
                raise HTTPException(status_code=500, detail="ID column not found in CSV")

            # 題號欄位 idx
            idx_map = {}
            for qid in variables:
                if qid in header:
                    idx_map[qid] = header.index(qid)
                else:
                    # 如果沒找到就讓它輸出空白（跟你前端舊邏輯一致）
                    idx_map[qid] = None

            # 輸出表頭：YEAR + exportHeaders + ID
            out_header = ["YEAR", *export_headers, "ID"]
            yield (",".join(_escape_csv(x) for x in out_header) + "\n").encode("utf-8")

            for row in reader:
                if len(row) <= max(year_idx, id_idx):
                    continue

                row_year = row[year_idx]
                if row_year not in samples_set:
                    continue

                out = [row_year]
                for qid in variables:
                    idx = idx_map.get(qid)
                    val = row[idx] if (idx is not None and idx < len(row)) else ""
                    out.append(val)
                out.append(row[id_idx] if id_idx < len(row) else "")

                yield (",".join(_escape_csv(x) for x in out) + "\n").encode("utf-8")

    headers = {
        "Content-Disposition": 'attachment; filename="data_extract.csv"'
    }
    return StreamingResponse(generate(), media_type="text/csv; charset=utf-8", headers=headers)


def _escape_csv(val) -> str:
    s = "" if val is None else str(val)
    if any(c in s for c in [",", '"', "\n", "\r"]):
        s = '"' + s.replace('"', '""') + '"'
    return s