#!/usr/bin/env node

/**
 * KAIST 학과별 교수/연구실 정보 스크래핑 v2
 * 학과마다 다른 CMS → 학과별 특화 파서
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "..", "data", "kaist.json");

async function fetchHTML(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KaistMCP/0.1)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.error(`  Fetch failed: ${url} — ${e.message}`);
    return null;
  }
}

// ── 전산학부 파서 ──
async function scrapeCS() {
  console.log("Scraping: 전산학부");
  const html = await fetchHTML("https://cs.kaist.ac.kr/people/faculty");
  if (!html) return [];
  const $ = cheerio.load(html);
  const professors = [];

  $("li.horiz_item").each((_, el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, " ").trim();

    // 이름 (한글)
    const nameKo = text.match(/^([가-힣]{2,4})/);
    if (!nameKo) return;

    // 영문 이름 (상세 페이지 링크 텍스트에서)
    const link = $el.find("a").first().attr("href") || "";
    const nameEn = text.match(/([A-Z][a-z]+(?:[-\s][A-Z][a-z]+)+)/) || "";

    // 이메일 (emailWrite 패턴)
    const emailMatch = text.match(/emailWrite\('([^']+)'\)/);
    const email = emailMatch ? emailMatch[1].replace("^*", "@") : "";

    // 연구 분야 (마지막 부분, 쉼표 구분)
    const parts = text.split(/\d{4}\s*/);
    const researchText = parts.length > 1 ? parts[parts.length - 1] : "";
    const research = researchText.split(/[,،·]/).map(s => s.trim()).filter(s => s.length > 1);

    // 연구실
    const labMatch = text.match(/연구실:\s*([^e]+?)(?:\s*email|$)/);
    const lab = labMatch ? labMatch[1].trim() : "";

    // 직위
    const posMatch = text.match(/교수,\s*([^교]+?)(?:\s*교수)?연구실/);
    const position = posMatch ? posMatch[1].trim() : "교수";

    professors.push({
      name_ko: nameKo[1],
      name_en: nameEn ? nameEn[0] : "",
      department: "전산학부",
      department_id: "cs",
      position,
      email,
      url: link.startsWith("/") ? `https://cs.kaist.ac.kr${link}` : link,
      research_areas: research,
      keywords: [],
      lab,
      recent_papers: [],
    });
  });

  console.log(`  전산학부: ${professors.length}명`);
  return professors;
}

// ── 물리학과 파서 ──
async function scrapePhysics() {
  console.log("Scraping: 물리학과");
  // 물리학과는 XE CMS, 실제 교수 목록은 별도 URL
  const html = await fetchHTML("https://physics.kaist.ac.kr/index.php?mid=p_people1&category=193");
  if (!html) {
    // 영문 페이지 시도
    const htmlEn = await fetchHTML("https://physics.kaist.ac.kr/eng/people/faculty");
    if (!htmlEn) return [];
    return parsePhysicsPage(htmlEn);
  }
  return parsePhysicsPage(html);
}

function parsePhysicsPage(html) {
  const $ = cheerio.load(html);
  const professors = [];

  // XE 게시판 스타일: .member, .list 등 여러 패턴 시도
  const selectors = [
    ".document_list .item, .board_list .item",
    "table tbody tr",
    ".professor-card, .people-card, .member-item",
    "li.professor, li.people",
    ".xe_content .item",
  ];

  let found = false;
  for (const sel of selectors) {
    const items = $(sel);
    if (items.length >= 3) {
      console.log(`  Found ${items.length} items: ${sel}`);
      items.each((_, el) => {
        const text = $(el).text().replace(/\s+/g, " ").trim();
        const nameKo = text.match(/([가-힣]{2,4})/);
        const nameEn = text.match(/([A-Z][a-z]+(?:[-\s][A-Z][a-z]+)+)/);
        if (nameKo && text.length < 500) {
          professors.push({
            name_ko: nameKo[1],
            name_en: nameEn ? nameEn[0] : "",
            department: "물리학과",
            department_id: "physics",
            position: "교수",
            email: (text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+)/) || [])[1] || "",
            url: "",
            research_areas: [],
            keywords: [],
            lab: "",
            recent_papers: [],
          });
        }
      });
      found = true;
      break;
    }
  }

  if (!found) {
    // 전체 텍스트에서 교수 이름 추출
    const bodyText = $("body").text();
    // "이름 (English Name)" 패턴
    const matches = [...bodyText.matchAll(/([가-힣]{2,4})\s*[\(（]\s*([A-Z][a-z]+(?:[\s-][A-Z][a-z-]+)+)\s*[\)）]/g)];
    for (const m of matches) {
      professors.push({
        name_ko: m[1],
        name_en: m[2],
        department: "물리학과",
        department_id: "physics",
        position: "교수",
        email: "", url: "", research_areas: [], keywords: [], lab: "", recent_papers: [],
      });
    }
  }

  // 메뉴/네비 텍스트 필터
  const menuWords = new Set(["교수진", "구성원", "공지사항", "교수초빙", "연구", "교육", "뉴스", "동문", "행정"]);
  const filtered = professors.filter(p => !menuWords.has(p.name_ko) && p.name_ko.length >= 2);
  console.log(`  물리학과: ${filtered.length}명`);
  return filtered;
}

// ── 수리과학과 파서 ──
async function scrapeMath() {
  console.log("Scraping: 수리과학과");
  const html = await fetchHTML("https://mathsci.kaist.ac.kr/home/people/professor/");
  if (!html) return [];
  const $ = cheerio.load(html);
  const professors = [];

  // WordPress 기반 — 본문에서 교수 정보 추출
  // 패턴: 한글이름 (English Name) - 또는 테이블/리스트
  const content = $(".entry-content, .page-content, article, .content-area").first();
  const bodyText = content.length ? content.text() : $("body").text();

  // "이름 (English)" 패턴
  const namePattern = /([가-힣]{2,4})\s*[\(（]\s*([A-Za-z]+(?:[\s,.-]+[A-Za-z]+)*)\s*[\)）]/g;
  const matches = [...bodyText.matchAll(namePattern)];

  // 메뉴/네비 필터용
  const menuWords = new Set([
    "교수", "연구분야", "학사일정", "정보보안", "응용수학", "수학그룹",
    "뉴스", "소개", "공지", "직원", "학과", "연수",
  ]);

  for (const m of matches) {
    const nameKo = m[1];
    const nameEn = m[2].trim();

    if (menuWords.has(nameKo)) continue;
    if (nameKo.length < 2) continue;
    // 영문 이름이 너무 짧거나 대학이름이면 제외
    if (nameEn.length < 3) continue;
    if (/University|Institute|College|School/i.test(nameEn)) continue;

    professors.push({
      name_ko: nameKo,
      name_en: nameEn,
      department: "수리과학과",
      department_id: "math",
      position: "교수",
      email: "",
      url: "",
      research_areas: [],
      keywords: [],
      lab: "",
      recent_papers: [],
    });
  }

  // 중복 제거
  const seen = new Set();
  const unique = professors.filter(p => {
    if (seen.has(p.name_ko)) return false;
    seen.add(p.name_ko);
    return true;
  });

  console.log(`  수리과학과: ${unique.length}명`);
  return unique;
}

// ── 메인 ──
async function main() {
  console.log("KAIST MCP Data Scraper v2\n");

  const cs = await scrapeCS();
  const physics = await scrapePhysics();
  const math = await scrapeMath();

  const allProfessors = [...cs, ...physics, ...math];

  const data = {
    meta: {
      university: "KAIST",
      scraped_at: new Date().toISOString(),
      total_professors: allProfessors.length,
    },
    departments: [
      { id: "cs", name_ko: "전산학부", name_en: "School of Computing", professor_count: cs.length },
      { id: "physics", name_ko: "물리학과", name_en: "Department of Physics", professor_count: physics.length },
      { id: "math", name_ko: "수리과학과", name_en: "Department of Mathematical Sciences", professor_count: math.length },
    ],
    professors: allProfessors,
    labs: [],
  };

  mkdirSync(join(__dirname, "..", "data"), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(data, null, 2));
  console.log(`\nSaved: ${OUT_PATH}`);
  console.log(`Total: ${allProfessors.length} professors (CS:${cs.length} Physics:${physics.length} Math:${math.length})`);
}

main().catch(console.error);
