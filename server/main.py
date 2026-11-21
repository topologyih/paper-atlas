"""Optional API for caching, URL fetches, and PDF parsing.

Run: python3 -m uvicorn main:app --app-dir server --port 8787
"""

from __future__ import annotations

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from paperatlas.client import OpenAlexClient, OpenAlexError
from paperatlas.expand import AmbiguousQuery, build_graph
from paperatlas.pdf_extract import extract_pdf

app = FastAPI(title="PaperAtlas")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class GraphRequest(BaseModel):
    query: str
    limit: int = Field(default=100, ge=10, le=500)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/graph")
def graph(body: GraphRequest):
    client = OpenAlexClient("cache/openalex")
    try:
        return build_graph(body.query, limit=body.limit, client=client, origin="server")
    except AmbiguousQuery as error:
        raise HTTPException(status_code=409, detail={"message": str(error), "candidates": error.candidates}) from error
    except OpenAlexError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.post("/api/pdf")
async def pdf(file: UploadFile = File(...)):
    data = await file.read()
    try:
        return extract_pdf(data)
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
