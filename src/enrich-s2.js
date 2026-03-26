#!/usr/bin/env node

/**
 * Semantic Scholar API로 교수 논문 데이터 보강
 * + 연구실 홈페이지 수집 (Math 기존 enrich 포함)
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "..", "data", "kaist.json");

const S2_API = "https://api.semanticscholar.org/graph/v1";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function searchAuthor(name, dept) {
  const query = encodeURIComponent(`${name} KAIST`);
  try {
    const res = await fetch(
      `${S2_API}/author/search?query=${query}&limit=3&fields=name,affiliations,paperCount,hIndex,url`,
      { headers: { "User-Agent": "KaistMCP/0.1" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    // KAIST 소속인 저자 찾기
    for (const author of (data.data || [])) {
      const affs = (author.affiliations || []).join(" ").toLowerCase();
      if (affs.includes("kaist") || affs.includes("korea advanced")) {
        return author;
      }
    }
    // 소속 불명이면 첫 번째 반환
    return data.data?.[0] || null;
  } catch { return null; }
}

async function getAuthorPapers(authorId) {
  try {
    const res = await fetch(
      `${S2_API}/author/${authorId}/papers?limit=5&fields=title,year,venue,url&sort=year:desc`,
      { headers: { "User-Agent": "KaistMCP/0.1" } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map(p => ({
      title: p.title,
      year: p.year,
      venue: p.venue || "",
      url: p.url || "",
    }));
  } catch { return []; }
}

async function main() {
  console.log("KAIST MCP — Semantic Scholar Enrichment\n");

  const data = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  let enriched = 0;
  let total = data.professors.length;

  for (let i = 0; i < data.professors.length; i++) {
    const prof = data.professors[i];

    // 영문 이름이 있으면 그걸로 검색, 없으면 스킵
    const searchName = prof.name_en || prof.name_ko;
    if (!searchName || searchName.length < 2) continue;

    const author = await searchAuthor(searchName, prof.department);
    if (author) {
      prof.s2_id = author.authorId;
      prof.s2_url = author.url || "";
      prof.h_index = author.hIndex || 0;
      prof.paper_count = author.paperCount || 0;

      // 논문 가져오기
      const papers = await getAuthorPapers(author.authorId);
      if (papers.length > 0) {
        prof.recent_papers = papers.map(p =>
          `${p.title} (${p.year || '?'}) ${p.venue ? '— ' + p.venue : ''}`
        );
      }
      enriched++;
    }

    if ((i + 1) % 10 === 0) {
      console.log(`  Progress: ${i + 1}/${total} (enriched: ${enriched})`);
    }

    // Rate limiting: S2 API 무료는 1 req/sec
    await sleep(3000);
  }

  // Math 교수 홈페이지 링크 (cheerio로)
  console.log("\nEnriching Math homepage links...");
  try {
    const res = await fetch("https://mathsci.kaist.ac.kr/home/people/professor/",
      { headers: { "User-Agent": "Mozilla/5.0" } });
    const html = await res.text();
    const { load } = await import("cheerio");
    const $ = load(html);
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      const nameMatch = text.match(/([가-힣]{2,4})/);
      if (nameMatch && href.startsWith("http")) {
        const prof = data.professors.find(p => p.name_ko === nameMatch[1] && p.department_id === "math");
        if (prof) {
          prof.url = prof.url || href;
          if (href.includes("lab") || href.includes("~")) {
            prof.lab_url = href;
          }
        }
      }
    });
  } catch (e) {
    console.log(`  Math links failed: ${e.message}`);
  }

  data.meta.enriched_at = new Date().toISOString();
  data.meta.s2_enriched = enriched;
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

  const withPapers = data.professors.filter(p => p.recent_papers?.length > 0).length;
  const withUrl = data.professors.filter(p => p.url || p.s2_url).length;
  console.log(`\n=== 결과 ===`);
  console.log(`S2 매칭: ${enriched}/${total}`);
  console.log(`논문 보유: ${withPapers} | URL 보유: ${withUrl}`);
  console.log(`Saved: ${DATA_PATH}`);
}

main().catch(console.error);
