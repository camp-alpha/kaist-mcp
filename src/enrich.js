#!/usr/bin/env node

/**
 * 교수 데이터 보강 — 상세 페이지/연구실 홈페이지 크롤링
 *
 * 1. CS: /people/view?idx=N 페이지에서 연구실 URL, 논문 추출
 * 2. Math: 개인 홈페이지 링크 추출
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "..", "data", "kaist.json");

async function fetchHTML(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KaistMCP/0.1)" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── CS 교수 상세 페이지 링크 수집 ──
async function getCSProfLinks() {
  console.log("Collecting CS professor detail links...");
  const html = await fetchHTML("https://cs.kaist.ac.kr/people/faculty");
  if (!html) return {};
  const $ = cheerio.load(html);
  const links = {};

  $("li.horiz_item").each((_, el) => {
    const $el = $(el);
    const nameKo = $el.text().match(/^[\s]*([가-힣]{2,4})/);
    const href = $el.find("a[href*='view']").first().attr("href");
    if (nameKo && href) {
      const url = href.startsWith("/") ? `https://cs.kaist.ac.kr${href}` : href;
      links[nameKo[1]] = url;
    }
  });
  console.log(`  Found ${Object.keys(links).length} detail links`);
  return links;
}

// ── CS 교수 상세 페이지 파싱 ──
async function enrichCSProfessor(prof, detailUrl) {
  const html = await fetchHTML(detailUrl);
  if (!html) return prof;
  const $ = cheerio.load(html);
  const text = $("body").text();

  // 연구실 홈페이지
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const linkText = $(el).text().trim().toLowerCase();
    if ((linkText.includes("lab") || linkText.includes("homepage") || linkText.includes("홈페이지") || linkText.includes("연구실")) &&
        href.startsWith("http") && !href.includes("kaist.ac.kr/people")) {
      if (!prof.lab_url) prof.lab_url = href;
    }
  });

  // 외부 홈페이지 링크
  $("a[href*='http']").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href.includes("kaist.ac.kr") && !href.includes("google") && !href.includes("scholar")) {
      if (href.includes(".kaist.") || href.includes("lab") || href.includes("research")) {
        if (!prof.lab_url) prof.lab_url = href;
      }
    }
  });

  // 논문 (publications 섹션)
  const papers = [];
  $("li, .publication, .paper").each((_, el) => {
    const t = $(el).text().trim();
    // 논문 패턴: 연도 포함, 길이 50자 이상
    if (/20[12]\d/.test(t) && t.length > 50 && t.length < 500) {
      papers.push(t.replace(/\s+/g, " ").slice(0, 200));
    }
  });
  if (papers.length > 0) {
    prof.recent_papers = papers.slice(0, 5);
  }

  prof.url = detailUrl;
  return prof;
}

// ── Math 교수 홈페이지 링크 수집 ──
async function enrichMathProfessors(professors) {
  console.log("Enriching Math professors...");
  const html = await fetchHTML("https://mathsci.kaist.ac.kr/home/people/professor/");
  if (!html) return;
  const $ = cheerio.load(html);

  // 본문에서 링크 추출
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim();
    const nameMatch = text.match(/([가-힣]{2,4})/);
    if (nameMatch && href.startsWith("http")) {
      const prof = professors.find(p => p.name_ko === nameMatch[1] && p.department_id === "math");
      if (prof) {
        prof.url = href;
        if (href.includes("lab") || href.includes("~")) {
          prof.lab_url = href;
        }
      }
    }
  });
}

// ── 메인 ──
async function main() {
  console.log("KAIST MCP Data Enrichment\n");

  const data = JSON.parse(readFileSync(DATA_PATH, "utf-8"));

  // CS 교수 보강
  const csLinks = await getCSProfLinks();
  const csProfessors = data.professors.filter(p => p.department_id === "cs");
  let enriched = 0;

  for (const prof of csProfessors) {
    const detailUrl = csLinks[prof.name_ko];
    if (detailUrl) {
      await enrichCSProfessor(prof, detailUrl);
      enriched++;
      if (enriched % 10 === 0) console.log(`  CS enriched: ${enriched}/${csProfessors.length}`);
      await sleep(300); // rate limiting
    }
  }
  console.log(`  CS total enriched: ${enriched}`);

  // Math 교수 보강
  const mathProfessors = data.professors.filter(p => p.department_id === "math");
  await enrichMathProfessors(mathProfessors);
  const mathWithUrl = mathProfessors.filter(p => p.url).length;
  console.log(`  Math with URLs: ${mathWithUrl}`);

  // 저장
  data.meta.enriched_at = new Date().toISOString();
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  console.log(`\nSaved: ${DATA_PATH}`);

  // 통계
  const withUrl = data.professors.filter(p => p.url).length;
  const withLabUrl = data.professors.filter(p => p.lab_url).length;
  const withPapers = data.professors.filter(p => p.recent_papers?.length > 0).length;
  console.log(`URLs: ${withUrl}/${data.professors.length}, Lab URLs: ${withLabUrl}, Papers: ${withPapers}`);
}

main().catch(console.error);
