#!/usr/bin/env node

/**
 * KAIST MCP Server
 *
 * Tools:
 *   - search_professors: 교수 검색 (이름, 학과, 연구 분야)
 *   - search_labs: 연구실 검색
 *   - get_professor_detail: 교수 상세 정보 (논문, 연구 키워드)
 *   - list_departments: 학과 목록
 *   - search_papers: 논문 검색 (키워드, 교수명)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "..", "data", "kaist.json");

// 데이터 로드
let db = { departments: [], professors: [], labs: [] };
if (existsSync(DATA_PATH)) {
  db = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
}

const server = new McpServer({
  name: "kaist-mcp",
  version: "0.1.0",
});

// Tool: 학과 목록
server.tool("list_departments", {}, async () => {
  const depts = db.departments.map(d => `${d.name_ko} (${d.name_en}) — ${d.professor_count || '?'}명`);
  return { content: [{ type: "text", text: depts.join("\n") || "데이터 없음" }] };
});

// Tool: 교수 검색
server.tool(
  "search_professors",
  { query: z.string().describe("교수 이름, 연구 분야, 키워드 (한글/영어)") },
  async ({ query }) => {
    const q = query.toLowerCase();
    const results = db.professors.filter(p =>
      (p.name_ko || "").includes(query) ||
      (p.name_en || "").toLowerCase().includes(q) ||
      (p.department || "").includes(query) ||
      (p.research_areas || []).some(a => a.toLowerCase().includes(q)) ||
      (p.keywords || []).some(k => k.toLowerCase().includes(q))
    );

    if (results.length === 0) {
      return { content: [{ type: "text", text: `"${query}"에 대한 검색 결과 없음.` }] };
    }

    const text = results.slice(0, 20).map(p =>
      `${p.name_ko} (${p.name_en || ''}) | ${p.department}\n` +
      `  연구: ${(p.research_areas || []).join(", ")}\n` +
      `  랩: ${p.lab || '-'}\n` +
      `  URL: ${p.url || '-'}`
    ).join("\n\n");

    return { content: [{ type: "text", text: `${results.length}건 검색됨:\n\n${text}` }] };
  }
);

// Tool: 연구실 검색
server.tool(
  "search_labs",
  { query: z.string().describe("연구실 이름, 연구 분야, 키워드") },
  async ({ query }) => {
    const q = query.toLowerCase();
    const results = db.labs.filter(l =>
      (l.name || "").toLowerCase().includes(q) ||
      (l.professor || "").includes(query) ||
      (l.department || "").includes(query) ||
      (l.research_areas || []).some(a => a.toLowerCase().includes(q))
    );

    if (results.length === 0) {
      return { content: [{ type: "text", text: `"${query}"에 대한 연구실 없음.` }] };
    }

    const text = results.slice(0, 15).map(l =>
      `${l.name} | ${l.department}\n` +
      `  교수: ${l.professor}\n` +
      `  연구: ${(l.research_areas || []).join(", ")}\n` +
      `  URL: ${l.url || '-'}`
    ).join("\n\n");

    return { content: [{ type: "text", text: `${results.length}건:\n\n${text}` }] };
  }
);

// Tool: 교수 상세
server.tool(
  "get_professor_detail",
  { name: z.string().describe("교수 이름 (한글 또는 영어)") },
  async ({ name }) => {
    const q = name.toLowerCase();
    const prof = db.professors.find(p =>
      (p.name_ko || "") === name ||
      (p.name_en || "").toLowerCase() === q
    );

    if (!prof) {
      return { content: [{ type: "text", text: `"${name}" 교수를 찾을 수 없음.` }] };
    }

    const detail = [
      `# ${prof.name_ko} (${prof.name_en || ''})`,
      `학과: ${prof.department}`,
      `직위: ${prof.position || '-'}`,
      `연구실: ${prof.lab || '-'}`,
      `이메일: ${prof.email || '-'}`,
      `홈페이지: ${prof.url || '-'}`,
      ``,
      `## 연구 분야`,
      ...(prof.research_areas || []).map(a => `- ${a}`),
      ``,
      `## 키워드`,
      (prof.keywords || []).join(", ") || '-',
      ``,
      `## 최근 논문`,
      ...(prof.recent_papers || []).map(p => `- ${p}`),
    ].join("\n");

    return { content: [{ type: "text", text: detail }] };
  }
);

// Tool: 논문 검색
server.tool(
  "search_papers",
  { query: z.string().describe("논문 키워드 또는 교수명") },
  async ({ query }) => {
    const q = query.toLowerCase();
    const results = [];

    for (const prof of db.professors) {
      for (const paper of (prof.recent_papers || [])) {
        if (paper.toLowerCase().includes(q) ||
            (prof.name_ko || "").includes(query) ||
            (prof.name_en || "").toLowerCase().includes(q)) {
          results.push({ paper, professor: prof.name_ko, department: prof.department });
        }
      }
    }

    if (results.length === 0) {
      return { content: [{ type: "text", text: `"${query}"에 대한 논문 없음.` }] };
    }

    const text = results.slice(0, 20).map(r =>
      `${r.paper}\n  — ${r.professor} (${r.department})`
    ).join("\n\n");

    return { content: [{ type: "text", text: `${results.length}건:\n\n${text}` }] };
  }
);

// 서버 시작
const transport = new StdioServerTransport();
await server.connect(transport);
