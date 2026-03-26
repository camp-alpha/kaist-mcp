# KAIST MCP Server

KAIST 대학 연구실 정보를 MCP(Model Context Protocol)로 제공하는 서버.

## Tools

| Tool | 설명 |
|------|------|
| `list_departments` | 학과 목록 |
| `search_professors` | 교수 검색 (이름, 분야, 키워드) |
| `search_labs` | 연구실 검색 |
| `get_professor_detail` | 교수 상세 (논문, 키워드) |
| `search_papers` | 논문 검색 |

## 사용법

```bash
# 데이터 수집
npm install
npm run build-data

# MCP 서버 실행 (stdio)
npm start

# Claude Code에서 사용
# settings.json > mcpServers:
{
  "kaist": {
    "command": "node",
    "args": ["/path/to/kaist-mcp/src/index.js"],
    "trust": true
  }
}

# Gemini CLI에서 사용
# ~/.gemini/settings.json > mcpServers:
{
  "kaist": {
    "command": "node",
    "args": ["/path/to/kaist-mcp/src/index.js"]
  }
}
```

## 데이터 범위

Phase 1: 물리학과, 전산학부, 수리과학과
Phase 2: 전체 학과 확장
