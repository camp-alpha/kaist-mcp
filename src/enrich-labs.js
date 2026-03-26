#!/usr/bin/env node

/**
 * 연구실 홈페이지 크롤링 — 논문, 연구 키워드, 연구실명 추출
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "..", "data", "kaist.json");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchHTML(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KaistMCP/0.1)" },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function extractPapers(html, url) {
  const $ = cheerio.load(html);
  const papers = [];

  // 논문 패턴: 연도(2020-2026) + 길이 50자 이상
  const candidates = new Set();

  // li, p, tr, div 등에서 논문 추출
  $("li, p, tr, .publication, .paper, .pub-item, .bib-item").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length < 40 || text.length > 600) return;
    if (!/20[12]\d/.test(text)) return;
    // 논문 특징: 저자명, 학회/저널명, 연도
    if (/[A-Z][a-z]+/.test(text) && (
      /conference|journal|proc|ieee|acm|arxiv|workshop|symposium|transactions|letters|review|nature|science|physical/i.test(text) ||
      /vol\.|pp\.|no\.|pages/i.test(text) ||
      text.includes(",") // 저자 구분 쉼표
    )) {
      candidates.add(text.slice(0, 300));
    }
  });

  return [...candidates].slice(0, 10);
}

function extractLabInfo(html, url) {
  const $ = cheerio.load(html);
  const text = $("body").text();

  // 연구실 이름 추출
  let labName = "";
  const titleTag = $("title").text().trim();
  if (titleTag && titleTag.length < 100) labName = titleTag;

  // h1 태그
  const h1 = $("h1").first().text().trim();
  if (h1 && h1.length < 80) labName = h1;

  // 연구 키워드 추출 (meta keywords, 또는 research interests 섹션)
  const keywords = [];
  const metaKw = $('meta[name="keywords"]').attr("content");
  if (metaKw) {
    keywords.push(...metaKw.split(/[,;]/).map(s => s.trim()).filter(s => s.length > 1));
  }

  // "Research" 섹션 근처 텍스트에서 키워드
  $("h2, h3, h4").each((_, el) => {
    const heading = $(el).text().toLowerCase();
    if (heading.includes("research") || heading.includes("interest") || heading.includes("연구")) {
      const next = $(el).next();
      if (next.length) {
        const items = next.text().split(/[,;·•\n]/).map(s => s.trim()).filter(s => s.length > 2 && s.length < 60);
        keywords.push(...items.slice(0, 10));
      }
    }
  });

  return { labName, keywords: [...new Set(keywords)].slice(0, 10) };
}

async function main() {
  console.log("KAIST MCP — Lab Homepage Enrichment\n");

  const data = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  let crawled = 0;
  let papersFound = 0;

  for (const prof of data.professors) {
    const url = prof.lab_url || prof.url;
    if (!url || !url.startsWith("http")) continue;

    const html = await fetchHTML(url);
    if (!html) {
      console.log(`  FAIL: ${prof.name_ko} — ${url.slice(0, 50)}`);
      await sleep(500);
      continue;
    }

    // 논문 추출
    const papers = extractPapers(html, url);
    if (papers.length > 0) {
      prof.recent_papers = papers;
      papersFound++;
    }

    // 연구실 정보
    const labInfo = extractLabInfo(html, url);
    if (labInfo.labName && !prof.lab) prof.lab = labInfo.labName;
    if (labInfo.keywords.length > 0) prof.keywords = labInfo.keywords;

    crawled++;
    if (crawled % 5 === 0) console.log(`  Crawled: ${crawled} (papers: ${papersFound})`);
    await sleep(1000);
  }

  data.meta.lab_enriched_at = new Date().toISOString();
  data.meta.lab_crawled = crawled;
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

  const total = data.professors.length;
  const withPapers = data.professors.filter(p => p.recent_papers?.length > 0).length;
  const withKeywords = data.professors.filter(p => p.keywords?.length > 0).length;
  const withLab = data.professors.filter(p => p.lab).length;

  console.log(`\n=== 결과 ===`);
  console.log(`크롤링: ${crawled}/${total}`);
  console.log(`논문: ${withPapers} | 키워드: ${withKeywords} | 연구실명: ${withLab}`);
  console.log(`Saved: ${DATA_PATH}`);
}

main().catch(console.error);
